# Windows 剪贴板与钉钉验证

Windows 打包流水线先运行真实 Electron 剪贴板测试，再构建安装包。也可单独运行 Actions 的 **Windows clipboard validation**，不触发 Release。报告中的 `dingtalkClientTested: false` 表示没有把 CI 的剪贴板读写通过当成钉钉粘贴通过。

## 自动验证

Windows 安装 Node.js 22 后，在仓库根目录执行 `npm ci`、`npm run desktop:test:windows`。此命令会临时替换系统剪贴板，完成后尝试恢复；请在不使用剪贴板时运行。报告写入 `release/qa/windows-clipboard.json`，失败时退出码非零。

用例包含纯文字、无图 HTML、HTML 与纯文本共存、单张/两张本机 PNG 混排、已有 HTTPS 图片引用、独立 PNG、保持 HTML 文档字符串的重写，以及本应用缓存图回读。使用生产复制函数和真实 Electron API。独立 PowerShell/Win32 探针读取 `HTML Format` 原始字节，校验 CF_HTML 偏移范围、UTF-8 边界和片段标记。它不输出原始 HTML、正文、图片、链接或缓存路径，也不会请求 HTTPS 图片。

Actions 的 `windows-clipboard-qa`（独立验证）或 `windows-clipboard-qa-release`（发布验证）附件包含脱敏报告、本说明及人工 Markdown 样例。自动验证只能判断剪贴板传输和数据完整性，不能判断钉钉是否接受这些表示。

## 钉钉人工用例

使用 `examples/windows-clipboard/` 的三个虚构 Markdown 样例：先纯文字，再一张表格图片，再表格与代码两张图片。逐个粘贴进 md2chat；只在自己的钉钉草稿测试，无需发送。结果记录在 `results-template.md`。

1. 点击普通「钉钉」复制，粘贴到钉钉，记录完全空白 / 仅文字 / 完整图文 / 部分图片。当前恢复纯文本兜底，一次混排尚未解决。
2. 对两图样例点击「钉钉分段复制（备用）」，按面板编号逐段复制、粘贴，核对前文、图一、中间文字、图二、后文。图片段写入独立 PNG，文字段写入纯文本。不要在粘完前发送。
3. 打开「剪贴板排查」，点击「复制 HTML 文字测试」，粘贴到钉钉。记录是否出现 **md2chat HTML 文字测试**。此步骤只写无图 HTML；仍为空时，原因不能只归到本机图片引用。
4. 从钉钉复制一条已有的、可正常粘回的测试图文。先直接粘到草稿确认，重新复制同一条消息，再点「重写当前 HTML」，再次粘贴。它保持读取到的 HTML 文档字符串不变，但 Electron 会重建系统封装；不承诺原生字节不变。原复制成功而重写失败时，应继续查系统表示或客户端附加信息；重写成功后，再查生成结构和图片来源。

每次测试会替换剪贴板。先记录粘贴结果，需要报告时再点「读取当前剪贴板」，最后统一复制报告；中途复制报告、截图或其他消息会替换待测试内容。不需要提供真实工作正文、图片地址或登录信息。

报告里的 `StartFragment 无` 只描述 Electron 解码后的 HTML，不能说明原生 CF_HTML 头缺失。CI 的 Win32 探针才直接检查该头部；它也不能证明钉钉导入成功。
