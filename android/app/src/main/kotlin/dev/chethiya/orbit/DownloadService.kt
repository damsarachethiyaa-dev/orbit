package dev.chethiya.orbit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationCompat
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class DownloadService : Service() {

    companion object {
        const val ACTION_START_DOWNLOAD = "dev.chethiya.orbit.action.START_DOWNLOAD"
        const val ACTION_CANCEL_DOWNLOAD = "dev.chethiya.orbit.action.CANCEL_DOWNLOAD"
        const val ACTION_RECOVER_DOWNLOADS = "dev.chethiya.orbit.action.RECOVER_DOWNLOADS"
        const val EXTRA_URL = "extra_url"
        const val EXTRA_JOB_ID = "extra_job_id"
        const val EXTRA_DIRECT_URL = "extra_direct_url"
        const val EXTRA_QUALITY = "extra_quality"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SITE = "extra_site"
        const val EXTRA_THUMB = "extra_thumb"
        const val EXTRA_IS_IMAGE = "extra_is_image"
        const val EXTRA_IMAGE_URLS = "extra_image_urls"
        const val CHANNEL_ID = "orbit_downloads_channel"
        const val CHANNEL_NAME = "Orbit Downloads"
    }

    private val activeJobsCount = AtomicInteger(0)
    private val activeJobIds = ConcurrentHashMap.newKeySet<String>()
    private val speedRegex = Regex("""at\s+([0-9.]+[KMGTP]?i?B/s)""", RegexOption.IGNORE_CASE)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        OrbitEngine.init(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL_DOWNLOAD -> intent.getStringExtra(EXTRA_JOB_ID)?.let { cancelDownload(it) }
            ACTION_START_DOWNLOAD -> beginDownload(intent, true)
        }
        // START_STICKY can restart us with a null Intent after process death.
        // The journal restores every unfinished job, not just the most recent one.
        recoverPendingDownloads()
        if (activeJobsCount.get() == 0) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun recoverPendingDownloads() {
        val completedIds = HashSet<String>()
        val history = OrbitEngine.readHistory(applicationContext)
        for (i in 0 until history.length()) {
            history.optJSONObject(i)?.optString("id")?.let { completedIds.add(it) }
        }
        for (recoveryIntent in PendingDownloads.recoveryIntents(applicationContext)) {
            val id = recoveryIntent.getStringExtra(EXTRA_JOB_ID) ?: continue
            if (id in completedIds) {
                PendingDownloads.remove(applicationContext, id)
            } else if (!activeJobIds.contains(id)) {
                beginDownload(recoveryIntent, false)
            }
        }
    }

    private fun beginDownload(intent: Intent, persist: Boolean) {
            val rawUrl = intent.getStringExtra(EXTRA_URL)
            val cleanUrl = OrbitEngine.extractUrl(rawUrl) ?: rawUrl
            if (cleanUrl.isNullOrBlank()) return

            var jobId = intent.getStringExtra(EXTRA_JOB_ID)
            if (jobId.isNullOrBlank()) {
                jobId = UUID.randomUUID().toString().substring(0, 8)
            }
            intent.putExtra(EXTRA_JOB_ID, jobId)
            if (!activeJobIds.add(jobId)) return
            val notifId = (jobId.hashCode().and(0x7fffffff) % 90000) + 1000

            val passedTitle = intent.getStringExtra(EXTRA_TITLE)
            val passedDirect = intent.getStringExtra(EXTRA_DIRECT_URL)
            val passedQuality = intent.getStringExtra(EXTRA_QUALITY) ?: OrbitEngine.currentDefaultQuality(this)
            val passedSite = intent.getStringExtra(EXTRA_SITE) ?: "Video"
            val passedThumb = intent.getStringExtra(EXTRA_THUMB) ?: ""
            val passedIsImage = intent.getBooleanExtra(EXTRA_IS_IMAGE, false)
            val passedImageUrls = intent.getStringArrayListExtra(EXTRA_IMAGE_URLS) ?: arrayListOf<String>()

            var job = OrbitEngine.jobsById[jobId]
            if (job == null) {
                job = OrbitEngine.DownloadJob(
                    id = jobId,
                    url = cleanUrl,
                    title = passedTitle?.ifBlank { "Downloading…" } ?: "Downloading…",
                    site = passedSite,
                    thumb = passedThumb,
                    quality = passedQuality,
                    state = "downloading",
                    isImage = passedIsImage,
                    directUrl = passedDirect ?: "",
                    imageUrls = if (passedIsImage) passedImageUrls else emptyList()
                )
                OrbitEngine.activeJobs.add(0, job)
                OrbitEngine.jobsById[jobId] = job
            } else if (job.isImage && job.imageUrls.isEmpty() && passedImageUrls.isNotEmpty()) {
                job.imageUrls = passedImageUrls
            }

            activeJobsCount.incrementAndGet()

            val initialNotification = buildNotification(
                notifId = notifId,
                jobId = jobId,
                title = if (job.title.isNotBlank()) job.title else "Orbit: Connecting...",
                text = "Starting download in background...",
                progress = 0,
                indeterminate = true,
                ongoing = true
            )

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(notifId, initialNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(notifId, initialNotification)
                }
                if (persist) PendingDownloads.save(applicationContext, intent, jobId)
                OrbitEngine.executor.execute {
                    runDownload(notifId, job, cleanUrl, passedDirect, if (job.isImage) passedImageUrls else emptyList())
                }
            } catch (e: Exception) {
                activeJobIds.remove(jobId)
                activeJobsCount.decrementAndGet()
                PendingDownloads.remove(applicationContext, jobId)
                job.state = "error"
                job.error = OrbitEngine.cleanErrorMessage(e.message)
            }
    }

    private fun cancelDownload(jobId: String) {
        activeJobIds.remove(jobId)
        PendingDownloads.remove(applicationContext, jobId)
        OrbitEngine.jobsById[jobId]?.let {
            it.state = "cancelled"
        }
        try {
            YoutubeDL.getInstance().destroyProcessById(jobId)
        } catch (_: Exception) {}
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notifId = (jobId.hashCode().and(0x7fffffff) % 90000) + 1000
        nm.cancel(notifId)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows progress and completion for Orbit downloads"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(
        notifId: Int,
        jobId: String,
        title: String,
        text: String,
        progress: Int = 0,
        indeterminate: Boolean = false,
        ongoing: Boolean = true
    ): Notification {
        val cancelIntent = Intent(this, DownloadService::class.java).apply {
            action = ACTION_CANCEL_DOWNLOAD
            putExtra(EXTRA_JOB_ID, jobId)
        }
        val pCancel = PendingIntent.getService(
            this,
            notifId,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val appIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pApp = PendingIntent.getActivity(
            this,
            0,
            appIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText("Orbit Downloader")
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setContentIntent(pApp)
            .setProgress(100, progress, indeterminate)
            .apply {
                if (ongoing) {
                    addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", pCancel)
                }
            }
            .build()
    }

    private fun runDownload(
        notifId: Int,
        job: OrbitEngine.DownloadJob,
        url: String,
        passedDirectUrl: String?,
        imageUrls: List<String> = emptyList()
    ) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        try {
            OrbitEngine.initLatch.await(30, java.util.concurrent.TimeUnit.SECONDS)

            // Case 1: Explicitly marked as image job from inside the app
            if (job.isImage) {
                val resolved = when {
                    imageUrls.isNotEmpty() -> imageUrls
                    job.imageUrls.isNotEmpty() -> job.imageUrls
                    else -> {
                        val social = OrbitEngine.resolveSocialAndWebImage(url)
                        if (social != null && social.imageUrls.isNotEmpty()) {
                            if (job.title.isBlank() || job.title == "Downloading…") job.title = social.title
                            if (job.site.isBlank() || job.site == "Video") job.site = social.site
                            social.imageUrls
                        } else {
                            listOf(passedDirectUrl?.takeIf { it.isNotBlank() } ?: url)
                        }
                    }
                }
                runImageBatchDownload(notifId, job, resolved)
                return
            }

            // Case 2: QuickDownload (Share to Orbit) where job metadata hasn't been fetched yet
            val isQuickShare = job.title.isBlank() || job.title == "Downloading…"
            if (isQuickShare) {
                val directImg = OrbitEngine.resolveDirectImage(url)
                val pin = if (directImg == null) OrbitEngine.resolvePinterest(url) else null
                val xhs = if (directImg == null && pin == null) OrbitEngine.resolveXiaohongshu(url) else null
                val tt = if (directImg == null && pin == null && xhs == null) OrbitEngine.resolveTikTok(url) else null
                val ig = if (directImg == null && pin == null && xhs == null && tt == null) OrbitEngine.resolveInstagram(url) else null
                val tw = if (directImg == null && pin == null && xhs == null && tt == null && ig == null) OrbitEngine.resolveTwitter(url) else null

                val preResolved = listOfNotNull(directImg, pin, xhs, tt, ig, tw).firstOrNull()
                if (preResolved != null && preResolved.mediaType == "image" && preResolved.imageUrls.isNotEmpty()) {
                    job.isImage = true
                    job.title = preResolved.title
                    job.site = preResolved.site
                    job.thumb = preResolved.thumbnail
                    job.imageUrls = preResolved.imageUrls
                    runImageBatchDownload(notifId, job, preResolved.imageUrls)
                    return
                }

                if ((xhs != null && xhs.mediaType == "video" && xhs.directVideoUrl.isNotBlank()) ||
                    (pin != null && pin.mediaType == "video" && pin.directVideoUrl.isNotBlank())
                ) {
                    val vMatch = xhs ?: pin!!
                    job.title = vMatch.title
                    job.site = vMatch.site
                    job.thumb = vMatch.thumbnail
                    runDirectStreamDownload(notifId, job, vMatch.directVideoUrl)
                    return
                }

                val infoReq = YoutubeDLRequest(url).apply {
                    addOption("--no-playlist")
                    addOption("--socket-timeout", "20")
                }
                val info = try {
                    YoutubeDL.getInstance().getInfo(infoReq)
                } catch (_: Exception) {
                    null
                }

                if (info != null) {
                    job.title = info.title ?: "Video"
                    job.site = info.extractorKey ?: info.extractor ?: "Video"
                    job.thumb = info.thumbnail ?: ""
                    runVideoDownload(notifId, job, url)
                    return
                } else {
                    val videoFallback = listOfNotNull(ig, tt, tw).firstOrNull {
                        it.mediaType == "video" && it.directVideoUrl.isNotBlank()
                    }
                    if (videoFallback != null) {
                        job.title = videoFallback.title
                        job.site = videoFallback.site
                        job.thumb = videoFallback.thumbnail
                        runDirectStreamDownload(notifId, job, videoFallback.directVideoUrl)
                        return
                    }

                    val fallbackImg = OrbitEngine.resolveSocialAndWebImage(url)
                    if (fallbackImg != null && fallbackImg.imageUrls.isNotEmpty()) {
                        job.isImage = true
                        job.title = fallbackImg.title
                        job.site = fallbackImg.site
                        job.thumb = fallbackImg.thumbnail
                        job.imageUrls = fallbackImg.imageUrls
                        runImageBatchDownload(notifId, job, fallbackImg.imageUrls)
                        return
                    }
                }
            }

            // Case 3: Known Video Job from inside the app
            val downloadUrl = passedDirectUrl?.takeIf { it.isNotBlank() } ?: url
            if ((passedDirectUrl != null && passedDirectUrl.isNotBlank() && passedDirectUrl != url) || isDirectStream(downloadUrl)) {
                runDirectStreamDownload(notifId, job, downloadUrl)
                return
            }

            try {
                runVideoDownload(notifId, job, downloadUrl)
            } catch (videoErr: Exception) {
                val videoFallback = listOfNotNull(
                    OrbitEngine.resolveInstagram(url),
                    OrbitEngine.resolveTikTok(url),
                    OrbitEngine.resolveTwitter(url)
                ).firstOrNull { it.mediaType == "video" && it.directVideoUrl.isNotBlank() }
                if (videoFallback != null) {
                    runDirectStreamDownload(notifId, job, videoFallback.directVideoUrl)
                } else {
                    throw videoErr
                }
            }
        } catch (e: Exception) {
            val isCancelled = !activeJobIds.contains(job.id) || e.javaClass.simpleName.contains("Cancel", ignoreCase = true)
            if (isCancelled) {
                job.state = "cancelled"
                nm.cancel(notifId)
            } else {
                val errMsg = OrbitEngine.cleanErrorMessage(e.message)
                job.state = "error"
                job.error = errMsg
                val errorNotif = NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Download failed")
                    .setContentText(errMsg)
                    .setSubText(job.title)
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .build()
                nm.notify(notifId, errorNotif)
            }
        } finally {
            PendingDownloads.remove(applicationContext, job.id)
            activeJobIds.remove(job.id)
            if (activeJobsCount.decrementAndGet() <= 0) {
                stopForeground(STOP_FOREGROUND_DETACH)
                stopSelf()
            }
        }
    }

    private fun isDirectStream(url: String): Boolean {
        val clean = url.substringBefore("?").lowercase()
        return clean.endsWith(".mp4") || clean.endsWith(".mov") || clean.endsWith(".webm") ||
               clean.endsWith(".m4v") || url.contains("sns-video") || url.contains("xhscdn.com") ||
               url.contains("pinimg.com/videos/")
    }

    private fun openConnectionWithRedirects(initialUrl: String, isVideo: Boolean = false): HttpURLConnection {
        var currentUrl = initialUrl.replace("&amp;", "&").trim()
        val host = try { Uri.parse(currentUrl).host?.lowercase() ?: "" } catch (_: Exception) { "" }
        val referer = when {
            host.contains("xhscdn.com") || host.contains("xiaohongshu") -> "https://www.xiaohongshu.com/"
            host.contains("tiktok") || host.contains("byteoversea") -> "https://www.tiktok.com/"
            host.contains("pinimg.com") || host.contains("pinterest") -> "https://www.pinterest.com/"
            host.contains("cdninstagram") || host.contains("fbcdn") || host.contains("instagram") -> "https://www.instagram.com/"
            host.contains("twimg.com") || host.contains("twitter") || host.contains("x.com") -> "https://twitter.com/"
            host.contains("redd.it") || host.contains("reddit") -> "https://www.reddit.com/"
            else -> try { "https://${Uri.parse(currentUrl).host}/" } catch (_: Exception) { "" }
        }

        for (i in 0..5) {
            val u = URL(currentUrl)
            val conn = (u.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 30000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                setRequestProperty("Accept", if (isVideo) "*/*" else "image/*,*/*;q=0.8")
                if (referer.isNotBlank()) setRequestProperty("Referer", referer)
            }
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (!loc.isNullOrBlank()) {
                    currentUrl = if (loc.startsWith("http")) loc else URL(u, loc).toString()
                    continue
                }
            } else if (code == 403 && referer.isNotBlank()) {
                conn.disconnect()
                return (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 30000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    setRequestProperty("Accept", if (isVideo) "*/*" else "image/*,*/*;q=0.8")
                }
            } else if (code >= 400 && currentUrl.contains("i.pinimg.com/originals/")) {
                conn.disconnect()
                currentUrl = currentUrl.replace("/originals/", "/736x/")
                continue
            }
            return conn
        }
        return (URL(currentUrl).openConnection() as HttpURLConnection)
    }

    private fun runImageBatchDownload(notifId: Int, job: OrbitEngine.DownloadJob, rawImageUrls: List<String>) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val saveDir = OrbitEngine.currentSaveDir(this)
        saveDir.mkdirs()

        val cleanUrls = rawImageUrls.map { it.replace("&amp;", "&").trim() }.filter { it.isNotBlank() }
        val totalPhotos = cleanUrls.size
        var totalBytesAll = 0L
        val savedPaths = mutableListOf<String>()
        var firstSavedName = ""

        val safePrefix = job.title
            .replace(Regex("""[\\/:*?"<>|]"""), "_")
            .trim()
            .take(80)
            .ifBlank { "orbit_${job.id}" }

        try {
            for ((index, imgUrl) in cleanUrls.withIndex()) {
                if (!activeJobIds.contains(job.id)) {
                    savedPaths.forEach { runCatching { OrbitEngine.deleteStoredMedia(this, it) } }
                    job.state = "cancelled"
                    nm.cancel(notifId)
                    return
                }

                val currentPhotoNum = index + 1
                nm.notify(
                    notifId,
                    buildNotification(
                        notifId = notifId,
                        jobId = job.id,
                        title = job.title,
                        text = if (totalPhotos > 1) "Downloading photo $currentPhotoNum of $totalPhotos..." else "Downloading photo...",
                        progress = ((index.toDouble() / totalPhotos) * 100).toInt(),
                        indeterminate = false,
                        ongoing = true
                    )
                )

                val conn = openConnectionWithRedirects(imgUrl, isVideo = false)

                val contentType = conn.contentType ?: ""
                if (contentType.startsWith("text/", true) || contentType.startsWith("video/", true) ||
                    contentType.contains("json", true)) {
                    conn.disconnect()
                    throw java.io.IOException("The link did not return a photo.")
                }
                val ext = when {
                    contentType.contains("png", true) || imgUrl.contains(".png", true) -> "png"
                    contentType.contains("webp", true) || imgUrl.contains(".webp", true) -> "webp"
                    contentType.contains("gif", true) || imgUrl.contains(".gif", true) -> "gif"
                    contentType.contains("avif", true) || imgUrl.contains(".avif", true) -> "avif"
                    else -> "jpg"
                }

                val fileName = if (totalPhotos > 1) {
                    "$safePrefix (${currentPhotoNum} of ${totalPhotos}) [${job.id}].$ext"
                } else {
                    "$safePrefix [${job.id}].$ext"
                }

                val targetFile = File(saveDir, fileName)
                val buffer = ByteArray(16384)

                try {
                    conn.inputStream.use { input ->
                        targetFile.outputStream().use { output ->
                            var bytesRead: Int
                            while (input.read(buffer).also { bytesRead = it } != -1) {
                                if (!activeJobIds.contains(job.id)) {
                                    targetFile.delete()
                                    savedPaths.forEach { runCatching { OrbitEngine.deleteStoredMedia(this, it) } }
                                    job.state = "cancelled"
                                    nm.cancel(notifId)
                                    return
                                }
                                output.write(buffer, 0, bytesRead)
                            }
                        }
                    }

                    val bytes = targetFile.length()
                    val savedPath = OrbitEngine.publishMedia(applicationContext, targetFile)
                    if (savedPaths.isEmpty()) firstSavedName = targetFile.name
                    savedPaths.add(savedPath)
                    totalBytesAll += bytes

                    job.percent = (((index + 1).toDouble() / totalPhotos) * 100.0).coerceIn(0.0, 100.0)
                } catch (e: Exception) {
                    targetFile.delete()
                    throw e
                } finally {
                    conn.disconnect()
                }
            }

            if (savedPaths.isEmpty()) throw java.io.IOException("No photo could be downloaded.")

            job.file = savedPaths.first()
            job.size = totalBytesAll
            job.percent = 100.0
            job.state = "done"

            OrbitEngine.addHistoryItem(
                context = applicationContext,
                id = job.id,
                title = if (totalPhotos > 1) "${job.title} ($totalPhotos Photos)" else job.title,
                site = job.site,
                thumb = job.thumb,
                quality = "photo",
                file = savedPaths.first(),
                size = totalBytesAll,
                files = savedPaths,
                url = job.url
            )

            runCatching {
                showCompletedNotification(
                    notifId,
                    if (totalPhotos > 1) "$totalPhotos photos saved to Gallery" else job.title,
                    savedPaths.first(),
                    firstSavedName
                )
            }
        } catch (e: Exception) {
            savedPaths.forEach { runCatching { OrbitEngine.deleteStoredMedia(this, it) } }
            val isCancelled = !activeJobIds.contains(job.id) || e.javaClass.simpleName.contains("Cancel", ignoreCase = true)
            if (isCancelled) {
                job.state = "cancelled"
                nm.cancel(notifId)
            } else {
                val errMsg = OrbitEngine.cleanErrorMessage(e.message)
                job.state = "error"
                job.error = errMsg
                val errorNotif = NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Photo download failed")
                    .setContentText(errMsg)
                    .setSubText(job.title)
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .build()
                nm.notify(notifId, errorNotif)
            }
        }
    }

    private fun runDirectStreamDownload(notifId: Int, job: OrbitEngine.DownloadJob, downloadUrl: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val saveDir = OrbitEngine.currentSaveDir(this)
        saveDir.mkdirs()

        val safePrefix = job.title
            .replace(Regex("""[\\/:*?"<>|]"""), "_")
            .trim()
            .take(80)
            .ifBlank { "orbit_${job.id}" }

        var targetFile: File? = null
        var publishedPath: String? = null

        try {
            nm.notify(
                notifId,
                buildNotification(
                    notifId = notifId,
                    jobId = job.id,
                    title = job.title,
                    text = "Starting video download...",
                    progress = 0,
                    indeterminate = true,
                    ongoing = true
                )
            )

            val conn = openConnectionWithRedirects(downloadUrl, isVideo = true)
            val contentType = conn.contentType.orEmpty().lowercase(Locale.ROOT)
            if (contentType.startsWith("text/") || contentType.contains("json")) {
                conn.disconnect()
                throw java.io.IOException("The link did not return a video stream.")
            }
            val extension = when {
                contentType.contains("webm") -> "webm"
                contentType.contains("quicktime") -> "mov"
                else -> when (Uri.parse(downloadUrl).path?.substringAfterLast('.')?.lowercase(Locale.ROOT)) {
                    "webm" -> "webm"
                    "mov" -> "mov"
                    "m4v" -> "m4v"
                    else -> "mp4"
                }
            }
            val outputFile = File(saveDir, "$safePrefix [${job.id}].$extension")
            targetFile = outputFile

            val totalBytes = conn.contentLengthLong.coerceAtLeast(1L)
            var downloaded = 0L
            val buffer = ByteArray(32768)
            var lastNotifTime = 0L
            var lastPercent = -1
            val startTime = System.currentTimeMillis()

            conn.inputStream.use { input ->
                outputFile.outputStream().use { output ->
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        if (!activeJobIds.contains(job.id)) {
                            outputFile.delete()
                            job.state = "cancelled"
                            nm.cancel(notifId)
                            return
                        }
                        output.write(buffer, 0, bytesRead)
                        downloaded += bytesRead
                        val p = ((downloaded.toDouble() / totalBytes) * 100.0).coerceIn(0.0, 99.0)
                        job.percent = p

                        val now = System.currentTimeMillis()
                        val pInt = p.toInt()
                        if (now - lastNotifTime > 750 || pInt >= lastPercent + 5) {
                            lastNotifTime = now
                            lastPercent = pInt
                            val elapsedSec = ((now - startTime) / 1000.0).coerceAtLeast(0.1)
                            val spdBytesPerSec = downloaded / elapsedSec
                            val spdStr = if (spdBytesPerSec > 1024 * 1024) {
                                String.format(Locale.US, "%.1f MB/s", spdBytesPerSec / (1024.0 * 1024.0))
                            } else {
                                String.format(Locale.US, "%d KB/s", (spdBytesPerSec / 1024.0).toLong())
                            }
                            job.speed = spdStr

                            nm.notify(
                                notifId,
                                buildNotification(
                                    notifId = notifId,
                                    jobId = job.id,
                                    title = job.title,
                                    text = "$pInt% · $spdStr",
                                    progress = pInt,
                                    indeterminate = false,
                                    ongoing = true
                                )
                            )
                        }
                    }
                }
            }

            if (conn.contentLengthLong > 0 && downloaded != conn.contentLengthLong) {
                throw java.io.IOException("Video download ended before all bytes were received.")
            }

            if (!activeJobIds.contains(job.id)) {
                outputFile.delete()
                job.state = "cancelled"
                nm.cancel(notifId)
                return
            }

            val size = outputFile.length()
            val savedPath = OrbitEngine.publishMedia(applicationContext, outputFile)
            publishedPath = savedPath
            job.file = savedPath
            job.size = size
            job.percent = 100.0
            job.state = "done"

            OrbitEngine.addHistoryItem(
                context = applicationContext,
                id = job.id,
                title = job.title,
                site = job.site,
                thumb = job.thumb,
                quality = job.quality,
                file = savedPath,
                size = size,
                url = job.url
            )

            runCatching { showCompletedNotification(notifId, job.title, savedPath, outputFile.name) }
        } catch (e: Exception) {
            targetFile?.delete()
            publishedPath?.let { runCatching { OrbitEngine.deleteStoredMedia(this, it) } }
            val isCancelled = !activeJobIds.contains(job.id) || e.javaClass.simpleName.contains("Cancel", ignoreCase = true)
            if (isCancelled) {
                job.state = "cancelled"
                nm.cancel(notifId)
            } else {
                val errMsg = OrbitEngine.cleanErrorMessage(e.message)
                job.state = "error"
                job.error = errMsg
                val errorNotif = NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Download failed")
                    .setContentText(errMsg)
                    .setSubText(job.title)
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .build()
                nm.notify(notifId, errorNotif)
            }
        }
    }

    private fun runVideoDownload(notifId: Int, job: OrbitEngine.DownloadJob, downloadUrl: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val saveDir = OrbitEngine.currentSaveDir(this)
        saveDir.mkdirs()

        if (!activeJobIds.contains(job.id)) return

        nm.notify(
            notifId,
            buildNotification(
                notifId = notifId,
                jobId = job.id,
                title = job.title,
                text = "Starting download...",
                progress = 0,
                indeterminate = true,
                ongoing = true
            )
        )

        val safePrefix = job.title
            .replace(Regex("""[\\/:*?"<>|]"""), "_")
            .trim()
            .take(80)
            .ifBlank { "orbit_${job.id}" }

        val outTemplate = File(saveDir, "$safePrefix [${job.id}].%(ext)s").absolutePath
        val req = YoutubeDLRequest(downloadUrl).apply {
            addOption("--no-playlist")
            addOption("--newline")
            addOption("-o", outTemplate)
            if (job.quality == "audio") {
                addOption("-x")
                addOption("--audio-format", "mp3")
                addOption("--audio-quality", "0")
            } else {
                val h = job.quality.toIntOrNull()
                if (h != null) {
                    addOption(
                        "-f",
                        "bestvideo[height<=$h]+bestaudio/best[height<=$h]/best"
                    )
                } else {
                    addOption("-f", "bestvideo+bestaudio/best")
                }
            }
        }

        var lastNotifTime = 0L
        var lastPercent = -1

        YoutubeDL.getInstance().execute(req, job.id) { progress, etaInSeconds, line ->
            if (!activeJobIds.contains(job.id)) return@execute

            val now = System.currentTimeMillis()
            val p = progress.toInt().coerceIn(0, 100)
            job.percent = progress.toDouble().coerceIn(0.0, 100.0)

            if (etaInSeconds >= 0) {
                val m = etaInSeconds / 60
                val s = etaInSeconds % 60
                job.eta = "$m:${s.toString().padStart(2, '0')}"
            }

            if (line.isNotBlank()) {
                speedRegex.find(line)?.groupValues?.getOrNull(1)?.let { spd ->
                    job.speed = spd
                }
                if (line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[Fixup")) {
                    job.state = "processing"
                }
            }

            if (now - lastNotifTime > 750 || p >= lastPercent + 5 || line.contains("[Merger]")) {
                lastNotifTime = now
                lastPercent = p

                val etaText = if (job.eta.isNotBlank()) " · ETA ${job.eta}" else ""
                val sub = when {
                    line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[Fixup") ->
                        "Finishing and merging..."
                    job.speed.isNotBlank() ->
                        "$p% · ${job.speed}$etaText"
                    else ->
                        "$p%$etaText"
                }

                nm.notify(
                    notifId,
                    buildNotification(
                        notifId = notifId,
                        jobId = job.id,
                        title = job.title,
                        text = sub,
                        progress = p,
                        indeterminate = false,
                        ongoing = true
                    )
                )
            }
        }

        // Locate downloaded file
        val matchedFile = saveDir.listFiles()?.filter { f ->
            f.isFile &&
                !f.name.endsWith(".part") &&
                !f.name.endsWith(".ytdl") &&
                f.name.contains("[${job.id}]")
        }?.maxByOrNull { it.lastModified() }

        if (matchedFile != null && matchedFile.exists()) {
            val size = matchedFile.length()
            val savedPath = OrbitEngine.publishMedia(applicationContext, matchedFile)
            OrbitEngine.addHistoryItem(
                context = applicationContext,
                id = job.id,
                title = job.title,
                site = job.site,
                thumb = job.thumb,
                quality = job.quality,
                file = savedPath,
                size = size,
                url = job.url
            )

            job.file = savedPath
            job.size = size
            job.percent = 100.0
            job.state = "done"

            runCatching { showCompletedNotification(notifId, job.title, savedPath, matchedFile.name) }
        } else {
            throw java.io.IOException("Download finished, but the output file could not be found.")
        }
    }

    private fun showCompletedNotification(notifId: Int, title: String, path: String, fileName: String) {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        val mime = when (ext) {
            "mp3", "m4a", "opus", "wav" -> "audio/*"
            "mp4", "mkv", "webm" -> "video/*"
            "jpg", "jpeg", "png", "webp", "gif" -> "image/*"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
        val contentUri = OrbitEngine.mediaUri(this, path)
        val openIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, contentResolver.getType(contentUri) ?: mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pOpen = PendingIntent.getActivity(
            this,
            notifId + 1,
            Intent.createChooser(openIntent, fileName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val completeNotif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Download complete")
            .setContentText(title)
            .setSubText("Saved to your media library")
            .setOngoing(false)
            .setAutoCancel(true)
            .setContentIntent(pOpen)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifId, completeNotif)
    }
}
