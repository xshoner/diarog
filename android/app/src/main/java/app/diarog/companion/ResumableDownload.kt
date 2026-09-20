package app.diarog.companion

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Partial bytes survive timeouts and process death; the caller verifies the full SHA-256. */
class ResumableDownload(private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(30, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
    .callTimeout(4, TimeUnit.MINUTES).build()) {
    fun fetch(url: String, file: File, expectedBytes: Long, progress: (Long, Long) -> Boolean): Boolean {
        if(file.length() > expectedBytes) file.delete()
        if(file.length() == expectedBytes) return true
        val offset = file.length()
        val request = Request.Builder().url(url).header("Accept-Encoding", "identity")
        if(offset > 0) request.header("Range", "bytes=$offset-")
        client.newCall(request.build()).execute().use { response ->
            if(response.code == 416) { file.delete(); throw IOException("이어받기 범위를 초기화했습니다.") }
            if(response.code != 200 && response.code != 206) throw IOException("다운로드 서버 HTTP ${response.code}")
            val append = response.code == 206
            if(append) {
                val range = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(response.header("Content-Range") ?: "")
                if(range == null || range.groupValues[1].toLongOrNull() != offset ||
                    range.groupValues[2].toLongOrNull() != expectedBytes - 1 || range.groupValues[3].toLongOrNull() != expectedBytes) {
                    file.delete(); throw IOException("이어받기 응답 범위가 올바르지 않습니다.")
                }
            }
            val body = response.body ?: throw IOException("빈 다운로드 응답")
            var total = if(append) offset else 0L
            if(body.contentLength() >= 0 && body.contentLength() != expectedBytes - total) throw IOException("모델 다운로드 크기가 올바르지 않습니다.")
            // A server ignoring Range returns 200: truncate rather than append duplicated bytes.
            FileOutputStream(file, append).use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(32_768)
                    while(true) {
                        if(!progress(total, expectedBytes)) return false
                        val n = input.read(buffer)
                        if(n == -1) break
                        if(total + n > expectedBytes) { file.delete(); throw IOException("모델 크기 초과") }
                        output.write(buffer, 0, n); total += n
                    }
                }
            }
            if(total != expectedBytes) throw IOException("다운로드 연결 중단 · 받은 부분부터 이어받습니다.")
            progress(total, expectedBytes)
            return true
        }
    }
}
