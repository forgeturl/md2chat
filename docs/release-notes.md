md2chat v0.3.0 · Windows / macOS

- 输入区增加「清空」，同时重置预览、图片引用和复制状态，清空后可直接粘贴新内容。
- 新增 Windows x64 安装程序、Intel Mac DMG / ZIP；继续提供 M 系列 Mac DMG / ZIP。
- README 和官网提供固定的最新版本下载入口，每次发版自动指向新版。
- Windows 提示使用 Ctrl+V，帮助菜单打开最新版本页。

## 下载

- Windows x64：`md2chat-windows-x64-setup.exe`，安装到当前用户，无需另装 Node 或助手。
- M 系列 Mac：`md2chat-mac-arm64.dmg`（或同名 ZIP）。
- Intel Mac：`md2chat-mac-x64.dmg`（或同名 ZIP）。
- `SHA256SUMS.txt` 包含全部五个文件的校验值。

## 兼容性

macOS 使用钉钉原生图文格式：此前在 M 系列 Mac 的钉钉输入框实测保留文字 + 图片 + 文字，未发送消息。Windows 使用标准 HTML 图文，尚未适配和验证 Windows 钉钉专有格式，可能丢图。Intel Mac、微信和其他客户端未完成同等粘贴验证。打包成功不等同于聊天客户端兼容性验证。

安装包尚未完成开发者签名，macOS 也未公证，系统可能提示或阻止打开。Latest 表示最新下载版本，不代表已完成平台认证。

正文不持久保存。复制所需图片缓存在本机；超过 7 天后启动时清理，剪贴板含钉钉专有格式时暂缓清理。远程图片会访问原网址。应用不会自动发送消息，也不会后台自动安装更新。
