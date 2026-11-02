package dev.chethiya.orbit

import android.content.Context
import java.io.File
import java.util.Locale

/**
 * Thin wrapper around the FFmpeg binary that ships with youtubedl-android.
 *
 * Used to (1) read what codecs a downloaded file really contains and (2) convert it to
 * H.264 + AAC in an MP4, the combination chat apps such as WeChat, WhatsApp and Telegram
 * and every phone gallery play without trouble.
 */
object MediaTools {

    data class Probe(
        val vcodec: String,
        val acodec: String,
        val pixFmt: String,
        val width: Int,
        val height: Int,
        val durationSec: Double
    ) {
        /** H.264 8-bit 4:2:0 video with AAC (or no) audio: plays everywhere. */
        val shareReady: Boolean
            get() = vcodec == "h264" && pixFmt == "yuv420p" && (acodec == "aac" || acodec.isEmpty())

        val codecLabel: String
            get() = when (vcodec) {
                "h264" -> "H.264"
                "hevc" -> "HEVC"
                "vp9" -> "VP9"
                "av1" -> "AV1"
                "vp8" -> "VP8"
                "mpeg4" -> "MPEG-4"
                else -> vcodec.uppercase(Locale.ROOT)
            }
    }

    enum class Preset(val crf: Int, val maxHeight: Int, val audioKbps: Int) {
        /** Same resolution, visually transparent quality. */
        SHARE(18, 0, 192),

        /** Smaller file for size-limited chats: capped at 720p. */
        CHAT(26, 720, 128)
    }

    private fun ffmpegBinary(context: Context): File? =
        File(context.applicationInfo.nativeLibraryDir, "libffmpeg.so").takeIf { it.exists() }

    private fun prepare(context: Context, args: List<String>): ProcessBuilder? {
        val bin = ffmpegBinary(context) ?: return null
        val libDir = File(context.noBackupFilesDir, "youtubedl-android/packages/ffmpeg/usr/lib")
        return ProcessBuilder(listOf(bin.absolutePath) + args).apply {
            redirectErrorStream(true)
            environment()["LD_LIBRARY_PATH"] = libDir.absolutePath
            environment()["TMPDIR"] = context.cacheDir.absolutePath
        }
    }

    /** Process.waitFor(timeout) only exists from API 26, and Orbit supports Android 7. */
    private fun waitFor(proc: Process, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                proc.exitValue()
                return true
            } catch (_: IllegalThreadStateException) {
                Thread.sleep(40)
            }
        }
        return false
    }

    fun ffmpegVersion(context: Context): String {
        return try {
            val proc = prepare(context, listOf("-hide_banner", "-version"))?.start() ?: return ""
            val first = proc.inputStream.bufferedReader().use { it.readLine().orEmpty() }
            waitFor(proc, 5_000)
            Regex("""version\s+(\S+)""").find(first)?.groupValues?.get(1).orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    fun probe(context: Context, file: File): Probe? {
        return try {
            val proc = prepare(context, listOf("-hide_banner", "-i", file.absolutePath))?.start() ?: return null
            val text = proc.inputStream.bufferedReader().use { it.readText() }
            waitFor(proc, 15_000)
            parseProbe(text)
        } catch (_: Exception) {
            null
        }
    }

    internal fun parseProbe(text: String): Probe? {
        val video = Regex("""Video:\s*([A-Za-z0-9_]+)[^\n]*?,\s*([a-z0-9]+)(?:\([^)]*\))?[^\n]*?\b(\d{2,5})x(\d{2,5})""")
            .find(text)
        val audio = Regex("""Audio:\s*([A-Za-z0-9_]+)""").find(text)
        val dur = Regex("""Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)""").find(text)
        if (video == null && audio == null) return null
        val seconds = dur?.let {
            it.groupValues[1].toDouble() * 3600 + it.groupValues[2].toDouble() * 60 + it.groupValues[3].toDouble()
        } ?: 0.0
        return Probe(
            vcodec = video?.groupValues?.get(1)?.lowercase(Locale.ROOT).orEmpty(),
            acodec = audio?.groupValues?.get(1)?.lowercase(Locale.ROOT).orEmpty(),
            pixFmt = video?.groupValues?.get(2)?.lowercase(Locale.ROOT).orEmpty(),
            width = video?.groupValues?.get(3)?.toIntOrNull() ?: 0,
            height = video?.groupValues?.get(4)?.toIntOrNull() ?: 0,
            durationSec = seconds
        )
    }

    /**
     * Converts [input] into an H.264 + AAC MP4 at [output]. Streams that are already compatible are
     * copied untouched, so a file that only needs new audio is finished in seconds and loses no quality.
     * Returns true when [output] was written completely.
     */
    fun convert(
        context: Context,
        input: File,
        output: File,
        source: Probe,
        preset: Preset,
        onProgress: (Double) -> Unit,
        isCancelled: () -> Boolean
    ): Boolean {
        val needsScale = preset.maxHeight > 0 && source.height > preset.maxHeight
        val copyVideo = !needsScale && source.vcodec == "h264" && source.pixFmt == "yuv420p" &&
            preset == Preset.SHARE
        val copyAudio = source.acodec == "aac" && preset == Preset.SHARE

        val args = mutableListOf("-hide_banner", "-nostdin", "-y", "-i", input.absolutePath, "-map", "0:v:0", "-map", "0:a:0?")
        if (copyVideo) {
            args += listOf("-c:v", "copy")
        } else {
            args += listOf("-c:v", "libx264", "-preset", "veryfast", "-crf", preset.crf.toString(),
                "-profile:v", "high", "-pix_fmt", "yuv420p")
            if (needsScale) args += listOf("-vf", "scale=-2:${preset.maxHeight}")
        }
        if (copyAudio) {
            args += listOf("-c:a", "copy")
        } else {
            args += listOf("-c:a", "aac", "-b:a", "${preset.audioKbps}k", "-ac", "2")
        }
        args += listOf("-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output.absolutePath)

        val proc = prepare(context, args)?.start() ?: return false
        val totalUs = (source.durationSec * 1_000_000).coerceAtLeast(1.0)
        try {
            proc.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    if (isCancelled()) {
                        proc.destroy()
                        return false
                    }
                    if (line.startsWith("out_time_us=")) {
                        val us = line.substringAfter('=').trim().toDoubleOrNull() ?: continue
                        onProgress((us / totalUs * 100.0).coerceIn(0.0, 99.0))
                    }
                }
            }
            val finished = waitFor(proc, 30_000)
            return finished && proc.exitValue() == 0 && output.exists() && output.length() > 0
        } finally {
            proc.destroy()
        }
    }
}
