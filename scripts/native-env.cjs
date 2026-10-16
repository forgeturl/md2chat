const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function nativeEnv(env = process.env) {
 const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
 return fs.existsSync(cargoBin) ? {...env, PATH: cargoBin + path.delimiter + (env.PATH || '')} : {...env};
}
module.exports = {nativeEnv};
