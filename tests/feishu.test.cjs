const {test} = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const {FORMAT,RAW_FORMAT,FRAGMENT_TYPE,BUSINESS_TYPE,makeFragment,encodeClipboardData} = require('../desktop/feishu.cjs');

function decodeClipboardData(buffer) {
 assert(Buffer.isBuffer(buffer));
 assert(buffer.length >= 8);
 assert.equal(buffer.readUInt32LE(0), buffer.length - 4);
 const count = buffer.readUInt32LE(4), result = new Map();
 let offset = 8;
 const readString = () => {
  assert(offset + 4 <= buffer.length);
  const codeUnits = buffer.readUInt32LE(offset);
  offset += 4;
  const end = offset + codeUnits * 2;
  assert(end <= buffer.length);
  const value = buffer.toString('utf16le', offset, end);
  offset = Math.ceil(end / 4) * 4;
  assert(offset <= buffer.length);
  for (let i = end; i < offset; i++) assert.equal(buffer[i], 0);
  return value;
 };
 for (let i = 0; i < count; i++) {
  const key = readString(), value = readString();
  assert(!result.has(key));
  result.set(key, value);
 }
 assert.equal(offset, buffer.length);
 return result;
}

const image = (name, extra={}) => ({type:'image',path:path.join(path.parse(process.cwd()).root,'md2chat-test',name),width:640,height:360,...extra});
const ops = fragment => fragment.deltas['0'].ops;

test('Feishu uses Chromium custom data with the IM_CHAT business key and exact UTF16 lengths', () => {
 assert.equal(FORMAT, 'org.chromium.web-custom-data');
 assert.equal(RAW_FORMAT, 'electron application/osclipboard;format="org.chromium.web-custom-data"');
 const fragment = makeFragment([{type:'text',text:'中文😀e\u0301\u0000尾'}]);
 const buffer = encodeClipboardData(fragment), decoded = decodeClipboardData(buffer);
 assert.equal(decoded.size, 2);
 assert.equal(decoded.get(BUSINESS_TYPE), 'IM_CHAT');
 assert.deepEqual(JSON.parse(decoded.get(FRAGMENT_TYPE)), fragment);
 assert.deepEqual(Object.keys(fragment), ['deltas','editorUniqueId']);
 assert.deepEqual(Object.keys(fragment.deltas), ['0']);
 assert.equal(fragment.deltas['0'].zoneId, '0');
 assert.equal(fragment.deltas['0'].zoneType, 'Z');
 assert.match(fragment.editorUniqueId, /^[a-f0-9]{6}$/);
});

test('Feishu keeps text and local images in order with explicit part boundaries', () => {
 const fragment = makeFragment([{type:'text',text:'前文'},image('blue.png'),{type:'text',text:'中间\n第二行'},image('green.png'),{type:'text',text:'后文'}]);
 assert.deepEqual(ops(fragment).map(op => op.insert), ['前文','\n','*','\n','中间\n第二行','\n','*','\n','后文']);
 const images = ops(fragment).filter(op => op.attributes?.entityType === 'image');
 assert.equal(images.length, 2);
 for (const [index, op] of images.entries()) {
  const value = JSON.parse(op.attributes.image);
  assert.deepEqual(value, {src:image(index ? 'green.png' : 'blue.png').path,zoneId:'0',key:op.attributes.uuid,imageState:'INITIAL',width:640,height:360});
  assert.match(op.attributes.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 }
 assert.notEqual(images[0].attributes.uuid, images[1].attributes.uuid);
 assert.deepEqual(JSON.parse(decodeClipboardData(encodeClipboardData(fragment)).get(FRAGMENT_TYPE)), fragment);
});

test('Feishu emits only supported styles from verified text runs', () => {
 const fragment = makeFragment([{type:'text',text:'粗斜删普通',runs:[
  {text:'粗',bold:true,underline:true,copyId:'untrusted'},
  {text:'斜',italic:true},
  {text:'删',strikethrough:true,bold:'true'},
  {text:'普通',italic:1},
 ]}]);
 assert.deepEqual(ops(fragment), [
  {insert:'粗',attributes:{bold:'true'}},
  {insert:'斜',attributes:{italic:'true'}},
  {insert:'删',attributes:{strikethrough:'true'}},
  {insert:'普通'},
 ]);
 const combined = makeFragment([{type:'text',text:'全部',runs:[{text:'全部',bold:true,italic:true,strikethrough:true}]}]);
 assert.deepEqual(ops(combined), [{insert:'全部',attributes:{bold:'true',italic:'true',strikethrough:'true'}}]);
});

test('Feishu falls back to authoritative text when text runs are invalid', () => {
 for (const runs of [undefined,null,{},[],[{text:'替换',bold:true}],[{text:12}],[null],Array.from({length:10000},()=>({text:''}))]) {
  assert.deepEqual(ops(makeFragment([{type:'text',text:'原文',runs}])), [{insert:'原文'}]);
 }
 assert.deepEqual(ops(makeFragment([{type:'text',text:''},{type:'text',text:'尾'}])), [{insert:'\n'},{insert:'尾'}]);
});

test('Feishu generates fresh image identities and excludes supplied account or uploaded-image metadata', () => {
 const part = image('own.png', {copyId:'untrusted-copy',token:'untrusted-token',key:'untrusted-key',uuid:'untrusted-uuid',image:{token:'nested-token'},src:'https://example.invalid/untrusted'});
 const first = makeFragment([part]), second = makeFragment([part]);
 assert.notEqual(ops(first)[0].attributes.uuid, ops(second)[0].attributes.uuid);
 for (const fragment of [first,second]) {
  const value = JSON.parse(ops(fragment)[0].attributes.image);
  assert.deepEqual(Object.keys(value), ['src','zoneId','key','imageState','width','height']);
  assert(!JSON.stringify(fragment).includes('untrusted'));
  assert(!JSON.stringify(fragment).includes('nested-token'));
  assert.equal(value.src, part.path);
 }
});

test('Feishu rejects invalid local image paths and malformed parts', () => {
 for (const value of [undefined,null,123,'','relative.png','https://example.invalid/image.png','file:///tmp/image.png']) {
  assert.throws(() => makeFragment([image('unused.png',{path:value})]), /绝对路径/);
 }
 for (const parts of [null,[],{},[null],[{type:'html'}],[{type:'text',text:1}]]) assert.throws(() => makeFragment(parts), /飞书内容/);
});

test('Feishu Pickle rejects truncation, corrupt lengths and unsupported oversized strings', () => {
 const buffer = encodeClipboardData(makeFragment([{type:'text',text:'测试'}]));
 assert.throws(() => decodeClipboardData(buffer.subarray(0,-1)));
 const invalidLength = Buffer.from(buffer);
 invalidLength.writeUInt32LE(0xffffffff, 8);
 assert.throws(() => decodeClipboardData(invalidLength));
 const invalidCount = Buffer.from(buffer);
 invalidCount.writeUInt32LE(3, 4);
 assert.throws(() => decodeClipboardData(invalidCount));
 assert.throws(() => encodeClipboardData(undefined), /数据格式错误/);
 assert.throws(() => makeFragment([{type:'text',text:'x'.repeat(4*1024*1024+1)}]), /8 MiB/);
 assert.throws(() => encodeClipboardData({text:'x'.repeat(4*1024*1024)}), /8 MiB/);
 const withinLimit = encodeClipboardData({text:'x'.repeat(4*1024*1024-1024)});
 assert(withinLimit.length < 8*1024*1024);
 assert.equal(decodeClipboardData(withinLimit).size, 2);
});
