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
const b = { _id: 'b1', name: 'Test Co', owners: ['mum@example.com', 'off@example.com'], roles: { 'sam@example.com': 'helper' }, settings: { vapidKey: 'K', receiptEmail: 'biz@example.com', summaries: { daily: false, weekly: false, monthly: false, yearly: false } }, notified: {} };
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
// ---- the assistant: words first, then drafts; a helper only gets their kinds; photos; lessons learnt
const calls = []; let replies = [];
const realFetch = ctx.UrlFetchApp.fetch;
ctx.UrlFetchApp.fetch = (url, o) => { if (/generativelanguage/.test(url)) { calls.push(JSON.parse(o.payload)); const t = replies.shift(); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) }; } return realFetch(url, o); };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: k => k === 'GEMINI_API_KEY' ? 'KEY' : null, setProperty() {} }) };
const notes = {}; ctx.getDoc = p => notes[p] ? Object.assign({}, notes[p]) : null; ctx.del = () => {};
ctx.runQuery = (bid, f, v) => f === 'note' ? [{ kind: 'chunk', i: 0, data: 'QUJD', _id: 'c0' }] : f === 'learn' ? [{ _id: 'n9', heard: 'buy lav oil', edits: [{ kind: 'shopping', before: { item: 'lav oil' }, after: { item: 'Lavender Infused Oil 50ml' } }] }] : [];
db['businesses/b1/products'] = [{ _id: 'p1', name: 'Lip balm', size: '15g' }]; db['businesses/b1/places'] = [{ _id: 'm1', name: 'Matakana' }]; db['businesses/b1/pins'] = []; db['businesses/b1/inputs'] = [{ _id: 'i1', name: 'Beeswax' }];
db['businesses/b1/events'] = [];
notes['businesses/b1/voicenotes/n1'] = { kind: 'note', status: 'new', by: 'sam@example.com', mime: 'audio/mp4' };
replies = ['Market at Matakana on Saturday, buy beeswax, and how many lip balms have we got', JSON.stringify({ say: 'Drafted.', drafts: [{ kind: 'event', event: { type: 'market', title: 'Matakana' } }, { kind: 'shopping', shopping: { item: 'Beeswax', qty: 2 } }, { kind: 'question', question: { ask: 'stock', product: 'Lip balm 15g' } }, { kind: 'cost', cost: { what: 'x', cents: 100 } }] })];
patches.length = 0; b.settings.aiLessons = "'lav oil' means Lavender Infused Oil 50ml";
ctx.processNote(b, 'n1');
const np = patches.filter(p => p[0] === 'businesses/b1/voicenotes/n1').map(p => p[1]);
ok(np.some(p => p.stage === 'listening') && np.findIndex(p => p.stage === 'thinking' && /Matakana/.test(p.heard)) < np.findIndex(p => p.status === 'ready'), 'voice note: the words are saved (stage "thinking") before the drafts are ready');
ok(!calls[0].contents[0].parts.some(p => /Lessons/.test(p.text || '')) && calls[1].contents[0].parts[0].text.indexOf("'lav oil' means") > 0 && /Lip balm 15g/.test(calls[1].contents[0].parts[0].text), 'drafts are worked out with the products and the lessons learnt');
const ready = np.find(p => p.status === 'ready');
ok(ctx.cleanDraft({ kind: 'todo', task: 'Add a camera to the fuel tool' }).todo.text === 'Add a camera to the fuel tool' && ctx.cleanDraft({ kind: 'todo', todo: { title: 'Label jars' } }).todo.text === 'Label jars' && ctx.cleanDraft({ kind: 'idea', idea: { description: 'Rose balm' } }).idea.text === 'Rose balm', 'a to-do or idea is kept whatever the model calls the field (task, title, description)');
ok(/todo \{text, who, due, time\}/.test(calls[1].contents[0].parts[0].text) && /never leave it empty/.test(calls[1].contents[0].parts[0].text), 'the instructions name every field (a to-do\'s text included)');
ok(ready.drafts.map(d => d.kind).join(',') === 'shopping,question', 'a helper only gets their kinds (no calendar entry, no cost)');
ok(calls[1].generationConfig.thinkingConfig.thinkingLevel === 'low', 'thinking is kept low for speed');
calls.length = 0; patches.length = 0;
notes['businesses/b1/voicenotes/n2'] = { kind: 'note', status: 'new', by: 'mum@example.com', mime: 'image/jpeg', text: 'fuel receipt' };
replies = [JSON.stringify({ heard: 'Z Energy 42.1 L $118.40', say: 'Fill-up drafted.', drafts: [{ kind: 'fuel', fuel: { litres: 42.1, cents: 11840, odometer: 84210, date: '2026-11-08' } }] })];
ctx.processNote(b, 'n2');
const r2 = patches.filter(p => p[0] === 'businesses/b1/voicenotes/n2').map(p => p[1]).find(p => p.status === 'ready');
ok(calls.length === 1 && calls[0].contents[0].parts.some(p => p.inline_data && p.inline_data.mime_type === 'image/jpeg') && r2.drafts[0].fuel.cents === 11840 && r2.drafts[0].fuel.odometer === 84210, 'a photo is read in one go: a fuel receipt becomes a fill-up draft');
calls.length = 0; patches.length = 0; clock = { day: tomorrow, mins: 21 * 60 + 10 }; b.aiLearnt = '';
replies = ["'lav oil' means Lavender Infused Oil 50ml\nBeeswax comes in 1 kg blocks"];
ctx.patchSetting = (bid, k, v) => patches.push(['setting', { [k]: v }]);
ctx.learnTick(b);
ok(patches.some(p => p[0] === 'setting' && /Beeswax comes in 1 kg blocks/.test(p[1].aiLessons)) && patches.some(p => p[0] === 'businesses/b1/voicenotes/n9' && p[1].learn === 'done') && /Never include prices/.test(calls[0].contents[0].parts[0].text), 'each evening, edits become lessons (never prices or recipe amounts), and the notes are marked learnt');
b.aiLearnt = tomorrow; calls.length = 0; ctx.learnTick(b); ok(calls.length === 0, 'lessons are worked out once a day');
// ---- the app's "Test the link": the helper notes it heard it, and does nothing else
ctx.ContentService = { createTextOutput: t => ({ text: t }) }; ctx.Session = { getEffectiveUser: () => ({ getEmail: () => 'biz@example.com' }) };
ctx.getDoc = p => p === 'businesses/bizb99' ? { settings: { receiptEmail: 'biz@example.com' } } : null; patches.length = 0;
const pr = ctx.doPost({ postData: { contents: JSON.stringify({ bid: 'bizb99', id: 'ping-abc123' }) } });
ok(pr.text === 'ok' && patches.length === 1 && patches[0][0] === 'businesses/bizb99' && patches[0][1].helperSeen.version === 6, 'Test the link: the helper records that it heard the app (and its version)');
// ---- summaries: the daily briefing only on days with something on; weekly on Mondays; monthly on the 1st
ctx.UrlFetchApp.fetch = realFetch; mails.length = 0;
const mon = '2026-11-16', first = '2026-12-01';
db['businesses/b1/events'] = [{ _id: 'e9', type: 'market', title: 'Matakana', date: mon, time: '08:00', end: '13:00' }];
db['businesses/b1/todos'] = []; db['businesses/b1/orders'] = []; db['businesses/b1/sessions'] = [{ _id: 'sx', type: 'market', name: 'Matakana', date: '2026-11-14', reported: true }, { _id: 'sy', type: 'market', name: 'Village', date: '2026-11-15', reported: true }];
db['businesses/b1/sales'] = [{ date: '2026-11-14', total: 12000, gst: 1565, channel: 'market', lines: [{ name: 'Lip balm', size: '15g', qty: 4, amount: 8000 }], at: 1 }, { date: '2026-11-15', total: 3000, gst: 391, channel: 'market', lines: [{ name: 'Tea', qty: 2, amount: 3000 }], at: 2 },
  { date: '2026-11-08', total: 10000, gst: 1304, channel: 'market', lines: [], at: 0 }, { date: '2026-11-15', total: 999, voided: true, lines: [], at: 3 }];
