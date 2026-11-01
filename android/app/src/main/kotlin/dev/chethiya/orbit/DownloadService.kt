package dev.chethiya.orbit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class DownloadService : Service() {

    companion object {
        const val ACTION_START_DOWNLOAD = "dev.chethiya.orbit.action.START_DOWNLOAD"
        const val ACTION_CANCEL_DOWNLOAD = "dev.chethiya.orbit.action.CANCEL_DOWNLOAD"
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
        if (intent == null) return START_NOT_STICKY

        val action = intent.action
        if (action == ACTION_CANCEL_DOWNLOAD) {
            val jobId = intent.getStringExtra(EXTRA_JOB_ID)
            if (!jobId.isNullOrBlank()) {
                cancelDownload(jobId)
            }
            return START_NOT_STICKY
        }

        if (action == ACTION_START_DOWNLOAD) {
            val rawUrl = intent.getStringExtra(EXTRA_URL)
            val cleanUrl = OrbitEngine.extractUrl(rawUrl) ?: rawUrl
            if (cleanUrl.isNullOrBlank()) return START_NOT_STICKY

            var jobId = intent.getStringExtra(EXTRA_JOB_ID)
            if (jobId.isNullOrBlank()) {
                jobId = UUID.randomUUID().toString().substring(0, 8)
            }
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
                    isImage = passedIsImage || passedImageUrls.isNotEmpty(),
                    directUrl = passedDirect ?: "",
                    imageUrls = passedImageUrls
                )
                OrbitEngine.activeJobs.add(0, job)
                OrbitEngine.jobsById[jobId] = job
            } else if (job.imageUrls.isEmpty() && passedImageUrls.isNotEmpty()) {
                job.imageUrls = passedImageUrls
            }

            activeJobsCount.incrementAndGet()
            activeJobIds.add(jobId)

            val initialNotification = buildNotification(
                notifId = notifId,
                jobId = jobId,
                title = if (job.title.isNotBlank()) job.title else "Orbit: Connecting...",
                text = "Starting download in background...",
                progress = 0,
                indeterminate = true,
                ongoing = true
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(notifId, initialNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(notifId, initialNotification)
            }

            OrbitEngine.executor.execute {
                runDownload(notifId, job, cleanUrl, passedDirect, passedImageUrls)
            }
        }

        return START_NOT_STICKY
    }

    private fun cancelDownload(jobId: String) {
        activeJobIds.remove(jobId)
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

            // Step 1: Check if already marked as image or if url/directUrl is image
            val directImg = OrbitEngine.resolveDirectImage(url)
            val pin = OrbitEngine.resolvePinterest(url)
            val xhs = OrbitEngine.resolveXiaohongshu(url)

            val resolvedImages = when {
                imageUrls.isNotEmpty() -> imageUrls
                job.imageUrls.isNotEmpty() -> job.imageUrls
                xhs != null && xhs.mediaType == "image" -> xhs.imageUrls
                pin != null -> pin.imageUrls
                directImg != null -> directImg.imageUrls
                passedDirectUrl?.matches(Regex(""".*\.(jpg|jpeg|png|webp|gif)($|\?.*)""", RegexOption.IGNORE_CASE)) == true -> listOf(passedDirectUrl)
                else -> emptyList()
            }

            if (job.isImage || resolvedImages.isNotEmpty() ||
                passedDirectUrl?.matches(Regex(""".*\.(jpg|jpeg|png|webp|gif)($|\?.*)""", RegexOption.IGNORE_CASE)) == true
            ) {
                job.isImage = true
                if (job.title.isBlank() || job.title == "Downloading…") {
                    job.title = directImg?.title ?: pin?.title ?: xhs?.title ?: "Photo"
                }
                if (job.site.isBlank() || job.site == "Video") {
                    job.site = directImg?.site ?: pin?.site ?: xhs?.site ?: "Photo"
                }
                val targets = if (resolvedImages.isNotEmpty()) {
                    resolvedImages
                } else {
                    listOf(passedDirectUrl?.takeIf { it.isNotBlank() } ?: directImg?.directVideoUrl ?: pin?.directVideoUrl ?: xhs?.directVideoUrl ?: url)
                }

                runImageBatchDownload(notifId, job, targets)
                return
            }

            // Step 2: Handle Video Download
            val downloadUrl = passedDirectUrl?.takeIf { it.isNotBlank() } ?: xhs?.directVideoUrl ?: url
            if (xhs != null) {
                if (job.title.isBlank() || job.title == "Downloading…") job.title = xhs.title
                if (job.site.isBlank() || job.site == "Video") job.site = xhs.site
                if (job.thumb.isBlank()) job.thumb = xhs.thumbnail
            } else if (job.title.isBlank() || job.title == "Downloading…") {
                val infoReq = YoutubeDLRequest(url).apply {
                    addOption("--no-playlist")
                    addOption("--socket-timeout", "20")
                    addOption("--ignore-no-formats-error")
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
                    // If no video format found, check if it's an image
                    val isVideo = info.formats?.any { it.vcodec != "none" && it.height >= 240 } == true
                    if (!isVideo && !info.thumbnail.isNullOrBlank()) {
                        job.isImage = true
                        runImageBatchDownload(notifId, job, listOf(info.thumbnail!!))
                        return
                    }
                }
            }

            if (isDirectStream(downloadUrl)) {
                runDirectStreamDownload(notifId, job, downloadUrl)
                return
            }

            runVideoDownload(notifId, job, downloadUrl)
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
               clean.endsWith(".m4v") || url.contains("sns-video") || url.contains("xhscdn.com")
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
        var firstSavedFile: File? = null

        val safePrefix = job.title
            .replace(Regex("""[\/:*?"<>|]"""), "_")
            .trim()
            .take(80)
            .ifBlank { "orbit_${job.id}" }

        try {
            for ((index, imgUrl) in cleanUrls.withIndex()) {
                if (!activeJobIds.contains(job.id)) {
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

                conn.inputStream.use { input ->
                    targetFile.outputStream().use { output ->
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            if (!activeJobIds.contains(job.id)) {
                                targetFile.delete()
                                job.state = "cancelled"
                                nm.cancel(notifId)
                                return
                            }
                            output.write(buffer, 0, bytesRead)
                        }
                    }
                }

                if (firstSavedFile == null) firstSavedFile = targetFile
                totalBytesAll += targetFile.length()

                MediaScannerConnection.scanFile(
                    applicationContext,
                    arrayOf(targetFile.absolutePath),
                    arrayOf("image/$ext"),
                    null
                )
                try {
                    val scanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE).apply {
                        data = Uri.fromFile(targetFile)
                    }
                    applicationContext.sendBroadcast(scanIntent)
                } catch (_: Exception) {}

                job.percent = (((index + 1).toDouble() / totalPhotos) * 100.0).coerceIn(0.0, 100.0)
            }

            if (firstSavedFile == null) throw java.io.IOException("No photo could be downloaded.")

            job.file = firstSavedFile.absolutePath
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
                file = firstSavedFile.absolutePath,
                size = totalBytesAll
            )

            showCompletedNotification(
                notifId,
                if (totalPhotos > 1) "$totalPhotos photos saved to Gallery" else job.title,
                firstSavedFile
            )
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

        val targetFile = File(saveDir, "$safePrefix [${job.id}].mp4")

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

            val totalBytes = conn.contentLengthLong.coerceAtLeast(1L)
            var downloaded = 0L
            val buffer = ByteArray(32768)
            var lastNotifTime = 0L
            var lastPercent = -1
            val startTime = System.currentTimeMillis()

            conn.inputStream.use { input ->
                targetFile.outputStream().use { output ->
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        if (!activeJobIds.contains(job.id)) {
                            targetFile.delete()
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
                                String.format("%.1f MB/s", spdBytesPerSec / (1024.0 * 1024.0))
                            } else {
                                String.format("%d KB/s", (spdBytesPerSec / 1024.0).toLong())
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

            if (!activeJobIds.contains(job.id)) {
                targetFile.delete()
                job.state = "cancelled"
                nm.cancel(notifId)
                return
            }

            job.file = targetFile.absolutePath
            job.size = targetFile.length()
            job.percent = 100.0
            job.state = "done"

            MediaScannerConnection.scanFile(
                applicationContext,
                arrayOf(targetFile.absolutePath),
                null,
                null
            )
            OrbitEngine.addHistoryItem(
                context = applicationContext,
                id = job.id,
                title = job.title,
                site = job.site,
                thumb = job.thumb,
                quality = job.quality,
                file = targetFile.absolutePath,
                size = targetFile.length()
            )

            showCompletedNotification(notifId, job.title, targetFile)
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

        val startStamp = System.currentTimeMillis() - 1500L
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
                (f.name.contains("[${job.id}]") || f.lastModified() >= startStamp)
        }?.maxByOrNull { it.lastModified() }

        if (matchedFile != null && matchedFile.exists()) {
            MediaScannerConnection.scanFile(
                applicationContext,
                arrayOf(matchedFile.absolutePath),
                null,
                null
            )
            OrbitEngine.addHistoryItem(
                context = applicationContext,
                id = job.id,
                title = job.title,
                site = job.site,
                thumb = job.thumb,
                quality = job.quality,
                file = matchedFile.absolutePath,
                size = matchedFile.length()
            )

            job.file = matchedFile.absolutePath
            job.size = matchedFile.length()
            job.percent = 100.0
            job.state = "done"

            showCompletedNotification(notifId, job.title, matchedFile)
        } else {
            nm.cancel(notifId)
        }
    }

    private fun showCompletedNotification(notifId: Int, title: String, file: File) {
        val ext = file.extension.lowercase()
        val mime = when (ext) {
            "mp3", "m4a", "opus", "wav" -> "audio/*"
            "mp4", "mkv", "webm" -> "video/*"
            "jpg", "jpeg", "png", "webp", "gif" -> "image/*"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
        val contentUri = FileProvider.getUriForFile(
            this,
            "${packageName}.fileprovider",
            file
        )
        val openIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pOpen = PendingIntent.getActivity(
            this,
            notifId + 1,
            Intent.createChooser(openIntent, file.name),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val completeNotif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Download complete")
            .setContentText(title)
            .setSubText("Saved to Downloads/Orbit")
            .setOngoing(false)
            .setAutoCancel(true)
            .setContentIntent(pOpen)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifId, completeNotif)
    }
}
