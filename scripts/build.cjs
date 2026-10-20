const fs=require('node:fs'),path=require('node:path');
function buildSite(root=path.resolve(__dirname,'..'),out=path.join(root,'dist')){
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
const {editions,sourcePath}=require('./site-locales.cjs');
for(const name of ['index.html','editor.html','assets','guides',...editions.map(item=>item.directory).filter(Boolean),'sitemap.xml','llms.txt','LICENSE','THIRD_PARTY_NOTICES.md'])fs.cpSync(path.join(root,sourcePath(name)),path.join(out,name),{recursive:true});
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Static site built in dist/');
return out;
}
if(require.main===module)buildSite();
module.exports={buildSite};
