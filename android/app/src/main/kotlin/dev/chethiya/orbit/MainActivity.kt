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
import android.widget.FrameLayout
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import android.provider.MediaStore
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

    private lateinit var orbitPlayer: OrbitPlayer

    /** Newest request first, so what is on screen decodes before what was scrolled past. */
    private val thumbPool = java.util.concurrent.ThreadPoolExecutor(
        4, 4, 30, TimeUnit.SECONDS,
        object : java.util.concurrent.LinkedBlockingDeque<Runnable>() {
            override fun offer(e: Runnable): Boolean = offerFirst(e)
        }
    )

    /** Hands WebView a response straight away; bytes arrive when the decode finishes, and closing cancels it. */
    private class FutureStream(private val task: java.util.concurrent.Future<ByteArray?>) : java.io.InputStream() {
        private var inner: ByteArrayInputStream? = null
        private fun src(): ByteArrayInputStream = inner ?: ByteArrayInputStream(
            try { task.get() ?: ByteArray(0) } catch (_: Exception) { ByteArray(0) }
        ).also { inner = it }
        override fun read(): Int = src().read()
        override fun read(b: ByteArray, off: Int, len: Int): Int = src().read(b, off, len)
        override fun close() { task.cancel(true) }
    }

    private var rootLayout: FrameLayout? = null

    /** System "move to trash / delete" confirmation for photos and videos Orbit didn't create. */
    private val mediaRequest = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.onMediaRequest && window.onMediaRequest(${res.resultCode == RESULT_OK});", null)
        }
    }

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
                    if (path.startsWith("thumb/")) {
                        val id = path.removePrefix("thumb/").substringBefore("/")
                        val size = uri.getQueryParameter("s")?.toIntOrNull() ?: 384
                        // WebView asks for intercepts one at a time, so the decode must happen off this thread.
                        val task = thumbPool.submit(java.util.concurrent.Callable<ByteArray?> {
                            findFileForId(id)?.let { MediaLibrary.thumbnail(applicationContext, id, it, size) }
                        })
                        return WebResourceResponse(
                            "image/jpeg", null, 200, "OK",
                            mapOf("Cache-Control" to "public, max-age=604800", "Access-Control-Allow-Origin" to "https://orbit.local"),
                            FutureStream(task)
                        )
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

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        rootLayout = root
        orbitPlayer = OrbitPlayer(this, root, webView)
        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the web UI close the viewer / selection / sub-screen first.
                webView.evaluateJavascript("(window.orbitBack ? window.orbitBack() : false)") { handled ->
                    if (handled != "true") moveTaskToBack(true)
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
                webView.evaluateJavascript("if (window.checkClip) window.checkClip(); if (window.poll) window.poll(); if (window.onOrbitResume) window.onOrbitResume();", null)
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
                ext == "jpg" || ext == "jpeg" -> "image/jpeg"
                ext == "png" -> "image/png"
                ext == "webp" -> "image/webp"
                ext == "gif" -> "image/gif"
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
        if (mediaPermissionState() == "none") perms.addAll(mediaPermissions())
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1001)
        }
    }

    private fun mediaPermissions(): List<String> = when {
        Build.VERSION.SDK_INT >= 34 -> listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        else -> listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    /** "full", "partial" (Android 14+ "selected photos only") or "none". */
    private fun mediaPermissionState(): String = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO) -> "full"
        Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> "partial"
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && granted(Manifest.permission.READ_EXTERNAL_STORAGE) -> "full"
        else -> "none"
    }

    /** Asks for access; once Android has stopped showing the prompt, opens Orbit's settings page instead. */
    private fun requestMediaAccess() {
        runOnUiThread {
            val perms = mediaPermissions()
            val first = perms.first()
            val asked = prefs().getBoolean("media_asked", false)
            if (asked && mediaPermissionState() == "none" && !ActivityCompat.shouldShowRequestPermissionRationale(this, first)) {
                startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            } else {
                prefs().edit().putBoolean("media_asked", true).apply()
                ActivityCompat.requestPermissions(this, perms.toTypedArray(), 1002)
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (::webView.isInitialized) webView.evaluateJavascript("window.onOrbitResume && window.onOrbitResume();", null)
    }

    private fun jsonIds(body: JSONObject): List<String> {
        val a = body.optJSONArray("ids") ?: return emptyList()
        return (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() }
    }

    /** Sends device photos / videos to the system trash. Android shows its own confirmation. */
    private fun trashDeviceMedia(ids: List<String>, delete: Boolean): JSONObject {
        val uris = ids.mapNotNull { MediaLibrary.deviceUri(it) }
        if (uris.isEmpty()) return JSONObject().put("done", true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val pi = if (delete) MediaStore.createDeleteRequest(contentResolver, uris) else MediaStore.createTrashRequest(contentResolver, uris, true)
            runOnUiThread { mediaRequest.launch(IntentSenderRequest.Builder(pi.intentSender).build()) }
            return JSONObject().put("pending", true)
        }
        uris.forEach { try { contentResolver.delete(it, null, null) } catch (_: Exception) {} }
        return JSONObject().put("done", true)
    }

    /** Takes items back out of the phone's trash. Android shows its own confirmation. */
    private fun restoreDeviceMedia(ids: List<String>): JSONObject {
        val uris = ids.mapNotNull { MediaLibrary.deviceUri(it) }
        if (uris.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return JSONObject().put("done", true)
        val pi = MediaStore.createTrashRequest(contentResolver, uris, false)
        runOnUiThread { mediaRequest.launch(IntentSenderRequest.Builder(pi.intentSender).build()) }
        return JSONObject().put("pending", true)
    }

    /** Copies device items into the private vault, then asks Android to remove the public originals. */
    private fun hideDeviceMedia(ids: List<String>): JSONObject {
        var moved = 0
        val done = ArrayList<String>()
        for (id in ids) {
            val uri = MediaLibrary.deviceUri(id) ?: continue
            val file = OrbitEngine.copyUriToVault(applicationContext, uri)
            OrbitEngine.addHistoryItem(
                applicationContext, id = UUID.randomUUID().toString().substring(0, 8), title = file.name, site = "This phone",
                thumb = "", quality = if (id.startsWith("m_i_")) "image" else "best", file = file.absolutePath, size = file.length()
            )
            val arr = readHistory()
            arr.optJSONObject(0)?.put("vault", true)
            OrbitEngine.writeHistory(applicationContext, arr)
            moved++
            done.add(id)
        }
        val res = trashDeviceMedia(done, true)
        return res.put("moved", moved)
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
        fun playerOpen(id: String, audioOnly: Boolean) {
            val path = findFileForId(id)
            runOnUiThread {
                if (path != null) orbitPlayer.open(path, audioOnly)
                else webView.evaluateJavascript("window.orbitPlayerEvent && window.orbitPlayerEvent({ev:'error',msg:'missing'});", null)
            }
        }
        @JavascriptInterface fun playerStop() { runOnUiThread { orbitPlayer.stop() } }
        @JavascriptInterface fun playerClose() { runOnUiThread { orbitPlayer.close() } }
        @JavascriptInterface fun viewerOpen(open: Boolean) { runOnUiThread { orbitPlayer.setViewerOpen(open) } }
        @JavascriptInterface fun playerPlay() { runOnUiThread { orbitPlayer.play() } }
        @JavascriptInterface fun playerPause() { runOnUiThread { orbitPlayer.pause() } }
        @JavascriptInterface fun playerSeek(ms: Double, scrubbing: Boolean) { runOnUiThread { orbitPlayer.seek(ms.toLong(), scrubbing) } }
        @JavascriptInterface fun playerRate(rate: Double) { runOnUiThread { orbitPlayer.setRate(rate.toFloat()) } }
        @JavascriptInterface fun playerMuted(muted: Boolean) { runOnUiThread { orbitPlayer.setMuted(muted) } }
        @JavascriptInterface fun playerRect(l: Int, t: Int, w: Int, h: Int) { runOnUiThread { orbitPlayer.setRect(l, t, w, h) } }
        @JavascriptInterface fun playerOffset(dx: Double, dy: Double) { runOnUiThread { orbitPlayer.setOffset(dx.toFloat(), dy.toFloat()) } }

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
            path == "/api/notices" -> JSONObject().put("items", OrbitEngine.readNotices(applicationContext))
                .put("enabled", androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled())
            path == "/api/notices/read" -> { OrbitEngine.markNoticesRead(applicationContext); JSONObject().put("ok", true) }
            path == "/api/notices/clear" -> { OrbitEngine.clearNotices(applicationContext); JSONObject().put("ok", true) }
            path == "/api/notices/settings" -> {
                runOnUiThread {
                    startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName))
                }
                JSONObject().put("ok", true)
            }
            path == "/api/ai/status" -> aiStatus()
            path == "/api/ai/key" -> aiSaveKey(body.optString("key"))
            path == "/api/ai/key/remove" -> { prefs().edit().remove("gemini_key").remove("gemini_model").apply(); aiStatus() }
            path == "/api/ai/chat" -> aiChat(body)
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
            path == "/api/media/permission" -> JSONObject().put("state", mediaPermissionState())
            path == "/api/media/request" -> { requestMediaAccess(); JSONObject().put("ok", true) }
            path == "/api/media/list" -> if (mediaPermissionState() == "none") JSONArray() else MediaLibrary.list(applicationContext, readHistory())
            path == "/api/media/trash" -> trashDeviceMedia(jsonIds(body), false)
            path == "/api/media/trashed" -> if (mediaPermissionState() == "none") JSONArray() else MediaLibrary.listTrashed(applicationContext)
            path == "/api/media/restore" -> restoreDeviceMedia(jsonIds(body))
            path == "/api/media/purge" -> trashDeviceMedia(jsonIds(body), true)
            path == "/api/media/vault" -> hideDeviceMedia(jsonIds(body))
            path == "/api/share-many" -> { shareMany(jsonIds(body)); JSONObject().put("ok", true) }
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
                    val q = copy.optString("quality")
                    if (exists && q != "image" && q != "photo") copy.put("dur", MediaLibrary.durationOf(applicationContext, filePath))
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
                val blocked = OrbitEngine.deleteHistoryItem(applicationContext, id)
                if (blocked.isNotEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val pi = MediaStore.createDeleteRequest(contentResolver, blocked.map { Uri.parse(it) })
                    runOnUiThread { mediaRequest.launch(IntentSenderRequest.Builder(pi.intentSender).build()) }
                    JSONObject().put("pending", true)
                } else JSONObject().put("ok", true)
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

        val vimeo = OrbitEngine.resolveVimeo(url)
        val req = YoutubeDLRequest(vimeo?.directVideoUrl ?: url).apply {
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
            val host = try { Uri.parse(url).host.orEmpty().lowercase(Locale.ROOT) } catch (_: Exception) { "" }
            val videoOnlySite = listOf("youtube.", "youtu.be", "twitch.", "vimeo.", "dailymotion.", "soundcloud.", "bilibili.", "rumble.", "kick.com", "odysee.", "twitter.com", "x.com")
                .any { host.contains(it) }
            val fallbackImg = if (videoOnlySite) null else OrbitEngine.resolveSocialAndWebImage(url)
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
        // Sound-only sources (SoundCloud and the like) have formats but no video track at all.
        val audioOnly = !info.formats.isNullOrEmpty() && heightsSet.isEmpty() &&
            info.formats!!.none { (it.vcodec ?: "").lowercase(Locale.ROOT).let { v -> v.isNotBlank() && v != "none" } }
        val maxHeight = heightsSet.firstOrNull() ?: 0
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
            put("title", vimeo?.title ?: info.title ?: "Untitled video")
            put("site", vimeo?.site ?: rawSite)
            put("uploader", vimeo?.uploader ?: info.uploader ?: "")
            put("duration", vimeo?.duration ?: info.duration)
            put("thumbnail", vimeo?.thumbnail?.ifBlank { null } ?: thumb)
            put("heights", heightsArr)
            put("h264Max", h264Max)
            put("maxCodec", maxCodec)
            put("directUrl", "")
            put("imageUrls", JSONArray())
            put("type", "video")
            put("audioOnly", audioOnly)
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

    /** Every file behind an id: a photo album download has several. */
    private fun allPathsFor(id: String): List<String> {
        val item = if (MediaLibrary.isDeviceId(id)) null else OrbitEngine.historyItem(this, id)
        val files = item?.optJSONArray("files")
        val list = if (files != null && files.length() > 0) (0 until files.length()).map { files.optString(it) }.filter { OrbitEngine.mediaExists(this, it) } else emptyList()
        return list.ifEmpty { listOfNotNull(findFileForId(id)) }
    }

    private fun mimeForPath(path: String): String {
        val ext = if (path.startsWith("content://")) "" else File(path).extension.lowercase()
        return when (ext) {
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "opus", "wav" -> "audio/*"
            "mp4", "m4v" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
        }
    }

    /** The system share sheet for one or many items (always carries the read grant, so every app can open them). */
    private fun shareMany(ids: List<String>, pkg: String? = null) {
        val paths = ids.flatMap { allPathsFor(it) }
        if (paths.isEmpty()) throw IllegalArgumentException("File not found on device.")
        if (pkg != null && pkg !in shareTargets.values) throw IllegalArgumentException("Unsupported share target.")
        runOnUiThread {
            try {
                val uris = ArrayList(paths.map { OrbitEngine.mediaUri(this, it) })
                val types = paths.indices.map { i ->
                    contentResolver.getType(uris[i])?.takeIf { it.isNotBlank() && it != "application/octet-stream" } ?: mimeForPath(paths[i])
                }
                val type = when {
                    types.distinct().size == 1 -> types[0]
                    types.map { it.substringBefore('/') }.distinct().size == 1 -> types[0].substringBefore('/') + "/*"
                    else -> "*/*"
                }
                val intent = if (uris.size == 1) Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
                else Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                intent.type = type
                val clip = ClipData.newRawUri("", uris[0])
                uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
                intent.clipData = clip
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (pkg != null) {
                    intent.setPackage(pkg)
                    startActivity(intent)
                } else {
                    startActivity(Intent.createChooser(intent, if (uris.size == 1) "Share" else "Share ${uris.size} items"))
                }
            } catch (e: Exception) {
                Toast.makeText(applicationContext, "Couldn't share: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

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

    private fun shareMediaById(id: String, pkg: String? = null) = shareMany(listOf(id), pkg)

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

    /* ---------------- AI helper (Google Gemini, your own key, stored only on this phone) ---------------- */
    private val geminiBase = "https://generativelanguage.googleapis.com/v1beta"

    private fun geminiRequest(key: String, path: String, payload: JSONObject?): JSONObject {
        val conn = (URL("$geminiBase/$path").openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 60000
            setRequestProperty("x-goog-api-key", key)
            setRequestProperty("Content-Type", "application/json")
            if (payload != null) {
                requestMethod = "POST"
                doOutput = true
                outputStream.use { it.write(payload.toString().toByteArray()) }
            }
        }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
        if (code !in 200..299) {
            val msg = try { JSONObject(text).optJSONObject("error")?.optString("message") } catch (_: Exception) { null }
            throw IllegalArgumentException(msg?.takeIf { it.isNotBlank() } ?: "Gemini returned an error (HTTP $code).")
        }
        return JSONObject(text)
    }

    /** Asks Google which models this key can use and picks the newest stable Flash, so model retirements don't break the app. */
    private fun geminiPickModel(key: String): String {
        val models = geminiRequest(key, "models?pageSize=200", null).optJSONArray("models") ?: JSONArray()
        val usable = ArrayList<String>()
        for (i in 0 until models.length()) {
            val m = models.optJSONObject(i) ?: continue
            val methods = m.optJSONArray("supportedGenerationMethods") ?: continue
            if ((0 until methods.length()).none { methods.optString(it) == "generateContent" }) continue
            val name = m.optString("name").removePrefix("models/")
            if (name.startsWith("gemini-")) usable.add(name)
        }
        val banned = Regex("lite|image|tts|live|audio|embedding|vision|exp|preview|thinking|robotics|computer")
        val version = { n: String -> Regex("""gemini-(\d+(?:\.\d+)?)""").find(n)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0 }
        val best = usable.filter { it.contains("flash") && !banned.containsMatchIn(it) }.maxByOrNull { version(it) }
            ?: usable.filter { it.contains("flash") }.maxByOrNull { version(it) }
            ?: usable.maxByOrNull { version(it) }
        return best ?: throw IllegalArgumentException("This API key has no Gemini text models available.")
    }

    private fun aiStatus(): JSONObject {
        val key = prefs().getString("gemini_key", "").orEmpty()
        return JSONObject().put("hasKey", key.isNotBlank()).put("model", prefs().getString("gemini_model", "").orEmpty())
    }

    /** The key is checked against Google before it is saved. It is never sent back to the page. */
    private fun aiSaveKey(raw: String): JSONObject {
        val key = raw.trim()
        if (key.isBlank()) throw IllegalArgumentException("Paste your Gemini API key first.")
        val model = geminiPickModel(key)
        prefs().edit().putString("gemini_key", key).putString("gemini_model", model).apply()
        return aiStatus()
    }

    private fun aiChat(body: JSONObject): JSONObject {
        val key = prefs().getString("gemini_key", "").orEmpty()
        if (key.isBlank()) throw IllegalArgumentException("Add your Gemini API key in Settings first.")
        var model = prefs().getString("gemini_model", "").orEmpty()
        if (model.isBlank()) { model = geminiPickModel(key); prefs().edit().putString("gemini_model", model).apply() }

        val contents = JSONArray()
        val msgs = body.optJSONArray("messages") ?: JSONArray()
        for (i in 0 until msgs.length()) {
            val m = msgs.optJSONObject(i) ?: continue
            contents.put(JSONObject()
                .put("role", if (m.optString("role") == "model") "model" else "user")
                .put("parts", JSONArray().put(JSONObject().put("text", m.optString("text").take(2000)))))
        }
        val stringArray = JSONObject().put("type", "ARRAY").put("items", JSONObject().put("type", "STRING"))
        val payload = JSONObject()
            .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", """
                You are the video finder inside Orbit, an Android app that downloads videos and music.
                Turn what the user wants into good YouTube search queries.
                reply: one or two short friendly sentences saying what you are looking for, in the user's language.
                searches: 1 to 3 focused YouTube queries. Use an empty list only when the user is not asking for media.
                library_keywords: 1 to 4 single words that might appear in the title of a file they already saved.
                Rules: you cannot see search results, so never name specific videos, channels, view counts, links or facts about results.
                Never promise that something exists. Help find any legal content, and do not help with getting around DRM or private content.
            """.trimIndent()))))
            .put("contents", contents)
            .put("generationConfig", JSONObject()
                .put("temperature", 0.5)
                .put("responseMimeType", "application/json")
                .put("responseSchema", JSONObject().put("type", "OBJECT")
                    .put("properties", JSONObject()
                        .put("reply", JSONObject().put("type", "STRING"))
                        .put("searches", stringArray)
                        .put("library_keywords", stringArray))
                    .put("required", JSONArray().put("reply").put("searches"))))

        val res = geminiRequest(key, "models/$model:generateContent", payload)
        val cand = res.optJSONArray("candidates")?.optJSONObject(0)
            ?: throw IllegalArgumentException("Gemini did not answer that request. Try rewording it.")
        val text = cand.optJSONObject("content")?.optJSONArray("parts")?.optJSONObject(0)?.optString("text").orEmpty()
        if (text.isBlank()) throw IllegalArgumentException("Gemini stopped without an answer (${cand.optString("finishReason", "unknown")}).")
        val ai = JSONObject(text)

        // Everything shown as a result comes from a real YouTube search, never from the model.
        val seen = HashSet<String>()
        val results = JSONArray()
        val queries = ai.optJSONArray("searches") ?: JSONArray()
        var searchError = ""
        for (i in 0 until minOf(queries.length(), 3)) {
            val q = queries.optString(i).trim()
            if (q.isBlank()) continue
            try {
                val found = searchVideos(q).optJSONArray("results") ?: continue
                for (j in 0 until minOf(found.length(), 6)) {
                    val v = found.optJSONObject(j) ?: continue
                    if (seen.add(v.optString("url"))) results.put(v)
                }
            } catch (e: Exception) { searchError = e.message.orEmpty() }
        }
        return JSONObject()
            .put("reply", ai.optString("reply"))
            .put("results", results)
            .put("queries", queries)
            .put("keywords", ai.optJSONArray("library_keywords") ?: JSONArray())
            .put("searchError", searchError)
            .put("model", model)
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
