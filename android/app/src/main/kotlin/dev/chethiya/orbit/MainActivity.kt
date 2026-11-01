package dev.chethiya.orbit

import android.Manifest
import android.annotation.SuppressLint
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
import android.webkit.JavascriptInterface
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

    data class DownloadJob(
        val id: String,
        var title: String,
        val site: String,
        val thumb: String,
        val quality: String,
        @Volatile var state: String = "downloading",
        @Volatile var percent: Double = 0.0,
        @Volatile var speed: String = "",
        @Volatile var eta: String = "",
        @Volatile var file: String = "",
        @Volatile var size: Long = 0L,
        @Volatile var error: String = ""
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
        }
    }

    private val jobs = CopyOnWriteArrayList<DownloadJob>()
    private val jobsById = ConcurrentHashMap<String, DownloadJob>()

    // In-app update state
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
            webChromeClient = WebChromeClient()
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
    private fun addHistoryItem(job: DownloadJob) {
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
                for (j in jobs) arr.put(j.toJson())
                arr
            }
            path.startsWith("/api/cancel/") -> {
                val id = path.removePrefix("/api/cancel/")
                cancelJob(id)
                JSONObject().put("ok", true)
            }
            path.startsWith("/api/dismiss/") -> {
                val id = path.removePrefix("/api/dismiss/")
                jobsById.remove(id)?.let { jobs.remove(it) }
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
                    if (item.optString("id") != id) next.put(item)
                }
                writeHistory(next)
                JSONObject().put("ok", true)
            }
            path == "/api/update/check" -> checkForUpdates()
            path == "/api/update/download" -> startUpdateDownload()
            path == "/api/update/status" -> getUpdateStatus()
            path == "/api/update/apply" -> applyApkUpdate()
            else -> JSONObject().put("ok", true)
        }
    }

    private fun getSettingsJson(): JSONObject {
        return JSONObject().apply {
            put("save_dir", currentSaveDir().absolutePath)
            put("default_quality", currentDefaultQuality())
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

    private fun fetchVideoInfo(url: String): JSONObject {
        if (url.isBlank()) throw IllegalArgumentException("Please enter a valid video link.")
        initLatch.await(30, TimeUnit.SECONDS)

        val req = YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            addOption("--socket-timeout", "20")
        }

        val info = try {
            YoutubeDL.getInstance().getInfo(req)
        } catch (e: Exception) {
            throw IllegalArgumentException(cleanErrorMessage(e.message))
        }

        val heightsSet = sortedSetOf<Int>(Comparator.reverseOrder())
        info.formats?.forEach { fmt ->
            val h = fmt.height
            val vcodec = fmt.vcodec ?: ""
            if (h >= 360 && vcodec != "none") {
                heightsSet.add(h)
            }
        }
        if (heightsSet.isEmpty()) {
            heightsSet.addAll(listOf(1080, 720, 480))
        }

        val rawSite = info.extractorKey ?: info.extractor ?: try {
            Uri.parse(url).host?.removePrefix("www.")?.substringBefore(".") ?: "Video"
        } catch (_: Exception) {
            "Video"
        }

        val heightsArr = JSONArray()
        heightsSet.forEach { heightsArr.put(it) }

        return JSONObject().apply {
            put("title", info.title ?: "Untitled video")
            put("site", rawSite)
            put("uploader", info.uploader ?: "")
            put("duration", info.duration)
            put("thumbnail", info.thumbnail ?: "")
            put("heights", heightsArr)
        }
    }

    private fun startDownloadJob(body: JSONObject): JSONObject {
        val url = body.optString("url")
        if (url.isBlank()) throw IllegalArgumentException("Missing video URL.")
        val quality = body.optString("quality", "best")
        val title = body.optString("title", "Downloading…")
        val site = body.optString("site", "Video")
        val thumb = body.optString("thumb", "")

        val id = UUID.randomUUID().toString().substring(0, 8)
        val job = DownloadJob(
            id = id,
            title = title,
            site = site,
            thumb = thumb,
            quality = quality
        )
        jobs.add(0, job)
        jobsById[id] = job

        executor.execute {
            runDownloadJob(job, url)
        }

        return JSONObject().put("id", id)
    }

    private fun runDownloadJob(job: DownloadJob, url: String) {
        try {
            initLatch.await(30, TimeUnit.SECONDS)
            val saveDir = currentSaveDir()
            saveDir.mkdirs()

            val startStamp = System.currentTimeMillis() - 1500L
            val safePrefix = job.title
                .replace(Regex("""[\\/:*?"<>|]"""), "_")
                .trim()
                .take(80)
                .ifBlank { "orbit_${job.id}" }

            val outTemplate = File(saveDir, "$safePrefix [${job.id}].%(ext)s").absolutePath
            val req = YoutubeDLRequest(url).apply {
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
                            "bestvideo[height<=$h][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=$h]+bestaudio/best[height<=$h]/best"
                        )
                    } else {
                        addOption("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best")
                    }
                    addOption("--merge-output-format", "mp4")
                }
            }

            YoutubeDL.getInstance().execute(req, job.id) { progress, etaInSeconds, line ->
                if (progress >= 0f) {
                    job.percent = progress.toDouble().coerceIn(0.0, 100.0)
                }
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
            }

            // Locate output file
            val matchedFile = saveDir.listFiles()?.filter { f ->
                f.isFile &&
                    !f.name.endsWith(".part") &&
                    !f.name.endsWith(".ytdl") &&
                    (f.name.contains("[${job.id}]") || f.lastModified() >= startStamp)
            }?.maxByOrNull { it.lastModified() }

            if (matchedFile != null && matchedFile.exists()) {
                job.file = matchedFile.absolutePath
                job.size = matchedFile.length()
                MediaScannerConnection.scanFile(
                    applicationContext,
                    arrayOf(matchedFile.absolutePath),
                    null,
                    null
                )
            }
            job.percent = 100.0
            job.state = "done"
            addHistoryItem(job)
        } catch (e: Exception) {
            if (job.state == "cancelled" || e.javaClass.simpleName.contains("Canceled", ignoreCase = true)) {
                job.state = "cancelled"
            } else {
                job.state = "error"
                job.error = cleanErrorMessage(e.message)
            }
        }
    }

    private fun cancelJob(id: String) {
        val job = jobsById[id]
        if (job != null) {
            job.state = "cancelled"
        }
        try {
            YoutubeDL.getInstance().destroyProcessById(id)
        } catch (_: Exception) {
        }
    }

    private fun findFileForId(id: String): File? {
        jobsById[id]?.file?.takeIf { it.isNotBlank() }?.let { path ->
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
            val conn = (URL("https://api.github.com/repos/damsarachethiyaa-dev/orbit/releases/latest").openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "Orbit-Android/${BuildConfig.VERSION_NAME}")
            }
            if (conn.responseCode == 200) {
                val data = JSONObject(conn.inputStream.bufferedReader().readText())
                val tag = data.optString("tag_name", "").removePrefix("v")
                if (tag.isNotBlank()) {
                    latestVersion = "v$tag"
                    releaseName = data.optString("name", "Orbit $latestVersion")
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
                    downloadUrl = apkUrl
                    hasUpdate = isNewerVersion(tag, BuildConfig.VERSION_NAME) && apkUrl.isNotBlank()
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

                val conn = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = true
                    connectTimeout = 15000
                    readTimeout = 30000
                    setRequestProperty("User-Agent", "Orbit-Android/${BuildConfig.VERSION_NAME}")
                }
                val total = conn.contentLengthLong
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
        if (!apkFile.exists()) throw IllegalArgumentException("Downloaded APK not found.")
        runOnUiThread {
            val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", apkFile)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        }
        return JSONObject().put("ok", true)
    }

    private fun cleanErrorMessage(raw: String?): String {
        if (raw.isNullOrBlank()) return "Couldn't fetch that link. Please check the URL and try again."
        val errLine = raw.lines().lastOrNull { it.contains("ERROR:") } ?: raw.lines().lastOrNull { it.isNotBlank() } ?: raw
        return errLine.replace(Regex("""^.*ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?"""), "").trim()
            .ifBlank { "Couldn't process that link." }
    }
}
