/* Shared, allowlisted clipboard profiles. No application-private formats in the web client. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChatTargets=api;})(globalThis,()=>{
 const profiles=Object.freeze({
  wechat:{label:'微信',note:'标准图文；请在聊天框确认图片完整。'},
  dingtalk:{label:'钉钉',note:'仅限桌面版。Mac 使用原生图文；Windows 使用兼容图文，请确认图片完整，当前方案待实测。'},
  feishu:{label:'飞书',note:'实验性标准图文，尚未完成飞书客户端验证。'},
  wecom:{label:'企微',note:'图文请按顺序分段复制、粘贴；文字可编辑，强调样式不保证保留。Windows 待验证。'},
  email:{label:'邮件',note:'实验性邮件 HTML，表格可编辑；内嵌图片需确认客户端粘贴及发送后仍保留。'}
 });
 const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 function profile(target){if(!Object.hasOwn(profiles,target))throw new Error('不支持的目标平台');return profiles[target];}
 function runsHtml(part){
  const runs=Array.isArray(part.runs)&&part.runs.length<10000&&part.runs.every(r=>r&&typeof r.text==='string')&&part.runs.map(r=>r.text).join('')===part.text?part.runs:[{text:part.text}];
  return runs.map(r=>{let s=esc(r.text).replaceAll('\n','<br>');if(r.bold)s='<strong>'+s+'</strong>';if(r.italic)s='<em>'+s+'</em>';if(r.strikethrough)s='<s>'+s+'</s>';return s;}).join('');
 }
 function render(parts,target){
  profile(target);let images=0;
  const html=parts.map(p=>{
   if(p.type==='text')return '<div style="margin:0;line-height:1.5;white-space:pre-wrap">'+runsHtml(p)+'</div>';
   if(p.type==='table'&&target==='email')return '<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'+p.rows.map((row,i)=>'<tr>'+row.map(cell=>'<'+(i?'td':'th')+' style="border:1px solid #ccd5df;text-align:left;'+(i?'':'background:#edf2f8;')+'">'+esc(cell).replaceAll('\n','<br>')+'</'+(i?'td':'th')+'>').join('')+'</tr>').join('')+'</table>';
   if(p.type!=='image'||!/^data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(p.src))throw new Error('图片必须是完整的内嵌图片');
   const naturalWidth=Number.isFinite(p.width)&&p.width>0?p.width:null;
   const requestedWidth=Number.isFinite(p.displayWidth)&&p.displayWidth>0?p.displayWidth:naturalWidth;
   const width=requestedWidth===null?null:Math.min(1100,naturalWidth??1100,Math.max(1,requestedWidth));
   images++;return '<div style="margin:0;line-height:0"><img src="'+p.src+'"'+(width!==null?' width="'+width+'"':'')+' alt="图片" style="display:block;max-width:100%;height:auto;border:0"></div>';
  }).join('');
  const body=target==='email'?'<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">'+html+'</div>':html;
  return {html:'<meta charset="utf-8">'+body,plain:parts.map(p=>p.type==='text'?p.text:p.type==='table'?p.rows.map(r=>r.join(' | ')).join('\n'):'[图片]').join('\n'),imageCount:images};
 }
 return {profiles,profile,render};
});
