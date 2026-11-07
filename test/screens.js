// Screen tests against the fake Firebase (npm test). Checks the phase 1 flows at iPad and Android sizes
// and saves screenshots to test/shots/. Real-device checks on the iPad and Android are still required.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium, devices } = require(process.env.PW || 'playwright');
const root = path.join(__dirname, '..', 'dist-test'), shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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
  // the payment flow: Check the order → take payment → confirm a second time → green "Payment approved"
  const payEft = async p => { await p.click('[data-pay="eftpos"]'); await p.click('#rGo'); await p.click('#pOk'); await p.click('#cYes'); await p.click('#apOk'); await p.waitForTimeout(100); };
  const payExact = async p => { await p.click('[data-pay="cash"]'); await p.click('#rGo'); await p.click('[data-v="exact"]'); await p.click('#pOk'); await p.click('#cYes'); await p.click('#apOk'); await p.waitForTimeout(100); };
  const pin = async (p, code) => { for (const k of code) await p.click(`[data-k="${k}"]`); };

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
  await page.click('[data-go="setup"]'); await page.waitForSelector('#cY');
  ok(/Set your PIN first/.test(await text(page)), 'first time: asked to set a personal PIN');
  await page.click('#cY'); await page.fill('#pnN', 'Admin'); await page.click('#pnOk');
  await pin(page, '1234'); await page.waitForTimeout(100);
  ok(/Too easy/.test(await text(page)), 'an easy PIN (1234) is refused');
  await pin(page, '2580'); await page.waitForTimeout(100); await pin(page, '2580'); await page.waitForTimeout(200);
  await pin(page, '2580'); await page.waitForSelector('#bizName');
  ok(!!(await page.$('#bk')), 'Setup has a visible Back button');
  ok(await page.evaluate(() => S.pins.length === 1 && S.pins[0].id === 'admin@example.com' && S.pins[0].hash.length === 64 && !JSON.stringify(S.pins).includes('2580')), 'personal PIN saved (as a hash, never the PIN itself)');
  ok(await page.evaluate(() => S.audit.some(a => a.action === 'open Setup' && a.approver === 'admin@example.com' && a.approverName === 'Admin' && a.at > 0)), 'opening Setup logged with who approved it and when');
  ok(/Not running yet|Add the GST number/.test(await text(page)), 'receipt helper status shown in Setup');
  await page.fill('#gstNo', '12345'); await page.press('#gstNo', 'Tab'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => !S.settings.gstNumber), 'a GST number with too few digits is refused');
  await page.fill('#gstNo', '123456789'); await page.press('#gstNo', 'Tab'); await page.waitForTimeout(80);
  await page.fill('#rcEmail', 'Shop@Example.com'); await page.press('#rcEmail', 'Tab'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.settings.gstNumber === '123-456-789' && S.settings.receiptEmail === 'shop@example.com'), 'GST number and receipt Gmail saved (formatted)');
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
  await page.locator('[data-role="co@example.com"]').click(); await page.click('#hand'); await page.fill('#hIn', 'hand over'); await page.click('#hGo'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => SYNC.getMainOwner() === 'co@example.com' && SYNC.roleOf('admin@example.com') === 'owner'), 'handed over: the co-owner is now main owner, the old one co-owner');
  ok(!(await page.$('[data-role="co@example.com"]')) && !(await page.$('#del')), 'after handing over: cannot change the new main owner or delete the business');
  // put it back for the rest of the tests (the fake database has no rules)
  await page.evaluate(() => { const d = JSON.parse(localStorage.mockdb); const k = Object.keys(d).find(x => /^businesses\/[^/]+$/.test(x)); d[k].owner = 'admin@example.com'; localStorage.mockdb = JSON.stringify(d); window.dispatchEvent(new StorageEvent('storage', { key: 'mockdb' })); }); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '04-ipad-setup.png'), fullPage: true });
  await page.click('#bk'); await page.waitForSelector('.tiles');
  await page.click('[data-go="setup"]'); await page.waitForTimeout(150);
  ok(!!(await page.$('.pinpad')), 'PIN asked again straight after leaving Setup (no 5-minute window)');
  for (const k of '9999') await page.click(`[data-k="${k}"]`); await page.waitForTimeout(150);
  ok(/isn't right/.test(await text(page)), 'wrong PIN refused');
  await page.screenshot({ path: path.join(shots, '05-ipad-pin.png') });
  await pin(page, '2580'); await page.waitForSelector('#bizName');
  ok(true, 'right PIN opens Setup');
  // invite another account for the isolation test
  await page.click('#addInv'); await page.fill('#iE', 'other@example.com'); await page.click('#iA'); await page.waitForTimeout(200);
  await page.click('#bk');

  console.log('Products, deals and the till (iPad)');
  // made-up products: never real business data in test code
  await page.click('[data-go="setup"]'); await pin(page, '2580');
  await page.click('#goProd'); await page.click('#pPaste');
  await page.click('details summary');
  await page.fill('#lT', 'PRODUCT  SIZE  PRICE\nTest Balm\t30g\t$20\nTest Oil, 50ml, 30\nTest Tea  Tea  $15\nTest Gift Box  Gift set  $90');
  await page.click('#lP'); await page.waitForTimeout(100);
  ok(/New products \(4\)/.test(await text(page)), 'pasted price list read (header line skipped)');
  await page.click('#lGo'); await page.waitForTimeout(200);
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
  ok((await page.textContent('.cart .gstl')) === 'incl. $6.52 GST', 'GST shown small under the total ($50.00 incl. $6.52)');
  await page.screenshot({ path: path.join(shots, '11-ipad-till-landscape.png') });
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, '12-ipad-till-portrait.png') });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.click('[data-pay="cash"]'); await page.waitForSelector('#rGo');
  ok(/Check the order/.test(await text(page)) && (await page.$$('.modal [data-inc]')).length === 3, 'payment starts with "Check the order", items adjustable');
  await page.locator('.modal [data-inc]').first().click(); await page.waitForTimeout(50);
  ok(/\$70\.00/.test(await page.textContent('.modal .ctot')), 'order changed in the check screen: one more Test Balm, $70.00');
  await page.locator('.modal [data-dec]').first().click(); await page.waitForTimeout(50);
  await page.click('#rGo'); await page.click('[data-v="2000"]'); await page.click('[data-v="5000"]');
  ok(/Change\s*\$20\.00/.test(await page.textContent('.change')), 'cash: handed $70, change $20.00 shown');
  await page.screenshot({ path: path.join(shots, '13-ipad-cash.png') });
  await page.click('#pOk'); await page.waitForSelector('#cYes');
  ok(/\$70\.00 cash received and \$20\.00 change given\?/.test(await text(page)) && await page.evaluate(() => S.sales.length === 0), 'second confirmation asked before anything is saved');
  await page.click('#cNo'); ok(!!(await page.$('[data-v="exact"]')), 'No, go back returns to the payment screen'); await page.click('#pOk'); await page.click('#cYes'); await page.waitForSelector('.approved');
  ok(/Payment approved/.test(await text(page)) && /Give change: \$20\.00/.test(await text(page)) && /Includes \$6\.52 GST/.test(await text(page)), 'green "Payment approved" screen, with the change to give and the GST');
  await page.screenshot({ path: path.join(shots, '13b-ipad-payment-approved.png') });
  await page.click('#apMail'); await page.fill('#rE', 'customer@example'); await page.click('#rS'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => S.receipts.length === 0), 'receipt: an incomplete email address is refused');
  await page.fill('#rE', 'Customer@Example.com'); await page.click('#rS'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.receipts.length === 1 && S.receipts[0].to === 'customer@example.com' && S.receipts[0].status === 'queued' && S.receipts[0].saleId === S.sales[0].id && /^RS-\d{8}-[A-Z0-9]{5}$/.test(S.receipts[0].receiptNo)), 'receipt request queued for the helper, with a receipt number');
  ok(await page.evaluate(() => S.sales.length === 1 && S.sales[0].total === 5000 && S.sales[0].change === 2000 && S.sales[0].gst === 652 && S.sales[0].servedBy === 'Sam'), 'sale saved: $50, change $20, GST $6.52, served by Sam');
  ok((await page.textContent('#cTotal')) === '$0.00', 'sale cleared, ready for the next customer');
  await page.click('#tUndo'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => S.sales.length === 0) && (await page.textContent('#cTotal')) === '$50.00', 'undo removes the sale and puts the items back');
  await page.click('[data-pay="eftpos"]'); await page.click('#rGo'); await page.click('#pCancel'); await page.waitForSelector('#aYes');
  ok(/Cancel this sale\?/.test(await text(page)), 'declined: asks "Are you sure?"'); await page.click('#aNo'); await page.click('#pOk'); await page.click('#cNo'); await page.click('#pCancel'); await page.click('#aYes'); await page.waitForTimeout(100);
  ok((await page.textContent('#cTotal')) === '$0.00' && await page.evaluate(() => S.sales.length === 0 && !document.querySelector('.modal')), 'declined and confirmed: the sale is cleared and the till is back');
  await tap('Test Balm'); await tap('Test Oil'); await tap('Test Tea');
  await payEft(page);
  ok(await page.evaluate(() => S.sales.length === 1 && S.sales[0].method === 'eftpos'), 'EFTPOS sale recorded');
  await tap('Test Gift Box'); await payExact(page);

  console.log('Category filter, discounts, items not on the till, correcting a sale');
  await page.click('[data-f="balm"]'); await page.waitForTimeout(50);
  ok(await page.evaluate(() => [...document.querySelectorAll('.ptile[data-add]')].map(t => t.innerText).join('|').match(/Test Balm/) && document.querySelectorAll('.ptile[data-add]').length === 1), 'filter: Balms shows only balms');
  ok(await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.ptile[data-add]')).backgroundColor; return c === 'rgb(232, 163, 23)'; }), 'balms are bold gold');
  await page.click('[data-f="all"]');
  await tap('Test Tea'); await page.click('#cDisc'); await page.fill('#dR', 'regular customer'); await page.click('#dOk'); await page.waitForSelector('.pinpad');
  ok(true, 'a discount asks for a PIN'); await pin(page, '2580'); await page.waitForTimeout(150);
  ok((await page.textContent('#cTotal')) === '$13.50' && /approved by Admin/.test(await text(page)), 'discount 10% approved: $15.00 → $13.50, shows who approved');
  await payExact(page);
  ok(await page.evaluate(() => S.sales.some(s => s.total === 1350 && s.manualDiscount && s.manualDiscount.amount === 150 && s.manualDiscount.approvedBy === 'admin@example.com')), 'discounted sale stores the discount and the approver');
  await page.click('#tExtra'); await page.fill('#xN', 'Test Special'); await page.fill('#xP', '12'); await page.click('#xOk'); await pin(page, '2580'); await page.waitForTimeout(150);
  ok((await page.textContent('#cTotal')) === '$12.00' && /not on the till/.test(await text(page)), 'item not on the till added after a PIN');
  await payEft(page);
  await page.click('#tList'); await pin(page, '2580'); await page.waitForSelector('[data-corr]');
  ok(/Sales so far/.test(await text(page)), 'the sales list needs a PIN');
  await page.screenshot({ path: path.join(shots, '17-ipad-sales-list.png') });
  await page.locator('[data-corr]').first().click(); await pin(page, '2580'); await page.waitForTimeout(150);
  ok(/Correcting the \$12\.00 sale/.test(await text(page)) && (await page.textContent('#cTotal')) === '$12.00', 'correct a sale: it comes back onto the till');
  await tap('Test Tea'); ok((await page.textContent('#cTotal')) === '$27.00', 'correction: an item added');
  await page.click('[data-pay="eftpos"]'); ok(/owes \$15\.00 more/.test(await text(page)), 'correction: the difference to collect is shown'); await page.click('#rGo'); await page.click('#pOk'); await page.click('#cYes'); await page.click('#apOk'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => { const o = S.sales.find(s => s.total === 1200); const n = S.sales.find(s => s.total === 2700); return o.voided && o.voidReason === 'corrected' && o.replacedBy === n.id && n.replaces === o.id && n.correctedBy === 'admin@example.com'; }), 'correction saved: old sale voided as corrected and linked to the new one');
  await page.screenshot({ path: path.join(shots, '18-ipad-till-bold-colours.png') });

  console.log('Till mode (helper holding the iPad)');
  await page.click('#tLock'); await page.click('[data-who="Sam"]'); await page.waitForTimeout(150);
  ok(!(await page.$('#bk')) && !!(await page.$('#tlk')), 'till mode: no Back, no way to Setup');
  await page.evaluate(() => __test.go('setup')); await page.waitForTimeout(100);
  ok(await page.evaluate(() => !document.querySelector('#bizName')), 'till mode: Setup cannot be opened');
  ok(await page.evaluate(() => !document.querySelector('.ptile input,.ptile [contenteditable]')), 'till mode: no way to type a price');
  await page.screenshot({ path: path.join(shots, '14-ipad-till-mode.png') });
  await page.click('#tList'); await pin(page, '2580'); await page.waitForSelector('[data-void]');
  await page.locator('[data-void]').first().click(); await page.click('#cY'); await page.waitForSelector('.pinpad');
  ok(true, 'voiding a sale asks for the PIN');
  await pin(page, '2580'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.sales.filter(s => s.voided && s.voidReason === 'voided').length === 1 && S.sales.find(s => s.voidReason === 'voided').voidedBy === 'admin@example.com'), 'sale voided after the PIN, with who approved it');
  await page.click('#dOk');
  await page.click('#tEnd'); await page.waitForSelector('.pinpad'); await pin(page, '2580');
  await page.waitForSelector('#eC');
  // left: $50 EFTPOS; cash $90 gift box + $13.50 discounted tea; the $27 corrected sale was voided → expected cash = $100 float + $103.50
  await page.fill('#eC', '203.50'); await page.waitForTimeout(50);
  ok(/cash is right/.test(await page.textContent('#eDiff')), 'end of day: counted cash matches float + cash sales');
  await page.fill('#eC', '198.50'); ok(/Short by \$5\.00/.test(await page.textContent('#eDiff')), 'end of day: a $5 shortfall is shown');
  await page.screenshot({ path: path.join(shots, '15-ipad-end-of-day.png') });
  await page.fill('#eC', '203.50'); await page.click('#eX'); await page.waitForSelector('.tiles');
  ok(await page.evaluate(() => S.sessions[0].status === 'closed' && S.sessions[0].totals.eftpos === 5000 && !(localStorage.getItem('rs.tillMode')||'').includes('Sam')), 'day closed, totals stored, till mode off');
  ok(await page.evaluate(() => { const t = document.querySelector('.today').innerText; return /🔒 Show/.test(t) && !/153/.test(t); }), 'home: takings hidden until a PIN');
  await page.click('#showMoney'); await pin(page, '2580'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => /\$153\.50/.test(document.querySelector('.today').innerText)), 'home: takings shown after a PIN ($50 + $90 + $13.50)');
  await page.click('[data-go="setup"]'); await pin(page, '2580'); await page.click('#goAudit'); await page.waitForTimeout(100);
  const log = await text(page);
  ok(['Give a discount', 'Add an item not on the till', 'Correct a sale', 'Void a sale', 'End the day', 'Close the day', 'See the sales', 'Leave till mode'].every(a => log.includes(a) || a === 'Leave till mode') && /approved by Admin/.test(log), 'approvals log lists each approval with who and when');
  await page.screenshot({ path: path.join(shots, '19-ipad-approvals-log.png'), fullPage: true });
  await page.click('#bk'); await page.click('#bk');

  console.log('Load a price list from a PDF and an Excel file');
  // made-up test products: one price change, one unchanged, one new, two missing from the list
  const pdfPage = await ipad.newPage();
  await pdfPage.setContent(`<h1>TEST SHOP</h1><p>PRICE LIST</p><table style="width:100%;font:14px Arial"><tr><th align=left>PRODUCT</th><th align=left>SIZE</th><th align=right>PRICE</th></tr>
    <tr><td>Test Balm</td><td>30g</td><td align=right>$22</td></tr><tr><td>Test Oil (pump)</td><td>100ml</td><td align=right>$40</td></tr>
    <tr><td>Test Oil</td><td>50 ml</td><td align=right>$30</td></tr><tr><td>Test New Roll-On</td><td>10ml</td><td align=right>$12.50</td></tr></table><p>Prices in NZD. Check before use.</p>`);
  const pdfFile = path.join(shots, 'test-price-list.pdf'); await pdfPage.pdf({ path: pdfFile, format: 'A4' }); await pdfPage.close();
  await page.click('[data-go="setup"]'); await pin(page, '2580');
  await page.click('#goProd'); await page.click('#pPaste'); await page.setInputFiles('#lF', pdfFile); await page.waitForSelector('#lB', { timeout: 15000 });
  const rv = await text(page);
  ok(/New products \(2\)/.test(rv) && /Price changes \(1\)/.test(rv) && /not in this list \(2\)/.test(rv) && /1 product already on the till/.test(rv), 'PDF read: 2 new, 1 price change, 1 unchanged ("50 ml" matches "50ml"), 2 missing');
  ok(/\$20\.00\s*→\s*\$22\.00/.test(rv), 'price change shown as old → new');
  await page.screenshot({ path: path.join(shots, '16-ipad-load-price-list.png') });
  await page.locator('label.row', { hasText: 'Test Tea' }).locator('input').check(); await page.waitForTimeout(50);
  await page.click('#lGo'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => S.products.find(p => p.name === 'Test Balm').price === 2200 && S.products.find(p => p.name === 'Test New Roll-On').price === 1250
    && S.products.find(p => p.name === 'Test Tea').active === false && S.products.find(p => p.name === 'Test Gift Box').active !== false && S.products.filter(p => p.name === 'Test Balm').length === 1),
    'till updated: price changed in place, new added, ticked one hidden, unticked one left alone, no duplicates');
  // Excel: same list again, nothing should change
  const XLSX = require('xlsx'); const xf = path.join(shots, 'test-price-list.xlsx'); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Product', 'Size', 'Price'], ['Test Balm', '30g', 22], ['Test Oil', '50ml', 30], ['Test New Roll-On', '10ml', '$12.50']]), 'Prices'); XLSX.writeFile(wb, xf);
  await page.click('#pPaste'); await page.setInputFiles('#lF', xf); await page.waitForSelector('#lB', { timeout: 15000 });
  ok(/3 products already on the till/.test(await text(page)) && !/New products/.test(await text(page)), 'Excel read: matching list makes no changes');
  await page.click('#lB'); await page.setInputFiles('#lF', path.join(__dirname, '..', 'src', 'icon-192.png')); await page.waitForTimeout(300);
  ok(/That is a picture/.test(await text(page)), 'a picture is refused with a clear reason');
  await page.click('#lC'); await page.click('#bk'); await page.click('#bk');

  console.log('Back button');
  await page.click('[data-go="sell"]'); await page.waitForTimeout(100); await page.mouse.click(5, 300);
  await page.goBack(); await page.waitForTimeout(250);
  ok(await page.evaluate(() => !!document.querySelector('.tiles') && document.querySelector('#exitScr').hidden), 'back from the till goes to the home screen, not out of the app');
  await page.mouse.click(5, 300); await page.goBack(); await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.querySelector('#exitScr').hidden) && /Stay in the app/.test(await text(page)), 'back at the home screen shows the Rata & Smudge screen');
  await page.screenshot({ path: path.join(shots, '20-exit-screen.png') });
  await page.click('#exStay'); ok(await page.evaluate(() => document.querySelector('#exitScr').hidden && !!document.querySelector('.tiles')), '"Stay in the app" returns to the home screen');

  console.log('Old database rules (a new feature refused)');
  const op2 = await ipad.newPage(); op2.on('pageerror', e => errs.push(e.message));
  await op2.goto(url); await op2.evaluate(() => localStorage.setItem('mockdeny', 'pins,audit,receipts')); await op2.reload(); await op2.waitForSelector('#gIn');
  await signIn(op2, 'admin@example.com'); await op2.waitForTimeout(800);
  ok(await op2.evaluate(() => document.querySelector('#gate').hidden && !!document.querySelector('.tiles')), 'the app still opens when the rules refuse PINs, the log and receipts');
  ok(/database rules need updating/.test(await text(op2)) && /personal PINs, the approvals log, emailed receipts/.test(await text(op2)), 'and it says which parts are waiting for a rules update');
  await op2.screenshot({ path: path.join(shots, '21-rules-notice.png') });
  await op2.evaluate(() => localStorage.removeItem('mockdeny')); await op2.close();

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
  await hp.locator('.ptile', { hasText: 'Test Gift Box' }).click(); await hp.waitForTimeout(50);
  await hp.screenshot({ path: path.join(shots, '09-android-till.png') });
  ok(await hp.evaluate(() => { const c = document.querySelector('#cart'); const r = c.getBoundingClientRect(); return !c.classList.contains('open') && r.top > innerHeight * 0.6; }), 'phone: the sale panel sits closed at the bottom');
  await hp.click('#cGrab'); await hp.waitForTimeout(350);
  ok(await hp.evaluate(() => document.querySelector('#cart').classList.contains('open') && document.querySelector('#cart').getBoundingClientRect().top < innerHeight * 0.3), 'phone: tapping the handle slides the panel fully open');
  await hp.screenshot({ path: path.join(shots, '09b-android-sale-open.png') });
  await hp.goBack(); await hp.waitForTimeout(350);
  ok(await hp.evaluate(() => !document.querySelector('#cart').classList.contains('open')), 'phone: the back button closes the panel first');
  await payEft(hp);
  ok(await hp.evaluate(() => S.sales.some(s => s.by === 'helper@example.com' && s.total === 9000 && s.channel === 'farmgate')), 'helper sale saved as the helper ($90, farm gate)');
  ok(!(await hp.$('#tList')) && !(await hp.$('#tEnd')), 'helper sees no sales list and cannot end the day');
  await hp.click('#bk'); ok(/Today's takings\s*—/.test(await text(hp)), 'helper sees no takings on the home screen'); await hp.click('[data-go="sell"]');

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
