const {content:home}=require('./site-home.cjs');
const chinese=require('./site-content.cjs').guides,english=require('./site-content-en.cjs').guides;
const labels={
 'zh-CN':{navigation:'导航',imageAlt:'md2chat Markdown 输入与图文预览界面',language:'语言',editor:'试用转换器',download:'下载桌面版',steps:'操作步骤',example:'可复现的公开示例',check:'在自己的草稿中核对开头、表格图片和结尾，并检查普通文字仍可编辑。',evidence:'实现与验证依据',sources:'官方资料',related:'相关指南',cta:'在编辑器试用此示例',feedback:'反馈问题',reviewed:'内容核对日期',contents:'本页内容'},
 en:{navigation:'Navigation',imageAlt:'md2chat Markdown input and chat preview',language:'Language',editor:'Try the editor',download:'Download desktop',steps:'Step by step',example:'A public example',check:'Check the opening text, table image and closing text in your own draft. Ordinary text should remain editable.',evidence:'Implementation and validation records',sources:'Official sources',related:'Related guides',cta:'Try the sample in the editor',feedback:'Report an issue',reviewed:'Content reviewed',contents:'On this page'}
};
const content={'zh-CN':{home:home['zh-CN'],guides:chinese,labels:labels['zh-CN']},en:{home:home.en,guides:english,labels:labels.en}};
for(const locale of ['es','pt-BR','ja','ko','de','fr','hi']){
 const copy=require('./site-copy/'+locale+'.cjs');
 if(copy.guides.length!==english.length)throw new Error('Incomplete guide edition: '+locale);
 content[locale]={...copy,guides:english.map(base=>{
  const translated=copy.guides.find(guide=>guide.slug===base.slug);
  if(!translated?.title||!translated.description||translated.sections?.length<3)throw new Error('Missing translated guide: '+locale+'/'+base.slug);
  return {...translated,reviewed:'2026-10-18',example:copy.example,steps:translated.steps||copy.steps,
   evidence:base.evidence.map(([,url])=>[copy.labels.evidence+' · '+url.split('/').pop(),url]),
   sources:base.sources?.map(([,url],i)=>[copy.labels.sources+' '+(i+1),url])};
 })};
}
module.exports={content};
