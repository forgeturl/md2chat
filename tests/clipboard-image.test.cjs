const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {layout,fitScales}=require('../assets/clipboard-image.js');
const source=fs.readFileSync(path.join(__dirname,'../assets/clipboard-image.js'),'utf8');
const PNG='data:image/png;base64,AAAA';
const measure=text=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length*20;
const textOf=node=>node.runs.map(run=>run.text).join('');

test('short text and a narrow diagram size the output to the widest content plus margins',async()=>{
 const parts=[{type:'text',text:'【流程示例】\n文字与图表，按原顺序发出去。'},
  {type:'image',src:PNG,width:800,height:600,displayWidth:400}];
 const page=layout(parts,measure);
 assert.equal(page.width,464);
 assert.equal(page.pixelWidth,928);
 assert.equal(page.height,440);
 const {render}=browser({imageWidth:800,imageHeight:600});
 const image=await render(parts);
 assert.equal(image.width,928);
 assert.equal(image.height,880);
});

test('content width follows styled text, rounds up fractional widths, and keeps the wrapping limit',()=>{
 const parts=[{type:'text',text:'标题',runs:[{text:'标题',bold:true}]},{type:'image',src:PNG,width:20,height:20}];
 const page=layout(parts,(_text,run)=>run.bold?41.25:20);
 assert.equal(page.width,106);
 assert.equal(page.nodes[0].width,41.25);
 const wide=layout([{type:'text',text:'字'.repeat(60)}],measure);
 assert.equal(wide.width,1164);
 assert.deepEqual(wide.nodes.map(textOf),['字'.repeat(55),'字'.repeat(5)]);
});

test('narrow long content fits its actual pixel area while excessive canvas height is rejected',()=>{
 const page=layout([{type:'image',src:PNG,width:100,height:9000}],measure);
 assert.equal(page.pixelWidth,328);
 assert.equal(page.pixelHeight,18128);
 const narrow=[{type:'text',text:'行\n'.repeat(600)}];
 assert.throws(()=>layout(narrow,measure),/2,000 万像素/);
 const fitted=layout(narrow,measure,fitScales(narrow,measure)[0]);
 assert(fitted.scale<2&&fitted.scale>=1&&fitted.pixelHeight<=32767);
});

test('composition preserves text/image order, blank lines, styles, and source data',()=>{
 const input=[{type:'text',text:'标题\n\n正文',runs:[{text:'标题',bold:true},{text:'\n\n'},{text:'正文',italic:true,strikethrough:true,code:true}]},{type:'image',src:PNG,width:2200,height:600},{type:'text',text:'结尾'}];
 const before=JSON.stringify(input),page=layout(input,measure);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(page.nodes.map(node=>node.type==='text'?textOf(node):'[图片]'),['标题','','正文','[图片]','结尾']);
 assert.equal(page.nodes[0].runs[0].bold,true);
 assert.equal(page.nodes[2].runs[0].italic,true);
 assert.equal(page.nodes[2].runs[0].strikethrough,true);
 assert.equal(page.nodes[2].runs[0].code,true);
 assert.equal(page.nodes[3].width,1100);assert.equal(page.nodes[3].height,300);
 assert(page.nodes.every((node,index)=>!index||node.y>=page.nodes[index-1].y+page.nodes[index-1].height));
 assert.equal(page.pixelWidth,page.width*2);assert.equal(page.pixelHeight,page.height*2);
});

test('wrapping keeps grapheme clusters intact, including emoji split across style runs',()=>{
 const family='👨‍👩‍👧‍👦',flag='🇨🇳',accent='e\u0301';
 const text='字'.repeat(54)+family+flag+accent+'尾';
 const page=layout([{type:'text',text,runs:[{text:'字'.repeat(54)+'👨',bold:true},{text:'‍👩‍👧‍👦'+flag+accent+'尾',italic:true}]}],measure);
 assert.deepEqual(page.nodes.map(textOf),['字'.repeat(54)+family,flag+accent+'尾']);
 assert.equal(page.nodes.map(textOf).join(''),text);
 assert.equal(page.nodes[0].runs.at(-1).text.endsWith(family),true);
 assert.equal(page.nodes[1].runs[0].italic,true);
 assert(page.nodes.every(node=>node.width<=1100));
});

