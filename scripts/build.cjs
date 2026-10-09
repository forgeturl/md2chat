const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const name of ['index.html','assets','LICENSE','THIRD_PARTY_NOTICES.md'])fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Static site built in dist/');
