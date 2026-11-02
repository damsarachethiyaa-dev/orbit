package dev.chethiya.orbit

import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** Only the original link and user choices are kept; resolved media URLs can expire. */
object PendingDownloads {
    private const val PREFS = "orbit_pending_downloads"
    private const val KEY = "jobs"

    private fun read(context: Context): JSONObject = try {
        JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}") ?: "{}")
    } catch (_: Exception) {
        JSONObject()
    }

    private fun write(context: Context, jobs: JSONObject): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, jobs.toString()).commit()

    @Synchronized
    fun hasPending(context: Context): Boolean = read(context).length() > 0

    @Synchronized
    fun save(context: Context, intent: Intent, id: String) {
        val jobs = read(context)
        jobs.put(id, JSONObject().apply {
            put("url", intent.getStringExtra(DownloadService.EXTRA_URL) ?: "")
            put("quality", intent.getStringExtra(DownloadService.EXTRA_QUALITY) ?: "best")
            put("site", intent.getStringExtra(DownloadService.EXTRA_SITE) ?: "Video")
            put("image", intent.getBooleanExtra(DownloadService.EXTRA_IS_IMAGE, false))
        })
        check(write(context, jobs)) { "Could not save this download for background recovery." }
    }

    @Synchronized
    fun remove(context: Context, id: String) {
        val jobs = read(context)
        if (!jobs.has(id)) return
        jobs.remove(id)
        write(context, jobs)
    }

    @Synchronized
    fun recoveryIntents(context: Context): List<Intent> {
        val jobs = read(context)
        val result = ArrayList<Intent>()
        val keys = jobs.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val item = jobs.optJSONObject(id) ?: continue
            val url = item.optString("url")
            if (url.isBlank()) continue
            result.add(Intent(context, DownloadService::class.java).apply {
                action = DownloadService.ACTION_START_DOWNLOAD
                putExtra(DownloadService.EXTRA_JOB_ID, id)
                putExtra(DownloadService.EXTRA_URL, url)
                putExtra(DownloadService.EXTRA_TITLE, "Downloading…")
                putExtra(DownloadService.EXTRA_QUALITY, item.optString("quality", "best"))
                putExtra(DownloadService.EXTRA_SITE, item.optString("site", "Video"))
                putExtra(DownloadService.EXTRA_IS_IMAGE, item.optBoolean("image", false))
            })
        }
        return result
    }
}
