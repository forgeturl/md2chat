# 桌面自动更新与签名发布

从 0.6.0 起实现应用内更新：启动约 15 秒后及每 6 小时检查 GitHub Releases；发现稳定版后展示版本和更新说明。用户点击下载后显示进度，下载完成后点击「重启并安装」，再次确认未保存输入后安装。不自动下载，不在普通退出时自动安装，不上传正文或图片。下载的安装包会缓存在本机。

0.5.1 及更早版本不包含此更新模块，必须手动安装首次带更新功能的版本。Mac 需使用签名版并放入「应用程序」。仅完成源码和状态测试不能证明真实升级成功；首次发布需要两份同一团队签名的版本验证升级。Windows 使用 NSIS 安装器，尚未配置 Windows 签名证书。

## GitHub Actions Secrets

打开仓库 Settings → Secrets and variables → Actions → New repository secret。使用 Repository secrets，不使用 Variables。不要把证书、私钥或密码提交到 Git、Issues 或聊天。

| 名称 | 内容 |
| --- | --- |
| CSC_LINK | Developer ID Application 证书及对应私钥导出的 .p12 文件的 Base64 |
| CSC_KEY_PASSWORD | 导出 .p12 时设置的密码 |
| APPLE_ID | 用于公证、具有相应团队权限的 Apple 账户邮箱 |
| APPLE_APP_SPECIFIC_PASSWORD | Apple 账户生成的 App 专用密码，不是登录密码 |
| APPLE_TEAM_ID | 证书所属团队的 10 位 Team ID |

1. Mac「钥匙串访问」→「登录」→「我的证书」，找到 Developer ID Application，确认展开后有私钥。导出为带密码的 `md2chat-signing.p12`。若缺少私钥，应在原先创建证书的 Mac 导出；只有 .cer 不够。
2. 假设文件在下载目录，终端运行下面命令后粘贴到 CSC_LINK 的 Secret 输入框：

   ```sh
   base64 -i "$HOME/Downloads/md2chat-signing.p12" | tr -d '\n' | pbcopy
   ```

3. 登录 https://account.apple.com/ →「登录与安全」→「App 专用密码」，生成 `md2chat GitHub` 专用密码。需要双重认证。填入 APPLE_APP_SPECIFIC_PASSWORD，将登录邮箱填入 APPLE_ID。
4. 登录 https://developer.apple.com/account/ → Membership details 获取 Team ID，填入 APPLE_TEAM_ID。

证书应属于项目获授权使用的开发者团队。保留加密的 .p12 和密码备份，后续升级继续使用同一签名身份；证书轮换必须额外验证。修改 Apple 登录密码会撤销 App 专用密码，需要重新生成并更新 Secret。

## 发布验证

- Mac 构建要求五项凭据齐全，强制 Developer ID 签名、公证，检查 `codesign`、`spctl` 和 stapler；缺失凭据或校验失败会阻止发布，不退回未签名包。
- 三个构建任务分别产出 M 系列 Mac、Intel Mac、Windows x64。发布前验证五个安装资产，校验元数据中的 SHA-512、大小和版本，并合并两个 Mac 架构的清单。
- 发布必须包含 `latest.yml`、`latest-mac.yml`，Mac ZIP 和 DMG、Windows EXE、SHA256SUMS.txt；当前采用完整下载，不需要差分 blockmap。
- 更新来源固定为 `forgeturl/md2chat` 的公开 GitHub Releases，无用户可配置下载 URL，无客户端 GitHub token。稳定版不接受预发布版或降级。
- 更新说明来自 `docs/release-notes.md`，界面以纯文字显示，不执行远程 HTML。
- 先通过 workflow_dispatch 验证签名构建，再推版本标签发布。手动构建不会创建公开 Release。
- 验收应从实际安装的旧签名版升级到同团队的新签名版，验证提醒、说明、下载、取消安装、重启安装、版本变化；Windows 在真实安装环境验证相同流程。开发环境或模拟状态测试不算安装验收。

本地开发使用 `npm run desktop`；如需无证书的测试包，可显式覆盖 `-c.mac.identity=null -c.mac.notarize=false -c.mac.hardenedRuntime=false`。该包不能用于验证 Mac 自动安装，也不可替代正式发布包。

参考：[electron-builder v26 自动更新](https://www.electron.build/v26/docs/features/auto-update/)、[Apple Developer ID](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)、[Apple App 专用密码](https://support.apple.com/en-us/102654)。
