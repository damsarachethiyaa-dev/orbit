package dev.chethiya.orbit

import android.content.Context
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.Manifest
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.AtomicFile
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
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

            try {
                YoutubeDL.getInstance().updateYoutubeDL(appCtx, YoutubeDL.UpdateChannel.STABLE)
                ytDlpVersion = YoutubeDL.getInstance().version(appCtx) ?: ytDlpVersion
            } catch (_: Exception) {
            }
        }
    }

    fun prefs(context: Context) = context.getSharedPreferences("orbit_prefs", Context.MODE_PRIVATE)

    fun defaultSaveDir(context: Context): File {
        val fallback = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir, "Orbit")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            fallback.mkdirs()
            return fallback
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            fallback.mkdirs()
            return fallback
        }
        val pubDownloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val orbitDir = File(pubDownloads, "Orbit")
        if (orbitDir.exists() || orbitDir.mkdirs()) {
            return orbitDir
        }
        fallback.mkdirs()
        return fallback
    }

    fun currentSaveDir(context: Context): File {
        val saved = prefs(context).getString("save_dir", null)
        if (!saved.isNullOrBlank() && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val f = File(saved)
            if ((f.exists() || f.mkdirs()) && f.canWrite()) return f
        }
        return defaultSaveDir(context)
    }

    fun mediaUri(context: Context, path: String): Uri =
        if (path.startsWith("content://")) Uri.parse(path)
        else FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", File(path))

    fun mediaExists(context: Context, path: String): Boolean {
        if (path.isBlank()) return false
        if (!path.startsWith("content://")) return File(path).exists()
        return try {
            context.contentResolver.openFileDescriptor(Uri.parse(path), "r")?.use { true } ?: false
        } catch (_: Exception) { false }
    }

    fun publishMedia(context: Context, file: File): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), null, null)
            return file.absolutePath
        }
        val ext = file.extension.lowercase()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        val (collection, folder) = when {
            mime.startsWith("image/") -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_PICTURES
            mime.startsWith("video/") -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_MOVIES
            mime.startsWith("audio/") -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_MUSIC
            else -> MediaStore.Downloads.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_DOWNLOADS
        }
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/Orbit")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values)
            ?: throw java.io.IOException("Could not create a media library entry.")
        try {
            file.inputStream().use { input ->
                val output = resolver.openOutputStream(uri)
                    ?: throw java.io.IOException("Could not open media library entry.")
                output.use { input.copyTo(it) }
            }
            if (resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) <= 0) {
                throw java.io.IOException("Could not finish saving media to the library.")
            }
            file.delete()
            return uri.toString()
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    fun deleteStoredMedia(context: Context, path: String) {
        if (path.startsWith("content://")) {
            context.contentResolver.delete(Uri.parse(path), null, null)
        } else {
            val file = File(path)
            if (file.exists() && !file.delete()) throw java.io.IOException("Could not delete ${file.name}.")
            MediaScannerConnection.scanFile(context, arrayOf(path), null, null)
        }
    }

    fun currentDefaultQuality(context: Context): String {
        return prefs(context).getString("default_quality", "best") ?: "best"
    }

    private fun historyFile(context: Context): File = File(context.filesDir, "history.json")

    @Synchronized
    fun readHistory(context: Context): JSONArray {
        val f = historyFile(context)
        return try {
            JSONArray(AtomicFile(f).openRead().bufferedReader(Charsets.UTF_8).use { it.readText() })
        } catch (_: Exception) {
            JSONArray()
        }
    }

    @Synchronized
    fun writeHistory(context: Context, arr: JSONArray) {
        val atomicFile = AtomicFile(historyFile(context))
        var stream: java.io.FileOutputStream? = null
        try {
            stream = atomicFile.startWrite()
            stream.write(arr.toString().toByteArray(Charsets.UTF_8))
            atomicFile.finishWrite(stream)
        } catch (_: Exception) {
            if (stream != null) atomicFile.failWrite(stream)
        }
    }

    @Synchronized
    fun clearHistory(context: Context) = writeHistory(context, JSONArray())

    @Synchronized
    fun deleteHistoryItem(context: Context, id: String) {
        val arr = readHistory(context)
        val next = JSONArray()
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            if (item.optString("id") != id) {
                next.put(item)
                continue
            }
            val paths = item.optJSONArray("files")
            if (paths != null && paths.length() > 0) {
                for (j in 0 until paths.length()) deleteStoredMedia(context, paths.optString(j))
            } else {
                val path = item.optString("file")
                if (path.isNotBlank()) {
                    val legacyAlbum = if (path.startsWith("content://")) emptyList() else
                        File(path).parentFile?.listFiles()?.filter { it.isFile && it.name.contains("[$id]") }
                            ?.map { it.absolutePath }.orEmpty()
                    (legacyAlbum.ifEmpty { listOf(path) }).forEach { deleteStoredMedia(context, it) }
                }
            }
        }
        writeHistory(context, next)
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
        size: Long,
        files: List<String> = emptyList(),
        url: String = ""
    ) {
        val arr = readHistory(context)
        val next = JSONArray()
        val item = JSONObject().apply {
            put("id", id)
            put("title", title)
            put("site", site)
            put("url", url)
            put("thumb", thumb)
            put("quality", quality)
            put("file", file)
            put("size", size)
            if (files.isNotEmpty()) put("files", JSONArray(files))
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
        return match.trimEnd('.', ',', ';', '!', '?', ')', ']', '}', '"', '\'')
    }

    fun cleanErrorMessage(raw: String?): String {
        if (raw.isNullOrBlank()) return "Couldn't fetch that link. Please check the URL and try again."
        var clean = raw.lines().lastOrNull { it.contains("ERROR:") } ?: raw.lines().lastOrNull { it.isNotBlank() } ?: raw
        clean = clean.replace(Regex("""^.*ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?"""), "").trim()
        val lower = clean.lowercase()
        if (lower.contains("no space left") || lower.contains("enospc")) {
            return "Not enough storage space. Free up space and tap Retry."
        }
        if (lower.contains("http error 404") || lower.contains("not found") || lower.contains("deleted")) {
            return "This post or media file is no longer available."
        }
        if (lower.contains("http error 429") || lower.contains("rate limit") || lower.contains("too many requests")) {
            return "This site is limiting downloads right now. Wait a while, then tap Retry."
        }
        if (lower.contains("timed out") || lower.contains("timeout") || lower.contains("network is unreachable") ||
            lower.contains("unable to resolve host") || lower.contains("connection reset")) {
            return "Connection interrupted. Check your internet connection, then tap Retry."
        }
        if (lower.contains("http error 403") || lower.contains("forbidden")) {
            return "The site refused this download. The link may have expired or require an account."
        }
        if (clean.contains("No video formats found", ignoreCase = true)) {
            return "No video stream found. The reel or post might be private, restricted, or requires an account."
        }
        if (clean.contains("login", ignoreCase = true) || clean.contains("sign in", ignoreCase = true)) {
            return "This post requires signing in or is from a private account."
        }
        if (clean.contains("Unsupported URL", ignoreCase = true)) {
            return "Unsupported link. Please paste a direct video or post link."
        }
        val semi = clean.indexOf("; please report")
        if (semi != -1) {
            clean = clean.substring(0, semi)
        }
        return clean.ifBlank { "Couldn't process that link. Please verify the URL." }.take(240)
    }

    fun openMediaFile(context: Context, file: File): Boolean {
        if (!file.exists()) return false
        val ext = file.extension.lowercase()
        val mime = when (ext) {
            "mp3", "m4a", "opus", "wav" -> "audio/*"
            "mp4", "mkv", "webm" -> "video/*"
            "jpg", "jpeg", "png", "webp", "gif" -> "image/*"
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

    data class DownloadJob(
        val id: String,
        val url: String,
        var title: String,
        var site: String = "Video",
        var thumb: String = "",
        var quality: String = "best",
        var state: String = "downloading",
        var percent: Double = 0.0,
        var speed: String = "",
        var eta: String = "",
        var file: String = "",
        var size: Long = 0L,
        var error: String = "",
        var isImage: Boolean = false,
        var directUrl: String = "",
        var imageUrls: List<String> = emptyList()
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id)
            put("title", title)
            put("site", site)
            put("url", url)
            put("thumb", thumb)
            put("quality", quality)
            put("state", state)
            put("percent", percent)
            put("speed", speed)
            put("eta", eta)
            put("file", file)
            put("size", size)
            put("error", error)
            put("isImage", isImage)
            val imgArr = JSONArray()
            imageUrls.forEach { imgArr.put(it) }
            put("imageUrls", imgArr)
            put("count", imageUrls.size)
        }
    }

    val activeJobs = java.util.concurrent.CopyOnWriteArrayList<DownloadJob>()
    val jobsById = java.util.concurrent.ConcurrentHashMap<String, DownloadJob>()

    data class CustomMediaInfo(
        val title: String,
        val site: String,
        val uploader: String,
        val duration: Int = 0,
        val thumbnail: String = "",
        val directVideoUrl: String = "",
        val imageUrls: List<String> = emptyList(),
        val mediaType: String = "video"
    )

    fun resolveDirectImage(rawUrl: String): CustomMediaInfo? {
        val clean = extractUrl(rawUrl) ?: rawUrl
        val lower = clean.lowercase()
        val path = try { Uri.parse(clean).path?.lowercase() ?: "" } catch (_: Exception) { "" }
        val isImgExt = path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".png") ||
                path.endsWith(".webp") || path.endsWith(".gif") || path.endsWith(".bmp") ||
                path.endsWith(".avif") || path.endsWith(".heic") ||
                lower.contains("format=jpg") || lower.contains("format=png") || lower.contains("format=webp") ||
                lower.contains(".jpg?") || lower.contains(".jpeg?") || lower.contains(".png?") || lower.contains(".webp?")
        if (!isImgExt) return null
        val fileName = path.substringAfterLast("/").substringBefore(".").ifBlank { "Image" }
        return CustomMediaInfo(
            title = fileName,
            site = try { Uri.parse(clean).host?.removePrefix("www.")?.substringBefore(".")?.replaceFirstChar { it.uppercase() } ?: "Image" } catch (_: Exception) { "Image" },
            uploader = try { Uri.parse(clean).host ?: "" } catch (_: Exception) { "" },
            duration = 0,
            thumbnail = clean,
            directVideoUrl = clean,
            imageUrls = listOf(clean),
            mediaType = "image"
        )
    }

    fun resolveTikTok(rawUrl: String): CustomMediaInfo? {
        val clean = extractUrl(rawUrl) ?: rawUrl
        if (!clean.contains("tiktok.com", ignoreCase = true)) return null
        try {
            val apiUrl = "https://www.tikwm.com/api/?url=" + java.net.URLEncoder.encode(clean, "UTF-8")
            val conn = (java.net.URL(apiUrl).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 12000
                readTimeout = 15000
                setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode == 200) {
                val resText = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                conn.disconnect()
                val root = JSONObject(resText)
                if (root.optInt("code", -1) == 0) {
                    val data = root.optJSONObject("data")
                    if (data != null) {
                        val title = data.optString("title").ifBlank { "TikTok Media" }.take(80)
                        val uploader = data.optJSONObject("author")?.optString("nickname")?.ifBlank { "TikTok" } ?: "TikTok"
                        val cover = data.optString("origin_cover").ifBlank { data.optString("cover") }
                        val imagesArr = data.optJSONArray("images")
                        if (imagesArr != null && imagesArr.length() > 0) {
                            val imgs = mutableListOf<String>()
                            for (i in 0 until imagesArr.length()) {
                                val u = imagesArr.optString(i)
                                if (u.isNotBlank()) imgs.add(u)
                            }
                            if (imgs.isNotEmpty()) {
                                return CustomMediaInfo(
                                    title = title,
                                    site = "TikTok",
                                    uploader = uploader,
                                    duration = 0,
                                    thumbnail = imgs.first(),
                                    directVideoUrl = imgs.first(),
                                    imageUrls = imgs,
                                    mediaType = "image"
                                )
                            }
                        }
                        val playUrl = data.optString("hdplay").ifBlank { data.optString("play") }
                        if (playUrl.isNotBlank()) {
                            return CustomMediaInfo(
                                title = title,
                                site = "TikTok",
                                uploader = uploader,
                                duration = data.optInt("duration", 0),
                                thumbnail = cover,
                                directVideoUrl = playUrl,
                                imageUrls = emptyList(),
                                mediaType = "video"
                            )
                        }
                    }
                }
            } else {
                conn.disconnect()
            }
        } catch (_: Exception) {}
        return null
    }

    fun resolveTwitter(rawUrl: String): CustomMediaInfo? {
        val clean = extractUrl(rawUrl) ?: rawUrl
        if (!clean.contains("twitter.com", ignoreCase = true) &&
            !clean.contains("x.com", ignoreCase = true) &&
            !clean.contains("t.co/", ignoreCase = true)
        ) return null
        try {
            var resolvedUrl = clean
            if (resolvedUrl.contains("t.co/", ignoreCase = true)) {
                val c = (java.net.URL(resolvedUrl).openConnection() as java.net.HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 8000
                    readTimeout = 8000
                }
                if (c.responseCode in 300..399) {
                    resolvedUrl = c.getHeaderField("Location") ?: resolvedUrl
                }
                c.disconnect()
            }
            val match = Regex("""(?:twitter\.com|x\.com)/[^/]+/status/(\d+)""", RegexOption.IGNORE_CASE).find(resolvedUrl)
                ?: return null
            val tweetId = match.groupValues[1]

            try {
                val fxConn = (java.net.URL("https://api.fxtwitter.com/i/status/$tweetId").openConnection() as java.net.HttpURLConnection).apply {
                    connectTimeout = 10000
                    readTimeout = 12000
                    setRequestProperty("User-Agent", "Orbit/1.0")
                    setRequestProperty("Accept", "application/json")
                }
                if (fxConn.responseCode == 200) {
                    val body = fxConn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    fxConn.disconnect()
                    val tweet = JSONObject(body).optJSONObject("tweet")
                    if (tweet != null) {
                        val title = tweet.optString("text").ifBlank { "X Post" }.take(80)
                        val uploader = tweet.optJSONObject("author")?.optString("name")?.ifBlank { "X" } ?: "X"
                        val media = tweet.optJSONObject("media")
                        val videos = media?.optJSONArray("videos")
                        if (videos != null && videos.length() > 0) {
                            val vObj = videos.optJSONObject(0)
                            val vUrl = vObj?.optString("url") ?: ""
                            val vThumb = vObj?.optString("thumbnail_url") ?: ""
                            val vDur = vObj?.optDouble("duration", 0.0)?.toInt() ?: 0
                            if (vUrl.isNotBlank()) {
                                return CustomMediaInfo(
                                    title = title,
                                    site = "X",
                                    uploader = uploader,
                                    duration = vDur,
                                    thumbnail = vThumb,
                                    directVideoUrl = vUrl,
                                    imageUrls = emptyList(),
                                    mediaType = "video"
                                )
                            }
                        }
                        val photos = media?.optJSONArray("photos")
                        if (photos != null && photos.length() > 0) {
                            val pList = mutableListOf<String>()
                            for (i in 0 until photos.length()) {
                                val pUrl = photos.optJSONObject(i)?.optString("url") ?: ""
                                if (pUrl.isNotBlank()) {
                                    pList.add(if (pUrl.contains("?")) pUrl else "$pUrl?name=orig")
                                }
                            }
                            if (pList.isNotEmpty()) {
                                return CustomMediaInfo(
                                    title = title,
                                    site = "X",
                                    uploader = uploader,
                                    duration = 0,
                                    thumbnail = pList.first(),
                                    directVideoUrl = pList.first(),
                                    imageUrls = pList,
                                    mediaType = "image"
                                )
                            }
                        }
                    }
                } else {
                    fxConn.disconnect()
                }
            } catch (_: Exception) {}

            val synConn = (java.net.URL("https://cdn.syndication.twimg.com/tweet-result?id=$tweetId&token=x").openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 10000
                readTimeout = 12000
                setRequestProperty("User-Agent", "Mozilla/5.0")
            }
            if (synConn.responseCode == 200) {
                val synBody = synConn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                synConn.disconnect()
                val synJson = JSONObject(synBody)
                val title = synJson.optString("text").ifBlank { "X Post" }.take(80)
                val uploader = synJson.optJSONObject("user")?.optString("name")?.ifBlank { "X" } ?: "X"
                val photos = synJson.optJSONArray("photos")
                if (photos != null && photos.length() > 0) {
                    val pList = mutableListOf<String>()
                    for (i in 0 until photos.length()) {
                        val u = photos.optJSONObject(i)?.optString("url") ?: ""
                        if (u.isNotBlank()) pList.add(if (u.contains("?")) u else "$u?name=orig")
                    }
                    if (pList.isNotEmpty()) {
                        return CustomMediaInfo(
                            title = title,
                            site = "X",
                            uploader = uploader,
                            duration = 0,
                            thumbnail = pList.first(),
                            directVideoUrl = pList.first(),
                            imageUrls = pList,
                            mediaType = "image"
                        )
                    }
                }
            } else {
                synConn.disconnect()
            }
        } catch (_: Exception) {}
        return null
    }

    fun resolveInstagram(rawUrl: String): CustomMediaInfo? {
        val clean = extractUrl(rawUrl) ?: rawUrl
        if (!clean.contains("instagram.com", ignoreCase = true)) return null
        try {
            var currentUrl = clean
            val ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            if (currentUrl.contains("/share/", ignoreCase = true)) {
                for (i in 0..4) {
                    val c = (java.net.URL(currentUrl).openConnection() as java.net.HttpURLConnection).apply {
                        instanceFollowRedirects = false
                        connectTimeout = 8000
                        readTimeout = 8000
                        setRequestProperty("User-Agent", ua)
                    }
                    val code = c.responseCode
                    val loc = c.getHeaderField("Location")
                    c.disconnect()
                    if (code in 300..399 && !loc.isNullOrBlank()) {
                        currentUrl = if (loc.startsWith("http")) loc else java.net.URL(java.net.URL(currentUrl), loc).toString()
                    } else {
                        break
                    }
                }
            }
            val scMatch = Regex("""instagram\.com/(?:[^/]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)""", RegexOption.IGNORE_CASE).find(currentUrl)
                ?: return null
            val shortcode = scMatch.groupValues[1]

            val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
            var pk = java.math.BigInteger.ZERO
            val base = java.math.BigInteger.valueOf(64)
            for (ch in shortcode.take(11)) {
                val idx = alphabet.indexOf(ch)
                if (idx < 0) break
                pk = pk.multiply(base).add(java.math.BigInteger.valueOf(idx.toLong()))
            }
            val mediaId = pk.toString()

            val postBody = "variables=" + java.net.URLEncoder.encode("""{"media_id":"$mediaId"}""", "UTF-8") +
                    "&doc_id=27130156389949648&lsd=AVqbxe3J_YA"
            val gqlConn = (java.net.URL("https://www.instagram.com/api/graphql").openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 12000
                readTimeout = 15000
                setRequestProperty("User-Agent", ua)
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                setRequestProperty("X-IG-App-ID", "936619743392459")
                setRequestProperty("X-FB-LSD", "AVqbxe3J_YA")
                setRequestProperty("X-ASBD-ID", "129477")
                setRequestProperty("Sec-Fetch-Site", "same-origin")
                setRequestProperty("Referer", "https://www.instagram.com/p/$shortcode/")
            }
            gqlConn.outputStream.use { it.write(postBody.toByteArray(Charsets.UTF_8)) }
            if (gqlConn.responseCode == 200) {
                val gqlText = gqlConn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                gqlConn.disconnect()
                val info = JSONObject(gqlText)
                    .optJSONObject("data")
                    ?.optJSONObject("xig_polaris_media")
                    ?.optJSONObject("if_not_gated_logged_out")
                if (info != null) {
                    val uploader = info.optJSONObject("user")?.optString("username")?.ifBlank { "Instagram" } ?: "Instagram"
                    val title = info.optJSONObject("caption")?.optString("text")?.ifBlank { "Instagram Post" }?.take(80) ?: "Instagram Post"
                    val mediaType = info.optInt("media_type", 0)
                    val topImg = info.optJSONObject("image_versions2")?.optJSONArray("candidates")?.optJSONObject(0)?.optString("url")
                        ?.ifBlank { info.optString("display_uri") } ?: info.optString("display_uri")

                    if (mediaType == 1 && topImg.isNotBlank()) {
                        return CustomMediaInfo(
                            title = title,
                            site = "Instagram",
                            uploader = uploader,
                            duration = 0,
                            thumbnail = topImg,
                            directVideoUrl = topImg,
                            imageUrls = listOf(topImg),
                            mediaType = "image"
                        )
                    } else if (mediaType == 2) {
                        val vUrl = info.optJSONArray("video_versions")?.optJSONObject(0)?.optString("url") ?: ""
                        if (vUrl.isNotBlank()) {
                            return CustomMediaInfo(
                                title = title,
                                site = "Instagram",
                                uploader = uploader,
                                duration = 0,
                                thumbnail = topImg,
                                directVideoUrl = vUrl,
                                imageUrls = emptyList(),
                                mediaType = "video"
                            )
                        }
                    } else if (mediaType == 8) {
                        val carousel = info.optJSONArray("carousel_media")
                        if (carousel != null && carousel.length() > 0) {
                            val photoList = mutableListOf<String>()
                            var firstVideoUrl = ""
                            for (i in 0 until carousel.length()) {
                                val item = carousel.optJSONObject(i) ?: continue
                                val itemType = item.optInt("media_type", 1)
                                val itemImg = item.optJSONObject("image_versions2")?.optJSONArray("candidates")?.optJSONObject(0)?.optString("url")
                                    ?.ifBlank { item.optString("display_uri") } ?: item.optString("display_uri")
                                val itemVid = item.optJSONArray("video_versions")?.optJSONObject(0)?.optString("url") ?: ""
                                if (itemType == 1 && itemImg.isNotBlank()) {
                                    photoList.add(itemImg)
                                } else if (itemType == 2 && itemVid.isNotBlank() && firstVideoUrl.isBlank()) {
                                    firstVideoUrl = itemVid
                                } else if (itemImg.isNotBlank() && itemVid.isBlank()) {
                                    photoList.add(itemImg)
                                }
                            }
                            if (photoList.isNotEmpty()) {
                                return CustomMediaInfo(
                                    title = title,
                                    site = "Instagram",
                                    uploader = uploader,
                                    duration = 0,
                                    thumbnail = photoList.first(),
                                    directVideoUrl = photoList.first(),
                                    imageUrls = photoList,
                                    mediaType = "image"
                                )
                            } else if (firstVideoUrl.isNotBlank()) {
                                return CustomMediaInfo(
                                    title = title,
                                    site = "Instagram",
                                    uploader = uploader,
                                    duration = 0,
                                    thumbnail = topImg,
                                    directVideoUrl = firstVideoUrl,
                                    imageUrls = emptyList(),
                                    mediaType = "video"
                                )
                            }
                        }
                    }
                }
            } else {
                gqlConn.disconnect()
            }

            val botConn = (java.net.URL("https://www.instagram.com/p/$shortcode/").openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 10000
                readTimeout = 12000
                setRequestProperty("User-Agent", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")
            }
            if (botConn.responseCode == 200) {
                val botHtml = botConn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                botConn.disconnect()
                val hasOgVideo = Regex("""property=["']og:video""", RegexOption.IGNORE_CASE).containsMatchIn(botHtml)
                if (!hasOgVideo && !currentUrl.contains("/reel/", ignoreCase = true)) {
                    val ogImgMatch = Regex("""property=["']og:image["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE).find(botHtml)
                        ?: Regex("""content=["']([^"']+)["'][^>]+property=["']og:image["']""", RegexOption.IGNORE_CASE).find(botHtml)
                    val imgUrl = ogImgMatch?.groupValues?.getOrNull(1)?.replace("&amp;", "&")?.trim() ?: ""
                    if (imgUrl.isNotBlank()) {
                        val titleMatch = Regex("""property=["']og:title["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE).find(botHtml)
                        val title = titleMatch?.groupValues?.getOrNull(1)?.replace("&amp;", "&")?.take(80) ?: "Instagram Photo"
                        return CustomMediaInfo(
                            title = title,
                            site = "Instagram",
                            uploader = "Instagram",
                            duration = 0,
                            thumbnail = imgUrl,
                            directVideoUrl = imgUrl,
                            imageUrls = listOf(imgUrl),
                            mediaType = "image"
                        )
                    }
                }
            } else {
                botConn.disconnect()
            }
        } catch (_: Exception) {}
        return null
    }

    fun resolveSocialAndWebImage(rawUrl: String): CustomMediaInfo? {
        val clean = extractUrl(rawUrl) ?: rawUrl
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) return null

        resolveTikTok(clean)?.takeIf { it.mediaType == "image" }?.let { return it }
        resolveInstagram(clean)?.takeIf { it.mediaType == "image" }?.let { return it }
        resolveTwitter(clean)?.takeIf { it.mediaType == "image" }?.let { return it }
        resolvePinterest(clean)?.takeIf { it.mediaType == "image" }?.let { return it }
        resolveXiaohongshu(clean)?.takeIf { it.mediaType == "image" }?.let { return it }

        try {
            var currentUrl = clean
            val isSocialWall = currentUrl.contains("facebook.com", true) ||
                    currentUrl.contains("fb.com", true) ||
                    currentUrl.contains("threads.net", true) ||
                    currentUrl.contains("threads.com", true) ||
                    currentUrl.contains("instagram.com", true)
            val ua = if (isSocialWall) {
                "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
            } else {
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
            var html = ""

            for (i in 0..5) {
                val conn = (java.net.URL(currentUrl).openConnection() as java.net.HttpURLConnection).apply {
                    instanceFollowRedirects = true
                    connectTimeout = 12000
                    readTimeout = 15000
                    setRequestProperty("User-Agent", ua)
                    setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    setRequestProperty("Accept-Language", "en-US,en;q=0.9")
                }
                val code = conn.responseCode
                if (code in 300..399) {
                    val loc = conn.getHeaderField("Location")
                    conn.disconnect()
                    if (!loc.isNullOrBlank()) {
                        currentUrl = if (loc.startsWith("http")) loc else java.net.URL(java.net.URL(currentUrl), loc).toString()
                        continue
                    }
                }
                val contentType = conn.contentType?.lowercase() ?: ""
                if (contentType.startsWith("image/")) {
                    conn.disconnect()
                    val fileName = try {
                        Uri.parse(currentUrl).path?.substringAfterLast("/")?.substringBefore(".")?.ifBlank { "Photo" } ?: "Photo"
                    } catch (_: Exception) { "Photo" }
                    return CustomMediaInfo(
                        title = fileName,
                        site = try { Uri.parse(currentUrl).host?.removePrefix("www.")?.substringBefore(".")?.replaceFirstChar { it.uppercase() } ?: "Image" } catch (_: Exception) { "Image" },
                        uploader = try { Uri.parse(currentUrl).host ?: "" } catch (_: Exception) { "" },
                        duration = 0,
                        thumbnail = currentUrl,
                        directVideoUrl = currentUrl,
                        imageUrls = listOf(currentUrl),
                        mediaType = "image"
                    )
                }

                html = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                currentUrl = conn.url.toString()
                conn.disconnect()
                break
            }

            if (html.isBlank()) return null
            val siteName = try { Uri.parse(currentUrl).host?.removePrefix("www.")?.substringBefore(".")?.replaceFirstChar { it.uppercase() } ?: "Web" } catch (_: Exception) { "Web" }
            // Video posts also expose og:image for their thumbnail. Never treat that as the download.
            val videoMetadata = Regex(
                """<meta\b[^>]*(?:og:video(?::(?:url|secure_url))?|twitter:player:stream|og:type["'][^>]*video|content=["']video[^"']*["'][^>]*og:type|twitter:card["'][^>]*player)[^>]*>""",
                RegexOption.IGNORE_CASE
            )
            if (videoMetadata.containsMatchIn(html)) return null

            // 1. Reddit Galleries and Image Posts
            if (currentUrl.contains("reddit.com", ignoreCase = true) || currentUrl.contains("redd.it", ignoreCase = true)) {
                val matches = Regex("""https://(?:i|preview)\.redd\.it/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|gif)""").findAll(html)
                val redditImages = mutableListOf<String>()
                val seen = mutableSetOf<String>()
                for (m in matches) {
                    val direct = m.value.replace("preview.redd.it", "i.redd.it").substringBefore("?")
                    if (!seen.contains(direct)) {
                        seen.add(direct)
                        redditImages.add(direct)
                    }
                }
                if (redditImages.isNotEmpty()) {
                    val titleMatch = Regex("""<title>(.*?)</title>""", RegexOption.IGNORE_CASE).find(html)
                    val rawTitle = titleMatch?.groupValues?.getOrNull(1)?.replace(Regex("""\s*:\s*r/\w+.*"""), "")?.trim()?.ifBlank { "Reddit Photos" } ?: "Reddit Photos"
                    return CustomMediaInfo(
                        title = rawTitle.take(80),
                        site = "Reddit",
                        uploader = "Reddit",
                        duration = 0,
                        thumbnail = redditImages.first(),
                        directVideoUrl = redditImages.first(),
                        imageUrls = redditImages,
                        mediaType = "image"
                    )
                }
            }

            // 2. Universal OpenGraph & Twitter Image Fallback (Facebook, Threads, Blogs, Web)
            val ogMatches = Regex("""<meta[^>]+(?:property|name)=["'](?:og:image:secure_url|og:image|twitter:image)["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE).findAll(html)
            val ogImages = mutableListOf<String>()
            val seen = mutableSetOf<String>()
            for (m in ogMatches) {
                var u = m.groupValues[1].replace("&amp;", "&").trim()
                if (u.startsWith("//")) u = "https:$u"
                if (u.startsWith("http") && !seen.contains(u)) {
                    seen.add(u)
                    ogImages.add(u)
                }
            }
            if (ogImages.isEmpty()) {
                val reversedOg = Regex("""<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image:secure_url|og:image|twitter:image)["']""", RegexOption.IGNORE_CASE).findAll(html)
                for (m in reversedOg) {
                    var u = m.groupValues[1].replace("&amp;", "&").trim()
                    if (u.startsWith("//")) u = "https:$u"
                    if (u.startsWith("http") && !seen.contains(u)) {
                        seen.add(u)
                        ogImages.add(u)
                    }
                }
            }

            if (ogImages.isNotEmpty()) {
                val titleMatch = Regex("""<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE).find(html)
                    ?: Regex("""<title[^>]*>(.*?)</title>""", RegexOption.IGNORE_CASE).find(html)
                val rawTitle = titleMatch?.groupValues?.getOrNull(1)?.replace("&amp;", "&")?.trim()?.ifBlank { "$siteName Image" } ?: "$siteName Image"

                return CustomMediaInfo(
                    title = rawTitle.take(80),
                    site = siteName,
                    uploader = siteName,
                    duration = 0,
                    thumbnail = ogImages.first(),
                    directVideoUrl = ogImages.first(),
                    imageUrls = ogImages,
                    mediaType = "image"
                )
            }

        } catch (_: Exception) {}
        return null
    }

    fun resolvePinterest(rawUrl: String): CustomMediaInfo? {
        if (!rawUrl.contains("pinterest.", ignoreCase = true) && !rawUrl.contains("pin.it", ignoreCase = true)) {
            return null
        }
        try {
            var currentUrl = extractUrl(rawUrl) ?: rawUrl
            val ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            for (i in 0..5) {
                val conn = (java.net.URL(currentUrl).openConnection() as java.net.HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 10000
                    readTimeout = 12000
                    setRequestProperty("User-Agent", ua)
                    setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                }
                val code = conn.responseCode
                if (code in 300..399) {
                    val loc = conn.getHeaderField("Location")
                    conn.disconnect()
                    if (!loc.isNullOrBlank()) {
                        currentUrl = if (loc.startsWith("http")) loc else java.net.URL(java.net.URL(currentUrl), loc).toString()
                        continue
                    }
                }
                val html = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                conn.disconnect()
                val ogImgMatch = Regex("""property=["']og:image["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE).find(html)
                    ?: Regex("""content=["']([^"']+)["'][^>]+property=["']og:image["']""", RegexOption.IGNORE_CASE).find(html)
                val ogTitleMatch = Regex("""property=["']og:title["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE).find(html)
                val title = ogTitleMatch?.groupValues?.getOrNull(1)?.replace("&amp;", "&")?.ifBlank { "Pinterest Pin" } ?: "Pinterest Pin"
                val imgUrl = ogImgMatch?.groupValues?.getOrNull(1)?.replace("&amp;", "&") ?: ""

                val videoMatch = Regex("""https://v\d*\.pinimg\.com/videos/[^"'\s\\]+\.mp4""").find(html)
                if (videoMatch != null) {
                    return CustomMediaInfo(
                        title = title,
                        site = "Pinterest",
                        uploader = "Pinterest",
                        duration = 0,
                        thumbnail = imgUrl,
                        directVideoUrl = videoMatch.value,
                        imageUrls = emptyList(),
                        mediaType = "video"
                    )
                }

                val origMatch = Regex("""https://i\.pinimg\.com/originals/[a-zA-Z0-9/_.-]+\.(?:jpg|jpeg|png|webp|gif)""").find(html)
                val bestImg = origMatch?.value ?: imgUrl
                if (bestImg.isNotBlank()) {
                    return CustomMediaInfo(
                        title = title,
                        site = "Pinterest",
                        uploader = "Pinterest",
                        duration = 0,
                        thumbnail = imgUrl.ifBlank { bestImg },
                        directVideoUrl = bestImg,
                        imageUrls = listOf(bestImg),
                        mediaType = "image"
                    )
                }
                break
            }
        } catch (_: Exception) {}
        return null
    }

    fun resolveXiaohongshu(rawUrl: String): CustomMediaInfo? {
        if (!rawUrl.contains("xhslink.com", ignoreCase = true) && !rawUrl.contains("xiaohongshu.com", ignoreCase = true)) {
            return null
        }
        try {
            var currentUrl = rawUrl
            val mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            for (i in 0..5) {
                val c = (java.net.URL(currentUrl).openConnection() as java.net.HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 12000
                    readTimeout = 15000
                    setRequestProperty("User-Agent", mobileUa)
                    setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                }
                val code = c.responseCode
                if (code in 300..399) {
                    val loc = c.getHeaderField("Location")
                    if (!loc.isNullOrBlank()) {
                        currentUrl = loc
                        continue
                    }
                }
                val html = c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val regex = Regex("""window\.__INITIAL_STATE__\s*=\s*(.*?)</script>""", RegexOption.DOT_MATCHES_ALL)
                val match = regex.find(html) ?: return null
                val jsonStr = match.groupValues[1].trim().trimEnd(';').replace("undefined", "null")
                val root = JSONObject(jsonStr)
                val note = root.optJSONObject("noteData")?.optJSONObject("data")?.optJSONObject("noteData") ?: return null

                val title = note.optString("title").ifBlank { note.optString("desc").take(60) }.ifBlank { "Xiaohongshu Post" }
                val uploader = note.optJSONObject("user")?.optString("nickname") ?: "Xiaohongshu"
                val duration = note.optJSONObject("video")?.optInt("duration", 0) ?: 0

                val imgList = note.optJSONArray("imageList")
                val imageUrls = mutableListOf<String>()
                if (imgList != null) {
                    for (j in 0 until imgList.length()) {
                        val item = imgList.optJSONObject(j) ?: continue
                        var u = item.optString("urlOriginal").ifBlank {
                            item.optString("urlDefault").ifBlank { item.optString("url") }
                        }
                        val infoList = item.optJSONArray("infoList")
                        if (infoList != null && infoList.length() > 0) {
                            val lastInfo = infoList.optJSONObject(infoList.length() - 1)
                            val best = lastInfo?.optString("url")
                            if (!best.isNullOrBlank()) u = best
                        }
                        if (u.isNotBlank()) imageUrls.add(u)
                    }
                }
                val thumb = imageUrls.firstOrNull() ?: ""

                val h264List = note.optJSONObject("video")?.optJSONObject("media")?.optJSONObject("stream")?.optJSONArray("h264")
                var videoUrl = ""
                if (h264List != null && h264List.length() > 0) {
                    videoUrl = h264List.optJSONObject(0)?.optString("masterUrl") ?: ""
                }
                if (videoUrl.isBlank()) {
                    val h265List = note.optJSONObject("video")?.optJSONObject("media")?.optJSONObject("stream")?.optJSONArray("h265")
                    if (h265List != null && h265List.length() > 0) {
                        videoUrl = h265List.optJSONObject(0)?.optString("masterUrl") ?: ""
                    }
                }
                if (videoUrl.isNotBlank()) {
                    return CustomMediaInfo(
                        title = title,
                        site = "Xiaohongshu",
                        uploader = uploader,
                        duration = duration,
                        thumbnail = thumb,
                        directVideoUrl = videoUrl,
                        imageUrls = imageUrls,
                        mediaType = "video"
                    )
                } else if (imageUrls.isNotEmpty()) {
                    return CustomMediaInfo(
                        title = title,
                        site = "Xiaohongshu",
                        uploader = uploader,
                        duration = 0,
                        thumbnail = thumb,
                        directVideoUrl = imageUrls.first(),
                        imageUrls = imageUrls,
                        mediaType = "image"
                    )
                }
                break
            }
        } catch (_: Exception) {}
        return null
    }
}
