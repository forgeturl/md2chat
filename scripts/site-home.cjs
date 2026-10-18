const content={
 'zh-CN':{
  title:'md2chat — Markdown 转聊天图文，文字可编辑',
  description:'将 AI 回答和 Markdown 转为聊天图文。普通文字可编辑，表格、代码、公式与 Mermaid 转图片；提供 macOS、Windows 桌面版和网页编辑器。免费开源，本机处理。',
  heading:'<span>Markdown</span><span>转聊天图文，</span><span class="accent-blue">文字可编辑。</span>',
  definition:'md2chat 是免费开源的 Markdown 转聊天图文工具。粘贴 AI 回答或 Markdown 后，普通文字保持可编辑，表格、代码、公式和 Mermaid 图按原顺序转成图片，再按目标聊天平台复制。',
  featuresTitle:'哪些内容保留文字，哪些转成图片？',
  features:[['普通文字可编辑','段落、列表和任务项保持文字；表格、代码块、公式和图表转为 PNG，图片内的文字需回到源文修改。'],['按目标平台复制','钉钉、飞书使用桌面版；飞书先展开富文本输入框。企微有图时逐段复制、粘贴，微信使用标准图文。'],['无需账号，本机处理','不向 md2chat 上传正文或图片。远程图片仍会请求原来源，桌面原生复制可能使用本机图片缓存。']],
  compatibilityTitle:'先选平台，再确认粘贴方式',
  columns:['目标','推荐操作','当前验证边界'],
  rows:[['钉钉','桌面版复制，再到聊天草稿粘贴。','Mac M 系列原生混排已有实测；Windows 新生成路径待当前客户端验收。'],['飞书','桌面版复制，先展开富文本输入框。','Mac 两图混排已有发送确认；Windows 编辑器样本适配待新构建验收。'],['企业微信','含图时按面板顺序复制文字、PNG，再逐段粘贴。','Mac 5.0.12 草稿实测；Windows 与发送后效果待验证。'],['微信 / 邮件','微信使用标准图文；邮件保留 HTML 表格。','微信需按客户端核对；邮件图片的收件效果待验证。']],
  faqTitle:'使用前常见问题',
  questions:[['和整篇截图有什么区别？','md2chat 保留普通文字，只把复杂内容转成图片。聊天里可以继续改普通文字，也可以复制、搜索这些文字。'],['支持哪些 AI 工具？','可输入从 ChatGPT、Claude、DeepSeek、Codex、Cursor 等工具获得的 Markdown。它们是内容来源示例，不代表官方集成；无需连接 AI 账号。'],['可以一次粘贴到所有平台吗？','不同客户端导入方式不同。Mac 钉钉、展开后的 Mac 飞书有原生混排证据；企微含图时使用分段复制。发送前请核对当前客户端结果。']],
  guidesTitle:'按场景查看操作指南', guidesLabel:'中文指南 · English guides available',
  evidence:'查看平台兼容性与验证记录', sample:'在网页编辑器试用公开示例',
 },
 en:{
  title:'md2chat — Markdown to chat with editable text and images',
  description:'Turn AI answers and Markdown into chat-ready content. Keep text editable and render tables, code, equations and Mermaid as images. Free, open-source, local processing for macOS, Windows and the web.',
  heading:'<span>Markdown</span> <span>to chat.</span> <span class="accent-blue">Text stays editable.</span>',
  definition:'md2chat is a free, open-source Markdown-to-chat converter. Paste an AI answer or Markdown, keep ordinary text editable and turn tables, code, equations and Mermaid diagrams into images in source order. Then copy for your chat platform.',
  featuresTitle:'Keep ordinary text. Render complex blocks as images.',
  features:[['Editable ordinary text','Paragraphs, lists and task items remain text. Tables, code blocks, equations and diagrams become PNGs; edit their source to change text inside an image.'],['Copy for your destination','DingTalk and Feishu require desktop. Expand the Feishu rich-text input first. WeCom with images uses sequential copies; WeChat uses standard HTML.'],['No account, local processing','Content is not uploaded to md2chat. Remote images still contact their original hosts, and desktop native copying can cache PNGs locally.']],
  compatibilityTitle:'Choose the workflow for your chat platform',
  columns:['Destination','Recommended workflow','Validation boundary'],
  rows:[['DingTalk','Copy from desktop, then paste into your draft.','Mac Apple Silicon native mixed content was tested; new Windows generation needs client acceptance.'],['Feishu','Copy from desktop and expand the rich-text input first.','Mac has a two-image sent-message confirmation; Windows editor-sample adaptation needs new-build acceptance.'],['WeCom','Copy and paste text and PNG segments in panel order.','Mac 5.0.12 drafts were tested; Windows and sent results remain unverified.'],['WeChat / Email','Standard HTML for WeChat; editable HTML tables for email.','Check your WeChat client; delivered email images remain unverified.']],
  faqTitle:'Before you copy',
  questions:[['How is this different from a screenshot?','md2chat retains ordinary text and renders only complex blocks as images. You can edit, copy and search ordinary text in the destination instead of sending one screenshot of the entire message.'],['Which AI tools can I use?','Markdown from ChatGPT, Claude, DeepSeek, Codex and Cursor can be used as input. These are content-source examples, not official integrations. No AI account connection is required.'],['Can I paste everything in one operation?','Client import behavior differs. Native mixed-content evidence exists for Mac DingTalk and the expanded Mac Feishu input. WeCom with images uses sequential copies. Inspect the current client before sending.']],
  guidesTitle:'Guides for your workflow', guidesLabel:'English guides · 中文指南',
  evidence:'Read compatibility and validation records', sample:'Try a public example in the web editor',
 }
};
module.exports={content};
