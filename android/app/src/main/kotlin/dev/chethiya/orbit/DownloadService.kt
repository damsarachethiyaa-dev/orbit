package dev.chethiya.orbit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationCompat
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * Foreground service that owns every download and conversion.
 *
 * Guarantees:
 *  - startForeground() runs first on every start command, so Android never kills the app for a
 *    missed foreground promotion, whatever the intent contains.
 *  - One foreground notification summarises all work; results/errors get their own notifications.
 *  - Running jobs are persisted and resumed if the system kills the process in the background.
 *  - At most [MAX_PARALLEL] heavy jobs run at once so low-memory phones are not overwhelmed.
 */
class DownloadService : Service() {

    companion object {
        const val ACTION_START_DOWNLOAD = "dev.chethiya.orbit.action.START_DOWNLOAD"
        const val ACTION_CANCEL_DOWNLOAD = "dev.chethiya.orbit.action.CANCEL_DOWNLOAD"
        const val ACTION_CANCEL_ALL = "dev.chethiya.orbit.action.CANCEL_ALL"
        const val ACTION_RESUME = "dev.chethiya.orbit.action.RESUME"
        const val ACTION_CONVERT = "dev.chethiya.orbit.action.CONVERT"
        const val EXTRA_URL = "extra_url"
        const val EXTRA_JOB_ID = "extra_job_id"
        const val EXTRA_DIRECT_URL = "extra_direct_url"
        const val EXTRA_QUALITY = "extra_quality"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SITE = "extra_site"
        const val EXTRA_THUMB = "extra_thumb"
        const val EXTRA_IS_IMAGE = "extra_is_image"
        const val EXTRA_IMAGE_URLS = "extra_image_urls"
        const val EXTRA_SHARE_READY = "extra_share_ready"
        const val EXTRA_SOURCE_ID = "extra_source_id"
        const val EXTRA_MODE = "extra_mode"
        const val CHANNEL_ID = "orbit_downloads_channel"
        const val CHANNEL_NAME = "Orbit Downloads"
        const val RESULT_CHANNEL_ID = "orbit_results_channel"
        const val RESULT_CHANNEL_NAME = "Orbit Results"

        private const val TAG = "OrbitService"
        private const val FOREGROUND_ID = 1
        private const val MAX_PARALLEL = 2
        private const val WAKE_LOCK_MS = 15 * 60 * 1000L
        private const val WAKE_RENEW_MS = 10 * 60 * 1000L
        private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        private val VIDEO_EXT = setOf("mp4", "mkv", "webm", "mov", "m4v", "mp3", "m4a", "opus", "wav", "flac", "ogg", "aac")
    }

    private val handler = Handler(Looper.getMainLooper())
    private val activeJobIds = ConcurrentHashMap.newKeySet<String>()
    private val slots = Semaphore(MAX_PARALLEL, true)
    private val speedRegex = Regex("""at\s+([0-9.]+[KMGTP]?i?B/s)""", RegexOption.IGNORE_CASE)

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val lockMutex = Any()
    private var lastForegroundUpdate = 0L

    private val renewLocks = object : Runnable {
        override fun run() {
            if (activeJobIds.isNotEmpty()) {
                acquireLocks()
                handler.postDelayed(this, WAKE_RENEW_MS)
            }
        }
    }

