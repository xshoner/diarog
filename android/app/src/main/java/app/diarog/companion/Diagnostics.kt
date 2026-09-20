package app.diarog.companion

import android.content.Context

/** Separate module results so a later sync message cannot erase a failure. No source content. */
class Diagnostics(context: Context) {
    private val prefs = context.getSharedPreferences("diagnostics", Context.MODE_PRIVATE)
    fun record(module: String, message: String) {
        prefs.edit().putString(module, message).putLong("${module}_at", System.currentTimeMillis()).apply()
    }
    fun message(module: String, fallback: String = "아직 실행하지 않음") = prefs.getString(module, fallback)!!
    fun time(module: String) = prefs.getLong("${module}_at", 0)
    fun verified() { record("connection", "서버가 토큰을 확인했습니다."); prefs.edit().putBoolean("connected", true).apply() }
    fun disconnected(message: String) { record("connection", message); prefs.edit().putBoolean("connected", false).apply() }
    fun fresh(now: Long = System.currentTimeMillis()) = prefs.getBoolean("connected", false) && now - time("connection") in 0..90_000L
    fun clear() { prefs.edit().clear().commit() }
    fun capabilities(response: org.json.JSONObject) {
        val modules = response.optJSONObject("capabilities")
        record("server", if(modules == null) "서버 상세 진단 미지원 · 웹 업데이트 후 확인 가능"
            else "기록 DB ${if(modules.optBoolean("signalStorage")) "접근 정상" else "오류"} · AI 요약 ${if(modules.optBoolean("summaryConfigured")) "키 설정됨 (실제 요약 결과는 별도 확인)" else "키 설정 필요"}")
    }
}
