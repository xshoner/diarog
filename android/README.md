# diarog Android Companion

Android 9 이상(64-bit ARM/x86)의 선택형 수집 앱입니다. 기존 전화 앱이 만든 녹음 파일 → 기기 내 한국어 STT → 서버 요약, Health Connect 걸음 수, 사용자가 시작한 위치 기록을 diarog에 연결합니다. 통화 자체를 녹음하거나 마이크·통화기록·접근성 권한을 사용하지 않습니다.

## 먼저 서버 준비

1. `supabase/migrations/0003_personal_context_agent.sql`, `0004_android_companion.sql`을 순서대로 적용합니다. 새 설치는 앞선 migration도 필요합니다.
2. 이 브랜치의 웹 서버를 배포합니다. 기존 Supabase 서비스 키, 로그인 설정, `LETSUR_API_KEY`가 필요합니다. Android 앱에는 서비스 키나 AI 키를 넣지 않습니다.
3. 배포한 웹에 로그인 → 설정 → **Android Companion** (`/companion`) → 기기 이름 입력 → 연결 토큰 발급.
4. 앱의 서버 주소를 **해당 브랜치가 배포된 HTTPS origin**으로 지정하고 토큰을 붙여넣습니다. 아직 main에 병합하지 않았다면 기존 프로덕션 주소에 새 API가 없을 수 있습니다. Vercel 인증 보호가 걸린 preview 주소는 보호를 해제하거나 별도 접근 가능한 테스트 배포가 필요합니다.

토큰은 90일 유효하고 웹에서 즉시 폐기할 수 있습니다. DB에는 SHA-256만 저장하고 발급 직후 한 번만 원문을 표시합니다. 기기 토큰은 수집 전용 API만 사용할 수 있으며, 계정/사진/기존 일기 API에는 사용할 수 없습니다.

## APK 만들기 / 설치

JDK 21(최소 17), Android SDK `platforms;android-36.1`, `build-tools;36.0.0`이 필요합니다. Android Studio에서 이 `android/` 폴더를 열거나:

