package app.diarog.companion

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.*
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.time.Instant

/** Started only by a visible Activity. No hidden boot-start or background-location permission. */
class LocationService : Service(), LocationListener {
    private lateinit var manager: LocationManager
    private lateinit var thread: HandlerThread
    private var lastSavedAt = 0L
    private var generation = ""
    override fun onBind(intent: Intent?) = null
    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(LocationManager::class.java)
        thread = HandlerThread("diarog-location").apply { start() }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if(intent?.action == "stop" || !Settings(this).enabled) { stopSelf(); return START_NOT_STICKY }
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if(!fine && !coarse) { stopSelf(); return START_NOT_STICKY }
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("location", "위치 수집", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, LocationService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, "location").setSmallIcon(R.drawable.ic_companion)
            .setContentTitle("diarog 이동 기록 수집 중").setContentText("일기에 사용할 위치를 기록합니다. 중지하려면 누르세요.")
            .setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null, "수집 중지", stop).build()).build()
        try {
            if(Build.VERSION.SDK_INT >= 29) startForeground(31, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(31, notification)
            if(active) return START_NOT_STICKY
            generation = Settings(this).generation
            var registered = false
            if(manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 300_000L, 200f, this, thread.looper); registered = true
            }
            if(fine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 300_000L, 200f, this, thread.looper); registered = true
            }
            if(!registered) { Settings(this).status = "기기 위치 설정을 켠 뒤 다시 시작해 주세요."; stopSelf() }
            else active = true
        } catch (_: SecurityException) { Settings(this).status = "위치 권한을 다시 확인해 주세요."; stopSelf() }
        return START_NOT_STICKY
    }
    override fun onLocationChanged(location: Location) {
        if(!Settings(this).enabled) { stopSelf(); return }
        if(location.accuracy > 2000f || location.time <= 0 || System.currentTimeMillis() - location.time !in 0..900_000L) return
        if(location.time - lastSavedAt < 300_000L) return
        try {
            val key = "location:${location.time}"
            val payload = JSONObject().put("lat", location.latitude).put("lng", location.longitude)
                .put("accuracyMeters", location.accuracy.toDouble()).put("provider", location.provider)
            val body = JSONObject().put("source", "location").put("externalId", key)
                .put("occurredAt", Instant.ofEpochMilli(location.time).toString()).put("title", "이동 위치")
                .put("summary", "위치 기록 (정확도 약 ${location.accuracy.toInt()}m)").put("payload", payload)
            synchronized(LocalState.lock) {
                val current = Settings(this)
                if(!current.enabled || current.generation != generation) return
                QueueStore(this).use { it.enqueue(key, "location", body.toString()) }
            }
            lastSavedAt = location.time
        } catch (_: Exception) { Settings(this).status = "위치 저장 실패. 대기 기록/저장 공간을 확인해 주세요." }
    }
    @Deprecated("Required on older Android versions")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit
    override fun onDestroy() {
        active = false
        manager.removeUpdates(this); thread.quitSafely()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
    companion object { @Volatile var active = false; private set }
}
