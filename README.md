# md2chat · 贴贴 Markdown

让 Markdown 更适合聊天。把从 DeepSeek、Codex、Cursor、ChatGPT、Claude 等 AI 工具复制的 Markdown，或自己写的文档，转成适合聊天的图文。保留可编辑文字，把表格、代码、公式和 Mermaid 转成图片，再按原文顺序组合。

AI 回答常用 Markdown，但并非所有输出或复制方式都相同。这些名称表示内容来源，不代表官方集成或已逐一实测；转换后请检查预览和目标客户端粘贴结果。[AI 内容转换说明与官方资料](https://forgeturl.github.io/md2chat/guides/ai-markdown-to-chat.html)。任务列表使用 ✅ / ⬜，文字仍可编辑。

- [产品主页](https://forgeturl.github.io/md2chat/)
- [最新版本与更新说明](https://github.com/forgeturl/md2chat/releases/latest)
- [网页版](https://forgeturl.github.io/md2chat/editor.html)
- [兼容性与测试范围](docs/compatibility.md)

![桌面预览](docs/desktop-preview.png)

## 下载最新桌面版

| 系统 | 安装包 | 更新归档 |
| --- | --- | --- |
| Windows x64（Intel / AMD） | [下载安装程序 EXE](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe) | — |
| macOS 通用版（M 系列 / Intel） | [下载 DMG](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg) | [Tauri 更新归档](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.app.tar.gz) |

链接始终指向最新发布版本，无需查找版本号。Mac 的同一个 DMG 包含 Apple Silicon 和 Intel 两种架构，无需选择芯片类型；`.app.tar.gz` 供 Tauri 应用内更新使用，日常安装请下载 DMG。[版本说明](https://github.com/forgeturl/md2chat/releases/latest) · [SHA256 校验值](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)。Windows ARM 暂无原生包。

## 桌面版

提供 Windows x64 安装包和 macOS 通用安装包（Apple Silicon / Intel）。使用 Tauri 2 + Rust，界面复用系统 WebView，应用内不再包含 Electron 或 Node.js。Mac 使用系统 WebKit；Windows 优先复用 WebView2，缺少时由安装器联网安装。无需另装插件、Python、Node 或助手。

源码已切换到 Tauri，以下历史客户端实测描述来自 Electron 版；Tauri 版必须重新验证相同粘贴用例，不能直接沿用为迁移验收结论。新架构不包含旧安装包自动换装或旧数据迁移。

输入 Markdown（左侧「清空」可重新开始）→ 检查右侧预览 → 点击目标平台图标 → 到目标输入框粘贴。企微图文会打开分段面板，按顺序分别复制、粘贴文字和图片；纯文字可直接复制。其他目标默认整段复制。普通文字仍可编辑，图片能否保留取决于客户端兼容性。网页版钉钉按钮禁用，悬浮钉钉按钮后可通过提示中的下载入口获取桌面版。

桌面版支持 Markdown 图片中的本地绝对路径和本机 `file:///` 地址，例如 `![截图](/Users/name/Pictures/screenshot.png)`；路径含空格时可写为 `![截图](</Users/name/Pictures/my screenshot.png>)`。PNG、JPEG、GIF、WebP、BMP 会读取到内存并嵌入预览和复制结果，单张最多 10 MB、2000 万像素。普通文件链接仍保留为文字链接。网页版请直接粘贴图片本身。

已发布的 0.5.1 及更早安装包**未完成平台开发者签名（macOS 也未公证）**，系统可能提示或阻止打开。0.6.0 的 Mac 发布要求签名和公证，以实际 Release 构建结果为准。macOS 使用钉钉原生图文格式，已在 M 系列 Mac 的钉钉输入框验证；Windows 钉钉一次图文粘贴尚未解决，0.6.4 的仅 HTML 方案有完全空白的用户反馈，已恢复纯文本兜底并提供可选分段复制和 HTML 排查实验。Intel Mac、微信等客户端未完成同等粘贴验证。不支持自动发送消息。

## 按目标平台复制

| 入口 | 输出 | 验证范围 |
| --- | --- | --- |
| 钉钉 | Mac 原生图文 + HTML + 纯文本；Windows HTML + 纯文本与可选分段；网页版禁用 | Mac M 系列输入框已实测；Windows 一次混排未解决，分段待实测 |
| 微信 | 标准 HTML 图文 + 纯文本 | 需按客户端版本确认图片 |
| 飞书 | Mac 原生编辑图文 + HTML + 纯文本；网页和 Windows 标准图文 | Mac 展开的富文本输入框一次混排与发送已实测；网页和 Windows 待验证 |
| 企微 | 有图时按顺序分别复制纯文本与 PNG；纯文字直接复制 | macOS 企微 5.0.12 网页 5 段、桌面 3 段粘贴已实测；Windows 未验证 |
| 邮件 | 可编辑 HTML 表格 + 文字；复杂内容为图片 | 实验性，需确认发送后图片仍在 |

Mac 飞书请先点击输入框的展开按钮，进入富文本编辑，再一次粘贴整段图文；普通输入框可能丢图。无需飞书账号配置，图片缓存在本机。复制不会自动发送。企微分段文字保持可编辑，粗体等强调样式不保证保留。网页受浏览器剪贴板能力限制。更多见 [平台指南](https://forgeturl.github.io/md2chat/guides/chat-compatibility.html)。

排查丢图时，打开「剪贴板排查」：先复制 md2chat 的转换结果并读取一次，再从钉钉复制同一条图文并读取一次，最后点击「复制排查报告」获取最近两份报告。中间截图或复制其他内容会替换剪贴板。报告包含图片引用类型、尺寸属性、脱敏属性名和周围标签，不含正文、图片内容、完整链接、文件路径或属性值，也不会请求图片；Windows 的 Mac 钉钉专用格式计数会显示「不适用」。这些元数据用于对比格式，不代表已经修复 Windows 钉钉的图文粘贴。

Mac 飞书的使用方式、已验证范围及本机剪贴板测试见 [飞书 Mac 适配](docs/feishu-mac.md)。

Windows 桌面版另提供「钉钉分段复制（备用）」及排查窗口的「复制 HTML 文字测试」「重写当前 HTML」。Windows CI 使用 Rust 原生剪贴板写入并读回，校验 CF_HTML；测试日志与人工样例随 Actions 上传。运行方式、样例和判读见 [Windows 验证步骤](docs/windows-clipboard-qa.md)。

## 菜单栏、托盘与开机自启动

- macOS 菜单栏 / Windows 系统托盘默认只显示专用 Markdown 转换图标；Mac 可在首选项开启「菜单栏显示应用名」。关闭主窗口会隐藏到托盘，当前输入保留在内存中。
- 点击 Mac 菜单栏图标，或右击 Windows 托盘图标，可「剪贴板转换」「显示主窗口」「首选项」「帮助 ↗」「检查更新」或「退出 md2chat」。「显示主窗口」紧邻「首选项」上方；Windows 单击托盘图标可打开窗口。
- 托盘及子菜单各项配有彩色图标，平台格式使用对应平台标识，高清屏保持清晰。
- 复制 Markdown 或图文后，在托盘「剪贴板转换」子菜单中依次可选「转图片」「微信格式」「钉钉格式」「飞书格式」「企业微信格式」或「邮件格式」。各平台转换规则和客户端兼容范围与主窗口相同，邮件保留可编辑表格。
- 「企业微信格式」遇到图文时打开独立分段面板，逐段复制并到企微依次粘贴；打开面板时不会把整段图文写回剪贴板。其他转换和企微纯文字转换在后台完成并写回剪贴板，看到完成通知后到目标应用粘贴即可。上述操作均保留主编辑器已有内容。
- 「转图片」位于「剪贴板转换」子菜单第一项，在「微信格式」之前，将当前剪贴板中的文字、表格、代码、公式与图片按顺序合成一张白底 PNG，写回剪贴板后直接粘贴。图片中的文字不可编辑；内容过长或图片无法读取时会提示原因，并保留原剪贴板。
- 只在点击快捷项时读取剪贴板。空内容、图片不可读取或转换失败会提示原因；转换期间复制了新内容时，会保留新剪贴板并提示重新转换。
- 点击「首选项」打开独立设置窗口，在「托盘常用格式」中可勾选多个平台格式，并通过拖动或上移、下移调整顺序。选中的格式按顺序显示在托盘菜单顶部；全部取消即可收起这些入口。设置立即生效并保存在本机，全部格式仍可在「剪贴板转换」子菜单中使用。Mac 也可按 ⌘, 打开首选项。
- 开机自启动及状态提示位于首选项窗口。「帮助 ↗」直接打开 GitHub Issues，「检查更新」保留独立入口。开机自启动默认不主动启用；勾选后注册系统登录项，取消勾选后移除。开机自动运行时只驻留托盘，不弹出编辑窗口。
- 自启动需使用安装后的桌面版；开发模式不注册登录项。Mac 请先将应用放到「应用程序」。未签名、公证的 macOS 应用可能无法成功注册，或需要在「系统设置 → 通用 → 登录项」批准；应用会显示系统状态，不能保证当前未签名包的自启动可靠性。
- 退出应用请使用菜单「退出 md2chat」（Mac 也可 ⌘Q）；关闭窗口不代表退出。Windows 自启动设置和托盘交互尚需 Windows 真机验收。

## 隐私

- 不登录，不上传正文或图片到 md2chat 服务；转换逻辑在本机运行。
- 不持久化保存输入正文。关闭窗口驻留时仅在进程内存保留输入，退出后清除。桌面版将复制用图片缓存在应用本机目录，保留以支持退出后粘贴。Mac 在下次启动时清理超过 7 天的旧图，剪贴板仍含钉钉专用格式时暂缓；Windows 在下一次成功复制钉钉内容后清理旧图，避免重启时破坏当前图片引用。已有 HTTPS 原图可继续使用原地址；不自动上传本地图片。
- 引用远程图片会访问其原网址，网页版仍受 CORS 与来源访问权限限制。
- 排查按钮只展示格式、字节数与图片数量；不输出正文、媒体标识或文件路径。
- 桌面版在启动后及每 6 小时检查 GitHub Releases 的 Tauri 更新清单，提醒新版并展示更新说明。点击下载后显示进度，再确认「重启并安装」。不会自动下载或在普通退出时自动安装；更新请求不包含输入正文。安装包缓存在本机。
- Mac 自动安装要求签名版已放入「应用程序」。Tauri 更新使用独立签名密钥，配置和验收步骤见 [自动更新与签名发布](docs/auto-update.md)。

## 开发

Node.js 22+、Rust 1.90+。Mac 需要 Xcode Command Line Tools；Windows 需要 Visual Studio C++ 构建工具和 WebView2。macOS 安装包在 macOS 构建，Windows 安装包在 Windows 构建；CI 自动分平台打包。

```sh
npm ci
npm run dev          # 宣传页及网页版：http://127.0.0.1:18768/md2chat/
npm run desktop      # 桌面编辑器
npm run check        # 语法与回归测试
npm run build        # GitHub Pages 静态站点
npm run desktop:test # Rust 桌面模块回归测试，不改系统剪贴板
npm run desktop:test:render # 隐藏的真实 WebView 渲染验证，报告在 release/qa/
npm run desktop:test:native # Mac / Windows 原生剪贴板往返验证，结束后恢复剪贴板
npm run desktop:test:windows # Windows 原生剪贴板与 CF_HTML 验证，结束后恢复剪贴板
npm run desktop:dist:mac # Mac 通用版 DMG / Tauri 更新归档（需要正式签名凭据）
npm run desktop:dist:win # Windows x64 安装程序 EXE
```

`desktop:test:native` 和 `desktop:test:windows` 会临时写入测试剪贴板，请在不使用剪贴板时运行。普通单元测试不访问系统剪贴板。桌面层直接调用 macOS / Win32 格式 API，Rust 依赖锁定在 `src-tauri/Cargo.lock`，Tauri CLI 锁定在 `package-lock.json`。

## 项目结构

- `index.html`、`assets/landing*.css`：产品宣传与下载页面。
- `editor.html`、`assets/app.js`：网页/桌面共用转换界面。
- `assets/chat-markdown.js`、`assets/renderers.js`、`assets/code-images.js`：解析与图片渲染。
- `src-tauri/`：Rust 桌面主进程、菜单栏／托盘、系统登录项、窗口和原生剪贴板。
- `desktop/design/`、`desktop/icon.py`：Image Gen 图标原图、提示词与跨平台图标打包脚本。
- `assets/tauri-bridge.js`：网页界面与 Rust 命令之间的窄接口；网页版不启用。
- `scripts/build-desktop.cjs`：仅打包共用界面、首选项及资源，不包含 Node.js 运行时。
- `desktop/*.cjs`：历史格式协议与测试对照；Tauri 发行包不包含这些 Electron 文件。
- `tests/`：纯逻辑、图片顺序、原生格式与缓存清理测试。

桌面 WebView 只加载打包的本地界面，不提供 Node.js 集成。按窗口限制 Tauri 命令权限，拒绝任意外部页面导航；仅允许指定 GitHub 和官网链接经系统浏览器打开。IPC 验证调用方和内容，复制接口只接受内嵌图片，缓存写入路径由主进程决定。本地图片读取接口只接受本机绝对路径，经文件类型、大小和图片解码校验后返回内嵌图片，不接受目录、符号链接或远程共享路径；粘贴 HTML 中的任意文件引用仍不可读取。

## SEO / GEO 维护

官网包含静态使用指南、canonical、分享元数据、应用结构化数据、sitemap 和 llms.txt。每次发布自动检查页面、链接与内容清单，见 [维护步骤](docs/seo.md)。修改公开说明后运行 `npm run seo:generate`；不承诺搜索收录、排名或 AI 引用。

## 发布

Actions 为每个工作流保留最近 10 次运行，较旧且已结束的运行自动清理；临时构建产物按仓库上限保留 3 天。

提交 main 或发起 PR 仅运行 `npm run check`，不构建或部署官网。发布桌面版与官网时：

1. 将本次已完成变更的更新说明正文写入文件（不带版本标题，命令会自动添加），再运行统一准备命令，例如：

   ```sh
   npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md
   ```

   `patch` 可替换为 `minor`、`major` 或明确的 `X.Y.Z` 稳定版本号。命令先校验版本、说明和 GitHub Latest；通过后同步 `package.json`、`package-lock.json`、Rust package / lock 版本，并把新版本说明放到 `docs/release-notes.md` 首部，保留历史。Tauri 配置直接引用 package 版本。准备命令只修改这些文件，不提交、不创建标签、不推送。
2. 审阅变更，运行 `npm run check`；将下方 `vX.Y.Z` 替换为准备好的版本，校验正式发布条件：

   ```sh
   npm run release:verify -- --tag vX.Y.Z
   ```

   正式发布要求规范的 `X.Y.Z` 稳定版本号（不接受预发布或 build metadata）、标签与两个 package 文件和更新说明首版本一致、说明正文有实质内容，而且版本严格高于 GitHub Latest。网络、鉴权或限流错误会停止校验；Latest 不存在且已确认仓库可访问时，允许发布首个稳定版。校验读取公开 GitHub API，可通过 `GH_TOKEN` 或 `GITHUB_TOKEN` 提供鉴权。CI 会在构建前和发布前重新校验。
3. 仅在要正式发布时，提交并推送发布所需代码，再创建并推送同版本 `vX.Y.Z` 标签。普通代码提交和推送 main 不会自动升版，也不会发布。`Desktop release` 从该标签构建 Mac 通用版、Windows x64 安装包和官网静态产物；全部构建成功后，校验 Mac DMG、Mac Tauri 更新归档、Windows EXE、更新签名与 `latest.json`，生成 SHA256 校验值，上传到草稿 Release，再发布并设为 Latest，随后部署同版本官网。

仓库自带 [发布 skill](.agents/skills/md2chat-release/SKILL.md) 和根目录 [AGENTS.md](AGENTS.md)，随代码一起维护。Codex 遇到准备新版本、更新说明或发布请求时会按此流程处理；脚本与流水线负责强制校验，普通提交和应用内「检查更新」不触发发布流程。

README 与宣传页使用 `releases/latest/download/固定文件名`，新版本发布后自动下载新版。历史版本仍保留在各自的 Release。Latest 表示当前下载版本，不代表安装包已签名或所有聊天客户端已验证。手动运行 `Desktop release` 仅生成安装包构建产物供验证，不发布 Release 或更新官网。官网部署失败时保留已发布的安装包，可在官网产物保留的 3 天内，在原发布运行中重跑失败的部署任务，无需重新发布版本；旧版本已不再是 Latest 时会跳过部署，避免覆盖新版官网。

0.6.0 发布流水线要求 Mac Developer ID 签名和 Apple 公证，缺少凭据会阻止发布；Windows 暂未接入代码签名。先按 [签名配置步骤](docs/auto-update.md) 添加 GitHub Secrets，再手动运行工作流验证。发布时会验证 Tauri updater 签名并上传统一的 `latest.json`；Mac 公证凭据与更新签名密钥均必须配置。源码实现和状态测试不代表跨版本安装已验收；不要在网站上宣称未验证的客户端已兼容。

示例只使用虚构内容，请勿提交工作消息、剪贴板原始样本或私人截图。MIT 许可证；第三方渲染库见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