test('line breaks and tabs remain readable; small images retain natural size',()=>{
 const page=layout([{type:'text',text:'首\r\n\t次\r末\n'},{type:'image',src:PNG,width:90,height:30}],measure);
 assert.deepEqual(page.nodes.filter(node=>node.type==='text').map(textOf),['首','    次','末','']);
 assert.equal(page.nodes.at(-1).width,90);assert.equal(page.nodes.at(-1).height,30);
});

test('high-DPI bitmaps retain their intended display width and natural aspect ratio',async()=>{
 const input=[{type:'image',src:PNG,width:1040,height:400,displayWidth:520,displayHeight:9999}];
 const page=layout(input,measure);
 assert.equal(page.nodes[0].width,520);assert.equal(page.nodes[0].height,200);
 const small=layout([{type:'image',src:PNG,width:100,height:50,displayWidth:500}],measure);
 assert.equal(small.nodes[0].width,100);assert.equal(small.nodes[0].height,50);
 const wide=layout([{type:'image',src:PNG,width:4000,height:2000,displayWidth:2000}],measure);
 assert.equal(wide.nodes[0].width,1100);assert.equal(wide.nodes[0].height,550);
 const {render,operations}=browser({imageWidth:1040,imageHeight:400});
 await render([{type:'image',src:PNG,displayWidth:520,displayHeight:9999}]);
 assert.deepEqual(operations.find(op=>op[0]==='image').slice(-2),[520,200]);
 assert.equal(input[0].width,1040);assert.equal(input[0].height,400);
});

test('composition rejects unsupported sources, malformed runs, excessive text/parts, and oversized pages',()=>{
 for(const src of ['https://example.com/a.png','file:///tmp/a.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,AA?A'])assert.throws(()=>layout([{type:'image',src,width:100,height:100}],measure),/内嵌/);
 assert.throws(()=>layout([{type:'text',text:'ab',runs:[{text:'a'}]}],measure),/样式内容无效/);
 assert.throws(()=>layout([{type:'text',text:'a'.repeat(200001)}],measure),/文字过长/);
 assert.throws(()=>layout(Array.from({length:501},()=>({type:'text',text:'a'})),measure),/段落过多/);
 assert.throws(()=>layout([{type:'image',src:PNG,width:1100,height:9000}],measure),/2,000 万像素/);
 assert.throws(()=>layout([{type:'text',text:('行'.repeat(55)+'\n').repeat(200)}],measure),/2,000 万像素/);
 assert.throws(()=>layout([{type:'image',src:PNG,width:0,height:10}],measure),/图片尺寸无效/);
 assert.throws(()=>layout([{type:'image',src:PNG,width:100,height:10,displayWidth:-1}],measure),/图片显示尺寸无效/);
});

function browser({badImage=false,imageWidth=600,imageHeight=300,pngBytes=10}={}){
 const operations=[],allocations=[];
 const canvas={_width:300,_height:150,get width(){return this._width;},set width(value){this._width=value;allocations.push([value,this._height]);},get height(){return this._height;},set height(value){this._height=value;allocations.push([this._width,value]);},getContext(){return context;},toBlob(callback,type){assert.equal(type,'image/png');callback({size:pngBytes});}};
 const context={font:'',fillStyle:'',measureText:text=>({width:measure(text)}),scale:(...args)=>operations.push(['scale',...args]),fillRect(...args){operations.push(['rect',this.fillStyle,...args]);},fillText(text,x,y){operations.push(['text',text,this.font,x,y]);},drawImage(image,...args){operations.push(['image',image.src,...args]);}};
 class Image {constructor(){this.naturalWidth=imageWidth;this.naturalHeight=imageHeight;}async decode(){operations.push(['decode',this.src]);if(badImage)throw new Error('invalid bitmap');}}
 class FileReader {readAsDataURL(){this.result='data:image/png;base64,UE5H';this.onload();}}
 const environment={Image,FileReader,document:{createElement(tag){assert.equal(tag,'canvas');return canvas;}}};
 vm.createContext(environment);vm.runInContext(source,environment);
 return {render:environment.ClipboardImage.render,operations,allocations,canvas};
}

