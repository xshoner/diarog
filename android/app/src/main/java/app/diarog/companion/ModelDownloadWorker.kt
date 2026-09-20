package app.diarog.companion

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream
import kotlin.coroutines.coroutineContext

object SpeechModel {
    const val NAME = "vosk-model-small-ko-0.22"
    const val SHA256 = "eea36124087fed26c59996a4761519458e3bd185e8ea9d9865ad8760c4a1d989"
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
        val archive = File(applicationContext.cacheDir, "speech-model.zip")
        try {
            diagnostics.record("model", "한국어 모델 다운로드 시작 (약 83MB)…")
            check(applicationContext.noBackupFilesDir.usableSpace > 400_000_000) { "저장 공간 부족: 400MB 이상 확보해 주세요." }
            stage.deleteRecursively(); check(stage.mkdirs())
            val client = OkHttpClient.Builder().callTimeout(7, TimeUnit.MINUTES).build()
            client.newCall(Request.Builder().url("https://alphacephei.com/vosk/models/${SpeechModel.NAME}.zip").build()).execute().use { response ->
                check(response.isSuccessful) { "다운로드 서버 HTTP ${response.code}" }
                response.body!!.byteStream().use { input -> archive.outputStream().use { out ->
                    val buffer = ByteArray(32_768); var total = 0L
                    var reported = -1L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buffer); if (n == -1) break
                        total += n; check(total <= 200_000_000) { "모델 크기 초과" }; out.write(buffer, 0, n)
                        if(total / 1_000_000 != reported) {
                            reported = total / 1_000_000
                            val length = response.body!!.contentLength()
                            diagnostics.record("model", "다운로드 ${reported}MB" + if(length > 0) " / ${length / 1_000_000}MB (${total * 100 / length}%)" else "")
                        }
                    }
                } }
            }
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            archive.inputStream().use { input ->
                val buffer = ByteArray(32_768)
                while(true) { coroutineContext.ensureActive(); val n = input.read(buffer); if(n == -1) break; digest.update(buffer, 0, n) }
            }
            check(digest.digest().joinToString("") { "%02x".format(it) } == SpeechModel.SHA256) { "모델 무결성 검사 실패" }
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
            SyncWorker.enqueue(applicationContext)
            Result.success()
        } catch (e: kotlinx.coroutines.CancellationException) {
            diagnostics.record("model", "다운로드 중단 · 네트워크 조건 충족 후 재시작하거나 다시 시도해 주세요.")
            throw e
        } catch (e: Exception) {
            val reason = when(e) {
                is java.net.UnknownHostException -> "다운로드 서버를 찾을 수 없습니다. 인터넷/DNS를 확인해 주세요."
                is java.net.SocketTimeoutException -> "다운로드 시간 초과. 안정적인 네트워크에서 재시도해 주세요."
                is javax.net.ssl.SSLException -> "보안 연결 실패. 기기 날짜와 네트워크를 확인해 주세요."
                else -> e.message?.take(180) ?: e.javaClass.simpleName
            }
            val retry = e is java.io.IOException && runAttemptCount < 3
            diagnostics.record("model", "$reason" + if(retry) " · 자동 재시도 대기 (${runAttemptCount + 1}/3)" else " · 다운로드 버튼으로 재시도")
            if(retry) Result.retry() else Result.failure()
        }
        finally { archive.delete(); stage.deleteRecursively() }
      }
    }
}
