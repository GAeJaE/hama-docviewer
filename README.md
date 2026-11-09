# 하마 문서뷰어 (Android)

HWP·HWPX·Word·Excel·PowerPoint·PDF 문서를 **파일을 눌러서 바로 여는** 안드로이드 뷰어입니다.
문서는 기기 안에서만 처리되며 외부로 전송되지 않습니다. (인터넷은 업데이트 확인·다운로드에만 사용)

## 설치

`dist/HamaDocViewer-1.4.apk` 를 휴대폰에 복사해 설치하거나, USB 디버깅이 켜진 상태에서:

```bash
adb install -r dist/HamaDocViewer-1.4.apk
```

설치 후 파일 관리자(내 파일)·카카오톡·메일에서 문서를 누르고 **하마 문서뷰어 → 항상**을 고르면,
다음부터는 탭 한 번으로 열립니다. 앱을 직접 실행해 [파일 열기]로 불러올 수도 있습니다.

## 찾기 · 쪽 이동 · 인쇄 (v1.4+)

- **문서 안 검색** (🔍): 모든 문서 형식에서 단어를 찾아 노란색으로 표시하고, ∧ ∨ 버튼이나 Enter로 다음 결과로 이동합니다.
  PDF는 글자 레이어를 만들어 정확한 위치에 표시합니다. 엑셀은 현재 시트에서 찾습니다.
- **PDF 글자 선택·복사**: PDF 글자를 길게 누르면 선택되어 복사·공유할 수 있습니다.
- **쪽 표시·이동**: 오른쪽 아래 「3 / 14」를 누르면 쪽 번호로 이동(처음/끝 버튼 포함).
- **이어 보기**: 문서마다 마지막으로 보던 위치를 기억해 다시 열면 그곳부터 보여 줍니다.
- **인쇄 / PDF로 저장** (⋮ 메뉴): 한글·워드·엑셀 등 모든 문서를 안드로이드 인쇄 화면으로 보냅니다.
  프린터를 고르면 인쇄, 「PDF로 저장」을 고르면 PDF 파일로 바뀝니다(기본 용지 A4).
  PDF는 원본 그대로(필기가 있으면 필기 포함본) 인쇄됩니다.

## PDF 필기 (v1.3+)

PDF를 열고 상단 ✏️ 버튼을 누르면 필기 모드가 됩니다. 태블릿 + 스타일러스(S펜 등)에 맞춰 만들었습니다.

- 도구: 펜 · 형광펜 · 지우개(획 단위), 색상 5가지, 굵기 3단계, 되돌리기/다시 실행, 모두 지우기
- **손바닥 오인식 방지**: 스타일러스가 감지되면 자동으로 '펜으로만 필기' 모드 → 펜은 필기, 손가락은 스크롤
  (스타일러스가 없으면 손가락으로 필기, 두 손가락으로 스크롤/확대) — 「☝ 손가락」 버튼으로 전환
- **자동 저장**: 필기는 문서(파일 이름+크기)별로 앱 내부에 저장되어 다시 열면 그대로 보입니다. 원본 PDF는 수정하지 않습니다.
- **PDF 저장 / 공유**: 필기를 벡터 선으로 넣은 새 PDF(`원본이름_필기.pdf`)를 원하는 위치에 저장하거나 공유합니다.

## 자동 업데이트 (v1.2+)

- 앱을 열면 12시간에 한 번 GitHub 최신 릴리스(`GAeJaE/hama-docviewer`)를 확인합니다.
- 새 버전이 있으면 홈 화면에서 안내 창이 뜨고, [업데이트]를 누르면 앱 안에서 APK를 내려받아 설치 화면을 엽니다.
  처음 한 번은 Android가 「이 출처 허용」 설정을 요구합니다.
- 문서를 보는 중에는 방해하지 않고 ⋮ 메뉴에 빨간 점과 「업데이트 (vX.Y)」만 표시합니다.
- 홈 화면 아래 「업데이트 확인」이나 ⋮ 메뉴에서 직접 확인할 수도 있습니다.

### 새 버전 배포 방법
1. `app/build.gradle.kts` 의 `versionCode` 를 올리고 `versionName` 을 바꿉니다 (예: 1.3).
2. `./gradlew assembleDebug` 로 빌드합니다. 같은 PC의 디버그 키로 서명해야 기존 앱 위에 덮어 설치됩니다.
3. 태그 `v<versionName>` 으로 GitHub 릴리스를 만들고 APK를 첨부합니다:
   `gh release create v1.3 dist/HamaDocViewer-1.4.apk --title "하마 문서뷰어 v1.3" --notes "변경 내용"`