test('converted headings draw bold at the body font size without injected brackets',async()=>{
 const markdown=require('../assets/chat-markdown.js');
 const {segments}=await require('../assets/chat-payload.js').build('# 标题\n\n###### 小标题\n\n正文',{markdown,renderers:{}});
 const {render,operations}=browser();await render(segments);
 const drawn=operations.filter(op=>op[0]==='text');
 assert.equal(drawn.map(op=>op[1]).join(''),'标题小标题正文');
 assert(drawn.filter(op=>op[1]!=='正文').every(op=>op[2].startsWith('600 20px')));
 assert(drawn.find(op=>op[1]==='正文')[2].startsWith('400 20px'));
});

test('render produces one white 2x PNG, with styled text and images drawn in source order',async()=>{
 const {render,operations,canvas}=browser();
 const result=await render([{type:'text',text:'粗体',runs:[{text:'粗体',bold:true,italic:true,code:true,strikethrough:true}]},{type:'image',src:PNG},{type:'text',text:'结束'}]);
 assert.equal(result.type,'image');assert.equal(result.src,'data:image/png;base64,UE5H');
 assert.equal(result.width,result.displayWidth*2);assert.equal(result.height,result.displayHeight*2);
 assert.deepEqual(operations.filter(op=>op[0]==='text'||op[0]==='image').map(op=>op[1]),['粗体',PNG,'结束']);
 assert(operations.some(op=>op[0]==='rect'&&op[1]==='#ffffff'&&op[4]===result.displayWidth&&op[5]===result.displayHeight));
 assert(operations.some(op=>op[0]==='text'&&op[2].includes('italic 600 19px')));
 assert(operations.some(op=>op[0]==='rect'&&op.at(-1)===1.2));
 assert.equal(canvas.width,0);assert.equal(canvas.height,0);
});

test('decoding and layout failures reject before any large canvas allocation',async()=>{
 const bad=browser({badImage:true});await assert.rejects(()=>bad.render([{type:'image',src:PNG}]),/第 1 张图片无法读取/);
 assert(bad.allocations.every(([width,height])=>width*height<=45000));
 const tall=browser({imageWidth:1100,imageHeight:9000});await assert.rejects(()=>tall.render([{type:'image',src:PNG}]),/2,000 万像素/);
 assert(tall.allocations.every(([width,height])=>width*height<=45000));
 const untrusted=browser();await assert.rejects(()=>untrusted.render([{type:'image',src:'https://example.com/a.png'}]),/内嵌/);
 assert.equal(untrusted.operations.length,0);
});

test('excessive encoded PNG size reports an actionable error and releases the bitmap',async()=>{
 const {render,canvas}=browser({pngBytes:11*1024*1024});
 await assert.rejects(()=>render([{type:'text',text:'test'}]),/PNG 文件过大.*10 MB/);
 assert.equal(canvas.width,0);assert.equal(canvas.height,0);
});

test('fit mode keeps long content in one image by lowering resolution, never below 1x',()=>{
 const lines=n=>({type:'text',text:Array.from({length:n},()=> '行'.repeat(55)).join('\n')});
 assert.throws(()=>layout([lines(400)],measure),/2,000 万像素/);
 const scales=fitScales([lines(400)],measure);
 assert(scales[0]<2&&scales[0]>1&&scales.at(-1)===1);
 for(let i=1;i<scales.length;i++)assert(scales[i]<scales[i-1]);
 const page=layout([lines(400)],measure,scales[0]);
 assert(page.pixelWidth*page.pixelHeight<=20000000&&page.scale===scales[0]);
 assert.deepEqual(fitScales([lines(3)],measure),[2,1.75,1.5,1.25,1]);
 assert.throws(()=>fitScales([lines(1000)],measure),/内容过长/);
});
