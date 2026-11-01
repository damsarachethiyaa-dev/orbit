package dev.chethiya.orbit

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast

class QuickDownloadActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val rawText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: intent.dataString
        val url = OrbitEngine.extractUrl(rawText)

        if (!url.isNullOrBlank()) {
            val serviceIntent = Intent(this, DownloadService::class.java).apply {
                action = DownloadService.ACTION_START_DOWNLOAD
                putExtra(DownloadService.EXTRA_URL, url)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
                Toast.makeText(applicationContext, "Orbit: Download started in background", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                Toast.makeText(applicationContext, "Orbit: Could not start download", Toast.LENGTH_LONG).show()
            }
        } else {
            Toast.makeText(applicationContext, "Orbit: No video link found to download.", Toast.LENGTH_SHORT).show()
        }

        finish()
    }
}