```sh
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Windows에서는 `gradlew.bat`를 사용합니다. `ANDROID_HOME` 또는 커밋하지 않는 `local.properties`의 `sdk.dir`로 SDK 경로를 지정합니다. Gradle wrapper와 배포 SHA-256을 포함했습니다. CI의 `diarog-companion-debug` artifact에서도 테스트용 APK를 받을 수 있습니다. 디버그 APK는 개발 서명이므로 스토어 배포용이 아닙니다. 배포 시 본인의 release signing key를 적용해야 합니다. 키/비밀번호는 저장소에 넣지 마세요.

## 휴대폰에서 설정

1. 앱에서 서버 주소·기기 토큰 입력 → **연결 확인 및 저장**.
2. **한국어 모델 다운로드**. Wi-Fi 등 비과금 연결에서 약 82MB를 다운로드하고 압축을 해제합니다. 수백 MB의 여유 공간이 필요합니다. 모델은 앱 내부에 보관하며 재시작 후에도 유지됩니다.
3. **통화녹음 폴더 선택**에서 전화 앱의 녹음 폴더를 지정합니다. 새 녹음만 가져오는 것이 기본이며, **과거 녹음도 가져오기**를 선택할 수 있습니다. 이후 **녹음 자동 수집**을 켜고 전사문 전송에 동의합니다.
4. 필요하면 **걸음 수 수집**을 켜고 Health Connect 읽기 권한을 허용합니다. 백그라운드 읽기는 지원 여부를 확인한 뒤 별도 버튼으로 허용합니다. 미지원/미허용 상태에서도 앱을 열고 **지금 동기화**하면 읽을 수 있습니다.
5. **위치 수집 시작**을 누르고 위치·알림 권한을 허용합니다. 앱/알림의 중지 버튼으로 즉시 중지할 수 있습니다. 재부팅이나 서비스 종료 후에는 다시 시작해야 합니다.
6. 웹 `/companion`에서 최근 수집 결과를 확인합니다. 원하는 날짜의 **일기 생성**을 누르면 사진 없는 날도 일기를 만들 수 있습니다. 기존 일기 교체는 웹에서 확인한 경우에만 실행합니다. 동기화 자체가 일기를 덮어쓰지는 않습니다.

## 수집과 재시도

- **녹음**: SAF의 영구 읽기 권한으로 선택한 폴더/하위 폴더만 읽습니다. MP3/M4A/WAV/AMR/AAC/OGG/3GP/MP4 중 기기의 MediaCodec이 디코딩하는 형식을 지원합니다. 수정 후 2분 이상 지난 파일만 처리하고, 복사 중 파일이 바뀌면 재시도합니다. 1개당 1시간/250MB 이하, 탐색 5,000개/깊이 8까지입니다. 작은 녹음 전용 폴더를 권장합니다.
- **STT**: Vosk 0.3.75와 `vosk-model-small-ko-0.22`를 사용합니다. PCM16 mono로 변환하며 모델의 up/downsampling으로 8kHz 통화 파일도 처리합니다. STT는 최대 약 3.5분의 실행 예산을 가지므로 긴 녹음은 기기 성능에 따라 실패할 수 있습니다. 한 작업에서 1개 녹음만 처리합니다. 화자 분리/상대방 전화번호 자동 조회는 없습니다.
- **발생 시각**: Samsung형 `YYMMDD_HHMMSS`/`YYYYMMDD_HHMMSS` 파일명의 시각을 기기 시간대로 읽습니다. 없으면 `파일 수정 시각 - 녹음 길이`를 사용하고 불확실한 출처로 표시합니다. 수정 시각이 없는 provider 파일은 건너뜁니다. 복사된 파일은 날짜 확인이 필요합니다.
- **걸음 수**: Health Connect `COUNT_TOTAL` aggregate로 출처 중복을 피합니다. 지연 반영을 위해 한국 시간 기준 오늘과 이전 2일을 다시 읽습니다. `steps:날짜` ID를 덮어써 합계 중복 누적을 막습니다. 3일보다 오래된 데이터의 자동 소급 수집은 하지 않습니다.
- **위치**: 사용자 시작형 foreground service로 알림을 표시합니다. GPS/network provider에 5분·200m 기준을 요청하고, 5분보다 잦은 기록이나 2km보다 부정확한 위치는 저장하지 않습니다. 실제 간격은 OS/기기/provider에 따라 달라집니다. 현재는 좌표 샘플을 보내며 체류 장소 자동 압축은 후속 과제입니다.
- **동기화**: WorkManager가 네트워크 연결·배터리 부족 아님 조건에서 약 15분 주기로 실행합니다. 즉시 감시가 아니며 절전·강제 종료·제조사 제한으로 늦어질 수 있습니다. STT를 끝낸 전사문은 실행 예산에 따라 다음 동기화에서 전송될 수 있습니다.
- **내구성**: SQLite outbox의 본문은 Android Keystore AES-GCM으로 암호화합니다. 성공 응답 후에만 삭제하며, 갱신된 걸음 수를 이전 요청의 응답이 지우지 않도록 행 ID로 확인합니다. 파일 내용 SHA-256, 기기 ID, source별 external ID로 서버에서도 중복을 방지합니다.
- **실패**: 네트워크/서버/429는 최대 6시간까지 지수 지연, 기타 HTTP 4xx는 하루 뒤 다시 시도합니다. 실패 기록은 남기며 **지금 동기화 / 실패 기록 재시도**로 재시도할 수 있습니다. 인증 만료·폐기는 수집/위치를 중지하고 재연결을 요구합니다. 녹음 변환 실패는 다음 파일 처리를 막지 않습니다. 대기열은 최대 10,000개입니다.

## 데이터 경계

- 녹음 원본은 업로드하지 않습니다. 기기 내 디코딩용 사본은 앱 private cache에 일시적으로 생기며 작업 종료 때 삭제합니다. 프로세스가 강제 종료되면 다음 녹음 수집/연결 해제 때 정리됩니다.
- 전사문은 **연결한 diarog 서버와 Letsur AI**에 요약을 위해 전달됩니다. diarog DB/애플리케이션 로그에는 원문을 저장하지 않고 요약·명시된 사람·주제·약속·할 일만 저장합니다. 전사·요약의 오류 가능성을 표시하며 사용자가 웹에서 확인/삭제할 수 있습니다. 제공자 자체의 보관 정책은 별도로 확인해야 합니다.
- 모든 수집 기능은 기본 꺼짐이고 권한/동의를 분리했습니다. 음성/걸음 수를 끄면 해당 대기 데이터를 지웁니다. 위치 중지는 새 수집만 중지하며 기존 대기 데이터는 동기화됩니다. 이미 진행 중인 네트워크 요청은 완료될 수 있습니다.
- 재연결은 수집을 끄고 기존 대기 데이터를 삭제합니다. 다른 토큰/서버로 이전 계정의 대기 데이터를 보내지 않습니다. 위치 이벤트도 연결 세대를 확인합니다.
- 앱 연결 해제는 로컬 토큰·대기 데이터·처리 이력을 삭제합니다. 서버 토큰 폐기는 웹에서 수행합니다. 기기 토큰 폐기는 기존 서버 데이터를 삭제하지 않습니다. 계정 삭제 시 FK cascade로 기기/수집 데이터도 삭제됩니다.
- 이미 생성된 일기·장기기억에서 파생 내용을 없애는 것은 별도 작업입니다. signal 삭제가 모든 파생 데이터를 지우는 기능은 아닙니다.
- Android 백업/기기 간 전송을 제외하며, HTTP·리다이렉트를 통한 토큰 전달을 허용하지 않습니다. 토큰/음성/전사문을 분석 로그에 기록하지 않습니다.

## 서버 API

| Endpoint | 인증 | 역할 |
|---|---|---|
| `GET/POST/DELETE /api/companion/devices` | 웹 세션 | 기기 목록, 토큰 발급, 폐기 |
| `GET /api/companion/signals` | 기기 Bearer | 연결/폐기/만료 확인 |
| `POST /api/companion/signals` | 기기 Bearer | steps/location 묶음 수집 |
| `POST /api/companion/transcripts` | 기기 Bearer | 로컬 STT 전사문 → AI 요약 → audio signal |
| `GET/POST/DELETE /api/signals` | 웹 세션 | 본인의 기록 조회/추가/삭제 |

기기 사용자는 요청 body로 선택하지 않습니다. 서버에서 검증한 기기의 소유자로 고정하고 `companion:기기ID:externalId`로 범위를 나눕니다. 200개/256KB 이내의 배치만 허용합니다. 잘못된 항목은 전체 요청을 거절하고, DB 실패를 성공으로 응답하지 않습니다. 일반 계정 쿠키는 앱에서 다루지 않습니다.

## 검증

```sh
npm ci
npm run test:companion
npm run lint
npm run build
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

