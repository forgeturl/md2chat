# 搜索与 AI 检索维护

公开资料的单一入口是 `scripts/site-content.cjs`。真实功能、限制和兼容性证据应随功能一起更新；不使用工作消息做关键词或示例。

## 每次发布

1. 修改功能后更新相关指南、`docs/compatibility.md` 和 README。区分代码实现、剪贴板验证、目标输入框实测与发送后验收。
2. 运行 `npm run seo:generate`，审阅生成的指南、首页/编辑器 metadata、`sitemap.xml`、`llms.txt`。
3. 运行 `npm run check` 与 `npm run build`。CI 在 Pages 和桌面发布前检查生成内容、canonical、站点地图覆盖、站内链接和 JSON-LD。内容过期或链接文件不存在时阻止发布。
4. 如更新产品界面，以虚构项目小结在当前 Tauri 测试包中手工更新完整界面与首屏两张面板截图，不写入或上传私人剪贴板内容；旧 Electron 截图脚本不再适用。如新增页面，加入内容清单，自动进入 sitemap 和 llms.txt。
5. 发布后检查线上页面和下载入口；根据公开 issue、实际查询与用户反馈迭代问答。不能把构建成功写成已收录或排名提升。

## 已实现

- 可直接抓取的静态首页、编辑器说明与五篇问题指南，正文不依赖 JavaScript 才出现。
- 独立 title/description、HTTPS canonical、Open Graph / Twitter 分享信息。
- 与可见产品事实一致的 SoftwareApplication / TechArticle JSON-LD；没有虚构评分、评论或兼容性。
- 子路径站点地图：<https://forgeturl.github.io/md2chat/sitemap.xml>。
- `llms.txt` 提供可读的项目入口与限制，仅是补充索引；不代表搜索引擎或 AI 平台承诺采用。

## 站长可选操作（未代为完成）

在 Google Search Console 和 Bing Webmaster Tools 验证站点归属、提交上述 sitemap，并观察索引和查询数据。需要账户和所有权验证，代码发布不能代替这一步。

`robots.txt` 必须位于域名根目录 `https://forgeturl.github.io/robots.txt`。项目子目录中的 `/md2chat/robots.txt` 无法控制整个主机爬虫，因此本项目不生成这个误导文件。没有 robots.txt 不会自动禁止爬取。若以后维护用户主页仓库，可在根目录机器人规则中加入 sitemap 地址。

Google 的 AI 搜索沿用基本 SEO 要求，没有所谓必须添加的专用 AI schema。内容被索引或引用均由平台决定，不能保证排名或引用。

参考：
- [Google AI 搜索功能与网站](https://developers.google.com/search/docs/appearance/ai-features)
- [软件应用结构化数据](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [创建 robots.txt](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)
- [站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
