/**
 * Rata & Smudge — business helper (Google Apps Script), running inside the business Gmail account.
 *  - Emails GST receipts that the till has queued (every 5 minutes).
 *  - Voice notes: turns a recorded note into draft calendar entries, to-dos, shopping and ideas, using
 *    the business's own Gemini API key (kept in this script's Script properties, never in the app or on
 *    GitHub). The app calls this helper's web address the moment a note is recorded, so drafts come back
 *    in a few seconds; the 5-minute check picks up anything missed (for example, a note made offline).
 *
 * Set-up (once): see "Emailed GST receipts" in the README.
 *   1. Signed in as the business Gmail, open script.google.com → New project → name it "Rata & Smudge receipts".
 *   2. Paste this file over Code.gs; Project Settings → tick "Show appsscript.json" and paste appsscript.json.
 *   3. Run setup() once and allow access. Then run sendTestReceipt() to email yourself a sample.
 *
 * Safety: the helper only sends for a business whose Setup → GST receipts names THIS Gmail account,
 * only for real sales, at most 3 receipts per sale, and builds every email itself (nothing typed into
 * the app becomes part of the email except the customer's address and name).
 */
const HELPER_VERSION = 3;   // 2: welcome line for new Loyalty programme members · 3: voice notes
const PROJECT_ID = 'batch-sales-planner';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
const MAX_PER_SALE = 3;

/* ---------- run once ---------- */
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  tick();
  Logger.log('Receipt helper is set up and will check every 5 minutes, as ' + me());
}
/* email a sample receipt (made-up items) to this Gmail account, to see what customers get */
function sendTestReceipt() {
  const b = myBusinesses()[0];
  if (!b) throw new Error('No business names ' + me() + ' in Setup → GST receipts. Add it there first.');
  const sale = { id: 'TEST1', date: today(), at: Date.now(), method: 'eftpos', total: 5000, gst: gstOf(5000), subtotal: 5500, discount: 500,
    lines: [{ name: 'Sample Balm', size: '30g', qty: 1, unit: 2500, amount: 2500 }, { name: 'Sample Oil', size: '50ml', qty: 1, unit: 3000, amount: 3000 }],
    deals: [{ name: 'Sample deal', saving: 500 }] };
  const m = buildReceipt(b, sale, { buyerName: '' });
  MailApp.sendEmail({ to: me(), subject: '[TEST] ' + m.subject, body: m.text, htmlBody: m.html, name: b.name || 'Rata & Smudge' });
  Logger.log('Sample receipt sent to ' + me());
}

/* ---------- every 5 minutes ---------- */
function tick() {
  const now = Date.now();
  for (const b of myBusinesses()) {
    try { voiceTick(b); } catch (e) { Logger.log('Voice notes: ' + e); }
    let err = '', sentNow = 0;
    try {
      const queued = queryQueued(b._id);
      for (const r of queued) {
        const path = 'businesses/' + b._id + '/receipts/' + r._id;
        try {
          const sale = getDoc('businesses/' + b._id + '/sales/' + r.saleId);
          if (!sale) { patch(path, { status: 'failed', error: 'sale not found (yet)', triedAt: now }); continue; }
          if (sale.voided) { patch(path, { status: 'failed', error: 'that sale was voided', triedAt: now }); continue; }
          if (countSent(b._id, r.saleId) >= MAX_PER_SALE) { patch(path, { status: 'failed', error: 'already sent ' + MAX_PER_SALE + ' times', triedAt: now }); continue; }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.to || '')) { patch(path, { status: 'failed', error: 'not an email address', triedAt: now }); continue; }
          const m = buildReceipt(b, sale, r);
          MailApp.sendEmail({ to: r.to, subject: m.subject, body: m.text, htmlBody: m.html, name: b.name || 'Rata & Smudge', replyTo: me() });
          patch(path, { status: 'sent', sentAt: Date.now(), receiptNo: m.no, error: '' });
          sentNow++;
        } catch (e) { patch(path, { status: 'failed', error: String(e && e.message || e).slice(0, 200), triedAt: now }); }
      }
    } catch (e) { err = String(e && e.message || e).slice(0, 300); }
    const prev = b.receiptHelper || {};
    patch('businesses/' + b._id, { receiptHelper: { lastRun: now, account: me(), version: HELPER_VERSION, error: err, sent: (prev.sent || 0) + sentNow } });
  }
}

