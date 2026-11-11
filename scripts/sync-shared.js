// Puts helper/shared.js into helper/Code.gs between the @shared markers. Run after editing shared.js (npm test does).
const fs = require('fs');
const shared = fs.readFileSync('helper/shared.js', 'utf8').trim();
const p = 'helper/Code.gs', s = fs.readFileSync(p, 'utf8');
const a = s.indexOf('/* @shared-start'), b = s.indexOf('/* @shared-end */');
if (a < 0 || b < 0) throw new Error('markers missing in Code.gs');
const head = s.slice(0, s.indexOf('\n', a) + 1);
fs.writeFileSync(p, head + shared + '\n' + s.slice(b));
console.log('shared.js synced into Code.gs');
