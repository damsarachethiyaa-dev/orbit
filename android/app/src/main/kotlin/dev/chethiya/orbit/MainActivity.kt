package dev.chethiya.orbit

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.MimeTypeMap
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val executor = Executors.newCachedThreadPool()
    private val initLatch = CountDownLatch(1)

    @Volatile
    private var engineReady = false

    @Volatile
    private var ytDlpVersion = "Bundled"

    @Volatile
    private var ffmpegReady = false

    @Volatile private var hasUpdate = false
    @Volatile private var latestVersion = BuildConfig.VERSION_NAME
    @Volatile private var releaseName = ""
    @Volatile private var downloadUrl = ""
    @Volatile private var updateDownloading = false
    @Volatile private var updatePercent = 0
    @Volatile private var updateSpeed = ""
    @Volatile private var updateError = ""
    @Volatile private var readyToInstall = false
    @Volatile private var downloadedApkPath = ""

    private val speedRegex = Regex("""at\s+([0-9.]+[KMGTP]?i?B/s)""", RegexOption.IGNORE_CASE)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        requestStoragePermissionsIfNeeded()
        initEngineAsync()

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
            scrollBarStyle = WebView.SCROLLBARS_INSIDE_OVERLAY
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                textZoom = 100
            }
            addJavascriptInterface(OrbitBridge(), "OrbitAndroid")
            webChromeClient = object : WebChromeClient() {
                override fun onJsConfirm(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    result: JsResult?
                ): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message ?: "Confirm action?")
                        .setPositiveButton("Confirm") { _, _ -> result?.confirm() }
                        .setNegativeButton("Cancel") { _, _ -> result?.cancel() }
                        .setOnCancelListener { result?.cancel() }
                        .show()
                    return true
                }

                override fun onJsAlert(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    result: JsResult?
                ): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message ?: "")
                        .setPositiveButton("OK") { _, _ -> result?.confirm() }
                        .setOnCancelListener { result?.cancel() }
                        .show()
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val uri = request?.url ?: return null
                    if (uri.host != "orbit.local") return super.shouldInterceptRequest(view, request)

                    var path = (uri.path ?: "/").removePrefix("/")
                    if (path.isEmpty() || path == "index.html") {
                        path = "desktop/index.html"
                    }
                    return try {
                        val stream = assets.open(path)
                        val mime = guessMime(path)
                        WebResourceResponse(
                            mime,
                            "UTF-8",
                            200,
                            "OK",
                            mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-cache"),
                            stream
                        )
                    } catch (e: Exception) {
                        WebResourceResponse(
                            "text/plain",
                            "UTF-8",
                            404,
                            "Not Found",
                            mapOf("Access-Control-Allow-Origin" to "*"),
                            ByteArrayInputStream("Not found: $path".toByteArray())
                        )
                    }
                }
            }
        }

        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })

        val sharedLink = extractSharedUrl(intent)
        val startUrl = if (!sharedLink.isNullOrBlank()) {
            "https://orbit.local/desktop/index.html?url=" + URLEncoder.encode(sharedLink, "UTF-8")
        } else {
            "https://orbit.local/desktop/index.html"
        }
        webView.loadUrl(startUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val sharedLink = extractSharedUrl(intent)
        if (!sharedLink.isNullOrBlank() && ::webView.isInitialized) {
            val quoted = JSONObject.quote(sharedLink)
            webView.post {
                webView.evaluateJavascript("window.onOrbitShareLink && window.onOrbitShareLink($quoted);", null)
            }
        }
    }

    private fun extractSharedUrl(intent: Intent?): String? {
        if (intent == null) return null
        if (Intent.ACTION_SEND == intent.action && intent.type?.startsWith("text/") == true) {
            val raw = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
            val urlRegex = Regex("""https?://\S+""", RegexOption.IGNORE_CASE)
            return urlRegex.find(raw)?.value ?: raw.trim()
        }
        return null
    }

    private fun requestStoragePermissionsIfNeeded() {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1001)
        }
    }

    private fun initEngineAsync() {
        OrbitEngine.init(applicationContext)
        executor.execute {
            OrbitEngine.initLatch.await(30, TimeUnit.SECONDS)
            engineReady = OrbitEngine.engineReady
            ytDlpVersion = OrbitEngine.ytDlpVersion
            ffmpegReady = OrbitEngine.ffmpegReady
            initLatch.countDown()
        }
    }

    private fun guessMime(path: String): String {
        val lower = path.lowercase()
        return when {
            lower.endsWith(".html") -> "text/html"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".js") -> "application/javascript"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".png") -> "image/png"
            else -> "application/octet-stream"
        }
    }

    private fun prefs() = getSharedPreferences("orbit_prefs", Context.MODE_PRIVATE)

    private fun defaultSaveDir(): File {
        val pubDownloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val orbitDir = File(pubDownloads, "Orbit")
        if (orbitDir.exists() || orbitDir.mkdirs()) {
            return orbitDir
        }
        val fallback = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir, "Orbit")
        fallback.mkdirs()
        return fallback
    }

    private fun currentSaveDir(): File {
        val saved = prefs().getString("save_dir", null)
        if (!saved.isNullOrBlank()) {
            val f = File(saved)
            if (f.exists() || f.mkdirs()) return f
        }
        return defaultSaveDir()
    }

    private fun currentDefaultQuality(): String {
        return prefs().getString("default_quality", "best") ?: "best"
    }

    private fun historyFile(): File = File(filesDir, "history.json")

    @Synchronized
    private fun readHistory(): JSONArray {
        val f = historyFile()
        if (!f.exists()) return JSONArray()
        return try {
            JSONArray(f.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            JSONArray()
        }
    }

    @Synchronized
    private fun writeHistory(arr: JSONArray) {
        try {
            historyFile().writeText(arr.toString(), Charsets.UTF_8)
        } catch (_: Exception) {
        }
    }

    @Synchronized
    private fun addHistoryItem(job: OrbitEngine.DownloadJob) {
        val arr = readHistory()
        val next = JSONArray()
        val item = JSONObject().apply {
            put("id", job.id)
            put("title", job.title)
            put("site", job.site)
            put("thumb", job.thumb)
            put("quality", job.quality)
            put("file", job.file)
            put("size", job.size)
            put("t", System.currentTimeMillis() / 1000L)
        }
        next.put(item)
        for (i in 0 until minOf(arr.length(), 199)) {
            val old = arr.optJSONObject(i) ?: continue
            if (old.optString("id") != job.id) {
                next.put(old)
            }
        }
        writeHistory(next)
    }

    inner class OrbitBridge {
        @JavascriptInterface
        fun haptic() {
            runOnUiThread {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        webView.performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM)
                    } else {
                        webView.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
                    }
                } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun callApi(cbId: String, path: String, method: String, bodyStr: String) {
            executor.execute {
                val responseObj = try {
                    handleApi(path, method.uppercase(), bodyStr)
                } catch (e: Exception) {
                    JSONObject().put("__error", e.message ?: "Request failed")
                }
                val jsonQuoted = JSONObject.quote(responseObj.toString())
                val cbQuoted = JSONObject.quote(cbId)
                webView.post {
                    webView.evaluateJavascript("window[$cbQuoted] && window[$cbQuoted]($jsonQuoted);", null)
                }
            }
        }

        private fun cbIdQuoted(cbId: String): String = JSONObject.quote(cbId)
    }

    private fun handleApi(path: String, method: String, bodyStr: String): Any {
        val body = if (bodyStr.isNotBlank()) {
            try { JSONObject(bodyStr) } catch (_: Exception) { JSONObject() }
        } else {
            JSONObject()
        }

        return when {
            path == "/api/settings" && method == "GET" -> getSettingsJson()
            path == "/api/settings" && method == "POST" -> updateSettingsJson(body)
            path == "/api/clipboard" -> getClipboardJson()
            path == "/api/info" -> fetchVideoInfo(body.optString("url"))
            path == "/api/download" -> startDownloadJob(body)
            path == "/api/jobs" -> {
                val arr = JSONArray()
                for (j in OrbitEngine.activeJobs) arr.put(j.toJson())
                arr
            }
            path.startsWith("/api/cancel/") -> {
                val id = path.removePrefix("/api/cancel/")
                cancelJob(id)
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/dismiss/") -> {
                val id = path.removePrefix("/api/dismiss/")
                dismissJob(id)
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/open/") -> {
                val id = path.removePrefix("/api/open/")
                openMediaById(id)
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/reveal/") -> {
                openDownloadsFolder()
                JSONObject().put("ok", true)
            }
            path == "/api/open-folder" -> {
                openDownloadsFolder()
                JSONObject().put("ok", true)
            }
            path == "/api/history" && method == "GET" -> {
                val arr = readHistory()
                val out = JSONArray()
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val filePath = item.optString("file")
                    val exists = filePath.isNotBlank() && File(filePath).exists()
                    val copy = JSONObject(item.toString())
                    copy.put("exists", exists)
                    out.put(copy)
                }
                out
            }
            path == "/api/history" && method == "DELETE" -> {
                writeHistory(JSONArray())
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/history/") && method == "DELETE" -> {
                val id = path.removePrefix("/api/history/")
                val arr = readHistory()
                val next = JSONArray()
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    if (item.optString("id") == id) {
                        val filePath = item.optString("file")
                        if (filePath.isNotBlank()) {
                            try {
                                val f = File(filePath)
                                if (f.exists()) {
                                    f.delete()
                                }
                                MediaScannerConnection.scanFile(
                                    applicationContext,
                                    arrayOf(filePath),
                                    null,
                                    null
                                )
                            } catch (_: Exception) {}
                        }
                    } else {
                        next.put(item)
                    }
                }
                writeHistory(next)
                JSONObject().put("ok", true)
            }
            path == "/api/update/check" -> checkForUpdates()
            path == "/api/update/download" || path == "/api/update/start" -> startUpdateDownload()
            path == "/api/update/status" -> getUpdateStatus()
            path == "/api/update/apply" -> applyApkUpdate()
            else -> JSONObject().put("ok", true)
        }
    }

    private fun getSettingsJson(): JSONObject {
        return JSONObject().apply {
            put("save_dir", currentSaveDir().absolutePath)
            put("default_quality", currentDefaultQuality())
            put("auto_download", prefs().getBoolean("auto_download", false))
            put("version", BuildConfig.VERSION_NAME)
            put("yt_dlp", ytDlpVersion)
            put("ffmpeg", ffmpegReady)
            put("has_update", hasUpdate)
            put("latest_version", latestVersion)
        }
    }

    private fun updateSettingsJson(body: JSONObject): JSONObject {
        val edit = prefs().edit()
        if (body.has("default_quality")) {
            edit.putString("default_quality", body.optString("default_quality", "best"))
        }
        if (body.has("auto_download")) {
            edit.putBoolean("auto_download", body.optBoolean("auto_download", false))
        }
        if (body.has("save_dir")) {
            val rawDir = body.optString("save_dir").trim()
            if (rawDir.isNotEmpty()) {
                val target = File(rawDir)
                if (target.exists() || target.mkdirs()) {
                    edit.putString("save_dir", target.absolutePath)
                } else {
                    throw IllegalArgumentException("Cannot write to folder: $rawDir")
                }
            }
        }
        edit.apply()
        return getSettingsJson()
    }

    private fun getClipboardJson(): JSONObject {
        val latch = CountDownLatch(1)
        var text = ""
        runOnUiThread {
            try {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                val clip: ClipData? = cm?.primaryClip
                if (clip != null && clip.itemCount > 0) {
                    text = clip.getItemAt(0).coerceToText(this)?.toString() ?: ""
                }
            } catch (_: Exception) {
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        return JSONObject().put("text", text)
    }

    private fun customInfoToJson(c: OrbitEngine.CustomMediaInfo): JSONObject {
        val isImg = c.mediaType == "image"
        val heightsArr = if (isImg) JSONArray() else JSONArray().put(1080).put(720).put(480)
        val imgArr = JSONArray()
        if (isImg) {
            c.imageUrls.forEach { imgArr.put(it) }
        }
        return JSONObject().apply {
            put("title", c.title)
            put("site", c.site)
            put("uploader", c.uploader)
            put("duration", if (isImg) 0 else c.duration)
            put("thumbnail", c.thumbnail)
            put("heights", heightsArr)
            put("directUrl", c.directVideoUrl)
            put("imageUrls", imgArr)
            put("type", if (isImg) "image" else "video")
            if (isImg) put("count", c.imageUrls.size.coerceAtLeast(1))
        }
    }

    private fun fetchVideoInfo(url: String): JSONObject {
        if (url.isBlank()) throw IllegalArgumentException("Please enter a valid link.")
        initLatch.await(30, TimeUnit.SECONDS)

        OrbitEngine.resolveDirectImage(url)?.let { return customInfoToJson(it) }
        OrbitEngine.resolvePinterest(url)?.let { return customInfoToJson(it) }
        OrbitEngine.resolveXiaohongshu(url)?.let { return customInfoToJson(it) }

        val ttInfo = OrbitEngine.resolveTikTok(url)
        if (ttInfo != null && ttInfo.mediaType == "image") {
            return customInfoToJson(ttInfo)
        }
        val igInfo = OrbitEngine.resolveInstagram(url)
        if (igInfo != null && igInfo.mediaType == "image") {
            return customInfoToJson(igInfo)
        }
        val twInfo = OrbitEngine.resolveTwitter(url)
        if (twInfo != null && twInfo.mediaType == "image") {
            return customInfoToJson(twInfo)
        }

        val req = YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            addOption("--socket-timeout", "20")
        }

        val info = try {
            YoutubeDL.getInstance().getInfo(req)
        } catch (e: Exception) {
            val videoFallback = listOfNotNull(igInfo, ttInfo, twInfo).firstOrNull {
                it.mediaType == "video" && it.directVideoUrl.isNotBlank()
            }
            if (videoFallback != null) {
                return customInfoToJson(videoFallback)
            }
            val fallbackImg = OrbitEngine.resolveSocialAndWebImage(url)
            if (fallbackImg != null && fallbackImg.imageUrls.isNotEmpty()) {
                return customInfoToJson(fallbackImg)
            }
            throw IllegalArgumentException(cleanErrorMessage(e.message))
        }

        val heightsSet = sortedSetOf<Int>(Comparator.reverseOrder())
        info.formats?.forEach { fmt ->
            val h = fmt.height
            val vcodec = fmt.vcodec ?: ""
            if (h >= 240 && vcodec != "none") {
                heightsSet.add(h)
            }
        }
        if (heightsSet.isEmpty()) {
            heightsSet.addAll(listOf(1080, 720, 480))
        }

        val rawSite = info.extractorKey ?: info.extractor ?: try {
            Uri.parse(url).host?.removePrefix("www.")?.substringBefore(".") ?: "Media"
        } catch (_: Exception) {
            "Media"
        }

        val thumb = info.thumbnail ?: info.thumbnails?.lastOrNull()?.url ?: ""
        val heightsArr = JSONArray()
        heightsSet.forEach { heightsArr.put(it) }

        return JSONObject().apply {
            put("title", info.title ?: "Untitled video")
            put("site", rawSite)
            put("uploader", info.uploader ?: "")
            put("duration", info.duration)
            put("thumbnail", thumb)
            put("heights", heightsArr)
            put("directUrl", "")
            put("imageUrls", JSONArray())
            put("type", "video")
        }
    }

    private fun startDownloadJob(body: JSONObject): JSONObject {
        val rawUrl = body.optString("url")
        if (rawUrl.isBlank()) throw IllegalArgumentException("Missing URL.")
        val quality = body.optString("quality", "best")
        val title = body.optString("title", "Downloading…")
        val site = body.optString("site", "Video")
        val thumb = body.optString("thumb", "")
        val isImage = body.optString("type") == "image" || quality == "image" || quality == "photo"
        val directUrl = body.optString("directUrl").ifBlank {
            if (!isImage) OrbitEngine.resolveXiaohongshu(rawUrl)?.directVideoUrl ?: rawUrl else rawUrl
        }

        val imgList = ArrayList<String>()
        if (isImage) {
            val imgArr = body.optJSONArray("imageUrls")
            if (imgArr != null) {
                for (i in 0 until imgArr.length()) {
                    val u = imgArr.optString(i)
                    if (u.isNotBlank()) imgList.add(u)
                }
            }
            if (imgList.isEmpty() && directUrl.isNotBlank()) {
                imgList.add(directUrl)
            }
        }

        val id = UUID.randomUUID().toString().substring(0, 8)
        val job = OrbitEngine.DownloadJob(
            id = id,
            url = rawUrl,
            title = title,
            site = site,
            thumb = thumb,
            quality = quality,
            state = "downloading",
            isImage = isImage,
            directUrl = directUrl,
            imageUrls = imgList
        )
        OrbitEngine.activeJobs.add(0, job)
        OrbitEngine.jobsById[id] = job

        val serviceIntent = Intent(this, DownloadService::class.java).apply {
            action = DownloadService.ACTION_START_DOWNLOAD
            putExtra(DownloadService.EXTRA_JOB_ID, id)
            putExtra(DownloadService.EXTRA_URL, rawUrl)
            putExtra(DownloadService.EXTRA_DIRECT_URL, directUrl)
            putExtra(DownloadService.EXTRA_QUALITY, quality)
            putExtra(DownloadService.EXTRA_TITLE, title)
            putExtra(DownloadService.EXTRA_SITE, site)
            putExtra(DownloadService.EXTRA_THUMB, thumb)
            putExtra(DownloadService.EXTRA_IS_IMAGE, isImage)
            putStringArrayListExtra(DownloadService.EXTRA_IMAGE_URLS, imgList)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, serviceIntent)
        } else {
            startService(serviceIntent)
        }

        return JSONObject().put("id", id)
    }

    private fun cancelJob(id: String) {
        val job = OrbitEngine.jobsById[id]
        if (job != null) {
            job.state = "cancelled"
        }
        val cancelIntent = Intent(this, DownloadService::class.java).apply {
            action = DownloadService.ACTION_CANCEL_DOWNLOAD
            putExtra(DownloadService.EXTRA_JOB_ID, id)
        }
        startService(cancelIntent)
    }

    private fun dismissJob(id: String) {
        val job = OrbitEngine.jobsById.remove(id)
        if (job != null) {
            OrbitEngine.activeJobs.remove(job)
        }
    }

    private fun findFileForId(id: String): File? {
        OrbitEngine.jobsById[id]?.file?.takeIf { it.isNotBlank() }?.let { path ->
            val f = File(path)
            if (f.exists()) return f
        }
        val arr = readHistory()
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            if (item.optString("id") == id) {
                val f = File(item.optString("file"))
                if (f.exists()) return f
            }
        }
        return null
    }

    private fun openMediaById(id: String) {
        val file = findFileForId(id) ?: throw IllegalArgumentException("File not found on device.")
        val ext = file.extension.lowercase()
        val mime = when (ext) {
            "mp3", "m4a", "opus", "wav" -> "audio/*"
            "mp4", "mkv", "webm" -> "video/*"
            "jpg", "jpeg", "png", "webp", "gif" -> "image/*"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
        runOnUiThread {
            try {
                val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", file)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(Intent.createChooser(intent, file.name))
            } catch (_: Exception) {
                openDownloadsFolder()
            }
        }
    }

    private fun openDownloadsFolder() {
        runOnUiThread {
            try {
                startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            } catch (_: Exception) {
            }
        }
    }

    private fun parseVersionTuple(v: String): List<Int> {
        return v.trim().removePrefix("v").removePrefix("V")
            .split(".")
            .map { part -> part.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
    }

    private fun isNewerVersion(latest: String, current: String): Boolean {
        val a = parseVersionTuple(latest)
        val b = parseVersionTuple(current)
        val maxLen = maxOf(a.size, b.size)
        for (i in 0 until maxLen) {
            val av = a.getOrElse(i) { 0 }
            val bv = b.getOrElse(i) { 0 }
            if (av != bv) return av > bv
        }
        return false
    }

    private fun checkForUpdates(): JSONObject {
        try {
            val conn = (URL("https://api.github.com/repos/damsarachethiyaa-dev/orbit/releases?per_page=15").openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "Orbit-Android/${BuildConfig.VERSION_NAME}")
            }
            if (conn.responseCode == 200) {
                val releases = JSONArray(conn.inputStream.bufferedReader().readText())
                for (rIdx in 0 until releases.length()) {
                    val data = releases.optJSONObject(rIdx) ?: continue
                    val tag = data.optString("tag_name", "").removePrefix("v")
                    val assets = data.optJSONArray("assets") ?: JSONArray()
                    var apkUrl = ""
                    for (i in 0 until assets.length()) {
                        val a = assets.optJSONObject(i) ?: continue
                        val name = a.optString("name", "").lowercase()
                        if (name.endsWith(".apk")) {
                            apkUrl = a.optString("browser_download_url", "")
                            break
                        }
                    }
                    if (apkUrl.isNotBlank() && tag.isNotBlank()) {
                        latestVersion = "v$tag"
                        releaseName = data.optString("name", "Orbit $latestVersion")
                        downloadUrl = apkUrl
                        hasUpdate = isNewerVersion(tag, BuildConfig.VERSION_NAME)
                        break
                    }
                }
            }
        } catch (_: Exception) {
        }
        return JSONObject().apply {
            put("has_update", hasUpdate)
            put("current_version", BuildConfig.VERSION_NAME)
            put("latest_version", latestVersion)
            put("release_name", releaseName)
            put("download_url", downloadUrl)
        }
    }

    private fun startUpdateDownload(): JSONObject {
        if (downloadUrl.isBlank()) throw IllegalArgumentException("No APK update URL available.")
        if (updateDownloading) return JSONObject().put("ok", true)

        updateDownloading = true
        updatePercent = 0
        updateSpeed = ""
        updateError = ""
        readyToInstall = false

        executor.execute {
            try {
                val updateDir = File(externalCacheDir ?: cacheDir, "update")
                updateDir.mkdirs()
                val outApk = File(updateDir, "Orbit-update.apk")
                if (outApk.exists()) outApk.delete()

                var currentUrl = downloadUrl
                var conn: HttpURLConnection? = null
                var total = -1L

                for (redirect in 0..5) {
                    val c = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = true
                        connectTimeout = 15000
                        readTimeout = 30000
                        setRequestProperty("User-Agent", "Orbit-Android/${BuildConfig.VERSION_NAME}")
                    }
                    val code = c.responseCode
                    if (code in 300..399) {
                        val loc = c.getHeaderField("Location")
                        if (!loc.isNullOrBlank()) {
                            currentUrl = loc
                            continue
                        }
                    }
                    conn = c
                    total = c.contentLengthLong
                    break
                }

                if (conn == null) throw java.io.IOException("Could not connect to update server.")

                var downloaded = 0L
                val startTime = System.currentTimeMillis()

                conn.inputStream.use { input ->
                    FileOutputStream(outApk).use { output ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            val read = input.read(buf)
                            if (read <= 0) break
                            output.write(buf, 0, read)
                            downloaded += read
                            if (total > 0) {
                                updatePercent = ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
                            }
                            val elapsedSec = ((System.currentTimeMillis() - startTime) / 1000.0).coerceAtLeast(0.2)
                            val mbps = (downloaded / (1024.0 * 1024.0)) / elapsedSec
                            updateSpeed = String.format("%.1f MB/s", mbps)
                        }
                    }
                }

                if (!outApk.exists() || outApk.length() < 1000000) {
                    throw java.io.IOException("Downloaded update package is incomplete.")
                }

                outApk.setReadable(true, false)
                downloadedApkPath = outApk.absolutePath
                updatePercent = 100
                readyToInstall = true
            } catch (e: Exception) {
                updateError = e.message ?: "Update download failed"
            } finally {
                updateDownloading = false
            }
        }
        return JSONObject().put("ok", true)
    }

    private fun getUpdateStatus(): JSONObject {
        return JSONObject().apply {
            put("downloading", updateDownloading)
            put("download_percent", updatePercent)
            put("download_speed", updateSpeed)
            put("ready_to_install", readyToInstall)
            put("error", updateError)
        }
    }

    private fun applyApkUpdate(): JSONObject {
        val apkFile = File(downloadedApkPath)
        if (!apkFile.exists()) throw IllegalArgumentException("Downloaded update package not found.")
        runOnUiThread {
            try {
                apkFile.setReadable(true, false)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!packageManager.canRequestPackageInstalls()) {
                        Toast.makeText(
                            applicationContext,
                            "Please allow Orbit to install updates from unknown sources.",
                            Toast.LENGTH_LONG
                        ).show()
                        val manageIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                            data = Uri.parse("package:$packageName")
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(manageIntent)
                        return@runOnUiThread
                    }
                }

                val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", apkFile)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                val resolved = packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
                for (info in resolved) {
                    try {
                        grantUriPermission(info.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    } catch (_: Exception) {}
                }

                val commonInstallers = listOf(
                    "com.google.android.packageinstaller",
                    "com.android.packageinstaller",
                    "com.google.android.apps.packageinstaller",
                    "com.miui.packageinstaller",
                    "com.samsung.android.packageinstaller",
                    "com.coloros.packageinstaller",
                    "com.oppo.packageinstaller",
                    "com.vivo.packageinstaller"
                )
                for (pkg in commonInstallers) {
                    try {
                        grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    } catch (_: Exception) {}
                }

                startActivity(intent)
            } catch (e: Exception) {
                Toast.makeText(applicationContext, "Install failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
        return JSONObject().put("ok", true)
    }

    private fun cleanErrorMessage(raw: String?): String {
        return OrbitEngine.cleanErrorMessage(raw)
    }
}
