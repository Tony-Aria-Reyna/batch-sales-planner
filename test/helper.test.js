// Runs the business helper's notification and report logic against a fake database (no Google services).
const fs = require('fs'), vm = require('vm'), path = require('path');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const sentPush = [], mails = [], patches = [];
const ctx = { console, Logger: { log() {} }, JSON, Math, Date, Number, String, Object, Array, Utilities: { formatDate: (d, tz, f) => require('util').format(f) },
  UrlFetchApp: { fetch: (url, o) => { if (/fcm\.googleapis/.test(url)) { sentPush.push(JSON.parse(o.payload).message); return { getResponseCode: () => 200, getContentText: () => '{}' }; } throw new Error('unexpected fetch ' + url); } },
  MailApp: { sendEmail: m => mails.push(m) }, ScriptApp: { getOAuthToken: () => 't' }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) }, Session: { getEffectiveUser: () => ({ getEmail: () => 'biz@example.com' }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'helper', 'Code.gs'), 'utf8'), ctx);
const today = '2026-11-08', tomorrow = '2026-11-09';
let clock = { day: today, mins: 18 * 60 + 40 };
const db = {
  'businesses/b1/devices': [{ _id: 'mum@example.com', tokens: { d1: { token: 'T1' } }, prefs: {} }, { _id: 'sam@example.com', tokens: { d2: { token: 'T2' } }, prefs: {} }, { _id: 'off@example.com', tokens: { d3: { token: 'T3' } }, prefs: { reminders: false } }],
  'businesses/b1/events': [{ _id: 'e1', type: 'market', title: 'Village Market', date: tomorrow, time: '08:00', end: '13:00', attendees: ['sam@example.com'], remind: ['day', 'hour'] },
                           { _id: 'e2', type: 'market', title: 'Hill Market', date: tomorrow, attendees: [], remind: ['day'] }],
  'businesses/b1/todos': [], 'businesses/b1/stockmoves': [{ product: 'p1', kind: 'count', qty: 2, at: 1 }], 'businesses/b1/sales': [{ sessionId: 'old', total: 1000, lines: [{ pid: 'p1', qty: 2 }], at: 5 }], 'businesses/b1/products': [{ _id: 'p1', name: 'Lip balm', size: '15g' }],
  'businesses/b1/sessions': []
};
ctx.listDocs = p => (db[p] || []).map(x => Object.assign({}, x)); ctx.getDoc = p => null; ctx.patch = (p, f) => patches.push([p, f]); ctx.nzNow = () => clock; ctx.today = () => clock.day;
const b = { _id: 'b1', name: 'Test Co', owners: ['mum@example.com', 'off@example.com'], roles: { 'sam@example.com': 'helper' }, settings: { vapidKey: 'K', receiptEmail: 'biz@example.com' }, notified: {} };
ctx.notifyTick(b);
const to = t => sentPush.filter(m => m.token === t).map(m => m.data.title + ' | ' + m.data.body);
ok(to('T1').some(x => /Market tomorrow \| Village Market at 8am/.test(x)) && to('T1').some(x => /Hill Market/.test(x)), 'evening before: owner reminded of both markets');
ok(to('T2').some(x => /Village Market/.test(x)) && !to('T2').some(x => /Hill Market/.test(x)), 'helper reminded only of the market they\'re rostered on');
ok(!to('T3').some(x => /Market tomorrow/.test(x)) && to('T3').some(x => /Before tomorrow/.test(x)), 'someone who switched reminders off gets none (but still gets the alerts they left on)');
ok(to('T1').some(x => /Before tomorrow.s market \| 1 product at 0: Lip balm 15g/.test(x)) && !to('T2').some(x => /Before tomorrow/.test(x)), 'evening before a market: owners told what has run out (helpers aren\'t)');
const marks = patches.filter(p => p[0] === 'businesses/b1').pop()[1].notified; b.notified = marks; const n1 = sentPush.length;
ctx.notifyTick(b); ok(sentPush.length === n1, 'nothing is sent twice');
// next morning, 7:10: an hour-before reminder; 7:40: the morning list
clock = { day: tomorrow, mins: 7 * 60 + 10 }; b.notified = patches.filter(p => p[0] === 'businesses/b1').pop()[1].notified; sentPush.length = 0;
db['businesses/b1/todos'] = [{ _id: 't1', text: 'Label jars', who: 'sam@example.com', due: tomorrow, done: false }];
ctx.notifyTick(b); ok(to('T2').some(x => /in 50 min \| Village Market at 8am/.test(x)), 'an hour before: "Market in 50 min"');
clock = { day: tomorrow, mins: 7 * 60 + 40 }; b.notified = patches.filter(p => p[0] === 'businesses/b1').pop()[1].notified; sentPush.length = 0;
ctx.notifyTick(b); ok(to('T2').some(x => /^Today \| 🧺 Village Market 8am\n✅ Label jars/.test(x)), 'morning list: their market and their to-do');
// till left open 2 hours after the market's finish; then the report email once it's closed
clock = { day: tomorrow, mins: 15 * 60 + 30 }; b.notified = patches.filter(p => p[0] === 'businesses/b1').pop()[1].notified; sentPush.length = 0;
db['businesses/b1/sessions'] = [{ _id: 's1', name: 'Village Market', date: tomorrow, status: 'open', eventId: 'e1', openedBy: 'sam@example.com', openedAt: Date.now() - 3600e3 }];
ctx.notifyTick(b); ok(to('T2').some(x => /Till still open/.test(x)) && to('T1').some(x => /Till still open/.test(x)), 'till still open 2 hours after the finish: the helper and owners are told');
ok(mails.length === 0, 'no report while a till is open');
db['businesses/b1/sessions'][0].status = 'closed'; Object.assign(db['businesses/b1/sessions'][0], { countedCash: 25000, expectedCash: 25000 });
db['businesses/b1/sales'] = [{ sessionId: 's1', total: 4500, gst: 587, method: 'cash', lines: [{ name: 'Lip balm', size: '15g', qty: 3 }], at: Date.now() }, { sessionId: 's1', total: 3000, gst: 391, method: 'eftpos', lines: [{ name: 'Oil', qty: 1 }], at: Date.now(), voided: true }];
b.notified = patches.filter(p => p[0] === 'businesses/b1').pop()[1].notified;
ctx.notifyTick(b);
ok(mails.length === 1 && /Village Market/.test(mails[0].subject) && /\$45\.00/.test(mails[0].subject) && /mum@example\.com/.test(mails[0].to), 'market report emailed to the owners when the last till closes');
ok(/Voided: 1/.test(mails[0].body) && /3 × Lip balm 15g/.test(mails[0].htmlBody) && /Cash counted against expected: \$250\.00 \/ \$250\.00 ✓/.test(mails[0].body), 'report: takings, voids, top sellers, cash check');
ok(patches.some(p => p[0] === 'businesses/b1/sessions/s1' && p[1].reported === true), 'the selling day is marked as reported');
console.log(fails ? fails + ' helper check(s) failed' : 'All helper checks passed'); process.exit(fails ? 1 : 0);