b.settings.summaries = { time: '07:00' }; b.notified = {};
clock = { day: mon, mins: 6 * 60 + 50 }; ctx.notifyTick(b); ok(mails.length === 0, 'nothing before the chosen time');
clock = { day: mon, mins: 7 * 60 + 5 }; ctx.notifyTick(b);
const daily = mails.find(m => /Today/.test(m.subject)), weekly = mails.find(m => /Last week/.test(m.subject));
ok(daily && /Matakana 8am–1pm/.test(daily.body) && /mum@example\.com/.test(daily.to) && !/sam@/.test(daily.to), 'Monday 7:05: the daily briefing goes to the owners (only), with today\'s market');
ok(weekly && /\$150\.00/.test(weekly.subject) && /50%/.test(weekly.subject) && /Markets: 2/.test(weekly.body) && /4 × Lip balm 15g/.test(weekly.body), 'and the weekly summary: takings (voids left out), against the week before, markets, best sellers');
const nm = mails.length; b.notified = patches.filter(p => p[0] === 'businesses/b1').pop()[1].notified; ctx.notifyTick(b); ok(mails.length === nm, 'each is sent once');
mails.length = 0; db['businesses/b1/events'] = []; b.notified = {}; clock = { day: '2026-11-17', mins: 7 * 60 + 30 }; ctx.notifyTick(b); ok(mails.length === 0, 'no briefing on a day with nothing on');
clock = { day: first, mins: 8 * 60 }; b.notified = {}; ctx.notifyTick(b); ok(mails.some(m => /Last month: \$250\.00/.test(m.subject)), 'the 1st of the month: last month\'s summary');
b.settings.summaries = { time: '07:00', monthly: false }; mails.length = 0; b.notified = {}; ctx.notifyTick(b); ok(!mails.some(m => /Last month/.test(m.subject)), 'a summary switched off in the app isn\'t sent');
console.log(fails ? fails + ' helper check(s) failed' : 'All helper checks passed'); process.exit(fails ? 1 : 0);
