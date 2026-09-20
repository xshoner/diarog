package app.diarog.companion

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.zip.ZipInputStream
import kotlin.coroutines.coroutineContext

object SpeechModel {
    const val NAME = "vosk-model-small-ko-0.22"
    const val SHA256 = "eea36124087fed26c59996a4761519458e3bd185e8ea9d9865ad8760c4a1d989"
    const val BYTES = 86_914_329L
    const val ASSET = "vosk-model-small-ko-0.22.zip"
    fun bundled(context: Context) = context.assets.list("")?.contains(ASSET) == true
    fun directory(context: Context) = File(context.noBackupFilesDir, "speech/$NAME")
    fun ready(context: Context) = valid(directory(context)) && File(directory(context), "READY").isFile
    fun valid(directory: File) = listOf("am/final.mdl", "conf/model.conf", "graph/Gr.fst", "graph/HCLr.fst").all { File(directory, it).let { f -> f.isFile && f.length() > 0 } }
}

private object ModelGate { val mutex = Mutex() }

class ModelDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
      ModelGate.mutex.withLock {
        if (SpeechModel.ready(applicationContext)) return@withContext Result.success()
        val settings = Settings(applicationContext)
        val diagnostics = Diagnostics(applicationContext)
        val stage = File(applicationContext.noBackupFilesDir, "speech-download")
        val archive = File(applicationContext.noBackupFilesDir, "speech-model.zip")
        try {
            diagnostics.record("model", "한국어 모델 다운로드 시작 (약 83MB)…")
            check(applicationContext.noBackupFilesDir.usableSpace > 400_000_000) { "저장 공간 부족: 400MB 이상 확보해 주세요." }
            stage.deleteRecursively(); check(stage.mkdirs())
            if(SpeechModel.bundled(applicationContext)) {
                diagnostics.record("model", "앱에 포함된 한국어 모델 복사 중 · 인터넷 사용 안 함")
                applicationContext.assets.open(SpeechModel.ASSET).use { input -> archive.outputStream().use { output ->
                    val buffer = ByteArray(32_768)
                    while(true) { coroutineContext.ensureActive(); val n = input.read(buffer); if(n == -1) break; output.write(buffer, 0, n) }
                } }
            } else {
                val deadline = android.os.SystemClock.elapsedRealtime() + 180_000L
                val jobContext = coroutineContext
                var reported = -1L
                val complete = ResumableDownload().fetch("https://alphacephei.com/vosk/models/${SpeechModel.NAME}.zip", archive, SpeechModel.BYTES) { total, length ->
                    jobContext.ensureActive()
                    if(total / 1_000_000 != reported) {
                        reported = total / 1_000_000
                        diagnostics.record("model", "다운로드 ${reported}MB / ${length / 1_000_000}MB (${total * 100 / length}%) · 중단 시 이어받기")
                    }
                    android.os.SystemClock.elapsedRealtime() < deadline
                }
                if(!complete) { diagnostics.record("model", "${archive.length() / 1_000_000}MB 보관 · 다음 작업에서 자동 이어받기"); return@withContext Result.retry() }
            }
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            archive.inputStream().use { input ->
                val buffer = ByteArray(32_768)
                while(true) { coroutineContext.ensureActive(); val n = input.read(buffer); if(n == -1) break; digest.update(buffer, 0, n) }
            }
            if(digest.digest().joinToString("") { "%02x".format(it) } != SpeechModel.SHA256) {
                archive.delete(); error("모델 무결성 검사 실패 · 손상 파일을 지웠습니다. 다시 설치해 주세요.")
            }
            diagnostics.record("model", "무결성 확인 완료 · 압축 해제 중…")
            ZipInputStream(archive.inputStream().buffered()).use { zip ->
                var total = 0L; var entries = 0
                while (true) {
                    coroutineContext.ensureActive()
                    val entry = zip.nextEntry ?: break
                    check(++entries < 5000) { "모델 파일 수 초과" }
                    val target = File(stage, entry.name).canonicalFile
                    check(target.path.startsWith(stage.canonicalPath + File.separator) && entry.name.startsWith(SpeechModel.NAME + "/")) { "잘못된 모델 경로" }
                    if (entry.isDirectory) target.mkdirs() else {
                        target.parentFile!!.mkdirs()
                        target.outputStream().use { out ->
                            val buffer = ByteArray(32_768)
                            while(true) {
                                coroutineContext.ensureActive()
                                val n = zip.read(buffer); if(n == -1) break
                                total += n; check(total <= 500_000_000) { "모델 압축 해제 크기 초과" }; out.write(buffer, 0, n)
                            }
                        }
                    }
                }
            }
            val unpacked = File(stage, SpeechModel.NAME)
            check(SpeechModel.valid(unpacked)) { "모델 필수 파일이 없거나 비어 있습니다." }
            diagnostics.record("model", "음성 엔진에서 모델을 여는 중…")
            org.vosk.Model(unpacked.path).use { }
            val destination = SpeechModel.directory(applicationContext)
            destination.parentFile!!.mkdirs(); destination.deleteRecursively()
            check(unpacked.renameTo(destination))
            File(destination, "READY").writeText(SpeechModel.NAME)
            settings.status = "한국어 모델 설치 완료"
            diagnostics.record("model", "준비 완료 · SHA-256 및 음성 엔진 로딩 검증 성공")
            archive.delete()
            SyncWorker.enqueue(applicationContext)
            Result.success()
        } catch (e: kotlinx.coroutines.CancellationException) {
            diagnostics.record("model", "작업 중단 · ${archive.length() / 1_000_000}MB 보관. 다시 설치하면 이어받습니다.")
            throw e
        } catch (e: Exception) {
            val reason = when(e) {
                is java.net.UnknownHostException -> "다운로드 서버를 찾을 수 없습니다. 인터넷/DNS를 확인해 주세요."
                is java.io.InterruptedIOException -> "다운로드 시간 초과 · ${archive.length() / 1_000_000}MB 보관"
                is javax.net.ssl.SSLException -> "보안 연결 실패. 기기 날짜와 네트워크를 확인해 주세요."
                else -> e.message?.take(180) ?: e.javaClass.simpleName
            }
            val retry = e is java.io.IOException && !SpeechModel.bundled(applicationContext) && runAttemptCount < 10
            diagnostics.record("model", "$reason" + if(retry) " · 자동 이어받기 대기 (${runAttemptCount + 1}/10)" else " · 모델 설치 버튼으로 재시도")
            if(retry) Result.retry() else Result.failure()
        }
        finally { stage.deleteRecursively() }
      }
    }
}
