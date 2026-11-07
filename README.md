# 하마 문서뷰어 (Android)

HWP·HWPX·Word·Excel·PowerPoint·PDF 문서를 **파일을 눌러서 바로 여는** 안드로이드 뷰어입니다.
모든 처리는 기기 안에서 오프라인으로 이루어지며, 문서 내용이 외부로 전송되지 않습니다.

## 설치

`dist/HamaDocViewer-1.0.apk` 를 휴대폰에 복사해 설치하거나, USB 디버깅이 켜진 상태에서:

```bash
adb install -r dist/HamaDocViewer-1.0.apk
```

설치 후 파일 관리자(내 파일)·카카오톡·메일에서 문서를 누르고 **하마 문서뷰어 → 항상**을 고르면,
다음부터는 탭 한 번으로 열립니다. 앱을 직접 실행해 [파일 열기]로 불러올 수도 있습니다.

## 지원 형식

| 형식 | 방식 | 표시 수준 |
|---|---|---|
| HWPX | 자체 렌더러 (`hwpx.js`) | 글자·문단 모양, 표(셀 병합·테두리), 그림, 한글 쪽 나눔 재현 |
| HWP 5.0 | hwp.js (버그 패치) → 실패 시 텍스트 추출 | 쪽·표·그림 / 대체 시 본문 텍스트 |
| DOCX | docx-preview | 페이지·서식·표·그림 |
| XLSX·XLS·ODS·CSV | SheetJS | 시트 탭, 셀 병합, 열 너비 (최대 5000행×200열) |
| PPTX | pptx-preview | 슬라이드 렌더링 |
| DOC · PPT (97-2003) | 자체 파서 (`legacy.js`) | 본문/슬라이드 텍스트만 |
| PDF | pdf.js (한글 CMap 포함) | 원본 그대로 |
| ODT·ODP·RTF·TXT | 자체 파서 | 텍스트 |

미지원: HWP 3.0 이하, 배포용(열람 제한) HWP, 암호 걸린 문서 → 안내 메시지와 [다른 앱으로 열기] 제공.

## 구조

```
app/src/main/java/com/hama/docviewer/MainActivity.kt  # 인텐트 수신, WebView, 파일 스트리밍
app/src/main/AndroidManifest.xml                      # 파일 형식별 intent-filter (탭해서 열기)
app/src/main/assets/web/                              # 뷰어 화면 (HTML/JS)
  ├─ app.js      형식 판별(확장자 + 파일 시그니처), 렌더러 선택, 확대/축소, 최근 문서
  ├─ hwpx.js     HWPX 렌더러
  ├─ legacy.js   HWP/DOC/PPT/RTF/ODF 텍스트 추출
  └─ lib/        번들된 라이브러리 (webdeps 에서 생성)
webdeps/                                              # JS 라이브러리 번들 스크립트
```

문서는 `https://appassets.androidplatform.net/doc/...` 가상 경로로 WebView에 스트리밍됩니다
(`WebViewAssetLoader`). 인터넷 권한이 없는 앱입니다.

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
