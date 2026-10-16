const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.join(__dirname,'..'),read=name=>yaml.load(fs.readFileSync(path.join(root,'.github/workflows',name),'utf8'));
test('release Windows native clipboard failures block installer builds and preserve QA evidence',()=>{
 const workflow=read('desktop-release.yml'),steps=workflow.jobs.build.steps;
 const index=steps.findIndex(step=>step.run==='npm run desktop:test:windows');assert(index>=0);
 assert.equal(steps[index].if,"matrix.platform == 'win'");assert(!steps[index]['continue-on-error']);
 assert(index<steps.findIndex(step=>step.name==='Build Windows installer'));
 const evidence=steps.find(step=>step.with?.name==='windows-clipboard-qa-release');
 assert.match(evidence.if,/always\(\)/);assert(evidence.with.path.includes('release/qa/windows-clipboard.json'));assert(evidence.with.path.includes('examples/windows-clipboard/'));
 assert(workflow.jobs.publish.needs.includes('build'));
});
test('Windows clipboard validation can run independently without publishing or secrets',()=>{
 const workflow=read('windows-clipboard.yml');assert(Object.hasOwn(workflow.on,'workflow_dispatch'));
 assert.equal(workflow.jobs.clipboard['runs-on'],'windows-latest');assert.equal(workflow.permissions.contents,'read');
 const text=JSON.stringify(workflow);assert(!text.includes('secrets.'));assert(!text.includes('gh release'));
 assert(workflow.jobs.clipboard.steps.some(step=>step.run==='npm run desktop:test:windows'));
 assert(read('actions-cleanup.yml').on.workflow_run.workflows.includes(workflow.name));
});
