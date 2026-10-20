# md2chat — Markdown을 채팅에 맞게

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: ko; source-sha256: f9bf7ac13d2bff3b856579f2a096a2455518b890f1b2c70cfee24041b9349d15 -->

AI 도구나 직접 작성한 문서의 Markdown을 채팅용 텍스트와 이미지로 변환합니다. 일반 텍스트는 편집 가능한 상태로 유지하고 표, 코드, 수식과 Mermaid 다이어그램은 원래 순서대로 이미지로 만듭니다. 작업 목록에는 ✅ / ⬜를 사용합니다. AI 도구 이름은 가능한 입력 출처이며 공식 연동이나 호환성 검증을 뜻하지 않습니다.

[웹사이트](https://forgeturl.github.io/md2chat/ko/) · [웹 편집기](https://forgeturl.github.io/md2chat/editor.html?lang=ko) · [최신 버전](https://github.com/forgeturl/md2chat/releases/latest) · [호환성 검증 기록](../compatibility.md)

![데스크톱 미리보기](../desktop-preview.png)

## 다운로드

- [macOS 공용 DMG — Apple Silicon 및 Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Windows x64 설치 파일 — Intel 및 AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [SHA256 체크섬](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

링크는 항상 최신 버전을 가리킵니다. Mac 일반 설치에는 DMG를 사용하며 `.app.tar.gz`는 앱 내 업데이트용입니다. Windows ARM 네이티브 패키지는 없습니다. 데스크톱은 Tauri 2, Rust와 시스템 WebView를 사용하며 Electron이나 Node.js를 포함하지 않습니다. Windows에 WebView2가 없으면 설치 프로그램이 내려받습니다. 공식 Mac 배포에는 Developer ID 서명과 공증이 필요하며 Windows Authenticode 서명은 아직 없습니다. 이전 Electron 설치는 자동으로 이전되지 않습니다.

## 사용 방법

왼쪽에 Markdown, 텍스트나 이미지를 붙여넣고 미리보기를 확인한 뒤 대상을 선택하여 해당 앱에 붙여넣습니다. 지우면 빈 문서를 시작합니다. 웹에서는 DingTalk와 Feishu 복사를 사용할 수 없으므로 데스크톱 앱을 사용하세요.

- **WeChat:** 표준 텍스트와 이미지입니다. 이미지가 모두 유지되는지 확인하세요.
- **DingTalk:** Mac은 전용 텍스트·이미지 형식, Windows는 HTML과 일반 텍스트 대체 형식을 사용합니다. 과거 Mac 테스트는 현재 모든 버전을 보장하지 않으며 Windows는 실제 앱 검증이 필요합니다.
- **Feishu/Lark:** Mac에서 서식 입력창을 먼저 펼치세요. Mac의 혼합 텍스트·이미지와 전송은 검증했지만 Windows는 실험적 지원입니다.
- **WeCom:** Mac과 Windows는 텍스트와 이미지를 함께 붙여넣고 웹은 순서대로 나눠 붙여넣습니다. Windows 5.0.12.6018 형식 테스트에서 이미지 2개, 중국어와 번호는 유지됐지만 굵게, 글자 크기와 색상은 제거됐습니다. 파일 전송 도우미로 전송한 결과도 확인했습니다. 새 Windows 빌드는 검증이 필요합니다.
- **이메일:** HTML 표를 편집할 수 있으며 복잡한 내용은 이미지가 됩니다. 실험적 지원이므로 붙여넣기와 전송 후 이미지를 확인하세요.

데스크톱에서는 문서 전체를 흰 배경 PNG 한 장으로 만들 수도 있습니다. 이미지 속 글자는 편집할 수 없습니다. 긴 내용은 축소되거나 이미지 제한으로 거부될 수 있습니다. 변환 중 클립보드가 바뀌면 새 내용을 유지하고 재시도를 안내합니다. 검증을 거친 로컬 절대 경로와 `file:///` 이미지를 지원합니다. PNG, JPEG, GIF, WebP, BMP는 이미지당 최대 10 MB와 2천만 픽셀입니다. 웹에서는 이미지를 직접 붙여넣으세요. 메시지는 자동으로 전송하지 않습니다.

## 트레이와 단축키

Mac 메뉴 막대나 Windows 트레이에서 편집기 내용을 바꾸지 않고 클립보드를 변환하고 창, 환경설정, 업데이트 확인이나 완전 종료를 사용할 수 있습니다. 창을 닫아도 프로세스와 입력은 메모리에 남습니다. 환경설정에서 형식을 고정·정렬하고 로그인 시 실행과 전역 변환 단축키를 설정할 수 있습니다. 자동 실행과 단축키는 직접 활성화해야 합니다. Mac은 응용 프로그램 폴더에 설치해야 하며 Windows 트레이와 자동 실행은 실제 기기 검증이 남아 있습니다.

## 언어와 업데이트

화면, 기본 예제, 웹사이트, README와 업데이트 요약은 9개 언어를 지원합니다. 지구본 메뉴에 각 언어의 원래 이름이 표시됩니다. 수정하지 않은 예제만 언어를 따라 바뀝니다. 편집, 붙여넣기, 드롭이나 지우기 후에는 실행 취소를 해도 사용자 내용을 유지합니다.

업데이트 요약은 설치 버전 이후부터 대상 버전까지 공개된 버전을 보여줍니다. 최근 3개가 먼저 표시되고 이전 버전을 펼칠 수 있으며 중요한 안내는 항상 표시됩니다. 기술 상세 기록은 원래 언어를 유지합니다. 시작 후와 6시간마다 업데이트를 확인하며 다운로드와 재시작은 사용자 동작이 필요합니다. 설치 전 내용을 저장하세요. 이전 앱은 새 화면이 포함된 버전을 설치한 뒤 새 기능을 사용합니다. 실제 버전 간 설치는 서명된 패키지로 검증해야 합니다.

## 개인정보와 진단

계정이 필요 없고 내용을 md2chat 서비스로 올리지 않습니다. 변환은 로컬에서 실행합니다. 원격 이미지는 원래 서버에 접속하고 데스크톱은 이후 붙여넣기를 위해 이미지를 로컬에 저장할 수 있습니다. 입력은 영구 저장하지 않으므로 완전히 종료하거나 새로고침하면 사라집니다.

클립보드 진단은 요청할 때만 읽습니다. 내보낸 ZIP에는 원문, 이미지, 링크와 전용 형식 등 원본 데이터가 포함되므로 공유 전에 확인하세요. 진단 창을 닫으면 샘플을 지우며 자동 업로드는 없습니다. 이슈 링크로 GitHub를 열어 ZIP을 직접 첨부합니다. 업데이트 요청에 문서 내용은 포함되지 않습니다.

## 개발

Node.js 22.12+와 Rust 1.90+가 필요합니다. Mac은 Xcode Command Line Tools, Windows는 Visual Studio C++ 도구와 WebView2가 필요하며 각 OS에서 해당 패키지를 빌드합니다. 공식 Mac DMG에는 Python 3.10+와 `scripts/dmgbuild-requirements.txt`의 해시 고정 의존성도 필요합니다.

```sh
npm ci
npm run dev
npm run desktop
npm run check
npm run build
npm run desktop:test
npm run desktop:test:render
npm run desktop:test:native
npm run desktop:test:windows
npm run desktop:dist:mac
npm run desktop:dist:win
```

네이티브 테스트는 시스템 클립보드를 잠시 바꾼 뒤 복원하므로 사용하지 않을 때 실행하세요. 웹·형식 테스트는 실제 채팅 앱 검증을 대신하지 않습니다. 제한된 데스크톱 명령은 번들 로컬 화면만 호출할 수 있으며 WebView는 Node.js를 노출하지 않습니다.

## 기여와 배포

사용자에게 보이는 변경은 [다국어 유지보수 규칙](../localization.md)에 따라 9개 언어를 동기화하세요. 공개 페이지나 리소스 변경 후 `npm run seo:generate`, 커밋 전 `npm run check`를 실행합니다. 언어별 웹 소스는 `site/locales/`에 모으고 기존 공개 URL은 유지합니다. 이 폴더에는 README 번역 8개가 있으며 루트는 중국어입니다. 기술 기록은 원래 언어일 수 있습니다.

상세 설명과 9개 언어 요약을 준비합니다.

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

파일과 검사를 확인한 뒤 `npm run release:verify -- --tag vX.Y.Z`를 실행합니다. 준비만으로 커밋하거나 배포하지 않습니다. 명시적인 배포 요청만 버전 태그 생성과 푸시를 허용합니다. main·PR은 배포하지 않으며 웹사이트만의 별도 배포 흐름이 있습니다. 공식 배포는 패키지와 서명을 검증하고 GitHub Release를 공개한 뒤 같은 버전의 사이트를 배포합니다. 수동 데스크톱 실행은 업데이트 기능 없는 검증 패키지만 만들고 공개하지 않습니다. [서명과 배포](../auto-update.md), [요약 규칙](../update-summaries.md), [Windows 검증](../windows-clipboard-qa.md), [상세 유지보수 문서](../../README.md#发布)를 확인하세요.

가상 예제를 사용하고 업무 메시지, 원본 클립보드, 인증 정보와 개인 화면을 커밋하지 마세요. [MIT 라이선스](../../LICENSE) · [타사 고지](../../THIRD_PARTY_NOTICES.md).
