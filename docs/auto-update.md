# Tauri 桌面自动更新与签名发布

桌面版使用 Tauri 2、Rust 和系统 WebView，不捆绑 Electron 或 Node.js。应用内更新读取固定 GitHub Releases `latest.json`，展示版本与纯文字更新说明；下载、安装由用户主动触发。安装前提示输入正文会清空，不在普通退出时自动安装。更新请求不包含输入正文或图片。

Tauri 使用独立的更新签名密钥验证下载内容。这与 Mac Developer ID 代码签名是两件事，两者都要配置。当前迁移不提供 Electron 自动换装或旧数据迁移。

## GitHub Actions Secrets

在仓库 Settings → Secrets and variables → Actions 中配置。证书、私钥和密码不能提交到 Git、Issues 或聊天。

| 名称 | 内容 |
| --- | --- |
| CSC_LINK | Developer ID Application 证书及对应私钥导出的 .p12 文件的 Base64 |
| CSC_KEY_PASSWORD | 导出 .p12 时设置的密码 |
| APPLE_SIGNING_IDENTITY | 可选。完整签名名称，例如 `Developer ID Application: Your Name (TEAMID1234)`；省略时从 `CSC_LINK` 的证书安全推导 |
| APPLE_ID | 用于公证、具有团队权限的 Apple 账户邮箱 |
| APPLE_APP_SPECIFIC_PASSWORD | Apple 账户生成的 App 专用密码 |
| APPLE_TEAM_ID | 证书所属团队的 10 位 Team ID |
| TAURI_SIGNING_PRIVATE_KEY | Tauri updater 签名私钥的完整内容 |
| TAURI_SIGNING_PRIVATE_KEY_PASSWORD | updater 私钥密码；无密码时可以留空 |
| TAURI_UPDATER_PUBLIC_KEY | 与上述私钥配对的 Tauri 公钥文件内容 |

使用 `npm run tauri -- signer generate --help` 查看密钥生成命令，在安全位置生成并备份密钥。私钥丢失后无法再向已安装版本提供受信更新。仓库默认公钥留空；正式构建要求提供真实密钥对，通过临时 Tauri 配置注入公钥，不生成或使用测试生产密钥。

Mac 构建把既有 CSC 凭据映射到 Tauri 的 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`，把 App 专用密码映射到 `APPLE_PASSWORD`。证书必须包含私钥，并属于项目获授权使用的 Developer ID 团队。省略 `APPLE_SIGNING_IDENTITY` 时，脚本在私有临时文件中用 OpenSSL 提取公开证书，由 Node 解析唯一 Developer ID Application 名称后清理；提取失败或名称存在歧义就停止，不使用临时签名。Tauri 负责 App 签名、公证和装订票据；发布脚本另行提交签名后的 DMG 公证，等待 `Accepted` 后装订并验证票据。构建后检查通用二进制的 arm64 / x86_64 架构、`codesign`、`spctl` 及 App / DMG 的公证票据。缺少凭据或校验失败时停止。

Windows 生成每用户 NSIS x64 安装器。优先复用系统 WebView2，缺少时联网安装，因此不会在主安装包中嵌入完整浏览器。Tauri updater 签名不等于 Windows Authenticode；Windows 代码签名尚未接入。

## 构建与发布资产

按 [README 发布步骤](../README.md#发布) 使用 `release:prepare` 和 `release:verify`。维护流水线不等于准备或发布版本；只有用户要求正式发布时才推送版本标签。

正式发布资产为：

- `md2chat-mac-universal.dmg`：M 系列与 Intel 通用安装包。
- `md2chat-mac-universal.app.tar.gz`、同名 `.sig`：Mac Tauri 更新包。
- `md2chat-windows-x64-setup.exe`、同名 `.sig`：Windows 安装与更新共用 NSIS 包。
- `latest.json`：`darwin-aarch64`、`darwin-x86_64` 指向同一 Mac 更新包，`windows-x86_64` 指向 EXE。
- `SHA256SUMS.txt`：以上文件的 SHA256 校验值。

构建脚本统一产物名称。发布任务先用配对公钥验证每个更新包的 Minisign 内容签名和受信注释签名，再生成 `latest.json`。清单版本、平台集合、版本固定下载 URL、签名与真实文件必须一致，之后才计算校验值并发布 Release。更新源固定为 `forgeturl/md2chat`，没有用户配置下载源和客户端 GitHub token。

Mac 与 Windows 构建任务均安装 Rust 并执行原生模块测试；Windows 另运行临时写入并恢复剪贴板的原生往返测试。CI 通过不能证明聊天客户端接受相应格式，人工步骤见 [Windows 剪贴板验证](windows-clipboard-qa.md)。

手动运行 `Desktop release` 使用 `--test-build`，只保留 DMG / EXE 构建产物，不发布或部署。此模式无需 Tauri updater 密钥，关闭更新产物生成并清空内嵌更新公钥，因此测试包禁用应用内更新；Mac 仍使用 Developer ID 签名并验证 App / DMG 公证。GitHub Actions 的标签构建禁止此模式，正式构建仍要求完整 updater 密钥和资产校验。版本标签构建同版本官网与安装包；全部成功后发布并设为 Latest，再部署官网。官网部署失败保留已发布安装包，旧版本不再是 Latest 时跳过部署。产物保留 3 天。

## 验收与本地构建

`npm run desktop` 启动开发版。仅测体积或本地运行时，可通过 Tauri 的 `--config` 覆盖 `bundle.createUpdaterArtifacts` 为 `false`，不需要或生成更新签名密钥。测试包不可替代正式签名、公证包。

真实更新验收需要两份由同一 updater 密钥签名的 Tauri 版本；Mac 还需使用同一 Developer ID 团队签名，并从「应用程序」运行。分别验证发现新版本、说明、下载、取消安装、重启安装及安装后版本变化。M 系列、Intel Mac 和 Windows 需要各自验收；单元测试、通用包构建或开发模式不能代替跨版本安装验证。

参考：[Tauri updater](https://v2.tauri.app/plugin/updater/)、[Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)、[Tauri Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)。
