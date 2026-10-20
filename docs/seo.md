# 搜索与 AI 检索维护

中文指南由 `scripts/site-content.cjs` 维护，英文指南由 `scripts/site-content-en.cjs` 维护，中英文首页事实由 `scripts/site-home.cjs` 维护。其他七种语言的首页、指南、标签、步骤和公开示例位于 `scripts/site-copy/`，由 `scripts/site-copy.cjs` 汇总；`scripts/site-locales.cjs` 是语言、路径与 Open Graph locale 的统一映射。`scripts/seo.cjs` 生成静态正文、语言互链、结构化数据、站点地图、`llms.txt` 和编辑器示例。其他八种语言的生成页面集中在 `site/locales/`，由预览与构建映射到原有公开网址；多语言同步规范见 [多语言维护](localization.md)。真实功能、限制和兼容性证据应随功能一起更新；不使用工作消息做关键词或示例，不用英文正文填充未完成的译文。

## 每次发布

1. 修改功能后更新相关指南、`docs/compatibility.md` 和 README。区分代码实现、剪贴板验证、目标输入框实测与发送后验收。
2. 运行 `npm run seo:generate`，审阅生成的指南、首页/编辑器 metadata、`sitemap.xml`、`llms.txt`。
3. 运行 `npm run check` 与 `npm run build`。CI 在 Pages 和桌面发布前检查生成内容、canonical、站点地图覆盖、站内链接和 JSON-LD。内容过期或链接文件不存在时阻止发布。
4. 如更新产品界面，以虚构项目小结在当前 Tauri 测试包中手工更新截图，不写入或上传私人剪贴板内容；旧 Electron 截图脚本不再适用。如新增指南，同时补齐九语言正文、操作步骤、公开示例与验证依据，自动进入 sitemap 和 llms.txt。核对内容后手动更新 `reviewed` 日期，不按每次构建刷新日期。
5. 发布后检查线上页面和下载入口；根据公开 issue、实际查询与用户反馈迭代问答。不能把构建成功写成已收录或排名提升。

## 已实现

- 九种语言各有一份完整静态首页与八篇场景指南，加上共享编辑器，共 82 个公开 HTML 页面。中文保留根路径，英文为 `/en/`，其他为 `/es/`、`/pt-br/`、`/ja/`、`/ko/`、`/de/`、`/fr/`、`/hi/`；葡萄牙语 hreflang 使用 `pt-BR`。
- 每个首页及指南使用自身 canonical，并完整互链九种语言与 `x-default`（中文原地址）。页面的 title、description、HTML lang、Open Graph、分享描述及 SoftwareApplication / TechArticle 数据与实际译文一致。站点地图覆盖所有页面；共享编辑器仍保留单一 canonical，不生成九份相同编辑器。
- 首页和指南只保留一个原生多语言下拉按钮，菜单内九个真实链接均可被发现；无 JavaScript 也能使用。切换指南语言保留同一篇文章，不退回首页。直接访问与刷新以 URL 的语言为准，不因浏览器或旧偏好自动跳走。编辑器和桌面应用原地切换界面，未编辑的内置示例（含指南载入示例）随语言同步；编辑、粘贴、拖入或清空后保留用户内容，撤销回示例原文也不恢复自动替换。语言选择器使用地球图标并显示语言本名。
- 独立 title/description、HTTPS canonical、Open Graph / Twitter 分享信息。
- 所有静态页面引用的 JavaScript / CSS 使用内容指纹，官网独立部署即使不升桌面版本也能更新资源 URL；指纹计算先统一 CRLF / LF，避免平台间无效差异。
- 与可见产品事实一致的 SoftwareApplication / TechArticle JSON-LD；没有虚构评分、评论或兼容性。
- 九语言指南均包含直接回答、步骤、相同事实边界、对应语言的可复现示例、内容核对日期与实现/验证记录；“试用此示例”按钮通过 `lang` 参数在共享编辑器载入与指南完全相同的 Markdown。复杂内容与普通文字的可编辑范围、平台待验收项和隐私例外在译文中保留。
- 子路径站点地图：<https://forgeturl.github.io/md2chat/sitemap.xml>。
- `llms.txt` 覆盖九语言入口和指南摘要，并保留兼容性证据与隐私限制，只作补充索引；Google 的生成式搜索不使用它作为特殊信号，不以它替代 HTML 正文与正常 SEO，也不保证其他 AI 平台采用。

## 站长配置与效果观察

维护者已确认完成前次建议的站长/收录配置。后续继续在对应账户观察各语言索引、查询、曝光和点击，以及账户可用时的生成式 AI 搜索效果报告；本仓库的验证标签和自动检查不代表已经读取或核验这些账户数据，也不代表新的语言页面已收录。新增语言页面会随现有 sitemap 更新，无需为每种语言另建站点地图。发布后通过真实 URL 检查与站长工具确认抓取和展示结果。

`robots.txt` 必须位于域名根目录 `https://forgeturl.github.io/robots.txt`。项目子目录中的 `/md2chat/robots.txt` 无法控制整个主机爬虫，因此本项目不生成这个误导文件。没有 robots.txt 不会自动禁止爬取。若以后维护用户主页仓库，可在根目录机器人规则中加入 sitemap 地址。

Google 的 AI 搜索沿用基本 SEO 要求，没有所谓必须添加的专用 AI schema。内容被索引或引用均由平台决定，不能保证排名或引用。

## 本地验收

`npm run check` 验证九语言完整性、82 页 canonical、同主题 hreflang 双向闭环、真实菜单链接、JSON-LD、编辑器示例及 CRLF 下可重复生成。`npm run build` 只打包公开资源和明确的语言目录，不包含源码、记录或临时浏览器快照。浏览器另检查九语言 URL 切换、刷新、指南保留主题、关闭脚本、手机菜单和用户输入保留。

参考：
- [Google AI 搜索功能与网站](https://developers.google.com/search/docs/appearance/ai-features)
- [Google 生成式 AI 搜索优化指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google 多语言版本与 hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [软件应用结构化数据](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [创建 robots.txt](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)
- [站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
