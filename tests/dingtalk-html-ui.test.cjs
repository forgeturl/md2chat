const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('diagnostic dialog offers exactly two actions and no clipboard rewriting experiments',()=>{
 const html=fs.readFileSync(require.resolve('../editor.html'),'utf8'),panel=html.slice(html.indexOf('<dialog id="diagnostic-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog id="diagnostic-dialog"')));
 assert.equal((panel.match(/<button\b/g)||[]).length,3); // Includes the window's close control.
 assert.match(panel,/id="read-clipboard"/);assert.match(panel,/id="export-diagnostics"/);
 for(const obsolete of ['copy-report','clear-diagnostics','data-dingtalk-html-test','clipboard-paste'])assert(!panel.includes(obsolete),obsolete);
});

test('GitHub feedback opens only the issue template without adding clipboard content to the URL',()=>{
 const html=fs.readFileSync(require.resolve('../editor.html'),'utf8');
 const feedback=html.match(/<p id="diagnostic-feedback"[\s\S]*?<\/p>/)[0];assert.match(feedback,/<p[^>]+hidden>/);
 const url=new URL(feedback.match(/href="([^"]+)"/)[1]);assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/forgeturl/md2chat/issues/new');assert.equal(url.searchParams.get('template'),'compatibility.md');assert.deepEqual([...url.searchParams.keys()],['template']);
 const template=fs.readFileSync(require.resolve('../.github/ISSUE_TEMPLATE/compatibility.md'),'utf8');assert.match(template,/不是脱敏报告/);assert.match(template,/手动/);assert.match(template,/original text, HTML, images/);
});
