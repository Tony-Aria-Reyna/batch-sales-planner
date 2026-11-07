// Screen tests against the fake Firebase (npm test). Checks the phase 1 flows at iPad and Android sizes
// and saves screenshots to test/shots/. Real-device checks on the iPad and Android are still required.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium, devices } = require(process.env.PW || 'playwright');
const root = path.join(__dirname, '..', 'dist-test'), shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(r); });
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

(async () => {
  await new Promise(r => server.listen(0, r)); const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ipad = await browser.newContext({ viewport: { width: 1180, height: 820 }, userAgent: IPAD_UA, hasTouch: true, deviceScaleFactor: 1 });
  await ipad.addInitScript(() => { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); });
  const page = await ipad.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  const signIn = (p, email) => p.evaluate(e => SYNC.testSignIn(e), email);
  const text = p => p.evaluate(() => document.body.innerText);

  console.log('iPad landscape: sign-in and set up');
  await page.goto(url); await page.evaluate(() => localStorage.setItem('mockdb', JSON.stringify({ 'admins/admin@example.com': { note: 'test admin' } }))); await page.reload(); await page.waitForSelector('#gIn');
  ok(/Sign in with Google/.test(await text(page)), 'sign-in screen shows');
  await page.screenshot({ path: path.join(shots, '01-ipad-signin.png') });
  await signIn(page, 'admin@example.com'); await page.waitForSelector('#gName');
  ok(/signed in as admin@example.com/i.test(await text(page)), 'not-yet-set-up screen names the signed-in account');
  await page.fill('#gName', 'Rata & Smudge'); await page.click('#gNew'); await page.waitForSelector('.tiles');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => ['inputs', 'recipes', 'products', 'sales', 'orders'].every(c => S[c].length === 0)), 'a new business starts empty');
  ok((await page.$$('.tile')).length === 6, 'owner sees six tiles');
  ok(/Rata & Smudge/.test(await page.textContent('.top h1')), 'business name in the top bar');
  await page.screenshot({ path: path.join(shots, '02-ipad-home-landscape.png') });
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, '03-ipad-home-portrait.png') });
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.tiles')).gridTemplateColumns.split(' ').length);
  ok(cols === 2, 'portrait iPad shows tiles two across');
  await page.setViewportSize({ width: 1180, height: 820 });

  console.log('Setup, PIN and people');
  await page.click('[data-go="setup"]'); await page.waitForSelector('#bizName');
  ok(!!(await page.$('#bk')), 'Setup has a visible Back button');
  await page.click('#setPin'); for (const k of '1234') await page.click(`[data-k="${k}"]`);
  await page.waitForTimeout(100); for (const k of '1234') await page.click(`[data-k="${k}"]`);
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!S.settings.pinHash), 'PIN saved (as a hash)');
  await page.click('#addPerson'); await page.fill('#pE', 'helper@example.com'); await page.click('#pA'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => SYNC.roleOf('helper@example.com') === 'helper'), 'added a helper (helper is the default role)');
  // the account that set the business up is the main owner; here the test admin plays that part
  await page.click('#addPerson'); await page.fill('#pE', 'co@example.com'); await page.click('[data-r="owner"]'); await page.click('#pA'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => SYNC.roleOf('co@example.com') === 'owner' && SYNC.getMainOwner() === 'admin@example.com'), 'added a co-owner; the creator stays main owner');
  ok(!(await page.$('[data-role="admin@example.com"]')), 'the main owner has no Change button (cannot be changed or removed)');
  await page.click('#addPerson'); ok(!(await page.$('[data-r="owner"]')), 'no third owner offered'); await page.click('#pC');
  await page.locator('[data-role="co@example.com"]').click(); await page.click('[data-r="manager"]'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => SYNC.roleOf('co@example.com') === 'manager' && SYNC.getOwners().join() === 'admin@example.com'), 'co-owner can be changed to a manager');
  await page.locator('[data-role="co@example.com"]').click(); await page.click('[data-r="owner"]'); await page.click('#cY'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => SYNC.getOwners().join() === 'admin@example.com,co@example.com'), 'made co-owner again, after a warning');
  ok(await page.evaluate(() => { try { SYNC.setRole('admin@example.com', 'manager'); return false; } catch (e) { return e.code === 'main-owner'; } }), 'the app refuses to change the main owner');
  await page.screenshot({ path: path.join(shots, '04-ipad-setup.png'), fullPage: true });
  await page.click('#bk'); await page.waitForSelector('.tiles');
  await page.click('[data-go="setup"]'); await page.waitForTimeout(150);
  ok(!!(await page.$('.pinpad')), 'PIN asked again straight after leaving Setup (no 5-minute window)');
  for (const k of '9999') await page.click(`[data-k="${k}"]`); await page.waitForTimeout(150);
  ok(/not right/.test(await text(page)), 'wrong PIN refused');
  await page.screenshot({ path: path.join(shots, '05-ipad-pin.png') });
  for (const k of '1234') await page.click(`[data-k="${k}"]`); await page.waitForSelector('#bizName');
  ok(true, 'right PIN opens Setup');
  // invite another account for the isolation test
  await page.click('#addInv'); await page.fill('#iE', 'other@example.com'); await page.click('#iA'); await page.waitForTimeout(200);
  await page.click('#bk');

  console.log('Products, deals and the till (iPad)');
  // made-up products: never real business data in test code
  await page.click('[data-go="setup"]'); for (const k of '1234') await page.click(`[data-k="${k}"]`);
  await page.click('#goProd'); await page.click('#pPaste');
  await page.fill('#tP', 'PRODUCT  SIZE  PRICE\nTest Balm\t30g\t$20\nTest Oil, 50ml, 30\nTest Tea  Tea  $15\nTest Gift Box  Gift set  $90');
  await page.waitForTimeout(100);
  ok(/4 found/.test(await text(page)), 'pasted price list read (header line skipped)');
  await page.click('#tA'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => S.products.length === 4 && S.products.find(p => p.name === 'Test Oil').price === 3000), 'products saved with prices in cents');
  ok(await page.evaluate(() => S.products.find(p => p.name === 'Test Balm').colour === 'balm'), 'button colour guessed from the product');
  await page.click('#bk'); await page.click('#goDeals'); await page.click('#dAdd');
  await page.fill('#kN', 'Any 2 for $35'); await page.fill('#kQ', '2'); await page.fill('#kP', '35');
  for (const n of ['Test Balm', 'Test Oil']) await page.locator('label.row', { hasText: n }).locator('input').check();
  await page.click('#kS'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.deals.length === 1 && S.deals[0].price === 3500), 'deal saved');
  await page.click('#bk'); await page.click('#bk');

  await page.click('[data-go="sell"]'); await page.waitForSelector('#sGo');
  await page.click('[data-t="market"]'); await page.fill('#sName', 'Test Market'); await page.fill('#sFloat', '100');
  await page.click('#sWhoAdd'); await page.fill('#wN', 'Sam'); await page.click('#wOk'); await page.waitForTimeout(100);
  await page.fill('#sName', 'Test Market'); await page.fill('#sFloat', '100');
  await page.screenshot({ path: path.join(shots, '10-ipad-start-day.png') });
  await page.click('#sGo'); await page.waitForSelector('.ptile');
  const tap = n => page.locator('.ptile', { hasText: n }).click();
  await tap('Test Balm'); await tap('Test Oil'); await tap('Test Tea');
  ok((await page.textContent('#cTotal')) === '$50.00', 'deal applied by itself: $20 + $30 + $15 − $15 = $50.00');
  await page.screenshot({ path: path.join(shots, '11-ipad-till-landscape.png') });
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, '12-ipad-till-portrait.png') });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.click('[data-pay="cash"]'); await page.click('[data-v="2000"]'); await page.click('[data-v="5000"]');
  ok(/Change\s*\$20\.00/.test(await page.textContent('.change')), 'cash: handed $70, change $20.00 shown');
  await page.screenshot({ path: path.join(shots, '13-ipad-cash.png') });
  await page.click('#pOk'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.sales.length === 1 && S.sales[0].total === 5000 && S.sales[0].change === 2000 && S.sales[0].gst === 652 && S.sales[0].servedBy === 'Sam'), 'sale saved: $50, change $20, GST $6.52, served by Sam');
  ok((await page.textContent('#cTotal')) === '$0.00', 'sale cleared, ready for the next customer');
  await page.click('#tUndo'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => S.sales.length === 0) && (await page.textContent('#cTotal')) === '$50.00', 'undo removes the sale and puts the items back');
  await page.click('[data-pay="eftpos"]'); await page.click('#pOk'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => S.sales.length === 1 && S.sales[0].method === 'eftpos'), 'EFTPOS sale recorded');
  await tap('Test Gift Box'); await page.click('[data-pay="cash"]'); await page.click('[data-v="exact"]'); await page.click('#pOk'); await page.waitForTimeout(100);

  console.log('Till mode (helper holding the iPad)');
  await page.click('#tLock'); await page.click('[data-who="Sam"]'); await page.waitForTimeout(150);
  ok(!(await page.$('#bk')) && !!(await page.$('#tlk')), 'till mode: no Back, no way to Setup');
  await page.evaluate(() => __test.go('setup')); await page.waitForTimeout(100);
  ok(await page.evaluate(() => !document.querySelector('#bizName')), 'till mode: Setup cannot be opened');
  ok(await page.evaluate(() => !document.querySelector('.ptile input,.ptile [contenteditable]')), 'till mode: no way to type a price');
  await page.screenshot({ path: path.join(shots, '14-ipad-till-mode.png') });
  await page.click('#tList'); await page.locator('[data-void]').first().click(); await page.waitForSelector('.pinpad');
  ok(true, 'voiding a sale asks for the PIN');
  for (const k of '1234') await page.click(`[data-k="${k}"]`); await page.click('#cY'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.sales.filter(s => s.voided).length === 1), 'sale voided after the PIN');
  await page.click('#dOk');
  await page.click('#tEnd'); await page.waitForSelector('.pinpad'); for (const k of '1234') await page.click(`[data-k="${k}"]`);
  await page.waitForSelector('#eC');
  // left: $50 EFTPOS (voided? the newest sale was voided: the $90 gift box, cash) → expected cash = float $100
  await page.fill('#eC', '100'); await page.waitForTimeout(50);
  ok(/cash is right/.test(await page.textContent('#eDiff')), 'end of day: counted cash matches float + cash sales');
  await page.fill('#eC', '95'); ok(/Short by \$5\.00/.test(await page.textContent('#eDiff')), 'end of day: a $5 shortfall is shown');
  await page.screenshot({ path: path.join(shots, '15-ipad-end-of-day.png') });
  await page.fill('#eC', '100'); await page.click('#eX'); await page.waitForSelector('.tiles');
  ok(await page.evaluate(() => S.sessions[0].status === 'closed' && S.sessions[0].totals.eftpos === 5000 && !(localStorage.getItem('rs.tillMode')||'').includes('Sam')), 'day closed, totals stored, till mode off');

  console.log('Android phone: helper, stranger, and a second business');
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  // share the fake database between the iPad and the phone (it lives in localStorage)
  const db = await page.evaluate(() => localStorage.getItem('mockdb'));
  await phone.addInitScript(d => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mockdb', d); sessionStorage.setItem('seeded', '1'); } }, db);
  const hp = await phone.newPage(); hp.on('pageerror', e => errs.push(e.message));
  await hp.goto(url); await hp.waitForSelector('#gIn'); await signIn(hp, 'helper@example.com'); await hp.waitForSelector('.tiles'); await hp.waitForTimeout(200);
  ok((await hp.$$('.tile')).length === 1 && !(await hp.$('#cog')), 'helper sees only Sell, and no Setup');
  await hp.screenshot({ path: path.join(shots, '06-android-helper.png') });
  await hp.click('[data-go="sell"]'); await hp.waitForSelector('#sGo'); await hp.click('[data-t="farmgate"]');
  await hp.click('[data-who="Sam"]'); await hp.click('#sGo'); await hp.waitForSelector('.ptile');
  ok(!(await hp.$('#tLock')), 'helper on own phone: no till-mode button needed');
  await hp.locator('.ptile', { hasText: 'Test Tea' }).click(); await hp.locator('.ptile', { hasText: 'Test Tea' }).click();
  await hp.screenshot({ path: path.join(shots, '09-android-till.png') });
  await hp.click('[data-pay="eftpos"]'); await hp.click('#pOk'); await hp.waitForTimeout(150);
  ok(await hp.evaluate(() => S.sales.some(s => s.by === 'helper@example.com' && s.total === 3000 && s.channel === 'farmgate')), 'helper sale saved as the helper ($30, farm gate)');
  await hp.click('#tList'); await hp.locator('[data-void]').first().click(); await hp.waitForTimeout(100);
  ok(!(await hp.$('.pinpad')), 'helper cannot void a sale'); await hp.click('#dOk');

  const sp = await phone.newPage(); await sp.goto(url); await sp.waitForSelector('#gIn'); await signIn(sp, 'stranger@example.com'); await sp.waitForSelector('#gCheck');
  ok(/invite-only/.test(await text(sp)) && !(await sp.$('#gNew')), 'an uninvited stranger cannot set up a business');
  await sp.screenshot({ path: path.join(shots, '07-android-not-invited.png') });

  const op = await phone.newPage(); await op.goto(url); await op.waitForSelector('#gIn'); await signIn(op, 'other@example.com'); await op.waitForSelector('#gName');
  await op.fill('#gName', 'Test Co'); await op.click('#gNew'); await op.waitForSelector('.tiles'); await op.waitForTimeout(200);
  ok(await op.evaluate(() => S.name === 'Test Co' && S.products.length === 0 && SYNC.getMembers().join() === 'other@example.com'), 'a second business is separate and empty');
  await op.screenshot({ path: path.join(shots, '08-android-home.png') });

  ok(errs.length === 0, 'no script errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
