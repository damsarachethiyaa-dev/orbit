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
        var clean = raw.lines().lastOrNull { it.contains("ERROR:") } ?: raw.lines().lastOrNull { it.isNotBlank() } ?: raw
        clean = clean.replace(Regex("""^.*ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?"""), "").trim()
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
        return clean.ifBlank { "Couldn't process that link. Please verify the URL." }
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

    fun resolveSocialAndWebImage(rawUrl: String): CustomMediaInfo? {
        val clean = extractUrl(rawUrl) ?: rawUrl
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) return null

        try {
            var currentUrl = clean
            val ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
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

            // 1. TikTok photo mode
            if (currentUrl.contains("tiktok.com", ignoreCase = true)) {
                val scriptMatch = Regex("""<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>""", RegexOption.DOT_MATCHES_ALL).find(html)
                if (scriptMatch != null) {
                    try {
                        val root = JSONObject(scriptMatch.groupValues[1])
                        val scope = root.optJSONObject("__DEFAULT_SCOPE__")
                        var itemStruct: JSONObject? = null
                        if (scope != null) {
                            itemStruct = scope.optJSONObject("webapp.video-detail")?.optJSONObject("itemInfo")?.optJSONObject("itemStruct")
                            if (itemStruct == null) {
                                val keys = scope.keys()
                                while (keys.hasNext()) {
                                    val k = keys.next()
                                    val sub = scope.optJSONObject(k)
                                    val itm = sub?.optJSONObject("itemInfo")?.optJSONObject("itemStruct")
                                    if (itm != null) { itemStruct = itm; break }
                                }
                            }
                        }
                        val images = itemStruct?.optJSONObject("imagePost")?.optJSONArray("images")
                        if (images != null && images.length() > 0) {
                            val ttImages = mutableListOf<String>()
                            for (idx in 0 until images.length()) {
                                val imgObj = images.optJSONObject(idx) ?: continue
                                val urlList = imgObj.optJSONObject("imageURL")?.optJSONArray("urlList")
                                if (urlList != null && urlList.length() > 0) {
                                    val bestUrl = urlList.optString(urlList.length() - 1)
                                    if (bestUrl.isNotBlank()) ttImages.add(bestUrl)
                                }
                            }
                            if (ttImages.isNotEmpty()) {
                                val desc = (itemStruct?.optString("desc") ?: "").ifBlank { "TikTok Photos" }
                                return CustomMediaInfo(
                                    title = desc.take(80),
                                    site = "TikTok",
                                    uploader = itemStruct?.optJSONObject("author")?.optString("nickname") ?: "TikTok",
                                    duration = 0,
                                    thumbnail = ttImages.first(),
                                    directVideoUrl = ttImages.first(),
                                    imageUrls = ttImages,
                                    mediaType = "image"
                                )
                            }
                        }
                    } catch (_: Exception) {}
                }
            }

            // 2. Reddit Galleries and Image Posts
            if (currentUrl.contains("reddit.com", ignoreCase = true) || currentUrl.contains("redd.it", ignoreCase = true)) {
                val matches = Regex("""https://(?:i|preview)\.redd\.it/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)""").findAll(html)
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

            // 3. Twitter / X Images
            if (currentUrl.contains("twitter.com", ignoreCase = true) || currentUrl.contains("x.com", ignoreCase = true)) {
                val matches = Regex("""https://pbs\.twimg\.com/media/[a-zA-Z0-9_-]+""").findAll(html)
                val xImages = mutableListOf<String>()
                val seen = mutableSetOf<String>()
                for (m in matches) {
                    val base = m.value
                    if (!seen.contains(base)) {
                        seen.add(base)
                        xImages.add("$base?format=jpg&name=orig")
                    }
                }
                if (xImages.isNotEmpty()) {
                    val titleMatch = Regex("""<title>(.*?)</title>""", RegexOption.IGNORE_CASE).find(html)
                    val rawTitle = titleMatch?.groupValues?.getOrNull(1)?.replace(Regex("""\s*/\s*X.*"""), "")?.trim()?.ifBlank { "X Post Photos" } ?: "X Post Photos"
                    return CustomMediaInfo(
                        title = rawTitle.take(80),
                        site = "X",
                        uploader = "X",
                        duration = 0,
                        thumbnail = xImages.first(),
                        directVideoUrl = xImages.first(),
                        imageUrls = xImages,
                        mediaType = "image"
                    )
                }
            }

            // 4. Universal OpenGraph & Twitter Image Fallback (Instagram, Threads, Facebook, Unsplash, Flickr, Blogs, Web)
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
        if (!rawUrl.contains("pinterest.com", ignoreCase = true) && !rawUrl.contains("pin.it", ignoreCase = true)) {
            return null
        }
        try {
            var currentUrl = rawUrl
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
                    if (!loc.isNullOrBlank()) {
                        currentUrl = loc
                        continue
                    }
                }
                val html = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val ogImgMatch = Regex("""property=["']og:image["']\s+content=["']([^"']+)""").find(html)
                    ?: Regex("""content=["']([^"']+)["']\s+property=["']og:image""").find(html)
                val ogTitleMatch = Regex("""property=["']og:title["']\s+content=["']([^"']+)""").find(html)
                val title = ogTitleMatch?.groupValues?.getOrNull(1)?.ifBlank { "Pinterest Pin" } ?: "Pinterest Pin"
                val imgUrl = ogImgMatch?.groupValues?.getOrNull(1)
                if (!imgUrl.isNullOrBlank()) {
                    val highRes = imgUrl.replace(Regex("""/\d+x/"""), "/originals/")
                    return CustomMediaInfo(
                        title = title,
                        site = "Pinterest",
                        uploader = "Pinterest",
                        duration = 0,
                        thumbnail = imgUrl,
                        directVideoUrl = highRes,
                        imageUrls = listOf(highRes),
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
