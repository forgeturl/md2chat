// One route registry for generation, previews and the public build allowlist.
const {locales}=require('../assets/locales.json');
const directories={'zh-CN':'',en:'en',es:'es','pt-BR':'pt-br',ja:'ja',ko:'ko',de:'de',fr:'fr',hi:'hi'};
const ogLocales={'zh-CN':'zh_CN',en:'en_US',es:'es_ES','pt-BR':'pt_BR',ja:'ja_JP',ko:'ko_KR',de:'de_DE',fr:'fr_FR',hi:'hi_IN'};
const editions=locales.map(locale=>{
 if(!Object.hasOwn(directories,locale.code)||!ogLocales[locale.code])throw new Error('Missing site route: '+locale.code);
 return {...locale,directory:directories[locale.code],ogLocale:ogLocales[locale.code]};
});
function route(locale,slug=''){
 const edition=editions.find(item=>item.code===locale);
 if(!edition)throw new Error('Unsupported site language: '+locale);
 return (edition.directory?edition.directory+'/':'')+(slug?'guides/'+slug+'.html':'');
}
module.exports={editions,route};
