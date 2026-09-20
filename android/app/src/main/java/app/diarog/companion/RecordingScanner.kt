package app.diarog.companion

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.ensureActive
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import kotlin.coroutines.coroutineContext

class RecordingScanner(private val context: Context) {
    suspend fun collectOne(queue: QueueStore) {
        // Remove a private decoding copy left behind by process termination.
        File(context.cacheDir, "call-input.tmp").delete()
        val settings = Settings(context)
        val diagnostics = Diagnostics(context)
        if(!settings.audio || settings.folder.isEmpty()) return
        if(!SpeechModel.ready(context)) { diagnostics.record("audio", "통화 수집 대기: 한국어 모델 설치 필요"); return }
        val root = DocumentFile.fromTreeUri(context, Uri.parse(settings.folder)) ?: error("녹음 폴더를 다시 선택해 주세요.")
        check(root.canRead()) { "녹음 폴더 접근 권한이 만료되었습니다." }
        val candidates = mutableListOf<DocumentFile>()
        var visited = 0
        fun scan(dir: DocumentFile, depth: Int) {
            check(depth <= 8) { "녹음 폴더 구조가 너무 깊습니다." }
            for(file in dir.listFiles()) {
                check(++visited <= 5000) { "파일 5,000개 이하의 녹음 하위 폴더를 선택해 주세요." }
                if(file.isDirectory) scan(file, depth + 1)
                else if(file.name?.substringAfterLast('.', "")?.lowercase() in setOf("mp3", "m4a", "wav", "amr", "aac", "ogg", "3gp", "mp4")) candidates.add(file)
            }
        }
        scan(root, 0)
        diagnostics.record("audio", "폴더 검사 완료 · 오디오 ${candidates.size}개 · 처리할 새 녹음 탐색 중")
        for(file in candidates.sortedByDescending { it.lastModified() }) {
            coroutineContext.ensureActive()
            val modified = file.lastModified(); val size = file.length()
            // Providers without timestamps cannot safely assign historical calls to a day.
            if(modified <= 0 || modified < settings.since || System.currentTimeMillis() - modified < 120_000L) continue
            val key = digest("${file.uri}|$modified|$size".toByteArray())
            if(!queue.shouldRead(key)) continue
            val temp = File(context.cacheDir, "call-input.tmp")
            try {
                require(size in 1..250_000_000L) { "지원 파일 크기: 최대 250MB" }
                val hash = MessageDigest.getInstance("SHA-256")
                context.contentResolver.openInputStream(file.uri)!!.use { input -> temp.outputStream().use { out ->
                    val buffer = ByteArray(32_768); var total = 0L
                    while(true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buffer); if(n == -1) break
                        total += n; check(total <= 250_000_000L)
                        hash.update(buffer, 0, n); out.write(buffer, 0, n)
                    }
                    check(total == size && file.length() == size && file.lastModified() == modified) { "녹음 파일 저장 중" }
                } }
                settings.status = "휴대폰에서 녹음을 글로 변환 중…"
                diagnostics.record("audio", "기기에서 음성을 글로 변환 중…")
                val transcript = LocalTranscriber(context).transcribe(temp)
                if (!settings.enabled || !settings.audio) return
                val parsed = AudioMath.recordingStart(file.name ?: "", ZoneId.systemDefault())
                val start = parsed ?: Instant.ofEpochMilli(modified - transcript.durationMs)
                val externalId = "audio:" + hash.digest().joinToString("") { "%02x".format(it) }
                val body = JSONObject().put("externalId", externalId).put("occurredAt", start.toString())
                    .put("endedAt", start.plusMillis(transcript.durationMs).toString())
                    .put("timingSource", if(parsed != null) "filename" else "file_modified").put("transcript", transcript.text)
                queue.enqueue(externalId, "audio", body.toString())
                queue.markRecording(key, true)
                diagnostics.record("audio", "전사 완료 · ${transcript.text.length}자 · 서버 요약 전송 대기")
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { queue.markRecording(key, false); diagnostics.record("audio", "전사 실패 (${e.javaClass.simpleName}). 지원 형식·1시간/250MB 제한 확인 후 실패 기록 재시도") }
            finally { temp.delete() }
            // One recording per run keeps background work within Android's execution window.
            return
        }
        diagnostics.record("audio", "오디오 ${candidates.size}개 확인 · 새 처리 대상 없음 (과거 녹음 선택/저장 후 2분/이미 처리한 파일 확인)")
    }
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
