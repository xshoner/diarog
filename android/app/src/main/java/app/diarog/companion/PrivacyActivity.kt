package app.diarog.companion

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

class PrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(ScrollView(this).apply { addView(TextView(this@PrivacyActivity).apply {
            textSize = 17f; setPadding(32, 64, 32, 32)
            text = "diarog Companion · 데이터 사용 안내\n\n" +
                "모든 수집 기능은 기본 꺼짐입니다. 원하는 항목만 직접 켜세요.\n\n" +
                "통화 녹음: 사용자가 지정한 폴더의 기존 파일만 읽습니다. 직접 통화를 녹음하지 않습니다. 원본은 기기에 남기며 Vosk로 기기 내 전사합니다. 전사문은 연결한 diarog 서버와 Letsur AI에 보내 요약합니다. diarog DB에는 요약·주제·사람·약속·할 일만 저장합니다. 본인에게 처리 권한이 있는 녹음만 선택하세요.\n\n" +
                "걸음 수: Health Connect에서 최근 3일의 일별 합계만 읽습니다. 한국 시간 기준 개인 일기 생성에 사용하며 광고나 판매에 사용하지 않습니다. 백그라운드 읽기는 지원 기기에서 별도로 허용한 경우만 작동합니다.\n\n" +
                "위치: 시작 버튼을 누른 뒤 수집 알림이 표시되는 동안에만 위치·시각·정확도를 기록합니다. 앱/알림에서 중지할 수 있습니다. 대략적 위치 권한도 지원합니다.\n\n" +
                "연결 토큰과 전송 대기 본문은 Android Keystore 키로 암호화합니다. 원격 서버에는 HTTPS로 보냅니다. 전송 성공 후 대기 본문은 삭제합니다. 연결 해제 시 기기의 대기 데이터와 처리 이력을 삭제합니다. 이미 서버에 저장한 기록은 웹의 Companion 화면에서 삭제하거나 계정을 삭제할 수 있습니다. 이미 만들어진 일기·장기기억은 별도로 남을 수 있습니다.\n\n" +
                "한국어 모델은 사용자가 다운로드를 누르면 alphacephei.com에서 받습니다(약 82MB, Apache-2.0). Vosk/JNA의 오픈소스 라이선스는 저장소 안내를 참고하세요.\n\nhttps://diarog.vercel.app/privacy"
        }) })
    }
}
