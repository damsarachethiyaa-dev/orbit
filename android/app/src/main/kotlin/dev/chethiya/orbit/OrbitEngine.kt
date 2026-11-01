package dev.chethiya.orbit

import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Environment
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object OrbitEngine {

    val executor = Executors.newCachedThreadPool()
    val initLatch = CountDownLatch(1)

    @Volatile
    var engineReady = false
        private set

    @Volatile
    var ytDlpVersion = "Bundled"
        private set

    @Volatile
    var ffmpegReady = false
        private set

    private var initialized = false

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        initialized = true

        executor.execute {
            val appCtx = context.applicationContext
            try {
                YoutubeDL.getInstance().init(appCtx)
                engineReady = true
                ytDlpVersion = YoutubeDL.getInstance().version(appCtx) ?: "Bundled"
            } catch (e: Exception) {
                ytDlpVersion = "Bundled"
            }
            try {
                FFmpeg.getInstance().init(appCtx)
                ffmpegReady = true
            } catch (e: Exception) {
                ffmpegReady = false
            }
            initLatch.countDown()

            // Opportunistically update yt-dlp in background if network is available
            try {
                YoutubeDL.getInstance().updateYoutubeDL(appCtx, YoutubeDL.UpdateChannel.STABLE)
                ytDlpVersion = YoutubeDL.getInstance().version(appCtx) ?: ytDlpVersion
            } catch (_: Exception) {
            }
        }
    }

    fun prefs(context: Context) = context.getSharedPreferences("orbit_prefs", Context.MODE_PRIVATE)

    fun defaultSaveDir(context: Context): File {
        val pubDownloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val orbitDir = File(pubDownloads, "Orbit")
        if (orbitDir.exists() || orbitDir.mkdirs()) {
            return orbitDir
        }
        val fallback = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir, "Orbit")
        fallback.mkdirs()
        return fallback
    }

    fun currentSaveDir(context: Context): File {
        val saved = prefs(context).getString("save_dir", null)
        if (!saved.isNullOrBlank()) {
            val f = File(saved)
            if (f.exists() || f.mkdirs()) return f
        }
        return defaultSaveDir(context)
    }

    fun currentDefaultQuality(context: Context): String {
        return prefs(context).getString("default_quality", "best") ?: "best"
    }

    private fun historyFile(context: Context): File = File(context.filesDir, "history.json")

    @Synchronized
    fun readHistory(context: Context): JSONArray {
        val f = historyFile(context)
        if (!f.exists()) return JSONArray()
        return try {
            JSONArray(f.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            JSONArray()
        }
    }

    @Synchronized
    fun writeHistory(context: Context, arr: JSONArray) {
        try {
            historyFile(context).writeText(arr.toString(), Charsets.UTF_8)
        } catch (_: Exception) {
        }
    }

    @Synchronized
    fun addHistoryItem(
        context: Context,
        id: String,
        title: String,
        site: String,
        thumb: String,
        quality: String,
        file: String,
        size: Long
    ) {
        val arr = readHistory(context)
        val next = JSONArray()
        val item = JSONObject().apply {
            put("id", id)
            put("title", title)
            put("site", site)
            put("thumb", thumb)
            put("quality", quality)
            put("file", file)
            put("size", size)
            put("t", System.currentTimeMillis() / 1000L)
        }
        next.put(item)
        for (i in 0 until minOf(arr.length(), 199)) {
            val old = arr.optJSONObject(i) ?: continue
            if (old.optString("id") != id) {
                next.put(old)
            }
        }
        writeHistory(context, next)
    }

    fun extractUrl(text: String?): String? {
        if (text.isNullOrBlank()) return null
        val regex = Regex("""https?://[^\s]+""", RegexOption.IGNORE_CASE)
        val match = regex.find(text)?.value ?: return null
        return match.trimEnd('.', ',', ';', '!', '?', ')', ']', '}')
    }

    fun cleanErrorMessage(raw: String?): String {
        if (raw.isNullOrBlank()) return "Couldn't fetch that link. Please check the URL and try again."
        val errLine = raw.lines().lastOrNull { it.contains("ERROR:") } ?: raw.lines().lastOrNull { it.isNotBlank() } ?: raw
        return errLine.replace(Regex("""^.*ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?"""), "").trim()
            .ifBlank { "Couldn't process that link." }
    }

    fun openMediaFile(context: Context, file: File): Boolean {
        if (!file.exists()) return false
        val ext = file.extension.lowercase()
        val mime = when (ext) {
            "mp3", "m4a", "opus", "wav" -> "audio/*"
            "mp4", "mkv", "webm" -> "video/*"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
        return try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(intent, file.name).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (_: Exception) {
            false
        }
    }
}
