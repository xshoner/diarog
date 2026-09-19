# diarog Personal Context Agent — 개발 방향

> Android Companion의 구현/설치/현재 제한은 [android/README.md](../android/README.md)를 참고한다. 아래 후속 설계 중 통화녹음 폴더 수집·기기 내 STT·Health Connect 집계·사용자 시작형 위치 수집을 구현했다. 실제 앱은 원본 음성을 업로드하지 않고 전사문을 서버에서 요약하며, 위치는 현재 좌표 샘플 방식이다. Gmail·체류 위치 압축·Memory Center는 후속 작업이다.

## 제품 정의
diarog를 "일기를 쓰는 앱"이 아니라, 사용자의 하루에서 증거를 자동 수집하고 장기 기억을 축적해 시간이 지날수록 사용자를 더 잘 이해하는 프라이빗 Personal Context Agent로 확장한다.

## 이미 반영한 v1
- 과거 사진도 촬영일 기준으로 Moment를 재조립한다.
- EXIF 위치가 없는 사진도 업로드 시점의 기기 위치를 폴백으로 기록한다. 위치 출처는 device로 구분한다.
- 홈 일기는 좌우 스와이프로 날짜를 이동한다.
- 주간 회고 카드에 대표 Moment의 썸네일을 노출한다.
- personal_memories를 도입해 preference/routine/relationship/goal/fact/pattern을 장기 기억으로 축적한다.
- 일기 생성 시 최근 장기 기억을 참고하되, 기억만으로 사건을 새로 만들지 못하도록 제한한다.
- life_signals 공통 수집 API를 추가해 audio/email/steps/location/device 등의 외부 데이터를 같은 모델로 받을 수 있게 한다.

## 통화 녹음
PWA가 Android의 임의 로컬 폴더를 백그라운드에서 지속 감시하는 구조는 신뢰성이 부족하다. 브라우저의 showDirectoryPicker는 사용자 동작이 필요하고 지원 범위도 제한적이다.

권장 구조:
1. Android Companion 앱을 둔다.
2. 사용자가 최초 1회 통화녹음 폴더를 Storage Access Framework로 선택한다.
3. WorkManager가 신규 MP3/M4A 파일을 감지한다.
4. 파일 해시로 중복을 제거한다.
5. STT 후 원문 전체 저장을 기본값으로 하지 않고 요약/화자/핵심 약속/할 일만 /api/signals에 보낸다.
6. 원본 음성은 기기에 유지하고, 사용자가 선택할 때만 서버 업로드한다.

STT:
- 1차: 서버 STT API를 설정 가능 provider로 추상화.
- 2차: 개인정보 우선 모드에서는 Android 온디바이스 또는 사용자가 선택한 STT provider 지원.
- diarog에는 transcript 전체보다 summary, action items, named entities, timestamp를 우선 저장한다.

## Gmail
메일 본문을 읽으려면 gmail.readonly 범위가 필요하다. 이 범위는 Restricted Scope이므로 공개 서비스 배포 전 Google OAuth 검증 및 데이터 처리 방식에 따라 추가 보안 검토가 필요하다.

권장 순서:
1. 초기에는 Gmail metadata/snippet 중심의 베타.
2. 사용자가 명시적으로 "메일 내용 분석"을 켠 경우에만 gmail.readonly 요청.
3. 최근 N일의 메일만 동기화하고, 뉴스레터/자동알림/광고를 필터링한다.
4. AI에는 전체 메일함이 아니라 해당 메시지의 최소 본문만 전달한다.
5. life_signals(source=email)에는 제목, 상대방, 요약, 약속/할 일, 중요도만 저장한다.
6. 장기 기억에는 반복 협업자, 프로젝트, 관심 주제만 반영하고 민감 정보는 제외한다.

## 걸음 수
Android Health Connect를 사용한다.
- READ_STEPS 권한
- 필요 시 READ_HEALTH_DATA_IN_BACKGROUND
- WorkManager로 일 단위 집계
- /api/signals source=steps 로 {steps, activeMinutes, distance?} 전송
- 의료정보가 아니라 생활패턴 문맥으로 사용하며, 진단/건강평가에는 사용하지 않는다.

## 위치
현재 사진 단위 GPS 외에 별도 위치 타임라인을 추가한다.
- Android Companion에서 Significant Location 방식으로 배터리 소모를 줄인다.
- 5~15분 샘플이 아니라 "머문 장소 / 이동 구간"으로 압축한다.
- 서버에는 원시 GPS 전체 대신 place stay를 기본 저장한다.
- 예: 09:10~11:40 사무실, 12:00~13:05 식당.
- 사용자는 특정 장소를 private/no-memory로 지정할 수 있어야 한다.

## 추가 데이터 소스
우선순위:
1. 사진/영상 메타데이터
2. Calendar
3. Gmail
4. 통화 녹음/STT
5. Health Connect 걸음 수
6. 위치 stay
7. 브라우저에서 공유한 링크/문서
8. 영수증/결제 알림에서 추출한 소비 이벤트
9. 날씨
10. 사용자가 직접 남긴 짧은 메모/음성 메모

모든 데이터는 life_signals로 정규화한 뒤 Moment와 장기 기억에 연결한다.

## 다음 단계 UX
- 홈 상단에 "오늘 AI가 이해한 나" 카드: 오늘의 에너지/집중이 아니라 관찰 가능한 패턴만 표시.
- "왜 이렇게 기억했지?" 버튼: 각 장기 기억의 근거 날짜를 보여준다.
- Memory Center: 기억 보기/수정/삭제/고정/잊기.
- People Graph: 자주 등장한 사람과 최근 상호작용 흐름.
- Promise Tracker: 통화/메일에서 나온 약속과 미완료 할 일을 다음 날 다시 상기.
- Life Pattern: "화요일 오후엔 외부 미팅이 많음" 같은 반복 패턴.
- Serendipity Recall: "1년 전 오늘", "이 장소에서 예전에 있었던 일".
- Weekly Movie: 주간 대표 사진 5~7장 + 한 줄 회고를 자동 슬라이드로 구성.
- Counterfactual Review: 계획한 일과 실제로 한 일을 비교하되 평가하거나 훈계하지 않는다.

## 프라이버시 원칙 확장
- 최소 수집, 최소 전송, 목적별 동의.
- 원본 음성/메일 본문은 가능한 한 단기 처리 후 요약만 보관.
- source별 연결 해제와 파생 기억 삭제.
- 개인 기억은 사용자가 직접 보고 수정할 수 있어야 한다.
- 민감정보 자동 장기기억 금지.
