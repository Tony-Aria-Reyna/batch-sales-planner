// Screenshots for Mum's quick guide, taken from the test build with invented demo data (never real business data).
// Run: MOCK=1 node build.js && node scripts/guide/capture.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', '..', 'dist-test'), out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(r); });
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

(async () => {
  await new Promise(r => server.listen(0, r)); const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, userAgent: IPAD_UA, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); });
  const page = await ctx.newPage(); page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const hideToast = () => page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.classList.remove('show'); });
  const shot = async (name, opts) => { await page.waitForTimeout(250); await hideToast(); await page.screenshot(Object.assign({ path: path.join(out, name + '.png') }, opts || {})); console.log('saved', name); };
  const modalShot = async name => { await page.waitForTimeout(250); await hideToast(); const m = (await page.$$('.modal')).pop(); if (m) await m.screenshot({ path: path.join(out, name + '.png') }); else await shot(name); console.log('saved', name); };
  const closeAll = () => page.evaluate(() => { while (modalStack.length) closeModal(); document.querySelectorAll('.approved,.overlay').forEach(x => x.remove()); });

  await page.goto(url); await page.evaluate(() => localStorage.setItem('mockdb', JSON.stringify({ 'admins/fiona@example.com': { note: 'demo' } }))); await page.reload(); await page.waitForSelector('#gIn');
  await page.evaluate(() => SYNC.testSignIn('fiona@example.com')); await page.waitForSelector('#gName');
  await page.fill('#gName', 'Rata & Smudge'); await page.click('#gNew'); await page.waitForSelector('.tiles'); await page.waitForTimeout(400);

  // ---------- invented demo data ----------
  await page.evaluate(() => {
    const id = c => SYNC.newId(c), me = SYNC.me(), day = n => dk(addDays(kd(nzDay()), n)), now = Date.now();
    Object.assign(S.settings, { homeAddress: '1 Demo Road, Hometown', staff: ['Fiona', 'Sam'], defaultFloat: 20000, setupMins: 60, packMins: 45, unpackMins: 15, vehicle: { l100: 9, ruc: 7600 } });
    S.pins.push({ id: me, name: 'Fiona', hash: 'demo', salt: 'demo' });
    const P = [['Lavender Lip Balm', '15g', 1200, 'purple'], ['Calendula Healing Balm', '50g', 2500, 'yellow'], ['Rose Hand Cream', '100ml', 2800, 'pink'], ['Kawakawa Salve', '30g', 2200, 'green'],
      ['Peppermint Foot Balm', '50g', 2000, 'green'], ['Chamomile Bath Soak', '200g', 1800, 'yellow'], ['Herbal Gift Box', 'Gift set', 4500, 'other'], ['Calendula Body Oil', '50ml', 2400, 'yellow']];
    P.forEach(([name, size, price, colour]) => S.products.push({ id: id('products'), name, size, price, colour, active: true, updated: now }));
    const pr = n => S.products.find(p => p.name === n);
    const inB = { id: id('inputs'), name: 'Beeswax pellets', cat: 'ingredient', price: 3800, pack: 1000, unit: 'g', supplier: 'Hive Supplies', supplierEmail: 'orders@hive.example', updated: now, warnAt: 500 };
    const inO = { id: id('inputs'), name: 'Olive oil', cat: 'ingredient', price: 2400, pack: 1000, unit: 'ml', supplier: 'Grove Oils', supplierLink: 'https://grove.example', updated: now };
    const inJ = { id: id('inputs'), name: 'Amber jar 15g', cat: 'packaging', price: 90, pack: 1, unit: 'each', supplier: 'Bottle Co', supplierEmail: 'sales@bottle.example', updated: now };
    S.inputs.push(inB, inO, inJ);
    moveStock({ kind: 'count', input: inB.id, qty: 400 });
    const rec = { id: id('recipes'), name: 'Lavender lip balm base', yield: 600, unit: 'g', lines: [{ input: inB.id, qty: 150 }, { input: inO.id, qty: 450 }] };
    S.recipes.push(rec); Object.assign(pr('Lavender Lip Balm'), { recipe: rec.id, fill: 15, pack: [{ input: inJ.id, qty: 1 }], warnAt: 20 });
    S.products.forEach((p, i) => moveStock({ kind: 'count', product: p.id, qty: [14, 22, 9, 18, 12, 25, 6, 16][i] }));
    const mk = { id: id('places'), name: 'Riverside Market', group: 'markets', channel: 'retail', address: '5 River Street, Riverton', km: 64, float: 20000, route: { for: 'x', km: 32, mins: 35 }, lat: -45.1, lng: 169.4 };
    const mk2 = { id: id('places'), name: 'Hilltop Farmers Market', group: 'markets', channel: 'retail', address: '2 Hill Road, Hilltop', km: 110, float: 15000 };
    const shop = { id: id('places'), name: 'Corner Gift Shop', group: 'shops', channel: 'wholesale', address: '9 Main Street, Townsville', km: 40 };
    S.places.push(mk, mk2, { id: id('places'), name: 'Farm shop', group: 'farmshop', channel: 'retail' }, shop);
    S.costs.push({ id: 'fee-' + mk.id, kind: 'stallfee', place: mk.id, cents: 4500, days: 1 }, { id: 'fee-' + mk2.id, kind: 'stallfee', place: mk2.id, cents: 6000, days: 1 });
    S.pay.push({ id: id('pay'), name: 'Sam', hourly: 2500, day: 0 });
    // markets on the calendar: every Saturday at Riverside, and one at Hilltop
    const sat = (() => { const t = kd(nzDay()); const d = (6 - t.getDay() + 7) % 7 || 7; return dk(addDays(t, d)); })();
    S.events.push({ id: id('events'), type: 'market', title: 'Riverside Market', place: mk.id, date: sat, time: '08:00', end: '13:00', days: 1, rpt: 'week', until: '', attendees: [me], remind: ['day'], note: '', plan: { there: 35, setup: 60, pack: 45, home: 35 }, by: me, changed: now });
    S.events.push({ id: id('events'), type: 'market', title: 'Hilltop Farmers Market', place: mk2.id, date: dk(addDays(kd(sat), 8)), time: '09:00', end: '14:00', days: 1, rpt: '', until: '', attendees: [me], remind: ['day'], note: '', by: me, changed: now });
    S.events.push({ id: id('events'), type: 'brew', title: 'Lip balm brew day', date: day(3), time: '', end: '', days: 1, rpt: '', until: '', attendees: [], remind: [], note: '', by: me, changed: now });
    // past selling days with sales, check-ins and costs, for Reports and Real profit
    const lines = [['Lavender Lip Balm', 3], ['Calendula Healing Balm', 2], ['Rose Hand Cream', 1], ['Kawakawa Salve', 2], ['Herbal Gift Box', 1], ['Chamomile Bath Soak', 2]];
    [-28, -21, -14, -7].forEach((off, k) => {
      const date = day(off), at = kd(date).getTime() + 9 * 3600e3, place = k === 2 ? mk2 : mk, ses = { id: id('sessions'), type: 'market', name: place.name, placeId: place.id, date, openedAt: at, openedBy: me, float: 20000, status: 'closed', closedAt: at + 5 * 3600e3, closedBy: me, countedCash: 0, expectedCash: 0,
        checkin: { busy: ['busy', 'steady', 'quiet', 'flat'][k], weather: [['sun'], ['cloud'], ['wind', 'cold'], ['sun', 'hot']][k], times: { there: 35, setup: 60, pack: 45, home: 35, unpack: 15 }, soldOut: [], note: '', by: me, at: at + 5 * 3600e3 } };
      S.sessions.push(ses);
      for (let i = 0; i < [14, 10, 5, 18][k]; i++) { const [n, q] = lines[(i + k) % lines.length], p = pr(n), total = p.price * q;
        S.sales.push({ id: id('sales'), sessionId: ses.id, channel: 'market', where: ses.name, date, at: at + i * 900e3, lines: [{ pid: p.id, name: p.name, size: p.size, qty: q, unit: p.price, amount: total }], subtotal: total, discount: 0, total, gst: Math.round(total * 3 / 23), method: i % 3 ? 'eftpos' : 'cash', by: me, servedBy: i % 4 ? 'Fiona' : 'Sam', voided: false }); }
    });
    S.batches.push({ id: id('batches'), recipe: rec.id, recipeName: rec.name, mult: 1, date: day(-10), status: 'made', madeAt: now - 10 * 864e5, items: [{ pid: pr('Lavender Lip Balm').id, units: 40 }], unitCost: { [pr('Lavender Lip Balm').id]: 310 }, ingredientCost: 1560, mins: 150, minsFrom: 'checkin', by: me, at: now });
    S.plans.push({ id: id('plans'), batch: 'x', date: day(3), status: 'planned', items: [{ pid: pr('Lavender Lip Balm').id, units: 40 }], at: now });
    S.todos.push({ id: id('todos'), text: 'Label the kawakawa jars', who: me, done: false, due: day(1), by: me, at: now }, { id: id('todos'), text: 'Book the Hilltop stall', who: me, done: false, due: day(4), by: me, at: now });
    S.shopping.push({ id: id('shopping'), item: 'Beeswax pellets', qty: 2, size: '1 kg', input: inB.id, done: false, by: me, at: now }, { id: id('shopping'), item: 'Amber jar 15g', qty: 50, size: '', input: inJ.id, done: false, by: me, at: now }, { id: id('shopping'), item: 'Brown paper bags', qty: 1, size: '', done: false, by: me, at: now });
    S.clock.push({ id: id('clock'), kind: 'owner', who: me, code: 'admin', date: day(-1), start: now - 864e5, end: now - 864e5 + 5400e3, mins: 90 });
    S.orders.push({ id: id('orders'), source: 'wholesale', place: shop.id, customer: { name: 'Corner Gift Shop' }, date: day(-2), due: day(5), status: 'new', lines: [{ pid: pr('Rose Hand Cream').id, name: 'Rose Hand Cream', size: '100ml', qty: 6, unit: 1680 }], total: 10080, at: now });
    save();
  });
  await page.evaluate(() => { stack = ['home']; render(); }); await page.waitForTimeout(500);

  // ---------- screens ----------
  await shot('01-home', { fullPage: true });
  await page.evaluate(() => { stack = ['home', 'sell']; render(); }); await page.waitForSelector('#sGo'); await shot('02-sell-start');
  await page.evaluate(() => lsSet('rs.servedBy', 'Fiona')); await page.fill('#sName', 'Riverside Market'); await page.click('#sGo'); await page.waitForSelector('[data-add]');
  for (const n of ['Lavender Lip Balm', 'Lavender Lip Balm', 'Rose Hand Cream', 'Kawakawa Salve']) await page.evaluate(n => document.querySelector('[data-add="' + S.products.find(p => p.name === n).id + '"]').click(), n);
  await shot('03-till');
  await page.click('[data-pay="eftpos"]'); await page.waitForTimeout(300); await shot('04-pay');
  await closeAll(); await page.evaluate(() => { stack = ['home', 'sell']; render(); }); await page.waitForTimeout(200);
  await page.evaluate(() => { const d = S.sessions.find(s => s.status === 'open'), me = SYNC.me(); [['Lavender Lip Balm', 2, 'cash'], ['Rose Hand Cream', 1, 'eftpos'], ['Herbal Gift Box', 1, 'eftpos'], ['Kawakawa Salve', 2, 'cash'], ['Calendula Healing Balm', 1, 'eftpos']].forEach(([n, q, m], i) => { const p = S.products.find(x => x.name === n), t = p.price * q;
    S.sales.push({ id: SYNC.newId('sales'), sessionId: d.id, channel: 'market', where: d.name, date: nzDay(), at: Date.now() - i * 60e3, lines: [{ pid: p.id, name: p.name, size: p.size, qty: q, unit: p.price, amount: t }], subtotal: t, discount: 0, total: t, gst: Math.round(t * 3 / 23), method: m, by: me, servedBy: 'Fiona', voided: false }); }); save(); });
  await page.evaluate(() => endDay(SYNC.me())); await page.waitForSelector('#eC'); await page.fill('#eC', '268.00'); await page.waitForTimeout(100); await modalShot('05-end-day');
  await closeAll();
  await page.evaluate(() => { const d = S.sessions.find(s => s.status === 'open'); marketCheckin(d); }); await page.waitForSelector('#cOk'); await page.click('[data-cbusy="busy"]'); await modalShot('06-checkin');
  await closeAll(); await page.evaluate(() => { const d = S.sessions.find(s => s.status === 'open'); if (d) { d.status = 'closed'; d.closedAt = Date.now(); } cart = []; saveCart(); lsSet('rs.tillMode', null); save(); stack = ['home']; render(); });
  await page.evaluate(() => { stack = ['home', 'calendar']; render(); }); await page.waitForTimeout(500); await shot('07-calendar');
  await page.evaluate(() => editEvent(S.events[0])); await page.waitForSelector('#ePlan'); await modalShot('08-market-entry');
  await closeAll();
  await page.evaluate(() => { brewTab = 'stock'; stack = ['home', 'brew']; render(); }); await page.waitForTimeout(300); await shot('09-stock');
  await page.evaluate(() => { brewTab = 'plan'; render(); }); await page.waitForTimeout(300); await shot('10-brew-plan');
  await page.evaluate(() => { stack = ['home', 'orders']; render(); }); await page.waitForTimeout(300); await shot('11-orders');
  await page.evaluate(() => { listTab = 'todo'; stack = ['home', 'lists']; render(); }); await page.waitForTimeout(300); await shot('12-todo');
  await page.evaluate(() => { listTab = 'shop'; render(); }); await page.waitForTimeout(300); await shot('13-shopping');
  await page.evaluate(() => { stack = ['home', 'clock']; render(); clockStart('brewing'); render(); }); await page.waitForTimeout(300); await shot('14-clock');
  await page.evaluate(() => { const r = clockRunning(); if (r) clockStop(r, true); profPeriod = 'month'; stack = ['home', 'profit']; render(); }); await page.waitForTimeout(400); await shot('15-profit', { fullPage: true });
  await page.evaluate(() => { stack = ['home']; render(); openSearch(); }); await page.waitForSelector('#sQ'); await page.fill('#sQ', 'how do I change a price'); await page.waitForTimeout(300); await modalShot('16-help');
  await closeAll(); await page.evaluate(() => { setupOpen = true; stack = ['home', 'setup']; render(); }); await page.waitForTimeout(300); await shot('17-setup');
  await page.evaluate(() => { stack = ['home', 'setup', 'places']; render(); }); await page.waitForTimeout(300); await shot('18-places');
  await page.evaluate(() => { repTab = 'summary'; repPeriod = 'month'; stack = ['home', 'reports']; render(); }); await page.waitForTimeout(300); await shot('19-reports');
  await browser.close(); server.close();
})();
