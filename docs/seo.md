# 搜索与 AI 检索维护

中文指南由 `scripts/site-content.cjs` 维护，英文指南由 `scripts/site-content-en.cjs` 维护，首页的中英文产品事实由 `scripts/site-home.cjs` 维护。`scripts/seo.cjs` 统一生成页面、语言互链、结构化数据、站点地图、`llms.txt` 和公开示例。真实功能、限制和兼容性证据应随功能一起更新；不使用工作消息做关键词或示例。

## 每次发布

1. 修改功能后更新相关指南、`docs/compatibility.md` 和 README。区分代码实现、剪贴板验证、目标输入框实测与发送后验收。
2. 运行 `npm run seo:generate`，审阅生成的指南、首页/编辑器 metadata、`sitemap.xml`、`llms.txt`。
3. 运行 `npm run check` 与 `npm run build`。CI 在 Pages 和桌面发布前检查生成内容、canonical、站点地图覆盖、站内链接和 JSON-LD。内容过期或链接文件不存在时阻止发布。
4. 如更新产品界面，以虚构项目小结在当前 Tauri 测试包中手工更新截图，不写入或上传私人剪贴板内容；旧 Electron 截图脚本不再适用。如新增指南，同时补齐中英文正文、操作步骤、公开示例与验证依据，自动进入 sitemap 和 llms.txt。核对内容后手动更新 `reviewed` 日期，不按每次构建刷新日期。
5. 发布后检查线上页面和下载入口；根据公开 issue、实际查询与用户反馈迭代问答。不能把构建成功写成已收录或排名提升。

## 已实现

- 中文首页、共享编辑器与八篇中文指南；`en/` 下提供英文首页与八篇完整英文指南，共 19 个公开页面。正文和语言链接不依赖 JavaScript 才出现。
- 中英文首页与对应指南各自使用 canonical，并互相声明 `zh-CN`、`en` 与 `x-default` 的 hreflang。共享编辑器保留单一 canonical；其九种界面语言不作为独立搜索页面发布。
- 首页只保留一个多语言下拉按钮，复用九种界面语言选择器；选择中文或 English 时进入对应完整页面，其他语言沿用界面翻译。禁用 JavaScript 时显示中英文链接作为备用入口，不同时显示两套控件。编辑器和桌面应用的语言选择行为保持不变。
- 独立 title/description、HTTPS canonical、Open Graph / Twitter 分享信息。
- 与可见产品事实一致的 SoftwareApplication / TechArticle JSON-LD；没有虚构评分、评论或兼容性。
- 指南包含直接回答、步骤、可复现示例、内容核对日期与实现/验证记录；“试用此示例”按钮载入同一份中英文 Markdown。语言切换不会重写已经输入的正文。
- 子路径站点地图：<https://forgeturl.github.io/md2chat/sitemap.xml>。
- `llms.txt` 提供可读的项目入口与限制，仅是补充索引；不代表搜索引擎或 AI 平台承诺采用。

## 站长配置与效果观察

维护者已确认完成前次建议的站长/收录配置。后续继续在对应账户观察索引、查询、曝光和点击；本仓库中的验证标签和自动检查不代表已经读取或核验这些账户数据。新增英文及场景页面会随现有 sitemap 更新，无需为每个语言另建站点地图。

`robots.txt` 必须位于域名根目录 `https://forgeturl.github.io/robots.txt`。项目子目录中的 `/md2chat/robots.txt` 无法控制整个主机爬虫，因此本项目不生成这个误导文件。没有 robots.txt 不会自动禁止爬取。若以后维护用户主页仓库，可在根目录机器人规则中加入 sitemap 地址。

Google 的 AI 搜索沿用基本 SEO 要求，没有所谓必须添加的专用 AI schema。内容被索引或引用均由平台决定，不能保证排名或引用。

参考：
- [Google AI 搜索功能与网站](https://developers.google.com/search/docs/appearance/ai-features)
- [软件应用结构化数据](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [创建 robots.txt](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)
- [站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
