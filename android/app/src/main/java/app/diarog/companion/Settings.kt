package app.diarog.companion

import android.content.Context
import java.net.URI

class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("companion", Context.MODE_PRIVATE)
    var server: String
        get() = prefs.getString("server", "https://diarog.vercel.app")!!
        set(value) { prefs.edit().putString("server", normalizeServer(value)).commit() }
    var token: String
        get() = prefs.getString("token", null)?.let(Vault::open) ?: ""
        set(value) { prefs.edit().putString("token", if (value.isBlank()) null else Vault.seal(value)).commit() }
    var folder: String
        get() = prefs.getString("folder", "")!!
        set(value) { prefs.edit().putString("folder", value).commit() }
    var since: Long
        get() = prefs.getLong("since", System.currentTimeMillis())
        set(value) { prefs.edit().putLong("since", value).commit() }
    var audio: Boolean
        get() = prefs.getBoolean("audio", false)
        set(value) { prefs.edit().putBoolean("audio", value).commit() }
    var steps: Boolean
        get() = prefs.getBoolean("steps", false)
        set(value) { prefs.edit().putBoolean("steps", value).commit() }
    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(value) { prefs.edit().putBoolean("enabled", value).commit() }
    var generation: String
        get() = prefs.getString("generation", "")!!
        set(value) { prefs.edit().putString("generation", value).commit() }
    var status: String
        get() = prefs.getString("status", "아직 동기화하지 않았습니다.")!!
        set(value) { prefs.edit().putString("status", value).apply() }
    var healthStatus: String
        get() = prefs.getString("healthStatus", "걸음 수 수집 꺼짐")!!
        set(value) { prefs.edit().putString("healthStatus", value).apply() }
    fun clear() { prefs.edit().clear().commit() }

    companion object {
        fun normalizeServer(raw: String): String {
            val uri = URI(raw.trim())
            require(uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null &&
                uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/")) { "서버 주소는 https://도메인 형식이어야 합니다." }
            return uri.toASCIIString().trimEnd('/')
        }
    }
}