/* ---------- the receipt (taxable supply information) ---------- */
function gstOf(c) { return Math.round((c || 0) * 3 / 23); }
function money(c) { const n = Math.round(c || 0); return (n < 0 ? '-$' : '$') + (Math.abs(n) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function receiptNo(s) { return 'RS-' + String(s.date || '').replace(/-/g, '') + '-' + String(s.id || s._id || '').slice(-5).toUpperCase(); }
function buildReceipt(b, sale, req) {
  const st = b.settings || {}, name = b.name || 'Rata & Smudge', no = receiptNo(sale);
  const when = Utilities.formatDate(new Date(sale.at), 'Pacific/Auckland', 'd MMMM yyyy, h:mm a');
  const gst = sale.gst != null ? sale.gst : gstOf(sale.total), excl = sale.total - gst;
  const paid = { cash: 'Cash', eftpos: 'EFTPOS', other: 'Other' + (sale.note ? ' (' + sale.note + ')' : '') }[sale.method] || sale.method;
  const rows = (sale.lines || []).map(l => [l.qty + ' × ' + l.name + (l.size ? ' ' + l.size : ''), money(l.amount)])
    .concat((sale.deals || []).map(d => [d.name + (d.times > 1 ? ' ×' + d.times : ''), '−' + money(d.saving)]))
    .concat(sale.manualDiscount ? [['Discount' + (sale.manualDiscount.reason ? ' (' + sale.manualDiscount.reason + ')' : ''), '−' + money(sale.manualDiscount.amount)]] : []);
  const subject = name + ' receipt ' + no + ' · ' + money(sale.total);
  const text = [name, 'GST receipt ' + no, 'GST number: ' + (st.gstNumber || ''), 'Date: ' + when, req.buyerName ? 'Customer: ' + req.buyerName : '', '',
    rows.map(r => r[0] + '  ' + r[1]).join('\n'), '', 'Total excluding GST: ' + money(excl), 'GST (15%): ' + money(gst), 'Total including GST: ' + money(sale.total), 'Paid by: ' + paid, '',
    req.loyalty ? 'Thank you for joining the ' + name + ' Loyalty programme. To leave at any time, reply to this email with UNSUBSCRIBE.' : '',
    st.receiptNote || 'Thank you.'].filter(x => x !== '').join('\n');
  const tr = (a, b, bold) => '<tr><td style="padding:6px 0;' + (bold ? 'font-weight:700;' : '') + '">' + esc(a) + '</td><td style="padding:6px 0;text-align:right;' + (bold ? 'font-weight:700;' : '') + '">' + esc(b) + '</td></tr>';
  const html = '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2b2c22">' +
    '<h1 style="color:#2f3b1f;font-weight:600;letter-spacing:.04em;margin:0 0 2px">' + esc(name.toUpperCase()) + '</h1>' +
    '<div style="color:#6b703e;letter-spacing:.08em;font-size:13px;margin-bottom:18px">HERBAL HUGS</div>' +
    '<div style="font-family:Arial,sans-serif;font-size:15px">' +
    '<p style="margin:0 0 14px"><b>GST receipt ' + esc(no) + '</b><br>GST number: ' + esc(st.gstNumber || '') + '<br>' + esc(when) + (req.buyerName ? '<br>Customer: ' + esc(req.buyerName) : '') + '</p>' +
    '<table style="width:100%;border-collapse:collapse;border-top:2px solid #e5e1d2;border-bottom:2px solid #e5e1d2">' + rows.map(r => tr(r[0], r[1])).join('') + '</table>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:8px">' + tr('Total excluding GST', money(excl)) + tr('GST (15%)', money(gst)) + tr('Total including GST', money(sale.total), true) + tr('Paid by', paid) + '</table>' +
    (req.loyalty ? '<p style="margin-top:20px;padding:12px;background:#eef4e8;border-radius:10px">💚 Thank you for joining the ' + esc(name) + ' Loyalty programme. To leave at any time, reply to this email with <b>UNSUBSCRIBE</b>.</p>' : '') +
    '<p style="margin-top:20px;color:#686a5a">' + esc(st.receiptNote || 'Thank you.') + '</p></div></div>';
  return { subject, text, html, no };
}

/* ---------- which businesses this account sends for ---------- */
function me() { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); }
function myBusinesses() { return listDocs('businesses').filter(b => String((b.settings || {}).receiptEmail || '').toLowerCase() === me()); }
function today() { return Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd'); }

/* ---------- Firestore over the web ---------- */
function headers() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': PROJECT_ID }; }
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue); if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null; if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) { const o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(k => o[k] = dec(f[k])); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
}
function enc(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(enc) } };
  const f = {}; Object.keys(x).forEach(k => f[k] = enc(x[k])); return { mapValue: { fields: f } };
}
function docOf(d) { const o = dec({ mapValue: { fields: d.fields || {} } }); o._id = d.name.split('/').pop(); return o; }
function check(r, what) { if (r.getResponseCode() !== 200) throw new Error(what + ': ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200)); return JSON.parse(r.getContentText()); }
function listDocs(path) {
  const out = []; let token = '';
  do {
    const j = check(UrlFetchApp.fetch(BASE + '/' + path + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { headers: headers(), muteHttpExceptions: true }), 'Reading ' + path);
    (j.documents || []).forEach(d => out.push(docOf(d)));
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
function getDoc(path) {
  const r = UrlFetchApp.fetch(BASE + '/' + path, { headers: headers(), muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  return docOf(check(r, 'Reading ' + path));
}
function runQuery(bid, field, value, limit, col) {
  const body = { structuredQuery: { from: [{ collectionId: col || 'receipts' }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }, limit: limit || 50 } };
  const j = check(UrlFetchApp.fetch(BASE + '/businesses/' + bid + ':runQuery', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), headers: headers(), muteHttpExceptions: true }), 'Looking for receipts');
  return j.filter(x => x.document).map(x => docOf(x.document));
}
function queryQueued(bid) { return runQuery(bid, 'status', 'queued', 50); }
function countSent(bid, saleId) { return runQuery(bid, 'saleId', saleId, 20).filter(r => r.status === 'sent').length; }
function patch(path, fields) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const body = { fields: {} }; Object.keys(fields).forEach(k => { if (fields[k] !== undefined) body.fields[k] = enc(fields[k]); });
  check(UrlFetchApp.fetch(BASE + '/' + path + '?' + mask, { method: 'patch', contentType: 'application/json', payload: JSON.stringify(body), headers: headers(), muteHttpExceptions: true }), 'Saving ' + path);
}

function del(path) {
  const r = UrlFetchApp.fetch(BASE + '/' + path, { method: 'delete', headers: headers(), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200 && r.getResponseCode() !== 404) throw new Error('Deleting ' + path + ': ' + r.getResponseCode());
}

/* ================= Voice notes ================= */
// Script properties (Project Settings → Script properties): GEMINI_API_KEY (required), GEMINI_MODEL (optional),
// VOICE_MONTHLY_LIMIT (optional, notes a month, default 600). Nothing here is ever sent to the app.
const VOICE_KINDS = ['event', 'todo', 'shopping', 'idea'];
function prop(k, d) { return PropertiesService.getScriptProperties().getProperty(k) || d; }

// the app calls this the moment a note is saved: { bid, id }. The note itself is read from the database,
// so a caller can only ask the helper to look at a note that a signed-in member has already saved.
function doPost(e) {
  let out = 'ok';
  try {
    const q = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(q.bid || '') || !/^[A-Za-z0-9_-]{6,40}$/.test(q.id || '')) return ContentService.createTextOutput('bad');
    const b = getDoc('businesses/' + q.bid);
    if (!b || String((b.settings || {}).receiptEmail || '').toLowerCase() !== me()) return ContentService.createTextOutput('not this helper');
    b._id = q.bid;
    processNote(b, q.id);
  } catch (err) { out = 'error'; Logger.log(err); }
  return ContentService.createTextOutput(out);
}
function doGet() { return ContentService.createTextOutput('Rata & Smudge helper v' + HELPER_VERSION + ' is running.'); }

function voiceTick(b) {
  const waiting = runQuery(b._id, 'status', 'new', 10, 'voicenotes');
  const stuck = runQuery(b._id, 'status', 'working', 10, 'voicenotes').filter(n => Date.now() - (n.workingAt || 0) > 5 * 60000);
  waiting.concat(stuck).forEach(n => { try { processNote(b, n._id); } catch (e) { Logger.log(e); } });
  // tidy: any recording pieces left more than a day are deleted
  runQuery(b._id, 'kind', 'chunk', 50, 'voicenotes').filter(c => Date.now() - (c.at || 0) > 24 * 3600000)
    .forEach(c => del('businesses/' + b._id + '/voicenotes/' + c._id));
}

function processNote(b, id) {
  const path = 'businesses/' + b._id + '/voicenotes/' + id, note = getDoc(path);
  if (!note || note.kind === 'chunk') return;
  if (note.status !== 'new' && !(note.status === 'working' && Date.now() - (note.workingAt || 0) > 5 * 60000)) return;
  const st = b.settings || {}, month = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM');
  const use = (b.aiUsage && b.aiUsage.month === month) ? b.aiUsage : { month: month, notes: 0, inTok: 0, outTok: 0 };
  const fail = msg => patch(path, { status: 'failed', error: msg, doneAt: Date.now() });
  if (st.aiPaused) return fail('The voice assistant is paused in Setup.');
  if (use.notes >= Number(prop('VOICE_MONTHLY_LIMIT', '600'))) return fail('This month\'s voice note limit has been reached.');
  if (!prop('GEMINI_API_KEY', '')) return fail('The voice assistant has no Gemini key yet (Script properties).');
  patch(path, { status: 'working', workingAt: Date.now() });

  const pieces = runQuery(b._id, 'note', id, 40, 'voicenotes').filter(c => c.kind === 'chunk').sort((x, y) => x.i - y.i);
  const audio = pieces.map(c => c.data || '').join('');
  if (!audio && !note.text) return fail('The recording did not arrive. Please try again.');

  const role = (b.owners || []).indexOf(note.by) >= 0 ? 'owner' : ((b.roles || {})[note.by] || 'helper');
  const names = {}; listDocs('businesses/' + b._id + '/pins').forEach(p => { if (p.name) names[p._id] = p.name; });
  const people = (b.members || []).map(m => ({ email: m, name: names[m] || m.split('@')[0] }));
  const places = listDocs('businesses/' + b._id + '/places').filter(p => !p.gone).map(p => p.name);
  const now = new Date(), todayK = today();
  const context = {
    today: todayK, weekday: Utilities.formatDate(now, 'Pacific/Auckland', 'EEEE'), time: Utilities.formatDate(now, 'Pacific/Auckland', 'HH:mm'),
    speaker: { email: note.by, name: (people.find(p => p.email === note.by) || {}).name || note.by, role: role },
    people: people, markets_and_places: places
  };
  const allowed = role === 'helper' ? ['todo', 'shopping'] : VOICE_KINDS;
  const instructions = [
    'You help a small New Zealand natural-products business (balms, oils, teas) that sells at markets.',
    'Listen to the voice note (or read the typed note) and turn it into draft actions. Use New Zealand English.',
    'Allowed kinds for this speaker: ' + allowed.join(', ') + '. If they ask for something else, leave it out and say so in "say".',
    'event: something for the calendar. type is one of market, brew (a day to make products), order (an order due to be sent), other.',
    '  For a market, set place to the exact name from markets_and_places when it matches, else "". attendees are emails from people.',
    'todo: a task. who is the email of the person it is for (the speaker unless they name someone). due is a date or "".',
    'shopping: something to buy. qty is a number, size like "1 kg" or "500 ml" or "".',
    'idea: kind is idea, call (a person to call) or product (a product idea).',
    'Dates are YYYY-MM-DD in New Zealand, worked out from today (' + todayK + ', ' + context.weekday + '). Times are 24-hour HH:MM or "".',
    'Never invent details. Leave anything not said as "" and list the field names you guessed or were unsure of in "unsure".',
    '"say" is one or two short sentences read aloud back to the speaker, listing what you drafted, e.g. "I\'ve drafted the Matakana market on Saturday from 8 to 1, and beeswax on the shopping list."',
    'Reply with JSON only, in this shape: {"heard": string, "say": string, "drafts": [{"kind": string, "unsure": [string], ' +
      '"event": {"type","title","date","time","end","days","place","attendees","note"}, "todo": {"text","due","time","who"}, ' +
      '"shopping": {"item","qty","size"}, "idea": {"text","kind"}}]}. Include only the object matching each draft\'s kind.',
    'Context: ' + JSON.stringify(context)
  ].join('\n');

  const parts = [{ text: instructions }];
  if (audio) parts.push({ inline_data: { mime_type: geminiMime(note.mime), data: audio } });
  if (note.text) parts.push({ text: 'Typed note: ' + String(note.text).slice(0, 2000) });
  const model = prop('GEMINI_MODEL', 'gemini-3.8-flash');
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': prop('GEMINI_API_KEY', '') },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } })
  });
  if (r.getResponseCode() !== 200) {
    patch(path, { status: 'new', error: 'Gemini ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 160), workingAt: 0 });
    throw new Error('Gemini ' + r.getResponseCode());
  }
  const j = JSON.parse(r.getContentText()), u = j.usageMetadata || {};
  let ans = {};
  try { ans = JSON.parse((((j.candidates || [])[0] || {}).content || {}).parts.map(p => p.text || '').join('')); } catch (e) { ans = {}; }
  const drafts = (Array.isArray(ans.drafts) ? ans.drafts : []).filter(d => d && allowed.indexOf(d.kind) >= 0).slice(0, 12).map(cleanDraft);
  patch(path, { status: 'ready', heard: String(ans.heard || '').slice(0, 4000), say: String(ans.say || '').slice(0, 500), drafts: drafts, doneAt: Date.now(), error: '' });
  pieces.forEach(c => del('businesses/' + b._id + '/voicenotes/' + c._id));      // the recording is not kept
  patch('businesses/' + b._id, { aiUsage: { month: month, notes: use.notes + 1, inTok: use.inTok + (u.promptTokenCount || 0), outTok: use.outTok + (u.candidatesTokenCount || 0) } });
}
function geminiMime(m) { m = String(m || '').split(';')[0]; return m === 'audio/mp4' || m === 'audio/x-m4a' ? 'audio/m4a' : (m || 'audio/webm'); }
function str(x, n) { return String(x == null ? '' : x).slice(0, n || 200); }
function cleanDraft(d) {
  const date = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '', time = x => /^\d{2}:\d{2}$/.test(x || '') ? x : '';
  const o = { kind: d.kind, unsure: (Array.isArray(d.unsure) ? d.unsure : []).map(x => str(x, 30)).slice(0, 10) };
  const e = d.event || {}, t = d.todo || {}, s = d.shopping || {}, i = d.idea || {};
  if (d.kind === 'event') o.event = { type: ['market', 'brew', 'order', 'other'].indexOf(e.type) >= 0 ? e.type : 'other', title: str(e.title, 80), date: date(e.date), time: time(e.time), end: time(e.end),
    days: Math.max(1, Math.min(7, Number(e.days) || 1)), place: str(e.place, 80), attendees: (Array.isArray(e.attendees) ? e.attendees : []).map(x => str(x, 100).toLowerCase()).slice(0, 10), note: str(e.note, 500) };
  if (d.kind === 'todo') o.todo = { text: str(t.text), due: date(t.due), time: time(t.time), who: str(t.who, 100).toLowerCase() };
  if (d.kind === 'shopping') o.shopping = { item: str(s.item, 120), qty: Math.max(1, Math.min(999, Number(s.qty) || 1)), size: str(s.size, 40) };
  if (d.kind === 'idea') o.idea = { text: str(i.text), kind: ['idea', 'call', 'product'].indexOf(i.kind) >= 0 ? i.kind : 'idea' };
  return o;
}
