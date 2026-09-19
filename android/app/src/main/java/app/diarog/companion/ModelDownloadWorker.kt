package app.diarog.companion

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
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
    fun ready(context: Context) = File(directory(context), "READY").isFile
}

class ModelDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (SpeechModel.ready(applicationContext)) return@withContext Result.success()
        val settings = Settings(applicationContext)
        val stage = File(applicationContext.noBackupFilesDir, "speech-download")
        val archive = File(applicationContext.cacheDir, "speech-model.zip")
        try {
            settings.status = "한국어 모델 다운로드 중 (약 82MB)…"
            stage.deleteRecursively(); check(stage.mkdirs())
            val client = OkHttpClient.Builder().callTimeout(7, TimeUnit.MINUTES).build()
            client.newCall(Request.Builder().url("https://alphacephei.com/vosk/models/${SpeechModel.NAME}.zip").build()).execute().use { response ->
                check(response.isSuccessful) { "모델 다운로드 실패" }
                response.body!!.byteStream().use { input -> archive.outputStream().use { out ->
                    val buffer = ByteArray(32_768); var total = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buffer); if (n == -1) break
                        total += n; check(total <= 200_000_000) { "모델 크기 초과" }; out.write(buffer, 0, n)
                    }
                } }
            }
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            archive.inputStream().use { input ->
                val buffer = ByteArray(32_768)
                while(true) { coroutineContext.ensureActive(); val n = input.read(buffer); if(n == -1) break; digest.update(buffer, 0, n) }
            }
            check(digest.digest().joinToString("") { "%02x".format(it) } == SpeechModel.SHA256) { "모델 무결성 검사 실패" }
            settings.status = "한국어 모델 설치 중…"
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
            check(File(unpacked, "am/final.mdl").isFile && File(unpacked, "conf/model.conf").isFile) { "올바른 Vosk 모델이 아닙니다." }
            val destination = SpeechModel.directory(applicationContext)
            destination.parentFile!!.mkdirs(); destination.deleteRecursively()
            check(unpacked.renameTo(destination))
            File(destination, "READY").writeText(SpeechModel.NAME)
            settings.status = "한국어 모델 설치 완료"
            SyncWorker.enqueue(applicationContext)
            Result.success()
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (_: Exception) { settings.status = "모델 설치 실패. Wi-Fi와 저장 공간을 확인한 뒤 다시 다운로드해 주세요."; Result.failure() }
        finally { archive.delete(); stage.deleteRecursively() }
    }
}
