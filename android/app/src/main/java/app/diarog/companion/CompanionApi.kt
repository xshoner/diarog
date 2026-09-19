package app.diarog.companion

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class HttpFailure(val code: Int) : IOException("HTTP $code")

class CompanionApi(private val server: String, private val token: String) {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(290, TimeUnit.SECONDS)
        .callTimeout(295, TimeUnit.SECONDS).build()
    fun verify() = send("signals", null)
    fun upload(item: Pending) = send(if(item.kind == "audio") "transcripts" else "signals", item.body)
    private fun send(path: String, body: String?) {
        val builder = Request.Builder().url("$server/api/companion/$path").header("Authorization", "Bearer $token")
        if(body != null) builder.post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
        client.newCall(builder.build()).execute().use {
            if(!it.isSuccessful) throw HttpFailure(it.code)
            if(JSONObject(it.body?.string() ?: "{}").optBoolean("ok") != true) throw IOException("서버 확인 응답이 없습니다.")
        }
    }
}
