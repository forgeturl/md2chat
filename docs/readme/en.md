# md2chat — Make Markdown chat-ready

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: en; source-sha256: a4607b50438048b9ba1495a6554c9b2c6e20ab1bb623b0e0f13212abd7e63f41 -->

Turn Markdown copied from AI tools or your own documents into chat-ready text and images. Ordinary text stays editable; tables, code, equations and Mermaid diagrams become images in the original order. Task lists use ✅ / ⬜. AI tool names describe possible content sources, not official integrations or proof of compatibility.

[Website](https://forgeturl.github.io/md2chat/en/) · [Web editor](https://forgeturl.github.io/md2chat/editor.html?lang=en) · [Latest release](https://github.com/forgeturl/md2chat/releases/latest) · [Compatibility evidence](../compatibility.md)

![Desktop preview](../desktop-preview.png)

## Download

- [macOS Universal DMG — Apple Silicon and Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Windows x64 installer — Intel and AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [SHA256 checksums](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

These links always point to the latest release. Use the DMG for a normal Mac installation; the `.app.tar.gz` archive is for in-app updates. No native Windows ARM installer is available. Desktop uses Tauri 2, Rust and the system WebView, without bundling Electron or Node.js. Windows uses WebView2; the installer downloads it if needed. Mac release builds require Developer ID signing and notarization; Windows does not currently use Authenticode signing. Old Electron installations are not automatically migrated.

## Use

Paste Markdown, text or images on the left, check the preview, choose a destination, then paste into that app. Clear starts an empty document. The web editor disables DingTalk and Feishu copying; use desktop for those destinations.

- **WeChat:** standard text and images. Check that the destination retains every image.
- **DingTalk:** Mac uses native text and images; Windows uses HTML and plain-text fallback. Historical Mac tests do not establish acceptance of every current build or client version; Windows pasting still needs client verification.
- **Feishu/Lark:** expand the Mac rich-text input before pasting. Mac mixed text and images were tested, including sending; Windows remains experimental and needs verification.
- **WeCom:** Mac desktop can paste the entire text and images at once; ordinary text is editable. Web and Windows use ordered parts when images are present. The Mac test was in a draft and did not send a message.
- **Email:** editable HTML tables; complex content becomes images. Experimental: check images after both pasting and sending.

Desktop can also turn the entire document into one white PNG. Text inside that image is not editable. Long content may be scaled down or rejected if it exceeds image limits. If the clipboard changes during conversion, new content is preserved and you are asked to retry. Local absolute image paths and `file:///` URLs are supported on desktop after validation (PNG, JPEG, GIF, WebP or BMP, up to 10 MB and 20 million pixels per image); paste images directly on the web. Conversion never sends chat messages automatically.

## Tray and shortcuts

Use the Mac menu bar or Windows tray to convert clipboard content without replacing the editor, reopen the window, open Preferences, check updates or fully quit. Closing the window keeps the process and its input in memory. Preferences lets you pin and reorder formats, enable login startup and configure global conversion shortcuts; shortcuts and startup require explicit activation. Mac startup requires an installed app in Applications. Windows tray and startup behavior still needs real-device acceptance.

## Languages and updates

The interface, built-in examples, website, README and update summaries support nine languages. The globe menu shows language names in their own language. Untouched examples follow language changes; editing, pasting, dropping or clearing gives control to the user, so their content is preserved, even after undo.

Update summaries list the published versions between the installed and target versions. The latest three are shown first, older versions can be expanded, and important notices always remain visible. Full technical notes retain their original language. Checks run after startup and every six hours; downloading and restarting require user action. Save input before installing. Older clients gain the new interface after installing a release that includes it; cross-version installation still requires signed-package testing.

## Privacy and diagnostics

No account is required, and content is not uploaded to an md2chat service. Conversion runs locally. Remote image URLs contact their original hosts. Desktop copying may cache images locally so later pasting works. Input is not saved persistently; fully quitting or refreshing loses it.

Clipboard diagnostics only reads when requested. An exported ZIP contains original clipboard data, text, images, links and potentially private formats: review it before sharing. Closing diagnostics clears the sample; exports are not uploaded automatically. The Issue link opens GitHub, where you attach the ZIP yourself. Update requests do not include document content.

## Development

Use Node.js 22.12+ and Rust 1.90+. Mac needs Xcode Command Line Tools; Windows needs Visual Studio C++ tools and WebView2. Build each desktop package on its own OS. Formal Mac DMG generation also requires Python 3.10+ and the hash-pinned dependencies in `scripts/dmgbuild-requirements.txt`.

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

Native clipboard tests temporarily replace and restore the system clipboard; run them when it is not in use. Browser tests and clipboard-format checks do not establish real chat-client acceptance. Only bundled local pages can invoke the restricted desktop commands; the WebView does not expose Node.js.

## Contributing and release

Follow [localization maintenance](../localization.md) for every user-facing change, including all nine translations. Run `npm run seo:generate` after public-page or asset changes and `npm run check` before committing. Website language sources are grouped in `site/locales/`; public `/en/`, `/ja/` and other existing URLs stay unchanged. This README directory contains the other eight editions; the root README is Chinese. Technical maintenance records may retain their source language.

Release preparation requires detailed notes and nine-language summaries:

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

Review the files, run checks, then `npm run release:verify -- --tag vX.Y.Z`. Preparation does not commit or publish. Only an explicit release request authorizes creating and pushing the version tag. Main/PR checks do not release a version; the separate website workflow can deploy the website alone. A formal release validates packages and signatures, publishes GitHub Release, then deploys the matching website. Manual desktop workflow runs produce test packages without in-app updates or publication. See [release and signing](../auto-update.md), [summary policy](../update-summaries.md), [Windows validation](../windows-clipboard-qa.md), and [the detailed maintainer reference](../../README.md#发布).

Use fictional examples; never commit private clipboard samples, work messages, credentials or personal screenshots. [MIT license](../../LICENSE) · [Third-party notices](../../THIRD_PARTY_NOTICES.md).
