package app.diarog.companion

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.lifecycle.lifecycleScope
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var settings: Settings
    private lateinit var status: TextView
    private lateinit var server: EditText
    private lateinit var token: EditText
    private lateinit var audio: Switch
    private lateinit var steps: Switch
    private lateinit var history: CheckBox
    private lateinit var location: Button
    private lateinit var folderLabel: TextView
    private lateinit var layout: LinearLayout
    private lateinit var connectionLight: TextView
    private lateinit var modules: TextView
    private lateinit var diagnostics: Diagnostics
    private var checkingConnection = false
    private var lastCheck = 0L
    private var modelWork = ""
    private var syncWork = ""
    private var busy = false
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() {
        updateStatus()
        if(settings.enabled && System.currentTimeMillis() - lastCheck > 30_000) verifyConnection()
        handler.postDelayed(this, 2000)
    } }

    private val folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if(uri != null) task {
            val includeHistory = history.isChecked
            withContext(Dispatchers.IO) { SyncGate.mutex.withLock {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val previous = settings.folder
                settings.folder = uri.toString(); settings.since = if(includeHistory) 0 else System.currentTimeMillis()
                if(previous.isNotEmpty() && previous != uri.toString()) runCatching {
                    contentResolver.releasePersistableUriPermission(Uri.parse(previous), Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            } }
            folderLabel.text = "녹음 폴더 선택됨"
            settings.status = "폴더 연결 완료. 새 녹음은 저장 후 약 2분이 지나면 수집 대상이 됩니다."
        }
    }
    private val healthPermissions = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
        task { collectForegroundSteps() }
    }
    private val locationPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if(hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)) startLocation()
        else settings.status = "위치 권한이 허용되지 않았습니다. 다른 기능은 계속 사용할 수 있습니다."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)
        diagnostics = Diagnostics(this)
        layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(28, 24, 28, 36)
            setBackgroundColor(Color.rgb(249, 247, 241))
        }
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(layout) }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()); view.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
        }
        setContentView(scroll)
        label("diarog", 32f, true)
        label("Android Companion", 20f, true)
        label("버전 ${packageManager.getPackageInfo(packageName, 0).versionName}")
        connectionLight = label("● 연결 확인 전", 17f, true)
        modules = label("")
        button("연결 및 모듈 상태 다시 확인") {
            verifyConnection()
            task {
                if(HealthSteps.available(this)) {
                    val granted = HealthConnectClient.getOrCreate(this).permissionController.getGrantedPermissions()
                    settings.healthStatus = if(HealthSteps.permission in granted) "걸음 수 읽기 권한 허용" +
                        if(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in granted) " · 백그라운드 허용" else " · 앱에서 읽기 가능"
                    else "걸음 수 읽기 권한 없음"
                } else settings.healthStatus = "Health Connect 설치/업데이트 필요"
            }
        }
        label("일상의 맥락을, 내 일기로.\n필요한 수집 기능만 직접 켜세요.")
        button("데이터 사용 안내") { startActivity(Intent(this, PrivacyActivity::class.java)) }
        button("오픈소스 라이선스") { startActivity(Intent(this, LicenseActivity::class.java)) }

        section("1. 내 diarog 연결")
        server = EditText(this).apply { hint = "https://diarog.vercel.app"; setText(settings.server); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; isSingleLine = true }
        layout.addView(server)
        token = EditText(this).apply {
            hint = "웹에서 발급한 연결 토큰"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true; isSaveEnabled = false; importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        layout.addView(token)
        button("웹에서 토큰 발급하기") {
            runCatching { Settings.normalizeServer(server.text.toString()) }.onSuccess {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$it/companion")))
            }.onFailure { settings.status = it.message ?: "서버 주소를 확인해 주세요." }
        }
        button("연결 확인 및 저장") {
            if(settings.enabled) AlertDialog.Builder(this).setTitle("새 연결로 바꿀까요?")
                .setMessage("위치 수집을 중지하고 기기에 남은 전송 대기 기록과 처리 이력을 지웁니다. 서버에 저장된 기록은 유지됩니다.")
                .setPositiveButton("새로 연결") { _, _ -> connect() }.setNegativeButton("취소", null).show()
            else connect()
        }

        section("2. 통화 녹음 → 글 → 요약")
        label("기존 녹음 파일(MP3/M4A 등)을 읽습니다. 통화를 직접 녹음하지 않습니다. 원본은 기기에 남으며, 전사문은 연결한 서버와 AI 요약 서비스로 전달됩니다.")
        label("녹음 1개당 최대 1시간·250MB. 15분 주기 작업마다 1개를 처리하며, 기기 절전 상태에 따라 지연될 수 있습니다.")
        button("한국어 모델 다운로드 · Wi-Fi · 약 82MB") {
            downloadModel(false)
        }
        button("모바일 데이터로 모델 다운로드") {
            AlertDialog.Builder(this).setTitle("모바일 데이터를 사용할까요?")
                .setMessage("약 83MB를 다운로드합니다. 통신 요금이 발생할 수 있습니다.")
                .setPositiveButton("다운로드") { _, _ -> downloadModel(true) }.setNegativeButton("취소", null).show()
        }
        button("모델 다운로드 취소") { WorkManager.getInstance(this).cancelUniqueWork("speech-model") }
        history = CheckBox(this).apply { text = "폴더의 과거 녹음도 가져오기"; isChecked = settings.since == 0L }
        layout.addView(history)
        history.setOnCheckedChangeListener { _, checked -> settings.since = if(checked) 0 else System.currentTimeMillis() }
        folderLabel = label(if(settings.folder.isEmpty()) "녹음 폴더를 선택해 주세요." else "녹음 폴더 선택됨")
        button("통화녹음 폴더 선택") { folderPicker.launch(null) }
        audio = Switch(this).apply { text = "녹음 자동 수집"; isChecked = settings.audio }
        layout.addView(audio)
        audio.setOnCheckedChangeListener { _, checked ->
            if(checked && !settings.audio) {
                audio.isChecked = false
                AlertDialog.Builder(this).setTitle("전사문을 보내 요약할까요?")
                    .setMessage("선택한 폴더의 녹음을 기기에서 글로 바꾸고 전사문을 diarog 서버와 Letsur AI로 보냅니다. 처리 권한이 있는 녹음만 선택하세요. diarog DB에는 요약과 추출 항목만 남깁니다.")
                    .setPositiveButton("동의하고 켜기") { _, _ ->
                        if(!settings.enabled || settings.folder.isEmpty()) settings.status = "먼저 서버와 녹음 폴더를 연결해 주세요."
                        else { settings.audio = true; audio.isChecked = true; SyncWorker.enqueue(this) }
                    }.setNegativeButton("취소", null).show()
            } else if(!checked && settings.audio) {
                settings.audio = false
                task { withContext(Dispatchers.IO) { SyncGate.mutex.withLock { QueueStore(this@MainActivity).use { it.clearKind("audio") } } } }
            }
        }

        section("3. Health Connect 걸음 수")
        label("한국 시간 기준 최근 3일의 걸음 수 합계를 개인 일기에 사용합니다. 광고에 사용하지 않습니다. 백그라운드 권한이 없으면 앱에서 동기화할 때 읽습니다.")
        steps = Switch(this).apply { text = "걸음 수 수집"; isChecked = settings.steps }
        layout.addView(steps)
        steps.setOnCheckedChangeListener { _, checked ->
            settings.steps = checked
            if(checked) {
                if(!settings.enabled) { settings.status = "먼저 서버를 연결해 주세요."; steps.isChecked = false }
                else requestHealth(false)
            } else task { withContext(Dispatchers.IO) { SyncGate.mutex.withLock { QueueStore(this@MainActivity).use { it.clearKind("steps") } } } }
        }
        button("걸음 수 권한 확인") { requestHealth(false) }
        button("백그라운드 걸음 수 권한 허용") { requestHealth(true) }

        section("4. 이동 기록")
        label("시작한 뒤 수집 알림이 표시되는 동안만 위치를 기록합니다. 약 5분·200m 간격이며 대략적 위치도 가능합니다. 앱 또는 알림에서 언제든 중지하세요.")
        location = button("위치 수집 시작") {
            if(LocationService.active) stopService(Intent(this, LocationService::class.java))
            else if(!settings.enabled) settings.status = "먼저 서버를 연결해 주세요."
            else locationPermissions.launch(buildList {
                add(Manifest.permission.ACCESS_COARSE_LOCATION); add(Manifest.permission.ACCESS_FINE_LOCATION)
                if(Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            }.toTypedArray())
        }

        section("동기화 상태")
        status = label("")
        button("지금 동기화 / 실패 기록 재시도") {
            if(!settings.enabled) { settings.status = "먼저 서버를 연결해 주세요."; return@button }
            task {
                collectForegroundSteps()
                withContext(Dispatchers.IO) { SyncGate.mutex.withLock { QueueStore(this@MainActivity).use { it.retry() } } }
                SyncWorker.schedule(this); SyncWorker.enqueue(this)
                settings.status = "동기화를 예약했습니다. 네트워크·배터리 상태에 따라 잠시 대기할 수 있습니다."
            }
        }
        button("연결 해제 및 기기 대기 데이터 삭제") {
            AlertDialog.Builder(this).setTitle("기기 연결을 해제할까요?")
                .setMessage("수집을 중지하고 암호화된 토큰, 대기 기록, 처리 이력을 삭제합니다. 서버의 기기 토큰은 웹 Companion 화면에서 폐기하세요.")
                .setPositiveButton("연결 해제") { _, _ -> task {
                    settings.enabled = false; SyncWorker.cancel(this); stopService(Intent(this, LocationService::class.java))
                    withContext(Dispatchers.IO) { SyncGate.mutex.withLock {
                        contentResolver.persistedUriPermissions.forEach { runCatching { contentResolver.releasePersistableUriPermission(it.uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
                        synchronized(LocalState.lock) {
                            QueueStore(this@MainActivity).use { it.clear() }; settings.clear(); diagnostics.clear()
                            java.io.File(cacheDir, "call-input.tmp").delete()
                        }
                    } }
                    recreate()
                } }.setNegativeButton("취소", null).show()
        }
        if(settings.enabled) SyncWorker.schedule(this)
        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("speech-model").observe(this) { infos ->
            modelWork = infos.firstOrNull { !it.state.isFinished }?.let {
                if(it.state == WorkInfo.State.RUNNING) "실행 중" else "네트워크 조건/Android 실행 대기"
            } ?: infos.lastOrNull()?.state?.let { when(it) {
                WorkInfo.State.FAILED -> "실패 · 아래 원인 확인"
                WorkInfo.State.CANCELLED -> "취소됨"
                else -> ""
            } } ?: ""
            updateStatus()
        }
        WorkManager.getInstance(this).getWorkInfosByTagLiveData("companion-sync").observe(this) { infos ->
            syncWork = if(infos.any { it.state == WorkInfo.State.RUNNING }) "실행 중" else if(infos.any { !it.state.isFinished }) "예약됨 · 네트워크/배터리/주기 대기" else "예약 없음"
            updateStatus()
        }
    }

    private fun downloadModel(metered: Boolean) {
        if(SpeechModel.ready(this)) { diagnostics.record("model", "이미 설치되어 있습니다. 녹음 자동 수집을 켜 주세요."); updateStatus(); return }
        WorkManager.getInstance(this).enqueueUniqueWork("speech-model", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<ModelDownloadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(if(metered) NetworkType.CONNECTED else NetworkType.UNMETERED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, java.util.concurrent.TimeUnit.SECONDS).build())
        diagnostics.record("model", if(metered) "인터넷 연결 후 다운로드 대기" else "요금 없는 Wi-Fi 대기 · 핫스팟/데이터 절약 Wi-Fi는 대기할 수 있습니다.")
    }

    private fun verifyConnection() {
        if(checkingConnection || !settings.enabled) return
        checkingConnection = true; lastCheck = System.currentTimeMillis()
        val generation = settings.generation
        val url = settings.server; val credential = settings.token
        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) { CompanionApi(url, credential).verify() }
                if(settings.enabled && settings.generation == generation) { diagnostics.verified(); diagnostics.capabilities(response) }
            } catch(e: kotlinx.coroutines.CancellationException) { throw e }
            catch(e: Exception) {
                if(settings.generation == generation) {
                    diagnostics.disconnected(if(e is HttpFailure) "연결 확인 실패 (HTTP ${e.code})" else "연결 확인 실패 · 네트워크 확인")
                    if(e is HttpFailure && e.code in listOf(401, 403)) {
                        settings.enabled = false; SyncWorker.cancel(this@MainActivity)
                        stopService(Intent(this@MainActivity, LocationService::class.java))
                    }
                }
            } finally { checkingConnection = false; updateStatus() }
        }
    }

    private fun connect() = task {
        val url = Settings.normalizeServer(server.text.toString())
        val credential = token.text.toString().trim()
        require(Regex("dcp_[A-Za-z0-9_-]{43}").matches(credential)) { "웹에서 새 연결 토큰을 발급해 붙여넣어 주세요." }
        withContext(Dispatchers.IO) { CompanionApi(url, credential).verify() }
        settings.enabled = false; SyncWorker.cancel(this); stopService(Intent(this, LocationService::class.java))
        withContext(Dispatchers.IO) { SyncGate.mutex.withLock {
            synchronized(LocalState.lock) {
                QueueStore(this@MainActivity).use { it.clear() }
                java.io.File(cacheDir, "call-input.tmp").delete()
                settings.server = url; settings.token = credential; settings.audio = false; settings.steps = false
                settings.generation = java.util.UUID.randomUUID().toString(); settings.enabled = true
                diagnostics.clear(); diagnostics.verified()
            }
        } }
        audio.isChecked = false; steps.isChecked = false
        token.text.clear(); settings.status = "연결 완료. 수집할 항목을 선택해 주세요."
        SyncWorker.schedule(this); SyncWorker.enqueue(this)
    }
    private fun requestHealth(background: Boolean) {
        if(!HealthSteps.available(this)) {
            settings.status = "Health Connect 설치/업데이트가 필요합니다."
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")))
            return
        }
        val permissions = mutableSetOf(HealthSteps.permission)
        if(background) {
            if(!HealthSteps.supportsBackground(HealthConnectClient.getOrCreate(this))) { settings.status = "이 기기는 백그라운드 걸음 수 읽기를 지원하지 않습니다."; return }
            permissions.add(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
        }
        healthPermissions.launch(permissions)
    }
    private suspend fun collectForegroundSteps() {
        withContext(Dispatchers.IO) { SyncGate.mutex.withLock { HealthSteps.collect(this@MainActivity, true) } }
    }
    private fun startLocation() {
        if(Build.VERSION.SDK_INT >= 33 && !hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            settings.status = "수집 상태와 중지 버튼을 표시하려면 알림 권한을 허용해 주세요."; return
        }
        runCatching { ContextCompat.startForegroundService(this, Intent(this, LocationService::class.java)) }
            .onFailure { settings.status = "위치 수집을 시작할 수 없습니다. 앱을 연 상태에서 권한을 확인해 주세요." }
    }
    private fun hasPermission(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    private fun task(action: suspend () -> Unit) {
        if(busy) return
        lifecycleScope.launch {
            busy = true
            try { action() }
            catch(e: kotlinx.coroutines.CancellationException) { throw e }
            catch(e: HttpFailure) { settings.status = if(e.code == 401) "토큰이 만료되었거나 올바르지 않습니다." else "서버 연결 실패 (HTTP ${e.code})" }
            catch(e: Exception) { settings.status = e.message ?: "작업에 실패했습니다. 다시 시도해 주세요." }
            finally { busy = false; updateStatus() }
        }
    }
    private fun updateStatus() {
        if(!::status.isInitialized) return
        val counts = QueueStore(this).use { "전송 대기 ${it.count()}개 · 녹음 변환 실패 ${it.failedCount()}개" }
        val connected = settings.enabled && diagnostics.fresh()
        connectionLight.text = "● " + if(connected) "서버 연결 확인됨" else if(settings.enabled) "연결 미확인 / 오프라인" else "연결 필요"
        connectionLight.setTextColor(if(connected) Color.rgb(25, 118, 235) else Color.rgb(120, 120, 120))
        if(connected && connectionLight.animation == null) connectionLight.startAnimation(android.view.animation.AlphaAnimation(1f, 0.35f).apply {
            duration = 900; repeatCount = android.view.animation.Animation.INFINITE; repeatMode = android.view.animation.Animation.REVERSE
        }) else if(!connected) connectionLight.clearAnimation()
        val verifiedAt = diagnostics.time("connection").let { if(it == 0L) "없음" else java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) }
        val folderGranted = settings.folder.isNotEmpty() && contentResolver.persistedUriPermissions.any { it.uri.toString() == settings.folder && it.isReadPermission }
        modules.text = "연결: ${diagnostics.message("connection")}\n최근 확인: $verifiedAt\n" +
            "서버 기능: ${diagnostics.message("server")}\n" +
            "한국어 모델: ${if(SpeechModel.ready(this)) "준비됨" else "설치 필요"} $modelWork\n${diagnostics.message("model", "다운로드 버튼을 눌러 주세요.")}\n" +
            "녹음 폴더: ${if(folderGranted) "읽기 권한 유지" else "선택/권한 확인 필요"}\n" +
            "전사: ${if(settings.audio) diagnostics.message("audio") else "수집 꺼짐"}\n" +
            "요약·전송: ${diagnostics.message("upload")}\n" +
            "최근 통화 요약: ${diagnostics.message("summary")}\n" +
            "걸음 수: ${if(settings.steps) settings.healthStatus else "수집 꺼짐 · ${settings.healthStatus}"}\n" +
            "위치: ${if(LocationService.active) "수집 서비스 실행 중" else "중지됨"} · ${diagnostics.message("location")}\n" +
            "자동 동기화: $syncWork"
        status.text = "${settings.status}\n$counts${if(busy) "\n처리 중…" else ""}"
        location.text = if(LocationService.active) "위치 수집 중지" else "위치 수집 시작"
    }
    private fun section(text: String) { label("\n$text", 20f, true) }
    private fun label(value: String, size: Float = 14f, bold: Boolean = false): TextView = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.rgb(40, 49, 40)); setPadding(0, 10, 0, 10)
        if(bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        this@MainActivity.layout.addView(this)
    }
    private fun button(title: String, action: () -> Unit): Button = Button(this).apply {
        text = title; isAllCaps = false; minHeight = 52
        backgroundTintList = ColorStateList.valueOf(Color.rgb(223, 231, 218)); setTextColor(Color.rgb(38, 65, 42))
        this@MainActivity.layout.addView(this, LinearLayout.LayoutParams(-1, -2).apply { setMargins(0, 4, 0, 4) })
        setOnClickListener { action() }
    }
    override fun onResume() { super.onResume(); handler.post(refresh) }
    override fun onPause() { handler.removeCallbacks(refresh); super.onPause() }
}