## 지원 형식

| 형식 | 방식 | 표시 수준 |
|---|---|---|
| HWPX | 자체 렌더러 (`hwpx.js`) | 글자·문단 모양, 표(셀 병합·테두리), 그림, 한글 쪽 나눔 재현 |
| HWP 5.0 | hwp.js (버그 패치) → 실패 시 텍스트 추출 | 쪽·표·그림 / 대체 시 본문 텍스트 |
| DOCX | docx-preview | 페이지·서식·표·그림 |
| XLSX·XLS·ODS·CSV | SheetJS | 시트 탭, 셀 병합, 열 너비 (최대 5000행×200열) |
| PPTX | pptx-preview | 슬라이드 렌더링 |
| DOC · PPT (97-2003) | 자체 파서 (`legacy.js`) | 본문/슬라이드 텍스트만 |
| PDF | pdf.js legacy 빌드 (한글 CMap 포함, 구형 WebView 호환) | 원본 그대로 |
| ODT·ODP·RTF·TXT | 자체 파서 | 텍스트 |
| Markdown (MD) | marked + DOMPurify | 제목·표·코드 블록·인용 등 서식 렌더링 |
| HTML | 샌드박스 iframe | 미리보기(스크립트 차단) / 소스 보기 |
| JSON · 코드 · 설정 · 자막 | 내장 | 보기 좋게 정렬 / 고정폭 텍스트 (EUC-KR 자동 인식) |
| 이미지 (JPG·PNG·GIF·WEBP·SVG 등) | WebView | 확대/축소 가능 |
| 동영상·음악 (MP4·WEBM·MKV·MP3·M4A·WAV·FLAC 등) | WebView 플레이어 | Range 스트리밍으로 탐색 가능 |
| ZIP | JSZip | 목록 표시, 항목을 눌러 바로 열기 |
| EPUB | 자체 파서 | 장별 본문·그림 |
| 그 밖의 모든 파일 | 내장 | 텍스트로 보이면 텍스트, 아니면 16진수 보기 |

미지원: HWP 3.0 이하, 배포용(열람 제한) HWP, 암호 걸린 문서 → 안내 메시지와 [다른 앱으로 열기] 제공.

## 구조

```
app/src/main/java/com/hama/docviewer/MainActivity.kt  # 인텐트 수신, WebView, 파일 스트리밍
app/src/main/java/com/hama/docviewer/Updater.kt       # GitHub 릴리스 확인, APK 다운로드·설치
app/src/main/AndroidManifest.xml                      # 파일 형식별 intent-filter (탭해서 열기)
app/src/main/assets/web/                              # 뷰어 화면 (HTML/JS)
  ├─ nav.js      문서 안 검색, 쪽 표시·이동, 마지막 위치 기억
  ├─ pdfnote.js  PDF 필기 레이어 (펜/형광펜/지우개, 자동 저장, pdf-lib 내보내기)
  ├─ app.js      형식 판별(확장자 + 파일 시그니처), 렌더러 선택, 확대/축소, 최근 문서
  ├─ hwpx.js     HWPX 렌더러
  ├─ legacy.js   HWP/DOC/PPT/RTF/ODF 텍스트 추출
  └─ lib/        번들된 라이브러리 (webdeps 에서 생성)
webdeps/                                              # JS 라이브러리 번들 스크립트
```

문서는 `https://appassets.androidplatform.net/doc/...` 가상 경로로 WebView에 스트리밍됩니다
(`WebViewAssetLoader`). 외부 통신은 `Updater.kt`(GitHub 릴리스 조회·APK 다운로드)뿐입니다.

## 빌드

필요: JDK 17, Android SDK 36, Node.js (라이브러리를 다시 묶을 때만)

```bash
# (선택) JS 라이브러리 다시 번들
cd webdeps && npm install && node build.mjs && cd ..

# APK 빌드
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # 개인용: 디버그 키로 서명됨 (스토어 배포 시 서명 키 교체)
```

## 테스트한 내용

- 브라우저(모바일 크기)에서 HWP·HWPX·DOCX·DOC·XLSX·XLS·PPTX·PPT·PDF 샘플 렌더링
- Android 14 에뮬레이터에서 파일 앱으로 문서를 눌러 바로 열기 (HWPX·HWP·XLSX·PPT), 뒤로 가기 시 파일 앱 복귀
