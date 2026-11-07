package dev.chethiya.orbit

import android.content.Context
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** The vault PIN is stored only as a salted PBKDF2 hash, and repeated wrong guesses are slowed down. */
object VaultLock {
    private const val ITERATIONS = 120_000
    private fun prefs(c: Context) = c.getSharedPreferences("orbit_vault", Context.MODE_PRIVATE)
    private fun hash(pin: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, 256)).encoded

    fun hasPin(c: Context) = prefs(c).contains("hash")

    fun setPin(c: Context, pin: String) {
        require(pin.matches(Regex("\\d{4}"))) { "The PIN must be 4 digits." }
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs(c).edit()
            .putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString("hash", Base64.encodeToString(hash(pin, salt), Base64.NO_WRAP))
            .remove("fails").remove("until").apply()
    }

    fun waitSeconds(c: Context): Long = ((prefs(c).getLong("until", 0) - System.currentTimeMillis()) / 1000 + 1).coerceAtLeast(0).let { if (prefs(c).getLong("until", 0) <= System.currentTimeMillis()) 0 else it }

    fun verify(c: Context, pin: String): Boolean {
        val p = prefs(c)
        if (waitSeconds(c) > 0) return false
        val salt = Base64.decode(p.getString("salt", "") ?: "", Base64.NO_WRAP)
        val want = Base64.decode(p.getString("hash", "") ?: "", Base64.NO_WRAP)
        if (MessageDigest.isEqual(hash(pin, salt), want)) { p.edit().remove("fails").remove("until").apply(); return true }
        val fails = p.getInt("fails", 0) + 1
        val edit = p.edit().putInt("fails", fails)
        if (fails >= 5) edit.putLong("until", System.currentTimeMillis() + 30_000L * (1L shl (fails - 5).coerceAtMost(5)))
        edit.apply()
        return false
    }
}