    // ------------------------------------------------------------------ lifecycle

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        OrbitEngine.init(applicationContext)
        OrbitEngine.executor.execute { cleanStaleTempFiles() }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        releaseLocks()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // stopWithTask="false": swiping Orbit away from Recents must not stop running downloads.
        if (activeJobIds.isEmpty()) super.onTaskRemoved(rootIntent)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Always satisfy the startForegroundService() contract first, whatever the intent holds.
        promoteToForeground()
        when (intent?.action) {
            ACTION_START_DOWNLOAD -> handleStart(intent)
            ACTION_CONVERT -> handleConvert(intent)
            ACTION_CANCEL_DOWNLOAD -> intent.getStringExtra(EXTRA_JOB_ID)?.let { cancelDownload(it) }
            ACTION_CANCEL_ALL -> activeJobIds.toList().forEach { cancelDownload(it) }
            // ACTION_RESUME, or a null intent when Android restarts the service after killing the process.
            else -> resumePending()
        }
        scheduleIdleCheck()
        return START_STICKY
    }

    private fun promoteToForeground() {
        try {
            val n = buildForegroundNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(FOREGROUND_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(FOREGROUND_ID, n)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not enter foreground: ${e.message}")
        }
    }

    /** Stops the service on the main thread once nothing is running, so it cannot race a new start command. */
    private fun scheduleIdleCheck() {
        handler.post {
            if (activeJobIds.isEmpty()) {
                handler.removeCallbacks(renewLocks)
                releaseLocks()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            } else {
                updateForegroundNotification(force = true)
            }
        }
    }

    // ------------------------------------------------------------------ locks

    private fun acquireLocks() {
        synchronized(lockMutex) {
            try {
                if (wakeLock == null) {
                    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                    wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Orbit::DownloadWakeLock")
                        ?.apply { setReferenceCounted(false) }
                }
                wakeLock?.acquire(WAKE_LOCK_MS)
            } catch (_: Exception) {}
            try {
                if (wifiLock == null) {
                    val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                    @Suppress("DEPRECATION")
                    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        WifiManager.WIFI_MODE_FULL_HIGH_PERF
                    } else {
                        WifiManager.WIFI_MODE_FULL
                    }
                    wifiLock = wm?.createWifiLock(mode, "Orbit::DownloadWifiLock")?.apply { setReferenceCounted(false) }
                }
                if (wifiLock?.isHeld == false) wifiLock?.acquire()
            } catch (_: Exception) {}
        }
    }

    private fun releaseLocks() {
        synchronized(lockMutex) {
            try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
            try { if (wifiLock?.isHeld == true) wifiLock?.release() } catch (_: Exception) {}
        }
    }

    // ------------------------------------------------------------------ job intake

    private fun handleStart(intent: Intent) {
        val rawUrl = intent.getStringExtra(EXTRA_URL)
        val cleanUrl = OrbitEngine.extractUrl(rawUrl) ?: rawUrl?.trim()
        if (cleanUrl.isNullOrBlank()) return

        val jobId = intent.getStringExtra(EXTRA_JOB_ID)?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString().substring(0, 8)
        if (!activeJobIds.add(jobId)) return // already running

        val passedImageUrls = intent.getStringArrayListExtra(EXTRA_IMAGE_URLS) ?: arrayListOf()
        val isImage = intent.getBooleanExtra(EXTRA_IS_IMAGE, false)
        var job = OrbitEngine.jobsById[jobId]
        if (job == null) {
            job = OrbitEngine.DownloadJob(
                id = jobId,
                url = cleanUrl,
                title = intent.getStringExtra(EXTRA_TITLE)?.ifBlank { null } ?: "Downloading…",
                site = intent.getStringExtra(EXTRA_SITE) ?: "Video",
                thumb = intent.getStringExtra(EXTRA_THUMB) ?: "",
                quality = intent.getStringExtra(EXTRA_QUALITY) ?: OrbitEngine.currentDefaultQuality(this),
                state = "queued",
                isImage = isImage,
                directUrl = intent.getStringExtra(EXTRA_DIRECT_URL) ?: "",
                imageUrls = if (isImage) passedImageUrls else emptyList(),
                shareReady = intent.getBooleanExtra(EXTRA_SHARE_READY, OrbitEngine.currentShareReady(this))
            )
            OrbitEngine.activeJobs.add(0, job)
            OrbitEngine.jobsById[jobId] = job
        } else {
            job.state = "queued"
            if (job.isImage && job.imageUrls.isEmpty() && passedImageUrls.isNotEmpty()) job.imageUrls = passedImageUrls
        }
        OrbitEngine.savePending(this, job, 0)
        launch(job) { runDownload(job) }
    }

    private fun resumePending() {
        for ((job, attempts) in OrbitEngine.loadPending(this)) {
            if (activeJobIds.contains(job.id)) continue
            if (attempts >= OrbitEngine.MAX_RESUME_ATTEMPTS || job.url.isBlank()) {
                OrbitEngine.removePending(this, job.id)
                continue
            }
            activeJobIds.add(job.id)
            if (OrbitEngine.jobsById[job.id] == null) {
                OrbitEngine.activeJobs.add(0, job)
                OrbitEngine.jobsById[job.id] = job
            }
            job.stage = "Resuming…"
            OrbitEngine.savePending(this, job, attempts + 1)
            launch(job) { runDownload(job) }
        }
    }

    private fun handleConvert(intent: Intent) {
        val sourceId = intent.getStringExtra(EXTRA_SOURCE_ID) ?: return
        val mode = intent.getStringExtra(EXTRA_MODE) ?: "share"
        val jobId = intent.getStringExtra(EXTRA_JOB_ID)?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString().substring(0, 8)
        if (!activeJobIds.add(jobId)) return
        val item = OrbitEngine.historyItem(this, sourceId)
        val job = OrbitEngine.DownloadJob(
            id = jobId,
            url = "",
            title = item?.optString("title").orEmpty().ifBlank { "Video" },
            site = item?.optString("site").orEmpty().ifBlank { "Orbit" },
            thumb = item?.optString("thumb").orEmpty(),
            quality = "convert",
            state = "queued",
            shareReady = true
        )
        job.stage = if (mode == "chat") "Preparing smaller copy" else "Preparing share-ready copy"
        OrbitEngine.activeJobs.add(0, job)
        OrbitEngine.jobsById[jobId] = job
        launch(job) { runConvert(job, sourceId, mode) }
    }

    private fun launch(job: OrbitEngine.DownloadJob, body: () -> Unit) {
        acquireLocks()
        handler.removeCallbacks(renewLocks)
        handler.postDelayed(renewLocks, WAKE_RENEW_MS)
        updateForegroundNotification(force = true)
        OrbitEngine.executor.execute {
            try {
                waitForSlot(job)
                try {
                    if (job.state == "queued") job.state = "downloading"
                    body()
                } finally {
                    slots.release()
                }
            } catch (e: Exception) {
                handleFailure(job, e)
            } finally {
                finishJob(job)
            }
        }
    }

    private fun waitForSlot(job: OrbitEngine.DownloadJob) {
        while (!slots.tryAcquire(500, TimeUnit.MILLISECONDS)) {
            if (!isActive(job)) throw CancellationException("cancelled while queued")
            if (job.stage.isBlank()) job.stage = "Waiting for a free slot"
        }
        if (job.stage == "Waiting for a free slot") job.stage = ""
        if (!isActive(job)) {
            slots.release()
            throw CancellationException("cancelled while queued")
        }
    }

    private fun isActive(job: OrbitEngine.DownloadJob) = activeJobIds.contains(job.id) && job.state != "cancelled"

    private fun cancelDownload(jobId: String) {
        OrbitEngine.jobsById[jobId]?.state = "cancelled"
        activeJobIds.remove(jobId)
        try { YoutubeDL.getInstance().destroyProcessById(jobId) } catch (_: Exception) {}
        OrbitEngine.removePending(this, jobId)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(notifIdFor(jobId))
    }

    private fun finishJob(job: OrbitEngine.DownloadJob) {
        activeJobIds.remove(job.id)
        OrbitEngine.removePending(this, job.id)
        job.stage = if (job.state == "done") job.stage else ""
        scheduleIdleCheck()
    }

    private fun handleFailure(job: OrbitEngine.DownloadJob, e: Exception) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notifId = notifIdFor(job.id)
        val cancelled = !isActive(job) || e is CancellationException ||
            e.javaClass.simpleName.contains("Cancel", ignoreCase = true) || e is InterruptedException
        cleanupJobFiles(job.id)
        if (cancelled) {
            job.state = "cancelled"
            nm.cancel(notifId)
            return
        }
        Log.w(TAG, "Job ${job.id} failed", e)
        val message = OrbitEngine.cleanErrorMessage(e.message)
        job.state = "error"
        job.error = message
        job.stage = ""
        val title = when {
            job.quality == "convert" -> "Conversion failed"
            job.isImage -> "Photo download failed"
            else -> "Download failed"
        }
        val notification = NotificationCompat.Builder(this, RESULT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setSubText(job.title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()
        nm.notify(notifId, notification)
    }

    // ------------------------------------------------------------------ notifications

    private fun notifIdFor(jobId: String) = (jobId.hashCode() and 0x7fffffff) % 90000 + 1000

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "Live progress while Orbit downloads"
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(RESULT_CHANNEL_ID, RESULT_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Finished and failed downloads"
            }
        )
    }

    private fun openAppIntent(): PendingIntent {
        val appIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(this, 0, appIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun runningJobs(): List<OrbitEngine.DownloadJob> =
        OrbitEngine.activeJobs.filter { activeJobIds.contains(it.id) && it.state in setOf("queued", "downloading", "processing") }

    private fun buildForegroundNotification(): Notification {
        val running = runningJobs()
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openAppIntent())

        when (running.size) {
            0 -> builder.setContentTitle("Orbit").setContentText("Getting ready…").setProgress(0, 0, true)
            1 -> {
                val j = running[0]
                val pct = j.percent.toInt().coerceIn(0, 100)
                builder.setContentTitle(j.title.ifBlank { "Orbit" })
                    .setContentText(describe(j))
                    .setProgress(100, pct, j.state == "queued" || (pct == 0 && j.speed.isBlank()))
                val cancel = Intent(this, DownloadService::class.java).apply {
                    action = ACTION_CANCEL_DOWNLOAD
                    putExtra(EXTRA_JOB_ID, j.id)
                }
                builder.addAction(
                    android.R.drawable.ic_menu_close_clear_cancel, "Cancel",
                    PendingIntent.getService(this, 1, cancel, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                )
            }
            else -> {
                val avg = running.map { it.percent }.average().toInt().coerceIn(0, 100)
                builder.setContentTitle("Orbit · ${running.size} downloads")
                    .setContentText("$avg% overall")
                    .setProgress(100, avg, false)
                val cancel = Intent(this, DownloadService::class.java).apply { action = ACTION_CANCEL_ALL }
                builder.addAction(
                    android.R.drawable.ic_menu_close_clear_cancel, "Cancel all",
                    PendingIntent.getService(this, 2, cancel, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                )
            }
        }
        return builder.build()
    }

    private fun describe(j: OrbitEngine.DownloadJob): String {
        if (j.stage.isNotBlank()) return j.stage
        val pct = j.percent.toInt()
        val eta = if (j.eta.isNotBlank()) " · ETA ${j.eta}" else ""
        return if (j.speed.isNotBlank()) "$pct% · ${j.speed}$eta" else if (j.state == "queued") "Waiting…" else "$pct%$eta"
    }

    private fun updateForegroundNotification(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastForegroundUpdate < 700) return
        lastForegroundUpdate = now
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(FOREGROUND_ID, buildForegroundNotification())
        } catch (_: Exception) {}
    }

    private fun showCompletedNotification(job: OrbitEngine.DownloadJob, path: String, fileName: String) {
        val mime = mimeFor(fileName)
        val uri = OrbitEngine.mediaUri(this, path)
        val type = contentResolver.getType(uri) ?: mime

        val open = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, type)
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val notifId = notifIdFor(job.id)
        val pOpen = PendingIntent.getActivity(this, notifId + 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val send = Intent(Intent.ACTION_SEND).apply {
            this.type = type
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val pShare = PendingIntent.getActivity(
            this, notifId + 2, Intent.createChooser(send, "Share with…").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val note = NotificationCompat.Builder(this, RESULT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (job.quality == "convert") "Conversion complete" else "Download complete")
            .setContentText(job.title)
            .setSubText(if (job.stage.isNotBlank()) job.stage else "Saved to your media library")
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(pOpen)
            .addAction(android.R.drawable.ic_menu_view, "Open", pOpen)
            .addAction(android.R.drawable.ic_menu_share, "Share", pShare)
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notifId, note)
    }

    private fun mimeFor(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase(Locale.ROOT)
        return when (ext) {
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "opus", "wav", "flac", "ogg", "aac" -> "audio/*"
            "mp4", "m4v" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            "jpg", "jpeg" -> "image/jpeg"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
    }

    // ------------------------------------------------------------------ retry helper

    private fun isTransient(e: Exception): Boolean {
        val m = (e.message ?: "").lowercase(Locale.ROOT)
        if (listOf("private", "sign in", "login", "unsupported url", "unavailable", "drm", "copyright", "geo", "age-restricted", "removed").any { m.contains(it) }) return false
        if (e is java.net.SocketTimeoutException || e is java.net.UnknownHostException || e is java.net.SocketException || e is javax.net.ssl.SSLException) return true
        return listOf("timed out", "timeout", "reset", "refused", "unable to download", "temporary failure", "unreachable",
            "http error 5", "read error", "incompleteread", "connection", "ended before", "dropped", "eof", "http 5", "http 429")
            .any { m.contains(it) }
    }

    private fun <T> withRetry(job: OrbitEngine.DownloadJob, tries: Int = 4, block: () -> T): T {
        var attempt = 1
        while (true) {
            if (!isActive(job)) throw CancellationException("cancelled")
            try {
                return block()
            } catch (e: Exception) {
                if (!isActive(job) || e is CancellationException || attempt >= tries || !isTransient(e)) throw e
                val wait = 2000L * attempt
                job.stage = "Connection problem · retrying ($attempt/${tries - 1})"
                updateForegroundNotification(force = true)
                var waited = 0L
                while (waited < wait) {
                    if (!isActive(job)) throw CancellationException("cancelled")
                    Thread.sleep(250); waited += 250
                }
                job.stage = ""
                attempt++
            }
        }
    }

    // ------------------------------------------------------------------ files

    private fun saveDir(): File = OrbitEngine.currentSaveDir(this).also { it.mkdirs() }

    private fun baseName(job: OrbitEngine.DownloadJob) =
        "${OrbitEngine.safeName(job.title, "orbit_${job.id}")} [${job.id}]"

    /** Removes everything a job left in the save directory (intermediate formats, partials, thumbnails). */
    private fun cleanupJobFiles(jobId: String) {
        try {
            saveDir().listFiles()?.filter { it.isFile && it.name.contains("[$jobId]") }?.forEach { it.delete() }
            File(cacheDir, "convert").listFiles()?.filter { it.name.contains(jobId) }?.forEach { it.delete() }
        } catch (_: Exception) {}
    }

    /** Partial files from jobs that were never resumed would otherwise pile up forever. */
    private fun cleanStaleTempFiles() {
        try {
            val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(3)
            val pending = OrbitEngine.loadPending(this).map { it.first.id }
            saveDir().listFiles()?.filter {
                it.isFile && it.lastModified() < cutoff && pending.none { id -> it.name.contains("[$id]") } &&
                    (it.name.endsWith(".part") || it.name.endsWith(".ytdl") || it.name.endsWith(".orbitpart") || Regex("""\.f\d+\.\w+$""").containsMatchIn(it.name))
            }?.forEach { it.delete() }
            File(cacheDir, "convert").listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
        } catch (_: Exception) {}
    }

    // ------------------------------------------------------------------ routing

    private fun runDownload(job: OrbitEngine.DownloadJob) {
        OrbitEngine.initLatch.await(30, TimeUnit.SECONDS)
        val url = job.url
        val passedDirectUrl = job.directUrl.takeIf { it.isNotBlank() }

        // Case 1: explicitly an image job from inside the app
        if (job.isImage) {
            val resolved = when {
                job.imageUrls.isNotEmpty() -> job.imageUrls
                else -> {
                    val social = OrbitEngine.resolveSocialAndWebImage(url)
                    if (social != null && social.imageUrls.isNotEmpty()) {
                        if (job.title.isBlank() || job.title == "Downloading…") job.title = social.title
                        if (job.site.isBlank() || job.site == "Video") job.site = social.site
                        social.imageUrls
                    } else {
                        listOf(passedDirectUrl ?: url)
                    }
                }
            }
            runImageBatchDownload(job, resolved)
            return
        }

        // Case 2: quick share ("Share to Orbit") where nothing about the link is known yet
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
                runImageBatchDownload(job, preResolved.imageUrls)
                return
            }

            val direct = listOfNotNull(xhs, pin).firstOrNull { it.mediaType == "video" && it.directVideoUrl.isNotBlank() }
            if (direct != null) {
                job.title = direct.title; job.site = direct.site; job.thumb = direct.thumbnail
                finishVideo(job, downloadDirect(job, direct.directVideoUrl))
                return
            }

            val info = try {
                YoutubeDL.getInstance().getInfo(YoutubeDLRequest(url).apply {
                    addOption("--no-playlist")
                    addOption("--socket-timeout", "20")
                })
            } catch (_: Exception) {
                null
            }
            if (info != null) {
                job.title = info.title ?: "Video"
                job.site = info.extractorKey ?: info.extractor ?: "Video"
                job.thumb = info.thumbnail ?: ""
                runVideoDownload(job, url)
                return
            }
            val fallback = listOfNotNull(ig, tt, tw).firstOrNull { it.mediaType == "video" && it.directVideoUrl.isNotBlank() }
            if (fallback != null) {
                job.title = fallback.title; job.site = fallback.site; job.thumb = fallback.thumbnail
                finishVideo(job, downloadDirect(job, fallback.directVideoUrl))
                return
            }
            val fallbackImg = OrbitEngine.resolveSocialAndWebImage(url)
            if (fallbackImg != null && fallbackImg.imageUrls.isNotEmpty()) {
                job.isImage = true
                job.title = fallbackImg.title; job.site = fallbackImg.site; job.thumb = fallbackImg.thumbnail
                job.imageUrls = fallbackImg.imageUrls
                runImageBatchDownload(job, fallbackImg.imageUrls)
                return
            }
        }

        // Case 3: a known video job from inside the app
        val downloadUrl = passedDirectUrl ?: url
        if ((passedDirectUrl != null && passedDirectUrl != url) || isDirectStream(downloadUrl)) {
            finishVideo(job, downloadDirect(job, downloadUrl))
            return
        }
        try {
            runVideoDownload(job, downloadUrl)
        } catch (videoErr: Exception) {
            if (!isActive(job)) throw videoErr
            val fallback = listOfNotNull(
                OrbitEngine.resolveInstagram(url), OrbitEngine.resolveTikTok(url), OrbitEngine.resolveTwitter(url)
            ).firstOrNull { it.mediaType == "video" && it.directVideoUrl.isNotBlank() } ?: throw videoErr
            cleanupJobFiles(job.id)
            finishVideo(job, downloadDirect(job, fallback.directVideoUrl))
        }
    }

    private fun isDirectStream(url: String): Boolean {
        val clean = url.substringBefore("?").lowercase(Locale.ROOT)
        return clean.endsWith(".mp4") || clean.endsWith(".mov") || clean.endsWith(".webm") || clean.endsWith(".m4v") ||
            url.contains("sns-video") || url.contains("xhscdn.com") || url.contains("pinimg.com/videos/")
    }

    // ------------------------------------------------------------------ HTTP

    private fun refererFor(url: String): String {
        val host = try { Uri.parse(url).host?.lowercase(Locale.ROOT) ?: "" } catch (_: Exception) { "" }
        return when {
            host.contains("xhscdn.com") || host.contains("xiaohongshu") -> "https://www.xiaohongshu.com/"
            host.contains("tiktok") || host.contains("byteoversea") -> "https://www.tiktok.com/"
            host.contains("pinimg.com") || host.contains("pinterest") -> "https://www.pinterest.com/"
            host.contains("cdninstagram") || host.contains("fbcdn") || host.contains("instagram") -> "https://www.instagram.com/"
            host.contains("twimg.com") || host.contains("twitter") || host.contains("x.com") -> "https://twitter.com/"
            host.contains("redd.it") || host.contains("reddit") -> "https://www.reddit.com/"
            host.isNotBlank() -> "https://$host/"
            else -> ""
        }
    }

    /** Opens [initialUrl], following redirects by hand (also http→https) and optionally resuming from byte [rangeFrom]. */
    private fun openConnection(initialUrl: String, isVideo: Boolean, rangeFrom: Long = 0L): HttpURLConnection {
        var currentUrl = initialUrl.replace("&amp;", "&").trim()
        val referer = refererFor(currentUrl)
        var useReferer = true
        repeat(8) {
            val u = URL(currentUrl)
            val conn = (u.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 30000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", UA)
                setRequestProperty("Accept", if (isVideo) "*/*" else "image/*,*/*;q=0.8")
                if (useReferer && referer.isNotBlank()) setRequestProperty("Referer", referer)
                if (rangeFrom > 0) setRequestProperty("Range", "bytes=$rangeFrom-")
            }
            val code = conn.responseCode
            when {
                code in 300..399 -> {
                    val loc = conn.getHeaderField("Location")
                    conn.disconnect()
                    if (loc.isNullOrBlank()) throw IOException("The server sent an invalid redirect.")
                    currentUrl = URL(u, loc).toString()
                }
                code == 403 && useReferer && referer.isNotBlank() -> {
                    conn.disconnect()
                    useReferer = false
                }
                code >= 400 && currentUrl.contains("i.pinimg.com/originals/") -> {
                    conn.disconnect()
                    currentUrl = currentUrl.replace("/originals/", "/736x/")
                }
                else -> return conn
            }
        }
        throw IOException("Too many redirects.")
    }

    // ------------------------------------------------------------------ photos

    private fun runImageBatchDownload(job: OrbitEngine.DownloadJob, rawImageUrls: List<String>) {
        val dir = saveDir()
        val cleanUrls = rawImageUrls.map { it.replace("&amp;", "&").trim() }.filter { it.isNotBlank() }
        val total = cleanUrls.size
        if (total == 0) throw IOException("No photo found at that link.")
        val saved = mutableListOf<String>()
        var totalBytes = 0L
        var firstName = ""
        val prefix = OrbitEngine.safeName(job.title, "orbit_${job.id}")

        try {
            for ((index, imgUrl) in cleanUrls.withIndex()) {
                if (!isActive(job)) throw CancellationException("cancelled")
                job.stage = if (total > 1) "Photo ${index + 1} of $total" else ""
                job.percent = index.toDouble() / total * 100.0
                updateForegroundNotification()

                val target = withRetry(job) { downloadOneImage(imgUrl, dir, prefix, job.id, index, total) { isActive(job) } }
                val bytes = target.length()
                val path = OrbitEngine.publishMedia(applicationContext, target)
                if (saved.isEmpty()) firstName = target.name
                saved += path
                totalBytes += bytes
            }
            job.stage = ""
            job.file = saved.first()
            job.size = totalBytes
            job.percent = 100.0
            job.state = "done"
            OrbitEngine.addHistoryItem(
                context = applicationContext, id = job.id,
                title = if (total > 1) "${job.title} ($total Photos)" else job.title,
                site = job.site, thumb = job.thumb, quality = "photo",
                file = saved.first(), size = totalBytes, files = saved, url = job.url
            )
            runCatching {
                showCompletedNotification(job.also { it.stage = if (total > 1) "$total photos saved" else "" }, saved.first(), firstName)
            }
        } catch (e: Exception) {
            saved.forEach { runCatching { OrbitEngine.deleteStoredMedia(this, it) } }
            throw e
        }
    }

    private fun downloadOneImage(
        imgUrl: String, dir: File, prefix: String, jobId: String, index: Int, total: Int, stillActive: () -> Boolean
    ): File {
        val conn = openConnection(imgUrl, isVideo = false)
        try {
            if (conn.responseCode >= 400) throw IOException("Server returned HTTP ${conn.responseCode} for the photo.")
            val type = conn.contentType.orEmpty().lowercase(Locale.ROOT)
            if (type.startsWith("text/") || type.startsWith("video/") || type.contains("json")) {
                throw IOException("The link did not return a photo.")
            }
            val ext = when {
                type.contains("png") -> "png"
                type.contains("webp") -> "webp"
                type.contains("gif") -> "gif"
                type.contains("avif") -> "avif"
                type.contains("heic") || type.contains("heif") -> "heic"
                type.contains("bmp") -> "bmp"
                imgUrl.contains(".png", true) -> "png"
                imgUrl.contains(".webp", true) -> "webp"
                imgUrl.contains(".gif", true) -> "gif"
                imgUrl.contains(".avif", true) -> "avif"
                imgUrl.contains(".heic", true) -> "heic"
                else -> "jpg"
            }
            val name = if (total > 1) "$prefix (${index + 1} of $total) [$jobId].$ext" else "$prefix [$jobId].$ext"
            val target = File(dir, name)
            val expected = conn.contentLengthLong
            val buffer = ByteArray(16384)
            var written = 0L
            try {
                conn.inputStream.use { input ->
                    FileOutputStream(target).use { out ->
                        while (true) {
                            val n = input.read(buffer)
                            if (n == -1) break
                            if (!stillActive()) throw CancellationException("cancelled")
                            out.write(buffer, 0, n)
                            written += n
                        }
                    }
                }
                if (expected > 0 && written < expected) throw IOException("Connection dropped before the photo finished.")
                if (written == 0L) throw IOException("The photo was empty.")
            } catch (e: Exception) {
                target.delete()
                throw e
            }
            return target
        } finally {
            conn.disconnect()
        }
    }

    // ------------------------------------------------------------------ videos

    /** Resumable HTTP download of one media file. Returns the finished file in the save directory. */
    private fun downloadDirect(job: OrbitEngine.DownloadJob, downloadUrl: String): File {
        val dir = saveDir()
        val base = baseName(job)
        val part = File(dir, "$base.orbitpart")
        var ext = "mp4"
        val startedAt = System.currentTimeMillis()
        var lastUi = 0L

        withRetry(job) {
            val have = if (part.exists()) part.length() else 0L
            val conn = openConnection(downloadUrl, isVideo = true, rangeFrom = have)
            try {
                val code = conn.responseCode
                if (code == 416 && have > 0) return@withRetry // the partial file already holds everything
                if (code >= 400) throw IOException("Server returned HTTP $code.")
                val type = conn.contentType.orEmpty().lowercase(Locale.ROOT)
                if (type.startsWith("text/") || type.contains("json")) throw IOException("The link did not return a video stream.")
                ext = when {
                    type.contains("webm") -> "webm"
                    type.contains("quicktime") -> "mov"
                    else -> when (Uri.parse(downloadUrl).path?.substringAfterLast('.')?.lowercase(Locale.ROOT)) {
                        "webm" -> "webm"
                        "mov" -> "mov"
                        "m4v" -> "m4v"
                        else -> "mp4"
                    }
                }
                val resuming = code == 206 && have > 0
                val remaining = conn.contentLengthLong
                val total = if (remaining > 0) (if (resuming) have + remaining else remaining) else -1L
                var downloaded = if (resuming) have else 0L
                val sessionStart = downloaded
                val buffer = ByteArray(65536)

                conn.inputStream.use { input ->
                    FileOutputStream(part, resuming).use { out ->
                        while (true) {
                            val n = input.read(buffer)
                            if (n == -1) break
                            if (!isActive(job)) throw CancellationException("cancelled")
                            out.write(buffer, 0, n)
                            downloaded += n
                            val now = System.currentTimeMillis()
                            if (now - lastUi > 500) {
                                lastUi = now
                                if (total > 0) job.percent = (downloaded.toDouble() / total * 100.0).coerceIn(0.0, 99.0)
                                val perSec = (downloaded - sessionStart) / ((now - startedAt) / 1000.0).coerceAtLeast(0.3)
                                job.speed = formatSpeed(perSec)
                                if (total > 0 && perSec > 0) {
                                    val eta = ((total - downloaded) / perSec).toLong()
                                    job.eta = "${eta / 60}:${(eta % 60).toString().padStart(2, '0')}"
                                }
                                updateForegroundNotification()
                            }
                        }
                    }
                }
                if (total > 0 && downloaded < total) throw IOException("Connection dropped before the video finished.")
            } finally {
                conn.disconnect()
            }
        }

        if (!part.exists() || part.length() == 0L) throw IOException("The video file was empty.")
        val finalFile = File(dir, "$base.$ext")
        if (finalFile.exists()) finalFile.delete()
        if (!part.renameTo(finalFile)) {
            part.copyTo(finalFile, overwrite = true)
            part.delete()
        }
        job.speed = ""
        job.eta = ""
        return finalFile
    }

    private fun formatSpeed(bytesPerSec: Double): String =
        if (bytesPerSec > 1024 * 1024) String.format(Locale.US, "%.1f MB/s", bytesPerSec / (1024.0 * 1024.0))
        else String.format(Locale.US, "%d KB/s", (bytesPerSec / 1024.0).toLong())

    /**
     * yt-dlp format selection.
     *  - shareReady: prefer H.264 video + AAC audio (plays in WeChat, WhatsApp, Telegram, iPhone, TVs) at the
     *    best resolution that codec offers. Explicit 1440p/4K requests still get that resolution; the file is
     *    converted to H.264 afterwards.
     *  - otherwise: the best quality the site offers, whatever the codec.
     */
    internal fun buildFormat(quality: String, shareReady: Boolean): String {
        val h = quality.toIntOrNull()
        val cap = if (h != null) "[height<=$h]" else ""
        val avc = "[vcodec~='^(avc|h264)']"
        val aac = "[acodec~='^(mp4a|aac)']"
        if (h != null && h >= 1440) {
            val lo = (h * 0.9).toInt()
            val band = "[height<=$h][height>=$lo]"
            return "bv*$band+ba/b$band/bv*$cap+ba/b$cap/b"
        }
        return if (shareReady) {
            "bv*$avc$cap+ba$aac/bv*$avc$cap+ba/b$avc$aac$cap/bv*$cap+ba/b$cap/b"
        } else {
            "bv*$cap+ba/b$cap/b"
        }
    }

    private fun runVideoDownload(job: OrbitEngine.DownloadJob, downloadUrl: String) {
        val dir = saveDir()
        if (!isActive(job)) throw CancellationException("cancelled")
        job.stage = "Starting…"
        updateForegroundNotification(force = true)

        val template = File(dir, "${baseName(job)}.%(ext)s").absolutePath
        val req = YoutubeDLRequest(downloadUrl).apply {
            addOption("--no-playlist")
            addOption("--newline")
            addOption("--no-mtime")
            addOption("-o", template)
            addOption("--socket-timeout", "30")
            addOption("--retries", "10")
            addOption("--fragment-retries", "10")
            addOption("--extractor-retries", "3")
            addOption("-N", "4")
            addOption("--throttled-rate", "100K")
            if (job.quality == "audio") {
                addOption("-x")
                addOption("--audio-format", "mp3")
                addOption("--audio-quality", "0")
                addOption("--embed-thumbnail")
                addOption("--embed-metadata")
            } else {
                addOption("-f", buildFormat(job.quality, job.shareReady))
                addOption("--merge-output-format", "mp4")
                addOption("--remux-video", "mp4")
                addOption("--postprocessor-args", "Merger:-movflags +faststart")
            }
        }

        var lastPct = -1
        withRetry(job, tries = 3) {
            YoutubeDL.getInstance().execute(req, job.id) { progress, etaSeconds, line ->
                if (!isActive(job)) return@execute
                val p = progress.toInt().coerceIn(0, 100)
                if (progress >= 0) job.percent = progress.toDouble().coerceIn(0.0, 100.0)
                if (etaSeconds >= 0) job.eta = "${etaSeconds / 60}:${(etaSeconds % 60).toString().padStart(2, '0')}"
                if (line.isNotBlank()) {
                    speedRegex.find(line)?.groupValues?.getOrNull(1)?.let { job.speed = it }
                    if (line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[Fixup") || line.contains("[VideoRemuxer]")) {
                        job.state = "processing"
                        job.stage = "Merging video and audio…"
                    } else if (job.state == "processing") {
                        job.state = "downloading"
                    }
                }
                if (job.state == "downloading" && job.stage == "Starting…" && p > 0) job.stage = ""
                if (p != lastPct || job.state == "processing") {
                    lastPct = p
                    updateForegroundNotification()
                }
            }
        }
        if (!isActive(job)) throw CancellationException("cancelled")

        val found = saveDir().listFiles()?.filter { f ->
            f.isFile && f.name.contains("[${job.id}]") &&
                f.extension.lowercase(Locale.ROOT) in VIDEO_EXT &&
                !Regex("""\.f\d+\.\w+$""").containsMatchIn(f.name) && !f.name.endsWith(".conv.mp4")
        }?.maxByOrNull { it.lastModified() } ?: throw IOException("Download finished, but the output file could not be found.")
        job.speed = ""
        job.eta = ""
        finishVideo(job, found)
    }

    /**
     * Shared tail of every video/audio download: make it share-ready if requested, publish it to the
     * gallery, record real metadata and notify.
     */
    private fun finishVideo(job: OrbitEngine.DownloadJob, downloaded: File) {
        var file = downloaded
        var probe: MediaTools.Probe? = null
        val isAudio = job.quality == "audio" || file.extension.lowercase(Locale.ROOT) in setOf("mp3", "m4a", "opus", "wav", "flac", "ogg", "aac")

        if (!isAudio) {
            probe = MediaTools.probe(this, file)
            if (probe != null && job.shareReady && !probe.shareReady) {
                job.state = "processing"
                job.percent = 0.0
                job.stage = "Converting ${probe.codecLabel} to H.264…"
                updateForegroundNotification(force = true)
                val out = File(file.parentFile, "${file.nameWithoutExtension}.conv.mp4")
                val ok = MediaTools.convert(
                    this, file, out, probe, MediaTools.Preset.SHARE,
                    onProgress = { p -> job.percent = p; job.stage = "Converting to H.264 · ${p.toInt()}%"; updateForegroundNotification() },
                    isCancelled = { !isActive(job) }
                )
                if (!isActive(job)) { out.delete(); throw CancellationException("cancelled") }
                if (ok) {
                    file.delete()
                    val finalFile = File(out.parentFile, "${file.nameWithoutExtension}.mp4")
                    if (!out.renameTo(finalFile)) { out.copyTo(finalFile, overwrite = true); out.delete() }
                    file = finalFile
                    probe = MediaTools.probe(this, file) ?: probe
                    job.stage = ""
                } else {
                    out.delete()
                    job.stage = "Saved original ${probe.codecLabel} (conversion failed)"
                }
            }
        }

        val size = file.length()
        val savedPath = OrbitEngine.publishMedia(applicationContext, file)
        job.file = savedPath
        job.size = size
        job.percent = 100.0
        job.state = "done"
        OrbitEngine.addHistoryItem(
            context = applicationContext, id = job.id, title = job.title, site = job.site, thumb = job.thumb,
            quality = job.quality, file = savedPath, size = size, url = job.url,
            height = probe?.height ?: 0, codec = probe?.codecLabel.orEmpty(), shareReady = probe?.shareReady ?: isAudio
        )
        cleanupJobFiles(job.id)
        runCatching { showCompletedNotification(job, savedPath, file.name) }
    }

    // ------------------------------------------------------------------ conversion of existing library files

    private fun runConvert(job: OrbitEngine.DownloadJob, sourceId: String, mode: String) {
        val preset = if (mode == "chat") MediaTools.Preset.CHAT else MediaTools.Preset.SHARE
        val label = if (mode == "chat") "smaller copy" else "share-ready"
        val sourcePath = OrbitEngine.findMediaPath(this, sourceId) ?: throw IOException("The original file is no longer on this device.")
        val tmpDir = File(cacheDir, "convert").apply { mkdirs() }
        val input = File(tmpDir, "in_${job.id}.mp4")
        val base = OrbitEngine.safeName(job.title, "video")
        val output = File(tmpDir, "$base (${if (mode == "chat") "chat" else "share-ready"}) ${job.id}.mp4")

        try {
            job.state = "processing"
            job.stage = "Reading the original…"
            val uri = OrbitEngine.mediaUri(this, sourcePath)
            val sourceSize = contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
            if (sourceSize > 0 && tmpDir.usableSpace < sourceSize * 2) {
                throw IOException("Not enough free storage to convert this video.")
            }
            (contentResolver.openInputStream(uri) ?: throw IOException("Could not read the original file."))
                .use { src -> input.outputStream().use { src.copyTo(it) } }
            if (!isActive(job)) throw CancellationException("cancelled")

            val probe = MediaTools.probe(this, input) ?: throw IOException("Could not read this video's format.")
            if (mode != "chat" && probe.shareReady) {
                job.stage = "Already plays in WeChat, WhatsApp and Telegram. Nothing to convert."
                job.percent = 100.0
                job.file = sourcePath
                job.state = "done"
                return
            }

            job.stage = "Converting ${probe.codecLabel} to $label…"
            updateForegroundNotification(force = true)
            val ok = MediaTools.convert(
                this, input, output, probe, preset,
                onProgress = { p -> job.percent = p; job.stage = "Converting · ${p.toInt()}%"; updateForegroundNotification() },
                isCancelled = { !isActive(job) }
            )
            if (!isActive(job)) throw CancellationException("cancelled")
            if (!ok) throw IOException("The conversion did not finish. The original file is untouched.")

            val outProbe = MediaTools.probe(this, output)
            val newId = UUID.randomUUID().toString().substring(0, 8)
            val size = output.length()
            val path = OrbitEngine.publishMedia(applicationContext, output)
            OrbitEngine.addHistoryItem(
                context = applicationContext, id = newId,
                title = "${job.title} (${if (mode == "chat") "chat" else "share-ready"})",
                site = job.site, thumb = job.thumb, quality = "best", file = path, size = size,
                height = outProbe?.height ?: 0, codec = outProbe?.codecLabel.orEmpty(), shareReady = outProbe?.shareReady ?: true
            )
            job.file = path
            job.size = size
            job.percent = 100.0
            job.stage = "Saved as a new copy"
            job.state = "done"
            runCatching { showCompletedNotification(job, path, output.name.ifBlank { "video.mp4" }) }
        } finally {
            input.delete()
            output.delete()
        }
    }
}
