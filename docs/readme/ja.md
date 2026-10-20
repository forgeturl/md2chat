# md2chat — Markdown をチャット向けに

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: ja; source-sha256: 62acd6d3ecd00f7506d3cd1d28b689f2011e22c6b61c1eeeff69038b83fab54d -->

AI ツールや自分の文書からコピーした Markdown を、チャットで使える文章と画像に変換します。通常の文章は編集可能なまま、表・コード・数式・Mermaid 図は画像になり、原文の順序で並びます。タスク一覧には ✅ / ⬜ を使います。AI ツール名は入力元の例であり、公式連携や動作確認を示すものではありません。

[公式サイト](https://forgeturl.github.io/md2chat/ja/) · [Web エディター](https://forgeturl.github.io/md2chat/editor.html?lang=ja) · [最新版](https://github.com/forgeturl/md2chat/releases/latest) · [互換性の検証記録](../compatibility.md)

![デスクトップ画面](../desktop-preview.png)

## ダウンロード

- [macOS 共通 DMG — Apple Silicon / Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Windows x64 インストーラー — Intel / AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [SHA256 チェックサム](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

リンクは常に最新版を指します。Mac の通常インストールには DMG を使い、`.app.tar.gz` はアプリ内更新用です。Windows ARM のネイティブ版はありません。デスクトップ版は Tauri 2、Rust、OS 標準の WebView を使用し、Electron や Node.js を同梱しません。Windows で WebView2 がない場合はインストーラーがダウンロードします。正式な Mac 版には Developer ID 署名と公証が必要です。Windows は現在 Authenticode 署名に未対応です。旧 Electron 版からの自動移行はありません。

## 使い方

左側に Markdown・文章・画像を貼り付け、プレビューを確認してコピー先を選び、そのアプリに貼り付けます。クリアすると空の文書になります。Web 版では DingTalk・Feishu コピーを利用できないため、デスクトップ版をご利用ください。

- **WeChat：** 標準の文章と画像です。画像がすべて残るか確認してください。
- **DingTalk：** Mac はネイティブ図文、Windows は HTML とプレーンテキストを使用します。過去の Mac 検証は現在のすべての版を保証しません。Windows はクライアント確認が必要です。
- **Feishu/Lark：** Mac ではリッチテキスト入力を展開してから貼り付けます。Mac の図文混在と送信は確認済みですが、Windows は試験対応です。
- **WeCom：** Mac・Windows は図文を一括貼り付け、Web は順番に分割貼り付けします。Windows 5.0.12.6018 の形式テストでは画像2枚・中国語・番号を保持しましたが、太字・文字サイズ・色は失われました。ファイル転送アシスタントへの送信も確認済みです。Windows の新ビルドは未検証です。
- **メール：** HTML 表は編集可能で、複雑な内容は画像になります。試験対応のため、貼り付け後と送信後の画像を確認してください。

デスクトップ版は文書全体を白背景の PNG 1 枚にも変換できます。画像内の文章は編集できません。長い内容は縮小されるか、上限超過で変換できない場合があります。変換中に別の内容をコピーした場合、新しい内容を保持して再試行を案内します。検証済みの絶対パスや `file:///` のローカル画像にも対応し、PNG・JPEG・GIF・WebP・BMP は1枚 10 MB・2000万画素までです。Web では画像自体を貼り付けてください。メッセージは自動送信しません。

## トレイとショートカット

Mac のメニューバーまたは Windows のトレイから、エディターを変えずにクリップボード変換、画面の再表示、環境設定、更新確認、完全終了を行えます。画面を閉じてもプロセスと入力内容はメモリに残ります。環境設定で形式の固定・並べ替え、ログイン時の起動、グローバル変換ショートカットを設定できます。自動起動とショートカットは明示的に有効にしてください。Mac は「アプリケーション」へインストールする必要があります。Windows のトレイと自動起動は実機確認待ちです。

## 言語と更新

画面・内蔵例・公式サイト・README・更新概要は9言語に対応します。地球アイコンのメニューには各言語の本来の名称を表示します。未編集の例は言語に追従しますが、編集・貼り付け・ドラッグ・クリア後はユーザーの内容を保持し、元に戻しても自動置換は再開しません。

更新概要には現在版から対象版までの公開済みバージョンを表示します。最近の3版を先に表示し、以前の版は展開できます。重要な注意は常に表示し、技術的な詳細は原文のままです。起動後と6時間ごとに更新を確認します。ダウンロードと再起動はユーザー操作が必要です。インストール前に入力を保存してください。旧クライアントが新画面を使えるのは対応版をインストールした後です。実際の版間更新は署名済みパッケージでの検証が必要です。

過去の更新概要は、選択言語と更新対象の範囲に応じて読み込み、キャッシュします。読み込めない場合も現在版の概要を表示し、更新はダウンロードできます。ウィンドウを閉じて再度開くと再試行します。読み込み済みの履歴はキャッシュを再利用します。旧クライアントは互換性のある `notes` フィールドを引き続き読み取ります。

## プライバシーと診断

アカウントは不要で、内容を md2chat サービスへアップロードしません。変換は端末内で行います。リモート画像は元の配信元へ接続し、デスクトップのコピー用画像は後の貼り付けのためローカルに保存される場合があります。入力内容は永続保存しないため、完全終了や再読み込みで失われます。

クリップボード診断は操作時だけ読み取ります。エクスポート ZIP は原文・画像・リンク・非公開形式などの元データを含むため、共有前に確認してください。閉じるとサンプルを消去し、自動アップロードは行いません。Issue リンクから GitHub を開き、自分で ZIP を添付します。更新要求に文書内容は含まれません。

## 開発

Node.js 22.12+ と Rust 1.90+ が必要です。Mac は Xcode Command Line Tools、Windows は Visual Studio C++ ツールと WebView2 を用意し、それぞれの OS でパッケージをビルドします。正式 DMG の生成には Python 3.10+ と `scripts/dmgbuild-requirements.txt` のハッシュ固定依存関係も必要です。

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

ネイティブテストはシステムのクリップボードを一時的に書き換えて復元します。使用していないときに実行してください。Web・形式テストはチャットクライアントの受入確認を代替しません。制限されたデスクトップコマンドを呼べるのは同梱のローカル画面だけで、WebView に Node.js は公開しません。

## 貢献と公開

ユーザーに見える変更は [多言語保守規則](../localization.md) に従い、9言語を同期してください。公開ページ・資産の変更後は `npm run seo:generate`、コミット前は `npm run check` を実行します。言語別ページのソースは `site/locales/` にまとめ、既存の公開 URL は維持します。このフォルダーは README の8翻訳を収め、ルートは中国語です。技術記録は原文の場合があります。

詳細説明と9言語の概要を用意して版を準備します。

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

差分とチェックを確認し、`npm run release:verify -- --tag vX.Y.Z` を実行します。準備だけではコミット・公開しません。版タグの作成・送信は明示的な公開依頼がある場合だけです。main・PR は公開せず、公式サイトには単独の配備フローがあります。正式公開ではパッケージと署名を確認して GitHub Release を公開し、同じ版のサイトを配備します。手動のデスクトップフローは更新機能なしの検証用パッケージを作り、公開しません。[署名と公開](../auto-update.md)、[概要規則](../update-summaries.md)、[Windows 検証](../windows-clipboard-qa.md)、[詳細な保守資料](../../README.md#发布) を参照してください。

例は架空の内容を使い、仕事のメッセージ・生のクリップボード・認証情報・個人の画面写真をコミットしないでください。[MIT ライセンス](../../LICENSE) · [第三者ライブラリ](../../THIRD_PARTY_NOTICES.md)。
