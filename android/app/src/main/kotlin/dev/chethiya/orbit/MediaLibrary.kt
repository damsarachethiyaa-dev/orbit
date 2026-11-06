package dev.chethiya.orbit

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.ThumbnailUtils
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * The phone's own photos and videos (MediaStore), plus thumbnails for everything Orbit shows.
 * Device items use ids like "m_i_123" (image) and "m_v_123" (video), so the rest of the app can
 * stream, share, open and convert them exactly like its own downloads.
 */
object MediaLibrary {
    private const val THUMB_CACHE_MAX = 768
    private val durations = ConcurrentHashMap<String, Long>()

    fun isDeviceId(id: String) = id.startsWith("m_i_") || id.startsWith("m_v_")

    fun deviceUri(id: String): Uri? {
        val n = id.substring(4).toLongOrNull() ?: return null
        val base = if (id.startsWith("m_i_")) MediaStore.Images.Media.EXTERNAL_CONTENT_URI else MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        return ContentUris.withAppendedId(base, n)
    }

    /** Compact rows: [id, name, time(s), size, width, height, duration(ms), folder]. Orbit's own downloads are left out. */
    fun list(context: Context, history: JSONArray): JSONArray {
        val ownIds = HashSet<String>()
        val ownPaths = HashSet<String>()
        for (i in 0 until history.length()) {
            val paths = ArrayList<String>()
            val item = history.optJSONObject(i) ?: continue
            item.optString("file").takeIf { it.isNotBlank() }?.let { paths.add(it) }
            item.optJSONArray("files")?.let { f -> for (j in 0 until f.length()) paths.add(f.optString(j)) }
            for (p in paths) {
                if (p.startsWith("content://")) {
                    val u = Uri.parse(p)
                    val kind = if (p.contains("/video/")) "v" else if (p.contains("/images/")) "i" else "a"
                    u.lastPathSegment?.let { ownIds.add("m_${kind}_$it") }
                } else ownPaths.add(p)
            }
        }
        val rows = ArrayList<Pair<Long, JSONArray>>()
        fun read(uri: Uri, prefix: String, video: Boolean) {
            val cols = arrayListOf(
                MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.DATE_ADDED,
                MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT, MediaStore.MediaColumns.DATA
            )
            cols.add(if (video) MediaStore.Video.Media.DATE_TAKEN else MediaStore.Images.Media.DATE_TAKEN)
            cols.add(if (video) MediaStore.Video.Media.BUCKET_DISPLAY_NAME else MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
            if (video) cols.add(MediaStore.Video.Media.DURATION)
            context.contentResolver.query(uri, cols.toTypedArray(), null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val rawId = c.getLong(0)
                    val id = prefix + rawId
                    if (id in ownIds || c.getString(7) in ownPaths) continue
                    val taken = c.getLong(8)
                    val added = c.getLong(2)
                    val t = when {
                        taken > 0 -> taken / 1000L
                        added > 0 -> added
                        else -> c.getLong(3)
                    }
                    rows.add(t to JSONArray().apply {
                        put(id); put(c.getString(1) ?: ""); put(t); put(c.getLong(4)); put(c.getInt(5)); put(c.getInt(6))
                        put(if (video) c.getLong(10) else 0L); put(c.getString(9) ?: "")
                    })
                }
            }
        }
        read(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "m_i_", false)
        read(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "m_v_", true)
        rows.sortByDescending { it.first }
        val out = JSONArray()
        rows.forEach { out.put(it.second) }
        return out
    }

