# 桌面工作台改版

采用内置 GPT Image（imagegen）生成设计参考，再用 HTML/CSS 实现真实界面。设计图只是参考，编辑、复制、更新和企微分段窗口仍由原有代码提供。

目标：移除顶部品牌区，编辑和预览置顶；品牌、隐私说明、GitHub、更新和帮助集中到底部；平台复制置于预览区底部。浅灰绿底色、白色纸面、墨绿色文字、细分隔线。

参考图：`desktop-workbench-concept.png`。

实现截图：`desktop-workbench-implemented.png`。保留图文预览原有输出样式，让预览继续反映真正的聊天转换结果。

验证：原生 macOS 桌面默认窗口启动、底栏更新入口、企微分段窗口；网页 760×560 双栏和 390×844 手机布局；清空与重新输入、说明和排查弹窗、Escape 关闭及焦点返回。`npm run check` 119 项测试通过，静态站点构建通过。

## 生成提示词

```text
Use case: ui-mockup
Asset type: high fidelity implementable desktop application interface redesign, full flat screenshot, 1440x960 landscape.
Primary request: Redesign the Chinese Markdown-to-chat utility "贴贴 Markdown". The reference shows its old bulky top branding. Move ALL of that branding, tagline, privacy, GitHub and update controls into a compact BOTTOM utility bar. The editor workspace begins at the very top, with no page header or hero.
Input image 1: old header reference only; keep existing app identity/name but replace its visual design.
Layout: calm two-pane professional writing workbench. Left half editable Markdown source, right half rendered preview. Both start at y=16 with compact 48px section toolbars. Source toolbar: a small document outline icon, "输入内容", subtle "Markdown" descriptor, clear icon on right. Preview toolbar: tiny sparkle icon, "转换预览", subtle live status. Preview uses generous white document space with beautiful Chinese typography, a small mint underlined reading-club title, paragraphs, list and restrained quotation and a neat 3-column table; no dark blocks dominating. Left shows corresponding readable Markdown sample for "周末读书会". At bottom of right pane a low copy action strip: subtle "复制到" and small evenly spaced platform icon+text buttons "微信" "钉钉" "飞书" "企微" "邮件". Inline status and help live below the document and above these buttons, compact.
Bottom global utility bar about 60px high, full width, subtle top hairline: at left small original blue-purple chat app icon with "贴贴 Markdown" and muted tiny tagline; center small green local-processing dot "内容仅在本机处理"; right understated "使用说明" "剪贴板排查" "GitHub ↗" "检查更新" entries. No big blue update CTA.
Style: refined minimal native desktop utility, warm near-white canvas #F5F6F4, ink #263A34, muted sage-gray secondary text, jade-teal #23836D accent used sparingly, ultra-fine borders, 12px panel corners, nuanced microspacing and very subtle shadow. Quiet, polished, crisp interface, restrained rather than playful. Flat screen artwork with legible Chinese copy, no device frame, no giant decorative title, no extra sidebar, no avatars, no fabricated analytics, no gradients, no floating magical 3D objects. Composition must maximize useful vertical editing space.
```
