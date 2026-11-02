package dev.chethiya.orbit

import android.Manifest
import android.media.MediaScannerConnection
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
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
import java.util.Locale
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

    @Volatile
    private var destroyed = false

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

        // Start a shared download before initializing the engine or creating the WebView.
        val sharedLink = extractSharedUrl(intent)
        val sharedDownloadStarted = savedInstanceState == null && sharedLink != null &&
            startSharedDownload(sharedLink)

        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        requestStoragePermissionsIfNeeded()
        initEngineAsync()
        resumeInterruptedDownloads()

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
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
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
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean {
                    return handleNavigation(request.url, request.isForMainFrame)
                }

                @Deprecated("Used by Android versions without WebResourceRequest navigation")
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    return handleNavigation(Uri.parse(url ?: ""), true)
                }

                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val uri = request?.url ?: return null
                    if (uri.scheme != "https" || uri.host != "orbit.local") {
                        return super.shouldInterceptRequest(view, request)
                    }

                    var path = (uri.path ?: "/").removePrefix("/")
                    if (path.isEmpty() || path == "index.html") {
                        path = "desktop/index.html"
                    }
                    if (path.startsWith("stream/")) {
                        val id = path.removePrefix("stream/").substringBefore("/")
                        val filePath = findFileForId(id)
                        if (filePath != null) {
                            streamMedia(filePath, request.requestHeaders?.get("Range"))?.let { return it }
                        }
                        return WebResourceResponse(
                            "text/plain", "UTF-8", 404, "Not Found",
                            mapOf("Access-Control-Allow-Origin" to "https://orbit.local"),
                            ByteArrayInputStream("File not found".toByteArray())
                        )
                    }
                    return try {
                        val stream = assets.open(path)
                        val mime = guessMime(path)
                        val headers = mutableMapOf(
                            "Access-Control-Allow-Origin" to "https://orbit.local",
                            "Cache-Control" to "no-cache",
                            "X-Content-Type-Options" to "nosniff"
                        )
                        if (path == "desktop/index.html") {
                            headers["Content-Security-Policy"] =
                                "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
                                "img-src 'self' https: data:; font-src 'self'; media-src 'self' https: data: blob:; connect-src 'self' https:; " +
                                "frame-src 'self' https:; object-src 'none'; base-uri 'none'"
                        }
                        WebResourceResponse(
                            mime,
                            "UTF-8",
                            200,
                            "OK",
                            headers,
                            stream
                        )
                    } catch (e: Exception) {
                        WebResourceResponse(
                            "text/plain",
                            "UTF-8",
                            404,
                            "Not Found",
                            mapOf("Access-Control-Allow-Origin" to "https://orbit.local"),
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

        val startUrl = if (sharedDownloadStarted) {
            "https://orbit.local/desktop/index.html?shared=1"
        } else if (!sharedLink.isNullOrBlank() && savedInstanceState == null) {
            "https://orbit.local/desktop/index.html?url=" + URLEncoder.encode(sharedLink, "UTF-8")
        } else {
            "https://orbit.local/desktop/index.html"
        }
        webView.loadUrl(startUrl)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized && !isDestroyed) {
            webView.post {
                webView.evaluateJavascript("if (window.checkClip) window.checkClip(); if (window.poll) window.poll();", null)
            }
        }
    }

    override fun onDestroy() {
        destroyed = true
        if (::webView.isInitialized) {
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        executor.shutdown()
        super.onDestroy()
    }

    /** Streams a saved file (plain path or MediaStore/FileProvider URI) to the in-app player with HTTP Range support. */
    private fun streamMedia(path: String, rangeHeader: String?): WebResourceResponse? {
        return try {
            val uri = if (path.startsWith("content://")) Uri.parse(path) else Uri.fromFile(File(path))
            val afd = contentResolver.openAssetFileDescriptor(uri, "r") ?: return null
            val total = afd.length
            val ext = (if (path.startsWith("content://")) "" else File(path).extension).lowercase()
            val mime = when {
                ext == "mp3" -> "audio/mpeg"
                ext == "m4a" -> "audio/mp4"
                ext == "webm" -> "video/webm"
                ext == "mkv" -> "video/x-matroska"
                else -> contentResolver.getType(uri)?.takeIf { it.isNotBlank() && it != "application/octet-stream" } ?: "video/mp4"
            }
            var start = 0L
            var end = if (total > 0) total - 1 else Long.MAX_VALUE
            var partial = false
            val m = Regex("""bytes=(\d*)-(\d*)""").find(rangeHeader.orEmpty())
            if (m != null && total > 0) {
                val s = m.groupValues[1]
                val e = m.groupValues[2]
                if (s.isNotEmpty()) {
                    start = s.toLong().coerceAtMost(total - 1)
                    if (e.isNotEmpty()) end = e.toLong().coerceAtMost(total - 1)
                } else if (e.isNotEmpty()) {
                    start = (total - e.toLong()).coerceAtLeast(0)
                }
                partial = true
            }
            val length = if (total > 0) end - start + 1 else -1L
            val input = afd.createInputStream()
            var skipped = 0L
            while (skipped < start) {
                val n = input.skip(start - skipped)
                if (n <= 0) break
                skipped += n
            }
            val body = object : java.io.FilterInputStream(input) {
                private var left = length
                override fun read(): Int {
                    if (left == 0L) return -1
                    val b = super.read()
                    if (b >= 0 && left > 0) left--
                    return b
                }
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (left == 0L) return -1
                    val n = super.read(b, off, if (left > 0) minOf(len.toLong(), left).toInt() else len)
                    if (n > 0 && left > 0) left -= n
                    return n
                }
                override fun close() {
                    try { super.close() } finally { try { afd.close() } catch (_: Exception) {} }
                }
            }
            val headers = mutableMapOf(
                "Accept-Ranges" to "bytes",
                "Access-Control-Allow-Origin" to "https://orbit.local",
                "Content-Type" to mime
            )
            if (length >= 0) headers["Content-Length"] = length.toString()
            if (partial) headers["Content-Range"] = "bytes $start-$end/$total"
            WebResourceResponse(mime, null, if (partial) 206 else 200, if (partial) "Partial Content" else "OK", headers, body)
        } catch (_: Exception) {
            null
        }
    }

    private fun resumeInterruptedDownloads() {
        if (OrbitEngine.loadPending(this).isEmpty()) return
        val intent = Intent(this, DownloadService::class.java).apply { action = DownloadService.ACTION_RESUME }
        try {
            ContextCompat.startForegroundService(this, intent)
        } catch (_: Exception) {
            // The system will restart the service on its own; nothing is lost.
        }
    }

    private fun handleNavigation(uri: Uri, isForMainFrame: Boolean): Boolean {
        if (isForMainFrame && uri.scheme == "https" && uri.host == "orbit.local" &&
            (uri.path == "/desktop/index.html" || uri.path == "/")) return false
        if (isForMainFrame && (uri.scheme == "https" || uri.scheme == "http")) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
            } catch (_: Exception) {
                Toast.makeText(this, "No browser available to open link.", Toast.LENGTH_SHORT).show()
            }
        }
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val sharedLink = extractSharedUrl(intent)
        if (!sharedLink.isNullOrBlank()) {
            val started = startSharedDownload(sharedLink)
            if (!::webView.isInitialized) return
            val quoted = JSONObject.quote(sharedLink)
            webView.post {
                if (started) {
                    webView.evaluateJavascript("if (window.show && window.poll) { show('download'); poll(); toast('Download started in background'); }", null)
                } else {
                    webView.evaluateJavascript("window.onOrbitShareLink && window.onOrbitShareLink($quoted);", null)
                }
            }
        }
    }

    private fun startSharedDownload(url: String): Boolean {
        val serviceIntent = Intent(this, DownloadService::class.java).apply {
            action = DownloadService.ACTION_START_DOWNLOAD
            putExtra(DownloadService.EXTRA_URL, url)
        }
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, serviceIntent)
            } else {
                startService(serviceIntent)
            }
            true
        } catch (e: Exception) {
            Toast.makeText(this, "Could not start background download: ${e.message}", Toast.LENGTH_LONG).show()
            false
        }
    }

    private fun extractSharedUrl(intent: Intent?): String? {
        if (intent == null) return null
        if (Intent.ACTION_SEND == intent.action && intent.type?.startsWith("text/") == true) {
            val raw = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
            return OrbitEngine.extractUrl(raw)
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

    private fun currentSaveDir(): File = OrbitEngine.currentSaveDir(this)

    private fun currentDefaultQuality(): String {
        return prefs().getString("default_quality", "best") ?: "best"
    }

    private fun readHistory(): JSONArray = OrbitEngine.readHistory(applicationContext)

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
                if (destroyed) return@execute
                val jsonQuoted = JSONObject.quote(responseObj.toString())
                val cbQuoted = JSONObject.quote(cbId)
                webView.post {
                    if (!destroyed) webView.evaluateJavascript("window[$cbQuoted] && window[$cbQuoted]($jsonQuoted);", null)
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
            path == "/api/battery/status" -> {
                val ignored = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                    pm?.isIgnoringBatteryOptimizations(packageName) ?: true
                } else {
                    true
                }
                JSONObject().put("ignored", ignored)
            }
            path == "/api/battery/request" -> {
                runOnUiThread {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        try {
                            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                data = Uri.parse("package:$packageName")
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(intent)
                        } catch (_: Exception) {
                            try {
                                val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                }
                                startActivity(intent)
                            } catch (_: Exception) {}
                        }
                    }
                }
                JSONObject().put("ok", true)
            }
            path == "/api/search" || path == "/api/ai/query" -> searchVideos(body.optString("query"))
            path == "/api/apps" -> installedShareTargets()
            path == "/api/info" -> fetchVideoInfo(body.optString("url"))
            path == "/api/download" -> startDownloadJob(body)
            path.startsWith("/api/retry/") -> retryJob(path.removePrefix("/api/retry/"))
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
            path.startsWith("/api/share/") -> {
                val id = path.removePrefix("/api/share/")
                shareMediaById(id, body.optString("pkg").ifBlank { null })
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/convert/") -> startConversion(path.removePrefix("/api/convert/"), body.optString("mode", "share"))
            path.startsWith("/api/vault/hide/") -> {
                val id = path.removePrefix("/api/vault/hide/")
                toggleVaultItem(id, true)
            }
            path.startsWith("/api/vault/restore/") -> {
                val id = path.removePrefix("/api/vault/restore/")
                toggleVaultItem(id, false)
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
                    val exists = OrbitEngine.mediaExists(this, filePath)
                    val copy = JSONObject(item.toString())
                    copy.put("exists", exists)
                    out.put(copy)
                }
                out
            }
            path == "/api/history" && method == "DELETE" -> {
                OrbitEngine.clearHistory(applicationContext)
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/history/") && method == "DELETE" -> {
                val id = path.removePrefix("/api/history/")
                OrbitEngine.deleteHistoryItem(applicationContext, id)
                JSONObject().put("ok", true)
            }
            path == "/api/update/check" -> checkForUpdates()
            path == "/api/update/download" || path == "/api/update/start" -> startUpdateDownload()
            path == "/api/update/status" -> getUpdateStatus()
            path == "/api/update/apply" -> applyApkUpdate()
            else -> throw IllegalArgumentException("Unsupported app action: $path")
        }
    }

    private fun getSettingsJson(): JSONObject {
        return JSONObject().apply {
            put("save_dir", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                "Pictures/Orbit · Movies/Orbit · Music/Orbit" else currentSaveDir().absolutePath)
            put("default_quality", currentDefaultQuality())
            put("auto_download", prefs().getBoolean("auto_download", false))
            put("share_ready", OrbitEngine.currentShareReady(this@MainActivity))
            put("version", BuildConfig.VERSION_NAME)
            put("build", if (BuildConfig.DEBUG) "Review build" else "Release build")
            put("yt_dlp", OrbitEngine.ytDlpVersion)
            put("engine_ready", OrbitEngine.engineReady)
            put("ffmpeg", OrbitEngine.ffmpegReady)
            put("ffmpeg_version", OrbitEngine.ffmpegVersion)
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
        if (body.has("share_ready")) {
            edit.putBoolean("share_ready", body.optBoolean("share_ready", true))
        }
        if (body.has("save_dir")) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                throw IllegalArgumentException("Android saves media in Pictures, Movies and Music folders.")
            }
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
        // Direct streams arrive as one file with no quality ladder, so none is offered (it used to list 1080/720/480).
        val heightsArr = JSONArray()
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
        var h264Max = 0
        val codecByHeight = HashMap<Int, String>()
        info.formats?.forEach { fmt ->
            val h = fmt.height
            val vcodec = (fmt.vcodec ?: "").lowercase(Locale.ROOT)
            if (h >= 240 && vcodec != "none" && vcodec.isNotBlank()) {
                heightsSet.add(h)
                if (vcodec.startsWith("avc") || vcodec.startsWith("h264")) h264Max = maxOf(h264Max, h)
                else if (!codecByHeight.containsKey(h) || codecByHeight[h] == "") {
                    codecByHeight[h] = when {
                        vcodec.startsWith("vp9") || vcodec.startsWith("vp09") -> "VP9"
                        vcodec.startsWith("av01") || vcodec.startsWith("av1") -> "AV1"
                        vcodec.startsWith("hev") || vcodec.startsWith("hvc") || vcodec.startsWith("h265") -> "HEVC"
                        else -> vcodec.uppercase(Locale.ROOT)
                    }
                }
            }
        }
        if (heightsSet.isEmpty()) {
            heightsSet.addAll(listOf(1080, 720, 480))
        }
        val maxHeight = heightsSet.first()
        val maxCodec = codecByHeight[maxHeight] ?: if (h264Max == maxHeight) "H.264" else ""

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
            put("h264Max", h264Max)
            put("maxCodec", maxCodec)
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

        val shareReady = if (body.has("shareReady")) body.optBoolean("shareReady", true) else OrbitEngine.currentShareReady(this)
        val id = UUID.randomUUID().toString().substring(0, 8)
        val job = OrbitEngine.DownloadJob(
            id = id,
            url = rawUrl,
            title = title,
            site = site,
            thumb = thumb,
            quality = quality,
            state = "queued",
            isImage = isImage,
            directUrl = directUrl,
            imageUrls = imgList,
            shareReady = shareReady
        )
        launchJob(job)
        return JSONObject().put("id", id)
    }

    /** Registers [job] and hands it to the foreground service. A failure to start is shown on the job itself. */
    private fun launchJob(job: OrbitEngine.DownloadJob) {
        OrbitEngine.activeJobs.add(0, job)
        OrbitEngine.jobsById[job.id] = job
        val serviceIntent = Intent(this, DownloadService::class.java).apply {
            action = DownloadService.ACTION_START_DOWNLOAD
            putExtra(DownloadService.EXTRA_JOB_ID, job.id)
            putExtra(DownloadService.EXTRA_URL, job.url)
            putExtra(DownloadService.EXTRA_DIRECT_URL, job.directUrl)
            putExtra(DownloadService.EXTRA_QUALITY, job.quality)
            putExtra(DownloadService.EXTRA_TITLE, job.title)
            putExtra(DownloadService.EXTRA_SITE, job.site)
            putExtra(DownloadService.EXTRA_THUMB, job.thumb)
            putExtra(DownloadService.EXTRA_IS_IMAGE, job.isImage)
            putExtra(DownloadService.EXTRA_SHARE_READY, job.shareReady)
            putStringArrayListExtra(DownloadService.EXTRA_IMAGE_URLS, ArrayList(job.imageUrls))
        }
        try {
            ContextCompat.startForegroundService(this, serviceIntent)
        } catch (e: Exception) {
            job.state = "error"
            job.error = "Android blocked the background download. Keep Orbit open and tap retry."
        }
    }

    private fun retryJob(id: String): JSONObject {
        val old = OrbitEngine.jobsById[id] ?: throw IllegalArgumentException("That download is no longer in the list.")
        dismissJob(id)
        val job = OrbitEngine.DownloadJob(
            id = UUID.randomUUID().toString().substring(0, 8),
            url = old.url, title = old.title, site = old.site, thumb = old.thumb, quality = old.quality,
            state = "queued", isImage = old.isImage, directUrl = old.directUrl, imageUrls = old.imageUrls,
            shareReady = old.shareReady
        )
        launchJob(job)
        return JSONObject().put("id", job.id)
    }

    private fun startConversion(sourceId: String, mode: String): JSONObject {
        if (OrbitEngine.findMediaPath(this, sourceId) == null) {
            throw IllegalArgumentException("The original file is no longer on this device.")
        }
        if (!OrbitEngine.ffmpegReady) throw IllegalArgumentException("The video converter is still starting. Try again in a few seconds.")
        val intent = Intent(this, DownloadService::class.java).apply {
            action = DownloadService.ACTION_CONVERT
            putExtra(DownloadService.EXTRA_SOURCE_ID, sourceId)
            putExtra(DownloadService.EXTRA_MODE, mode)
        }
        try {
            ContextCompat.startForegroundService(this, intent)
        } catch (e: Exception) {
            throw IllegalArgumentException("Android blocked the background task. Keep Orbit open and try again.")
        }
        return JSONObject().put("ok", true)
    }

    private fun cancelJob(id: String) {
        OrbitEngine.jobsById[id]?.state = "cancelled"
        OrbitEngine.removePending(this, id)
        val cancelIntent = Intent(this, DownloadService::class.java).apply {
            action = DownloadService.ACTION_CANCEL_DOWNLOAD
            putExtra(DownloadService.EXTRA_JOB_ID, id)
        }
        try {
            ContextCompat.startForegroundService(this, cancelIntent)
        } catch (_: Exception) {
            // Service is not running, so there is nothing left to stop.
        }
    }

    private fun dismissJob(id: String) {
        val job = OrbitEngine.jobsById.remove(id)
        if (job != null) {
            OrbitEngine.activeJobs.remove(job)
        }
    }

    private fun findFileForId(id: String): String? = OrbitEngine.findMediaPath(this, id)

    private val shareTargets = linkedMapOf(
        "wechat" to "com.tencent.mm",
        "whatsapp" to "com.whatsapp",
        "telegram" to "org.telegram.messenger"
    )

    private fun isInstalled(pkg: String): Boolean = try {
        packageManager.getPackageInfo(pkg, 0)
        true
    } catch (_: Exception) {
        false
    }

    private fun installedShareTargets(): JSONObject {
        val o = JSONObject()
        shareTargets.forEach { (name, pkg) -> o.put(name, isInstalled(pkg)) }
        return o
    }

    private fun openMediaById(id: String) {
        val path = findFileForId(id) ?: throw IllegalArgumentException("File not found on device.")
        val ext = if (path.startsWith("content://")) "" else File(path).extension.lowercase()
        val mime = when (ext) {
            "mp3", "m4a", "opus", "wav" -> "audio/*"
            "mp4", "mkv", "webm" -> "video/*"
            "jpg", "jpeg", "png", "webp", "gif" -> "image/*"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
        runOnUiThread {
            try {
                val uri = OrbitEngine.mediaUri(this, path)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, contentResolver.getType(uri) ?: mime)
                    clipData = ClipData.newRawUri("", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(intent, "Open media"))
            } catch (_: Exception) {
                openDownloadsFolder()
            }
        }
    }

    /** Shares a saved file. With [pkg] it goes straight to that app (WeChat, WhatsApp, Telegram); otherwise the system sheet. */
    private fun shareMediaById(id: String, pkg: String? = null) {
        val path = findFileForId(id) ?: throw IllegalArgumentException("File not found on device.")
        if (pkg != null && pkg !in shareTargets.values) throw IllegalArgumentException("Unsupported share target.")
        val ext = if (path.startsWith("content://")) "" else File(path).extension.lowercase()
        val mime = when (ext) {
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "opus", "wav" -> "audio/*"
            "mp4", "m4v" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            "jpg", "jpeg" -> "image/jpeg"
            "png", "webp", "gif" -> "image/*"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
        runOnUiThread {
            try {
                val uri = OrbitEngine.mediaUri(this, path)
                val type = contentResolver.getType(uri)?.takeIf { it.isNotBlank() && it != "application/octet-stream" } ?: mime
                val intent = Intent(Intent.ACTION_SEND).apply {
                    this.type = type
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri("", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if (pkg != null) setPackage(pkg)
                }
                if (pkg != null) {
                    startActivity(intent)
                } else {
                    startActivity(Intent.createChooser(intent, "Share"))
                }
            } catch (e: Exception) {
                Toast.makeText(applicationContext, "Couldn't open the share target: ${e.message}", Toast.LENGTH_SHORT).show()
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
        if (BuildConfig.DEBUG) return JSONObject().apply {
            put("has_update", false)
            put("current_version", BuildConfig.VERSION_NAME)
            put("latest_version", BuildConfig.VERSION_NAME)
        }
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

    @Synchronized
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
                            updateSpeed = String.format(Locale.US, "%.1f MB/s", mbps)
                        }
                    }
                }

                if (!outApk.exists() || outApk.length() < 1000000) {
                    throw java.io.IOException("Downloaded update package is incomplete.")
                }
                val archive = packageManager.getPackageArchiveInfo(outApk.absolutePath, 0)
                if (archive?.packageName != packageName ||
                    !isNewerVersion(archive?.versionName ?: "", BuildConfig.VERSION_NAME)) {
                    throw java.io.IOException("Downloaded package is not a newer Orbit update.")
                }

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

    private fun toggleVaultItem(id: String, hide: Boolean): JSONObject {
        val path = findFileForId(id) ?: throw IllegalArgumentException("File not found.")
        val newPath = if (hide) OrbitEngine.moveToVault(applicationContext, path)
        else OrbitEngine.restoreFromVault(applicationContext, path)

        val arr = readHistory()
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            if (item.optString("id") == id) {
                item.put("file", newPath)
                item.put("vault", hide)
                item.remove("files")
                break
            }
        }
        OrbitEngine.writeHistory(applicationContext, arr)
        OrbitEngine.jobsById[id]?.file = newPath
        return JSONObject().put("ok", true)
    }

    /** Video search powered by yt-dlp's own YouTube search, with a page-scrape fallback. */
    private fun searchVideos(rawQuery: String): JSONObject {
        val q = rawQuery.trim()
        if (q.isBlank()) throw IllegalArgumentException("Type something to search for.")
        initLatch.await(30, TimeUnit.SECONDS)

        val results = JSONArray()
        try {
            val req = YoutubeDLRequest("ytsearch8:$q").apply {
                addOption("--flat-playlist")
                addOption("--dump-json")
                addOption("--socket-timeout", "15")
                addOption("--no-warnings")
            }
            val out = YoutubeDL.getInstance().execute(req).out
            for (line in out.lines()) {
                if (!line.trim().startsWith("{")) continue
                val o = try { JSONObject(line) } catch (_: Exception) { continue }
                val vid = o.optString("id")
                if (vid.isBlank()) continue
                val secs = o.optDouble("duration", 0.0).toInt()
                results.put(JSONObject().apply {
                    put("title", o.optString("title", "Video"))
                    put("uploader", o.optString("channel").ifBlank { o.optString("uploader") })
                    put("duration", if (secs > 0) formatDuration(secs) else "")
                    put("url", o.optString("url").takeIf { it.startsWith("http") } ?: "https://www.youtube.com/watch?v=$vid")
                    put("thumb", "https://i.ytimg.com/vi/$vid/hqdefault.jpg")
                })
            }
        } catch (_: Exception) {
            // fall through to the HTML fallback
        }
        if (results.length() == 0) scrapeYoutubeSearch(q, results)
        return JSONObject().put("query", q).put("results", results)
    }

    private fun formatDuration(secs: Int): String {
        val h = secs / 3600
        val m = secs % 3600 / 60
        val s = secs % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
    }

    private fun scrapeYoutubeSearch(q: String, into: JSONArray) {
        try {
            val conn = (URL("https://www.youtube.com/results?search_query=" + URLEncoder.encode(q, "UTF-8")).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                setRequestProperty("Accept-Language", "en-US,en;q=0.9")
            }
            val html = conn.inputStream.bufferedReader().use { it.readText() }
            val matcher = java.util.regex.Pattern.compile("""var ytInitialData = (\{.*?\});</script>""").matcher(html)
            if (!matcher.find()) return
            val sections = JSONObject(matcher.group(1)!!)
                .optJSONObject("contents")?.optJSONObject("twoColumnSearchResultsRenderer")
                ?.optJSONObject("primaryContents")?.optJSONObject("sectionListRenderer")?.optJSONArray("contents") ?: return
            for (i in 0 until sections.length()) {
                val items = sections.optJSONObject(i)?.optJSONObject("itemSectionRenderer")?.optJSONArray("contents") ?: continue
                for (j in 0 until items.length()) {
                    val vr = items.optJSONObject(j)?.optJSONObject("videoRenderer") ?: continue
                    val vid = vr.optString("videoId").takeIf { it.isNotBlank() } ?: continue
                    into.put(JSONObject().apply {
                        put("title", vr.optJSONObject("title")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text") ?: "Video")
                        put("uploader", vr.optJSONObject("ownerText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text") ?: "")
                        put("duration", vr.optJSONObject("lengthText")?.optString("simpleText") ?: "")
                        put("url", "https://www.youtube.com/watch?v=$vid")
                        put("thumb", "https://i.ytimg.com/vi/$vid/hqdefault.jpg")
                    })
                    if (into.length() >= 8) return
                }
            }
        } catch (_: Exception) {}
    }

}
