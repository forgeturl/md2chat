const crypto = require('node:crypto');
function signingFixture() {
 const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
 const keyId = crypto.randomBytes(8);
 const rawKey = publicKey.export({type: 'spki', format: 'der'}).subarray(-32);
 const key = Buffer.concat([Buffer.from('Ed'), keyId, rawKey]);
 return {
  publicKey: Buffer.from('untrusted comment: ephemeral test key\n' + key.toString('base64') + '\n').toString('base64'),
  sign(data) {
   const signature = crypto.sign(null, crypto.createHash('blake2b512').update(data).digest(), privateKey);
   const packet = Buffer.concat([Buffer.from('ED'), keyId, signature]);
   const comment = 'timestamp:1\tfile:fixture';
   const global = crypto.sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
   return Buffer.from('untrusted comment: test fixture\n' + packet.toString('base64') + '\ntrusted comment: ' + comment + '\n' + global.toString('base64') + '\n').toString('base64');
  }
 };
}
module.exports = {signingFixture};
