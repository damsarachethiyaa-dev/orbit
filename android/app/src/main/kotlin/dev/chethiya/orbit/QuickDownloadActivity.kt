package dev.chethiya.orbit

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast

class QuickDownloadActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val rawText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.dataString
        val url = OrbitEngine.extractUrl(rawText)

        if (!url.isNullOrBlank()) {
            Toast.makeText(applicationContext, "Orbit: Starting background download...", Toast.LENGTH_SHORT).show()
            val serviceIntent = Intent(this, DownloadService::class.java).apply {
                action = DownloadService.ACTION_START_DOWNLOAD
                putExtra(DownloadService.EXTRA_URL, url)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } else {
            Toast.makeText(applicationContext, "Orbit: No video link found to download.", Toast.LENGTH_SHORT).show()
        }

        finish()
    }
}
