package app.diarog.companion

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object HealthSteps {
    val permission = HealthPermission.getReadPermission(StepsRecord::class)
    private val zone = ZoneId.of("Asia/Seoul")
    fun available(context: Context) = HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
    fun supportsBackground(client: HealthConnectClient) = client.features.getFeatureStatus(
        HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
    ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    suspend fun collect(context: Context, foreground: Boolean) {
        val settings = Settings(context)
        if (!settings.enabled || !settings.steps) return
        if (!available(context)) { settings.healthStatus = "Health Connect 설치 또는 업데이트 필요"; return }
        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        if (permission !in granted) { settings.healthStatus = "걸음 수 권한 필요"; return }
        if (!foreground && (!supportsBackground(client) || HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in granted)) {
            settings.healthStatus = "백그라운드 걸음 수 읽기 미지원/권한 없음 · 앱에서 동기화 가능"; return
        }
        var daysWithData = 0
        var todayCount: Long? = null
        QueueStore(context).use { queue ->
            // Re-read recent days for delayed device/provider writes, without summing duplicate origins.
            for (daysAgo in 0L..2L) {
                val date = LocalDate.now(zone).minusDays(daysAgo)
                val start = date.atStartOfDay(zone).toInstant()
                val end = minOf(date.plusDays(1).atStartOfDay(zone).toInstant(), Instant.now())
                val count = client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end)))[StepsRecord.COUNT_TOTAL] ?: continue
                daysWithData++
                if(daysAgo == 0L) todayCount = count
                val key = "steps:$date"
                val signal = JSONObject().put("source", "steps").put("externalId", key)
                    .put("occurredAt", start.toString()).put("endedAt", end.toString())
                    .put("title", "$date 걸음 수").put("summary", "Health Connect 집계: ${count}보")
                    .put("payload", JSONObject().put("count", count).put("date", date.toString()).put("timezone", zone.id).put("aggregatedAt", Instant.now().toString()))
                queue.enqueue(key, "steps", signal.toString())
            }
        }
        settings.healthStatus = if(daysWithData == 0) "읽기 권한 정상 · 최근 3일 걸음 데이터 없음. Samsung Health 등의 Health Connect 쓰기 연동 확인"
            else "최근 3일 중 ${daysWithData}일 집계 · 오늘 ${todayCount?.let { "${it}보" } ?: "데이터 없음"} · 전송 대기"
    }
}