    /** Items in the phone's trash (Android 11+): [id, name, time(s), size, width, height, duration(ms), folder, expires(s)]. */
    fun listTrashed(context: Context): JSONArray {
        val out = JSONArray()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return out
        val rows = ArrayList<Pair<Long, JSONArray>>()
        fun read(uri: Uri, prefix: String, video: Boolean) {
            val cols = arrayListOf(
                MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.DATE_EXPIRES,
                MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.WIDTH, MediaStore.MediaColumns.HEIGHT,
                MediaStore.MediaColumns.BUCKET_DISPLAY_NAME, MediaStore.MediaColumns.DATE_TAKEN
            )
            if (video) cols.add(MediaStore.Video.Media.DURATION)
            val args = android.os.Bundle().apply { putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY) }
            context.contentResolver.query(uri, cols.toTypedArray(), args, null)?.use { c ->
                while (c.moveToNext()) {
                    val expires = c.getLong(2)
                    val name = (c.getString(1) ?: "").replace(Regex("^\\.trashed-\\d+-"), "")
                    rows.add(expires to JSONArray().apply {
                        put(prefix + c.getLong(0)); put(name); put(c.getLong(7) / 1000L); put(c.getLong(3)); put(c.getInt(4)); put(c.getInt(5))
                        put(if (video) c.getLong(8) else 0L); put(c.getString(6) ?: ""); put(expires)
                    })
                }
            }
        }
        read(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "m_i_", false)
        read(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "m_v_", true)
        rows.sortByDescending { it.first }
        rows.forEach { out.put(it.second) }
        return out
    }

    /** Duration in milliseconds for one of Orbit's own files; remembered for the life of the process. */
    fun durationOf(context: Context, path: String): Long {
        if (path.isBlank()) return 0
        durations[path]?.let { return it }
        val d = try {
            val r = MediaMetadataRetriever()
            try {
                if (path.startsWith("content://")) r.setDataSource(context, Uri.parse(path)) else r.setDataSource(path)
                r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            } finally { r.release() }
        } catch (_: Exception) { 0L }
        durations[path] = d
        return d
    }

    /**
     * JPEG bytes for a saved file. Small sizes are cached on disk so the grid scrolls without re-decoding.
     * [cover] means a square grid tile: the short side reaches the size, so tall screenshots stay sharp.
     */
    fun thumbnail(context: Context, id: String, path: String, size: Int, cover: Boolean = false): ByteArray? {
        val s = size.coerceIn(64, 4096)
        val cacheFile = if (s <= THUMB_CACHE_MAX) File(File(context.cacheDir, "thumbs").apply { mkdirs() }, "${id.replace(Regex("[^A-Za-z0-9_-]"), "_")}_${if (cover) "c" else "t"}$s.jpg") else null
        if (cacheFile != null && cacheFile.length() > 0) return try { cacheFile.readBytes() } catch (_: Exception) { null }
        var bmp = decode(context, path, s, cover) ?: return null
        if (cover) bmp = centerSquare(bmp, s)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, if (s <= 360) 78 else if (s <= THUMB_CACHE_MAX) 84 else 96, out)
        bmp.recycle()
        val bytes = out.toByteArray()
        if (cacheFile != null) try { cacheFile.writeBytes(bytes) } catch (_: Exception) {}
        return bytes
    }

    private fun centerSquare(src: Bitmap, s: Int): Bitmap {
        val side = minOf(src.width, src.height)
        if (side <= 0) return src
        val square = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
        if (side <= s) return square
        return Bitmap.createScaledBitmap(square, s, s, true)
    }

    private val PHOTO_EXT = setOf("jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp", "dng")

    private fun isPhoto(context: Context, path: String): Boolean =
        if (path.startsWith("content://")) context.contentResolver.getType(Uri.parse(path)).orEmpty().startsWith("image/")
        else File(path).extension.lowercase() in PHOTO_EXT

    /** Decodes the photo itself, so large sizes really are large. Android's thumbnail call stops well short of the screen size. */
    private fun decodePhoto(context: Context, path: String, s: Int, cover: Boolean): Bitmap? {
        val uri = if (path.startsWith("content://")) Uri.parse(path) else Uri.fromFile(File(path))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = android.graphics.ImageDecoder.createSource(context.contentResolver, uri)
            return android.graphics.ImageDecoder.decodeBitmap(source) { d, info, _ ->
                d.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
                val w = info.size.width; val h = info.size.height
                val ref = if (cover) minOf(w, h) else maxOf(w, h)
                if (ref > s) { val k = s.toFloat() / ref; d.setTargetSize((w * k).toInt().coerceAtLeast(1), (h * k).toInt().coerceAtLeast(1)) }
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        val ref = if (cover) minOf(bounds.outWidth, bounds.outHeight) else maxOf(bounds.outWidth, bounds.outHeight)
        while (ref / (sample * 2) >= s) sample *= 2
        return context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
    }

    /** The video's real opening frame, so the viewer's preview matches what starts playing. Falls back to the normal thumbnail. */
    fun firstFrame(context: Context, id: String, path: String, size: Int): ByteArray? {
        val s = size.coerceIn(64, THUMB_CACHE_MAX)
        val cacheFile = File(File(context.cacheDir, "thumbs").apply { mkdirs() }, "${id.replace(Regex("[^A-Za-z0-9_-]"), "_")}_f$s.jpg")
        if (cacheFile.length() > 0) return try { cacheFile.readBytes() } catch (_: Exception) { null }
        val frame = try {
            val r = MediaMetadataRetriever()
            try {
                if (path.startsWith("content://")) r.setDataSource(context, Uri.parse(path)) else r.setDataSource(path)
                r.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            } finally { r.release() }
        } catch (_: Exception) { null } ?: return thumbnail(context, id, path, s, false)
        val scale = minOf(1f, s.toFloat() / maxOf(frame.width, frame.height))
        val small = if (scale < 1f) Bitmap.createScaledBitmap(frame, (frame.width * scale).toInt().coerceAtLeast(1), (frame.height * scale).toInt().coerceAtLeast(1), true) else frame
        val out = ByteArrayOutputStream()
        small.compress(Bitmap.CompressFormat.JPEG, 84, out)
        val bytes = out.toByteArray()
        try { cacheFile.writeBytes(bytes) } catch (_: Exception) {}
        return bytes
    }

    @Suppress("DEPRECATION")
    private fun decode(context: Context, path: String, s: Int, cover: Boolean): Bitmap? {
        try {
            val photo = isPhoto(context, path)
            // Android keeps its own small thumbnails, which are the quickest source for small grid tiles.
            if (path.startsWith("content://") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && (!photo || s <= 360)) {
                val ask = if (cover) s * 2 else s
                return context.contentResolver.loadThumbnail(Uri.parse(path), Size(ask, ask), null)
            }
            if (photo) return decodePhoto(context, path, s, cover)
            if (path.startsWith("content://")) {
                val r = MediaMetadataRetriever()
                try { r.setDataSource(context, Uri.parse(path)); return r.frameAtTime } finally { r.release() }
            }
            val file = File(path)
            if (file.extension.lowercase() in setOf("mp3", "m4a", "opus", "wav", "ogg", "flac")) return null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return ThumbnailUtils.createVideoThumbnail(file, Size(s, s), null)
            return ThumbnailUtils.createVideoThumbnail(path, MediaStore.Images.Thumbnails.MINI_KIND)
        } catch (_: Exception) {
            return null
        }
    }
}
