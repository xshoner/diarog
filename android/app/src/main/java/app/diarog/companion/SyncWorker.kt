package app.diarog.companion

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

object SyncGate { val mutex = Mutex() }
object LocalState { val lock = Any() }

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        SyncGate.mutex.withLock {
            val settings = Settings(applicationContext)
            val diagnostics = Diagnostics(applicationContext)
            if(!settings.enabled) return@withLock Result.success()
            val started = android.os.SystemClock.elapsedRealtime()
            try {
                val api = CompanionApi(settings.server, settings.token)
                // Verify before reading sensitive sources. Revocation stops collection on the next run.
                diagnostics.capabilities(api.verify())
                diagnostics.verified()
                QueueStore(applicationContext).use { queue ->
                    try { HealthSteps.collect(applicationContext, false) }
                    catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: SecurityException) { settings.healthStatus = "걸음 수 권한이 취소되었습니다." }
                    catch (_: Exception) { settings.healthStatus = "걸음 수 읽기 실패. Health Connect 상태를 확인해 주세요." }
                    try { RecordingScanner(applicationContext).collectOne(queue) }
                    catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: Exception) { diagnostics.record("audio", "녹음 폴더를 읽지 못했습니다. 폴더를 다시 선택해 주세요.") }
                    var transientFailure = false
                    for(item in queue.pending()) {
                        if(!settings.enabled || isStopped) break
                        if((item.kind == "audio" && !settings.audio) || (item.kind == "steps" && !settings.steps)) continue
                        if(android.os.SystemClock.elapsedRealtime() - started > 240_000L) break
                        try {
                            diagnostics.record("upload", if(item.kind == "audio") "전사 완료 · 서버 요약 요청 중…" else "${item.kind} 전송 중…")
                            api.upload(item); queue.acknowledge(item.id)
                            diagnostics.record("upload", "${item.kind} 서버 저장 확인 · ${java.time.LocalDateTime.now().withNano(0)}")
                            if(item.kind == "audio") diagnostics.record("summary", "통화 요약 저장 완료 · ${java.time.LocalDateTime.now().withNano(0)}")
                        }
                        catch (e: HttpFailure) {
                            diagnostics.record("upload", "${item.kind} 전송 실패 HTTP ${e.code} · 대기 기록 유지")
                            if(e.code == 401 || e.code == 403) throw e
                            queue.fail(item, e.code)
                            transientFailure = true
                            if(e.code == 429 || e.code >= 500) break
                        } catch (_: java.io.IOException) {
                            diagnostics.record("upload", "네트워크 오류 · 대기 기록 유지, 자동 재시도")
                            queue.fail(item, 0); transientFailure = true; break
                        }
                        // Limit slow AI summaries to one per work execution.
                        if(item.kind == "audio") break
                    }
                    settings.status = "동기화 확인: ${java.time.LocalDateTime.now().withNano(0)}\n전송 대기 ${queue.count()}개 · 녹음 변환 실패 ${queue.failedCount()}개"
                    if(transientFailure) Result.retry() else Result.success()
                }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: HttpFailure) {
                diagnostics.disconnected("서버 확인 실패 HTTP ${e.code}")
                if(e.code in listOf(401, 403)) {
                    settings.enabled = false
                    applicationContext.stopService(android.content.Intent(applicationContext, LocationService::class.java))
                    settings.status = "연결 토큰이 만료/해제되었습니다. 새 토큰으로 다시 연결해 주세요."
                    Result.failure()
                } else { settings.status = "서버 연결 실패. 자동으로 다시 시도합니다."; Result.retry() }
            } catch (_: Exception) { diagnostics.disconnected("동기화 연결 확인 실패"); settings.status = "동기화 실패. 네트워크와 연결 설정을 확인해 주세요."; Result.retry() }
        }
    }

    companion object {
        private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build()
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("companion-periodic", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).addTag("companion-sync").build())
        }
        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("companion-now", ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(constraints)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).addTag("companion-sync").build())
        }
        fun cancel(context: Context) { WorkManager.getInstance(context).cancelAllWorkByTag("companion-sync") }
    }
}
