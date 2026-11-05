package dev.chethiya.orbit

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.io.File

/**
 * Hardware video playback, the same way Google Photos does it: a native ExoPlayer surface sits
 * behind the (then transparent) WebView, and the HTML viewer only draws the controls on top.
 */
@OptIn(UnstableApi::class)
class OrbitPlayer(private val activity: MainActivity, private val root: FrameLayout, private val web: WebView) {
    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var view: PlayerView? = null
    private var firstFrameSent = false

    private val ticker = object : Runnable {
        override fun run() {
            emit()
            if (player?.isPlaying == true) main.postDelayed(this, 250)
        }
    }

    private fun ensure(): ExoPlayer {
        player?.let { return it }
        val p = ExoPlayer.Builder(activity, DefaultRenderersFactory(activity).setEnableDecoderFallback(true))
            .setSeekBackIncrementMs(5000)
            .build()
        p.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true
        )
        p.setHandleAudioBecomingNoisy(true)
        p.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                view?.keepScreenOn = isPlaying
                main.removeCallbacks(ticker)
                if (isPlaying) main.post(ticker) else emit()
            }
            override fun onPlaybackStateChanged(state: Int) { emit() }
            override fun onPositionDiscontinuity(o: Player.PositionInfo, n: Player.PositionInfo, reason: Int) { emit() }
            override fun onRenderedFirstFrame() {
                firstFrameSent = true
                send(JSONObject().put("ev", "first"))
            }
            override fun onPlayerError(error: PlaybackException) {
                send(JSONObject().put("ev", "error").put("msg", error.errorCodeName))
            }
        })
        val v = PlayerView(activity).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.TRANSPARENT)
            setBackgroundColor(Color.BLACK)
            isClickable = false
            isFocusable = false
            visibility = View.GONE
            player = p
        }
        root.addView(v, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view = v
        player = p
        return p
    }

    fun open(path: String, audioOnly: Boolean) {
        val p = ensure()
        firstFrameSent = false
        val uri = if (path.startsWith("content://")) Uri.parse(path) else Uri.fromFile(File(path))
        web.setBackgroundColor(Color.TRANSPARENT)
        view?.visibility = if (audioOnly) View.GONE else View.VISIBLE
        view?.translationX = 0f
        view?.translationY = 0f
        p.setSeekParameters(SeekParameters.EXACT)
        p.playbackParameters = PlaybackParameters.DEFAULT
        p.volume = 1f
        p.setMediaItem(MediaItem.fromUri(uri))
        p.prepare()
        p.playWhenReady = true
    }

    /** Stops playback and hides the surface; the viewer stays open (for example on a photo). */
    fun stop() {
        main.removeCallbacks(ticker)
        player?.stop()
        player?.clearMediaItems()
        view?.visibility = View.GONE
        view?.keepScreenOn = false
    }

    fun close() {
        stop()
        web.setBackgroundColor(Color.BLACK)
    }

    /** The viewer needs the page transparent while it is on screen, video or not. */
    fun setViewerOpen(open: Boolean) {
        web.setBackgroundColor(if (open) Color.TRANSPARENT else Color.BLACK)
    }

    fun play() {
        val p = player ?: return
        if (p.playbackState == Player.STATE_ENDED) p.seekTo(0)
        p.play()
    }

    fun pause() { player?.pause() }

    fun seek(ms: Long, scrubbing: Boolean) {
        val p = player ?: return
        p.setSeekParameters(if (scrubbing) SeekParameters.CLOSEST_SYNC else SeekParameters.EXACT)
        p.seekTo(ms.coerceAtLeast(0))
    }

    fun setRate(rate: Float) { player?.setPlaybackSpeed(rate) }

    fun setMuted(muted: Boolean) { player?.volume = if (muted) 0f else 1f }

    fun setRect(left: Int, top: Int, width: Int, height: Int) {
        val v = view ?: return
        val lp = v.layoutParams as FrameLayout.LayoutParams
        if (lp.leftMargin == left && lp.topMargin == top && lp.width == width && lp.height == height) return
        lp.leftMargin = left; lp.topMargin = top; lp.width = width; lp.height = height
        v.layoutParams = lp
    }

    fun setOffset(dx: Float, dy: Float) {
        view?.translationX = dx
        view?.translationY = dy
    }

    fun onHostStopped() { player?.pause() }

    fun release() {
        main.removeCallbacks(ticker)
        player?.release()
        player = null
    }

    private fun emit() {
        val p = player ?: return
        send(JSONObject().apply {
            put("ev", "state")
            put("playing", p.isPlaying)
            put("pos", p.currentPosition)
            put("dur", if (p.duration == C.TIME_UNSET) 0 else p.duration)
            put("buffering", p.playbackState == Player.STATE_BUFFERING)
            put("ended", p.playbackState == Player.STATE_ENDED)
            put("rate", p.playbackParameters.speed.toDouble())
        })
    }

    private fun send(o: JSONObject) {
        web.evaluateJavascript("window.orbitPlayerEvent && window.orbitPlayerEvent($o);", null)
    }
}
