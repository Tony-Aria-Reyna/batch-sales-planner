// Prints guide.html to an A4 PDF with bookmarks (the headings) and working links.
const path = require('path'), { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'guide.html'), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const over = await p.evaluate(() => [...document.querySelectorAll('.page')].map((pg, i) => { const bd = pg.querySelector('.body'); return bd && bd.scrollHeight > bd.clientHeight + 2 ? (i + 1) + ':' + (bd.scrollHeight - bd.clientHeight) : null; }).filter(Boolean));
  if (over.length) console.log('PAGES TOO FULL (page:px over):', over.join(' '));
  const out = process.argv[2] || path.join(__dirname, 'Rata-and-Smudge-app-quick-guide.pdf');
  await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, outline: true, tagged: true });
  console.log('saved', out); await b.close();
})();
