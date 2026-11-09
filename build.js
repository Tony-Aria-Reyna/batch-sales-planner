// Builds public/ (what Firebase Hosting serves) from src/. Run: npm run build
// MOCK=1 builds dist-test/ against the fake Firebase in test/ for screen tests.
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const MOCK = process.env.MOCK === '1';
const out = path.join(__dirname, MOCK ? 'dist-test' : 'public'); fs.mkdirSync(out, { recursive: true });
const alias = MOCK ? { 'firebase/app': './test/mock-app.js', 'firebase/auth': './test/mock-auth.js', 'firebase/firestore': './test/mock-firestore.js', 'firebase/messaging': './test/mock-messaging.js' } : undefined;
const sync = esbuild.buildSync({ entryPoints: ['src/sync.js'], bundle: true, minify: true, format: 'iife', globalName: 'SYNC', write: false, target: 'es2019', alias }).outputFiles[0].text;
const cfgFile = path.join(__dirname, 'firebase-config.json');
const config = fs.existsSync(cfgFile) ? JSON.stringify(JSON.parse(fs.readFileSync(cfgFile, 'utf8'))) : 'null';
const version = 'rs-' + Date.now().toString(36);
const html = fs.readFileSync('src/app.html', 'utf8')
  .replace('/*@SYNC@*/', () => sync)
  .replace('/*@MODULES@*/', () => ['catalogue.js', 'till.js', 'calendar.js', 'places.js', 'lists.js', 'voice.js', 'brew.js', 'health.js', 'search.js', 'help.js', 'orders.js', 'reports.js', 'notify.js', 'contacts.js', 'checkin.js', 'clock.js'].map(f => fs.readFileSync(path.join('src', f), 'utf8')).join('\n'))
  .replace('/*@CONFIG@*/null', () => MOCK ? JSON.stringify({ projectId: 'mock', apiKey: 'mock', authDomain: 'mock' }) : config)
  .replace('/*@VERSION@*/', version);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version }));
fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync('src/sw.js', 'utf8').replace('__VERSION__', version));
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'privacy.html']) fs.copyFileSync(path.join('src', f), path.join(out, f));
// readers for "Load a price list": loaded only when someone picks a PDF or spreadsheet
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) fs.copyFileSync(path.join(__dirname, 'node_modules/pdfjs-dist/build', f), path.join(out, 'lib', f));
esbuild.buildSync({ entryPoints: ['src/xlsx-entry.js'], bundle: true, minify: true, format: 'iife', outfile: path.join(out, 'lib', 'xlsx.js'), target: 'es2019' });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync('src/fonts/cinzel-600.woff2', path.join(out, 'fonts', 'cinzel-600.woff2'));
// her logo is fetched from her website by GitHub at build time (scripts/fetch-logo.py); without it the app shows its icon
if (fs.existsSync('src/brand-logo.webp')) fs.copyFileSync('src/brand-logo.webp', path.join(out, 'brand-logo.webp'));
console.log('built', version, (html.length / 1024).toFixed(0) + ' KB', '->', path.basename(out));
