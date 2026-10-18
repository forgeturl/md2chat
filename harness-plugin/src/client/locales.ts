/** `md2chatShare` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.share': '分享到聊天',
  'dialog.title': '分享到聊天',
  'dialog.close': '关闭',
  'dialog.hint': '微信、企业微信发送整张长图，保持排版；钉钉、飞书保留可编辑文字，表格、代码、公式和图表转为图片；邮件中的表格可编辑。',
  'status.converting': '正在转换文字、表格、代码、公式和图表…',
  'status.ready': '已准备好：{images} 张图片（表格 {tables}、代码 {code}、公式 {math}、图表 {mermaid}、原图 {original}）。',
  'status.copying': '正在复制…',
  'status.empty': '这条回复没有可分享的文字。',
  'status.failed': '转换失败：{message}',
  'status.copyFailed': '复制失败：{message}',
  'target.wechat': '微信',
  'target.wecom': '企业微信',
  'target.dingtalk': '钉钉',
  'target.feishu': '飞书',
  'target.email': '邮件',
  'mode.image': '复制为长图',
  'mode.native': '复制为可编辑图文',
  'mode.html': '复制为邮件图文，表格可编辑',
  'toast.image': '已复制长图，请到{target}聊天框粘贴',
  'toast.copied': '已复制，请到{target}聊天框粘贴',
  'toast.feishu': '已复制，请先展开飞书富文本输入框，再一次粘贴图文',
  'toast.dingtalkWindows': '已写入兼容图文，请到钉钉粘贴并确认图片完整',
  'toast.email': '已复制，请到邮件编辑器粘贴',
} satisfies Record<string, string>

/** The namespace key union. */
export type ShareKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.share': 'Share to chat',
  'dialog.title': 'Share to chat',
  'dialog.close': 'Close',
  'dialog.hint': 'WeChat and WeCom get one long image that keeps the layout; DingTalk and Feishu keep editable text with tables, code, math and diagrams as images; email keeps tables editable.',
  'status.converting': 'Converting text, tables, code, math and diagrams…',
  'status.ready': 'Ready: {images} images (tables {tables}, code {code}, math {math}, diagrams {mermaid}, original {original}).',
  'status.copying': 'Copying…',
  'status.empty': 'This reply has no text to share.',
  'status.failed': 'Conversion failed: {message}',
  'status.copyFailed': 'Copy failed: {message}',
  'target.wechat': 'WeChat',
  'target.wecom': 'WeCom',
  'target.dingtalk': 'DingTalk',
  'target.feishu': 'Feishu',
  'target.email': 'Email',
  'mode.image': 'Copy as a long image',
  'mode.native': 'Copy as editable text with images',
  'mode.html': 'Copy as email HTML with editable tables',
  'toast.image': 'Long image copied. Paste it into the {target} chat box',
  'toast.copied': 'Copied. Paste it into the {target} chat box',
  'toast.feishu': 'Copied. Expand Feishu\'s rich-text input first, then paste once',
  'toast.dingtalkWindows': 'Copied in a compatible format. Paste into DingTalk and check the images',
  'toast.email': 'Copied. Paste it into your email editor',
} satisfies Record<ShareKey, string>
