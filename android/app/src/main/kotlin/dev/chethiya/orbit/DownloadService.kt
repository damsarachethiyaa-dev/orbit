package dev.chethiya.orbit

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
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class DownloadService : Service() {

    companion object {
        const val ACTION_START_DOWNLOAD = "dev.chethiya.orbit.action.START_DOWNLOAD"
        const val ACTION_CANCEL_DOWNLOAD = "dev.chethiya.orbit.action.CANCEL_DOWNLOAD"
        const val EXTRA_URL = "extra_url"
        const val EXTRA_JOB_ID = "extra_job_id"
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
            val cleanUrl = OrbitEngine.extractUrl(rawUrl)
            if (cleanUrl.isNullOrBlank()) return START_NOT_STICKY

            val jobId = UUID.randomUUID().toString().substring(0, 8)
            val notifId = (System.currentTimeMillis() % 100000).toInt() + 100

            activeJobsCount.incrementAndGet()
            activeJobIds.add(jobId)

            val initialNotification = buildNotification(
                notifId = notifId,
                jobId = jobId,
                title = "Orbit: Fetching video...",
                text = "Connecting to source...",
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
                runDownload(notifId, jobId, cleanUrl)
            }
        }

        return START_NOT_STICKY
    }

    private fun cancelDownload(jobId: String) {
        activeJobIds.remove(jobId)
        try {
            YoutubeDL.getInstance().destroyProcessById(jobId)
        } catch (_: Exception) {
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows progress and completion for Orbit video downloads"
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
    ): android.app.Notification {
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

    private fun runDownload(notifId: Int, jobId: String, url: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        var videoTitle = "Video"
        var site = "Video"
        var thumb = ""
        val quality = OrbitEngine.currentDefaultQuality(this)
        val saveDir = OrbitEngine.currentSaveDir(this)

        try {
            OrbitEngine.initLatch.await(30, java.util.concurrent.TimeUnit.SECONDS)
            saveDir.mkdirs()

            // 1. Fetch info
            val infoReq = YoutubeDLRequest(url).apply {
                addOption("--no-playlist")
                addOption("--socket-timeout", "20")
            }
            val info = try {
                YoutubeDL.getInstance().getInfo(infoReq)
            } catch (e: Exception) {
                null
            }

            if (info != null) {
                videoTitle = info.title ?: "Video"
                site = info.extractorKey ?: info.extractor ?: "Video"
                thumb = info.thumbnail ?: ""
            }

            if (!activeJobIds.contains(jobId)) return

            nm.notify(
                notifId,
                buildNotification(
                    notifId = notifId,
                    jobId = jobId,
                    title = videoTitle,
                    text = "Starting download...",
                    progress = 0,
                    indeterminate = true,
                    ongoing = true
                )
            )

            // 2. Prepare download request
            val startStamp = System.currentTimeMillis() - 1500L
            val safePrefix = videoTitle
                .replace(Regex("""[\\/:*?"<>|]"""), "_")
                .trim()
                .take(80)
                .ifBlank { "orbit_$jobId" }

            val outTemplate = File(saveDir, "$safePrefix [$jobId].%(ext)s").absolutePath
            val req = YoutubeDLRequest(url).apply {
                addOption("--no-playlist")
                addOption("--newline")
                addOption("-o", outTemplate)
                if (quality == "audio") {
                    addOption("-x")
                    addOption("--audio-format", "mp3")
                    addOption("--audio-quality", "0")
                } else {
                    val h = quality.toIntOrNull()
                    if (h != null) {
                        addOption(
                            "-f",
                            "bestvideo[height<=$h][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=$h]+bestaudio/best[height<=$h]/best"
                        )
                    } else {
                        addOption("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best")
                    }
                    addOption("--merge-output-format", "mp4")
                }
            }

            var lastNotifTime = 0L
            var lastPercent = -1

            YoutubeDL.getInstance().execute(req, jobId) { progress, etaInSeconds, line ->
                if (!activeJobIds.contains(jobId)) return@execute

                val now = System.currentTimeMillis()
                val p = progress.toInt().coerceIn(0, 100)

                if (now - lastNotifTime > 750 || p >= lastPercent + 5 || line.contains("[Merger]")) {
                    lastNotifTime = now
                    lastPercent = p

                    var speed = ""
                    speedRegex.find(line)?.groupValues?.getOrNull(1)?.let { speed = it }

                    val etaText = if (etaInSeconds >= 0) {
                        val m = etaInSeconds / 60
                        val s = etaInSeconds % 60
                        " · ETA $m:${s.toString().padStart(2, '0')}"
                    } else ""

                    val sub = when {
                        line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[Fixup") ->
                            "Finishing and merging..."
                        speed.isNotBlank() ->
                            "$p% · $speed$etaText"
                        else ->
                            "$p%$etaText"
                    }

                    nm.notify(
                        notifId,
                        buildNotification(
                            notifId = notifId,
                            jobId = jobId,
                            title = videoTitle,
                            text = sub,
                            progress = p,
                            indeterminate = false,
                            ongoing = true
                        )
                    )
                }
            }

            // 3. Locate downloaded file
            val matchedFile = saveDir.listFiles()?.filter { f ->
                f.isFile &&
                    !f.name.endsWith(".part") &&
                    !f.name.endsWith(".ytdl") &&
                    (f.name.contains("[$jobId]") || f.lastModified() >= startStamp)
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
                    id = jobId,
                    title = videoTitle,
                    site = site,
                    thumb = thumb,
                    quality = quality,
                    file = matchedFile.absolutePath,
                    size = matchedFile.length()
                )

                // 4. Show completed notification with tap-to-open
                val ext = matchedFile.extension.lowercase()
                val mime = when (ext) {
                    "mp3", "m4a", "opus", "wav" -> "audio/*"
                    "mp4", "mkv", "webm" -> "video/*"
                    else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
                }
                val contentUri = FileProvider.getUriForFile(
                    this,
                    "${packageName}.fileprovider",
                    matchedFile
                )
                val openIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(contentUri, mime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val pOpen = PendingIntent.getActivity(
                    this,
                    notifId + 1,
                    Intent.createChooser(openIntent, matchedFile.name),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                val completeNotif = NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Download complete")
                    .setContentText(videoTitle)
                    .setSubText("Saved to Downloads/Orbit")
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .setContentIntent(pOpen)
                    .build()

                nm.notify(notifId, completeNotif)
            } else {
                nm.cancel(notifId)
            }
        } catch (e: Exception) {
            val isCancelled = !activeJobIds.contains(jobId) || e.javaClass.simpleName.contains("Cancel", ignoreCase = true)
            if (isCancelled) {
                nm.cancel(notifId)
            } else {
                val errMsg = OrbitEngine.cleanErrorMessage(e.message)
                val errorNotif = NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Download failed")
                    .setContentText(errMsg)
                    .setSubText(videoTitle)
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .build()
                nm.notify(notifId, errorNotif)
            }
        } finally {
            activeJobIds.remove(jobId)
            if (activeJobsCount.decrementAndGet() <= 0) {
                stopForeground(STOP_FOREGROUND_DETACH)
                stopSelf()
            }
        }
    }
}
