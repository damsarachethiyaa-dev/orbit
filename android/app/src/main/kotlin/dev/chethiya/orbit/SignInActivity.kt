package dev.chethiya.orbit

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The site's own login page. Orbit never sees the password: when the user taps Done it only copies the
 * resulting session cookies to a private file, so yt-dlp can download what this account is allowed to see.
 */
class SignInActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var site: OrbitEngine.SignInSite

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        site = OrbitEngine.signInSites.firstOrNull { it.key == intent.getStringExtra(EXTRA_SITE) } ?: run { finish(); return }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val d = resources.displayMetrics.density
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding((16 * d).toInt(), (8 * d).toInt(), (8 * d).toInt(), (8 * d).toInt())
        }
        bar.addView(TextView(this).apply {
            text = "Sign in to ${site.name}"
            setTextColor(Color.WHITE)
            textSize = 17f
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(Button(this).apply {
            text = "Done"
            isAllCaps = false
            setOnClickListener { saveAndClose() }
        })
        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.userAgentString = settings.userAgentString.replace("; wv", "")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = false
            }
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        web.loadUrl(site.loginUrl)
    }

    private fun saveAndClose() {
        val cm = CookieManager.getInstance()
        cm.flush()
        val lines = StringBuilder("# Netscape HTTP Cookie File\n")
        val seen = HashSet<String>()
        val expiry = System.currentTimeMillis() / 1000 + 60L * 60 * 24 * 90
        for (u in site.cookieUrls) {
            cm.getCookie(u).orEmpty().split(";").map { it.trim() }.filter { it.contains("=") }.forEach { pair ->
                val name = pair.substringBefore("=")
                if (seen.add(name)) lines.append("${site.domain}\tTRUE\t/\tTRUE\t$expiry\t$name\t${pair.substringAfter("=")}\n")
            }
        }
        val f = OrbitEngine.cookieFile(this, site.key)
        if (seen.isEmpty()) f.delete() else f.writeText(lines.toString())
        setResult(RESULT_OK)
        finish()
    }

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    companion object { const val EXTRA_SITE = "site" }
}