서버 테스트는 로컬 HTTP fixture로 인증·만료·폐기·사용자 격리·저장 실패·중복·전사문 비보관을 검사하며 실제 개인정보/AI 비용을 사용하지 않습니다. Android 테스트는 PCM 변환·날짜 파싱·HTTPS 주소 검증, Robolectric의 첫 실행 및 SQLite 재시도/복구를 검사합니다. 실기기 검증을 대체하지 않습니다.

실기기 확인 항목: 삼성 녹음 폴더 SAF 접근 유지/재부팅, MP3/M4A 및 8k/16k/48k·mono/stereo 전사, 한국어 고유명사 정확도, 오프라인 후 재전송, 토큰 폐기/계정 전환, Health Connect 설치 유무/권한 거부/백그라운드 지원, Android 14+ 위치 시작/중지·대략적 권한·알림, 16KB page-size 기기, 절전/앱 강제종료. Play 배포 전에는 Health Connect 용도/데이터 안전성/foreground service 선언과 release 서명을 완료해야 합니다.

## 참고와 라이선스

- [Health Connect 시작하기](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [걸음 수 집계](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)
- [foreground service 시작 제한](https://developer.android.com/develop/background-work/services/fgs/launch)
- [Vosk Android demo](https://github.com/alphacep/vosk-android-demo), [한국어 모델/모델 라이선스](https://alphacephei.com/vosk/models)
- Vosk 및 한국어 small 모델: Apache-2.0. JNA: Apache-2.0 또는 LGPL-2.1-or-later의 dual license (이 앱은 Apache-2.0 선택). AndroidX/OkHttp: Apache-2.0. 앱의 **오픈소스 라이선스** 화면에 고지와 Apache-2.0 전문을 포함합니다.
