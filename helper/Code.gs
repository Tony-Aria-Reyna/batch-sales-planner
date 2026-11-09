/**
 * Rata & Smudge — business helper (Google Apps Script), running inside the business Gmail account.
 *  - Emails GST receipts that the till has queued (every 5 minutes).
 *  - Voice notes: turns a recorded note into draft calendar entries, to-dos, shopping and ideas, using
 *    the business's own Gemini API key (kept in this script's Script properties, never in the app or on
 *    GitHub). The app calls this helper's web address the moment a note is recorded, so drafts come back
 *    in a few seconds; the 5-minute check picks up anything missed (for example, a note made offline).
 *  - Shopify: every 15 minutes, copies new online orders into the app (read-only; it never changes Shopify).
 *  - Notifications (web push through Firebase Cloud Messaging) and the market report email.
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
const HELPER_VERSION = 7;   // 7: drive km and time to each place, market check-ins · 2: welcome line for new Loyalty programme members · 3: voice notes · 4: Shopify orders, voice orders · 5: notifications, market report email · 6: assistant v2 (words first, questions, follow-ups, photos, stock, costs, fuel, contacts, prices, recipes, lessons learnt), summaries
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
    try { shopifyTick(b); } catch (e) { Logger.log('Shopify: ' + e); }
    try { notifyTick(b); } catch (e) { Logger.log('Notifications: ' + e); }
    try { learnTick(b); } catch (e) { Logger.log('Lessons: ' + e); }
    try { routeTick(b); } catch (e) { Logger.log('Routes: ' + e); }
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

/* ================= Voice notes, typed notes and photos (the assistant) ================= */
// Script properties (Project Settings → Script properties): GEMINI_API_KEY (required), GEMINI_MODEL (optional),
// VOICE_MONTHLY_LIMIT (optional, notes a month, default 600). Nothing here is ever sent to the app.
// Steps, each written to the note so the app can show them: 'listening' (writing down what was said),
// 'thinking' (working out what to do, with the words already on screen), 'looking' (reading a photo), then ready.
const VOICE_KINDS = ['event', 'todo', 'shopping', 'idea', 'order', 'question', 'help', 'made', 'count', 'cost', 'fuel', 'contact', 'price', 'recipe'];
// what each role may draft. Helpers: their own to-dos and shopping, questions, and stock news (sent to the owners to confirm).
function kindsFor(role) { return role === 'helper' ? ['todo', 'shopping', 'question', 'help', 'made', 'count'] : role === 'manager' ? VOICE_KINDS.filter(k => k !== 'recipe') : VOICE_KINDS; }
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
    if (/^ping-/.test(q.id)) { patch('businesses/' + q.bid, { helperSeen: { at: Date.now(), version: HELPER_VERSION } }); return ContentService.createTextOutput('ok'); }
    processNote(b, q.id);
  } catch (err) { out = 'error'; Logger.log(err); }
  return ContentService.createTextOutput(out);
}
function doGet() { return ContentService.createTextOutput('Rata & Smudge helper v' + HELPER_VERSION + ' is running.'); }

function voiceTick(b) {
  const waiting = runQuery(b._id, 'status', 'new', 10, 'voicenotes');
  const stuck = runQuery(b._id, 'status', 'working', 10, 'voicenotes').filter(n => Date.now() - (n.workingAt || 0) > 5 * 60000);
  waiting.concat(stuck).forEach(n => { try { processNote(b, n._id); } catch (e) { Logger.log(e); } });
  // tidy: any recording or photo pieces left more than a day are deleted
  runQuery(b._id, 'kind', 'chunk', 50, 'voicenotes').filter(c => Date.now() - (c.at || 0) > 24 * 3600000)
    .forEach(c => del('businesses/' + b._id + '/voicenotes/' + c._id));
}

// one call to Gemini. Thinking is kept low (these are quick jobs); a model that doesn't take that setting is asked again without it.
function gemini(parts, json, level) {
  const model = prop('GEMINI_MODEL', 'gemini-3.8-flash');
  const call = withThinking => {
    const gc = { temperature: 0.2 }; if (json) gc.responseMimeType = 'application/json'; if (withThinking) gc.thinkingConfig = { thinkingLevel: level || 'low' };
    return UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': prop('GEMINI_API_KEY', '') },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: gc }) });
  };
  let r = call(true);
  if (r.getResponseCode() === 400 && /think/i.test(r.getContentText())) r = call(false);
  if (r.getResponseCode() !== 200) { const e = new Error('Gemini ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 160)); e.gemini = true; throw e; }
  const j = JSON.parse(r.getContentText());
  return { text: ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join(''), usage: j.usageMetadata || {} };
}

// what the assistant knows before it starts: names it must match, the next fortnight, and what it has learnt.
// Only what the person speaking may see (a helper's note never carries costs, pay or recipes).
function businessSummary(b, role) {
  const names = {}; listDocs('businesses/' + b._id + '/pins').forEach(p => { if (p.name) names[p._id] = p.name; });
  const people = (b.members || []).map(m => ({ email: m, name: names[m] || m.split('@')[0] }));
  const places = listDocs('businesses/' + b._id + '/places').filter(p => !p.gone).map(p => ({ name: p.name, kind: p.group || '' }));
  const products = listDocs('businesses/' + b._id + '/products').map(p => p.name + (p.size ? ' ' + p.size : '') + (p.active === false ? ' (off the till)' : ''));
  const todayK = today(), soon = addDay(todayK, 14);
  const events = listDocs('businesses/' + b._id + '/events').filter(e => e.date && e.date <= soon && (e.date >= todayK || e.rpt)).slice(0, 40)
    .map(e => ({ type: e.type, title: e.title, date: e.date, time: e.time || '', repeats: e.rpt || '' }));
  const out = { people: people, markets_and_places: places, products: products, calendar_next_14_days: events };
  if (role !== 'helper') out.ingredients_and_packaging = listDocs('businesses/' + b._id + '/inputs').map(i => i.name);
  return out;
}

function processNote(b, id) {
  const path = 'businesses/' + b._id + '/voicenotes/' + id, note = getDoc(path);
  if (!note || note.kind === 'chunk') return;
  if (note.status !== 'new' && !(note.status === 'working' && Date.now() - (note.workingAt || 0) > 5 * 60000)) return;
  const st = b.settings || {}, month = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM');
  const use = (b.aiUsage && b.aiUsage.month === month) ? b.aiUsage : { month: month, notes: 0, inTok: 0, outTok: 0 };
  const fail = msg => patch(path, { status: 'failed', error: msg, doneAt: Date.now() });
  if (st.aiPaused) return fail('The assistant is paused in Setup.');
  if (use.notes >= Number(prop('VOICE_MONTHLY_LIMIT', '600'))) return fail('This month\'s assistant limit has been reached.');
  if (!prop('GEMINI_API_KEY', '')) return fail('The assistant has no Gemini key yet (Script properties).');
  const isPhoto = /^image\//.test(note.mime || '');
  patch(path, { status: 'working', workingAt: Date.now(), stage: isPhoto ? 'looking' : note.text ? 'thinking' : 'listening' });

  const pieces = runQuery(b._id, 'note', id, 40, 'voicenotes').filter(c => c.kind === 'chunk').sort((x, y) => x.i - y.i);
  const media = pieces.map(c => c.data || '').join('');
  if (!media && !note.text) return fail(isPhoto ? 'The photo did not arrive. Please try again.' : 'The recording did not arrive. Please try again.');
  let inTok = 0, outTok = 0; const count = u => { inTok += u.promptTokenCount || 0; outTok += u.candidatesTokenCount || 0; };
  try {
    // 1. a voice note: write down the words first, so they're on screen while the rest is worked out
    let heard = note.text ? String(note.text).slice(0, 4000) : '';
    if (media && !isPhoto) {
      const t = gemini([{ text: 'Write down exactly what is said in this voice note, in New Zealand English. Plain text only, no comments. If nothing is said, reply with nothing.' },
        { inline_data: { mime_type: geminiMime(note.mime), data: media } }], false, 'low');
      count(t.usage); heard = String(t.text || '').trim().slice(0, 4000);
      patch(path, { stage: 'thinking', heard: heard });
      if (!heard) { patch(path, { status: 'ready', stage: 'ready', say: 'I didn\'t hear anything. Try again a bit closer to the iPad.', drafts: [], doneAt: Date.now(), error: '' }); pieces.forEach(c => del('businesses/' + b._id + '/voicenotes/' + c._id)); return; }
    }
    // 2. work out what to do
    const role = (b.owners || []).indexOf(note.by) >= 0 ? 'owner' : ((b.roles || {})[note.by] || 'helper');
    const allowed = kindsFor(role), now = new Date(), todayK = today();
    const context = Object.assign({ today: todayK, weekday: Utilities.formatDate(now, 'Pacific/Auckland', 'EEEE'), time: Utilities.formatDate(now, 'Pacific/Auckland', 'HH:mm'),
      speaker: { email: note.by, role: role } }, businessSummary(b, role));
    if (Array.isArray(note.helpTopics)) context.help_topics = note.helpTopics.slice(0, 80).map(x => str(x, 80));
    const lessons = String(st.aiLessons || '').slice(0, 3000);
    const instructions = [
      'You are the assistant for a small New Zealand natural-products business (balms, oils, teas) that sells at markets, from its farm shop, online and wholesale to shops.',
      'Turn the ' + (isPhoto ? 'photo' : 'note') + ' into draft actions for a person to check. Use New Zealand English. Never invent details.',
      'Allowed kinds for this person: ' + allowed.join(', ') + '. If they ask for something else, leave it out and say so in "say".',
      'Each kind and its exact field names (use these names, nothing else):',
      'event {type, title, date, time, end, days, place, attendees, note}: something for the calendar. type is market, brew (a day to make products), order (an order due to go), or other. title is a short name, e.g. "Matakana market". For a market, place is the exact name from markets_and_places if it matches. attendees are emails from people.',
      'todo {text, who, due, time}: a task. text is the task itself in a few words, e.g. "Add a camera to the fuel tool" (never leave it empty). who is the email of the person it is for (the speaker unless they name someone). due is a date or "".',
      'shopping {item, qty, size}: something to buy. qty is a number, size like "1 kg" or "".',
      'idea {text, kind}: text is the idea in a few words; kind is idea, call (someone to call) or product (a product idea).',
      'order {customer, lines, due, note}: an order from a shop or customer. customer is their name (a place name if it matches). lines are {product, qty}, product copied exactly from products when it matches. due is the send-by date or "". Whenever there is an order, also add a todo to send it, due a day before the send-by date (or "" if none).',
      'question {ask, from, to, product, text}: they are asking something. ask is one of sales (takings), profit, whatson (calendar and to-dos), stock (how many of a product), other. from and to are the dates it covers (YYYY-MM-DD; "today" means both are today; "this week" is Monday to Sunday). product is copied exactly from products when about one product. text is the question in their words.',
      'help {topic}: they ask how to do something in the app, or where to find something (e.g. "how do I change a price?", "where do I add a market?"). topic is the id of the best fit from help_topics (the part before the colon). Use help, not question, for how-to questions.',
      'made {product, qty}: products just made. product copied exactly from products, qty a number.',
      'count {lines}: a stock count. lines are {product, qty}.',
      'cost {what, cents, date, place}: money spent by the business (a stall fee, equipment, postage). what, cents (the amount in cents INCLUDING GST), date, place (exact name from markets_and_places or "").',
      'fuel {litres, cents, odometer, date}: filling up the vehicle (a fuel receipt or the pump display; the odometer may be on a separate dashboard photo). litres, cents (total paid, in cents), odometer (km, a whole number or 0), date.',
      'contact {business, person, phone, email, note}: a shop or person to remember. business, person, phone, email, note.',
      'price {item, cents, pack, unit, supplier}: a new price for an ingredient or packaging item (from an invoice or receipt). item copied exactly from ingredients_and_packaging when it matches, cents (price for one pack, EXCLUDING GST, in cents; take GST off if the invoice shows it), pack (pack size as a number), unit (g, ml or each), supplier.',
      'recipe {name, yield, unit, lines}: a recipe (e.g. a handwritten card). name, yield (a number), unit (ml, g or each), lines {item, qty} with item copied from ingredients_and_packaging when it matches.',
      'If the whole ' + (isPhoto ? 'photo' : 'note') + ' is only a command about drafts already on screen, set command to one of confirm, cancel, later, and give no drafts.',
      'Dates are YYYY-MM-DD in New Zealand, worked out from today (' + todayK + ', ' + context.weekday + '). Times are 24-hour HH:MM or "".',
      'Leave anything not said as "" and list the field names you guessed or were unsure of in "unsure".',
      '"say" is one or two short sentences read aloud, listing what you drafted, e.g. "I\'ve drafted the Matakana market on Saturday from 8 to 1, and beeswax on the shopping list."',
      'Reply with JSON only: {"heard": string, "say": string, "command": string, "drafts": [{"kind": string, "unsure": [string], "<kind>": {...its fields}}]}. Each draft has one object named after its kind, e.g. {"kind": "todo", "unsure": [], "todo": {"text": "Label the jars", "who": "", "due": "", "time": ""}}.',
      lessons ? 'Lessons learnt from this business (follow these):\n' + lessons : '',
      'Context: ' + JSON.stringify(context)
    ].filter(Boolean).join('\n');
    const parts = [{ text: instructions }];
    if (note.prev && note.prev.length) parts.push({ text: 'This note changes the drafts already on screen. Return the complete new list of drafts with the change made and everything else kept the same. Drafts on screen: ' + JSON.stringify(note.prev).slice(0, 6000) });
    if (isPhoto) parts.push({ inline_data: { mime_type: note.mime, data: media } }, { text: 'Read the photo. ' + (note.text ? 'They added: ' + String(note.text).slice(0, 500) : '') });
    else parts.push({ text: (note.text ? 'Typed note: ' : 'What they said: ') + heard });
    const g = gemini(parts, true, 'low'); count(g.usage);
    let ans = {}; try { ans = JSON.parse(g.text); } catch (e) { ans = {}; }
    const drafts = (Array.isArray(ans.drafts) ? ans.drafts : []).filter(d => d && allowed.indexOf(d.kind) >= 0).slice(0, 20).map(cleanDraft);
    const command = ['confirm', 'cancel', 'later'].indexOf(ans.command) >= 0 ? ans.command : '';
    patch(path, { status: 'ready', stage: 'ready', heard: isPhoto ? String(ans.heard || '').slice(0, 2000) : heard, say: String(ans.say || '').slice(0, 500), command: command, drafts: drafts, doneAt: Date.now(), error: '' });
    pieces.forEach(c => del('businesses/' + b._id + '/voicenotes/' + c._id));      // the recording or photo is not kept
    patch('businesses/' + b._id, { aiUsage: { month: month, notes: use.notes + 1, inTok: use.inTok + inTok, outTok: use.outTok + outTok } });
    // "tell me when it's ready": a notification to that person's devices
    if (note.notify && st.vapidKey) { try { DEV_CACHE = null; pushTo(b, [note.by], 'todos', '🎙 Ready to check', String(ans.say || 'Your note has been worked out.').slice(0, 160), 'note-' + id); } catch (e) { Logger.log(e); } }
  } catch (e) {
    if (e.gemini) { patch(path, { status: 'new', stage: '', error: String(e.message).slice(0, 200), workingAt: 0 }); throw e; }
    throw e;
  }
}
function geminiMime(m) { m = String(m || '').split(';')[0]; return m === 'audio/mp4' || m === 'audio/x-m4a' ? 'audio/m4a' : (m || 'audio/webm'); }
function str(x, n) { return String(x == null ? '' : x).slice(0, n || 200); }
function cleanDraft(d) {
  const date = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '', time = x => /^\d{2}:\d{2}$/.test(x || '') ? x : '', num = (x, max) => Math.max(0, Math.min(max, Number(x) || 0));
  const o = { kind: d.kind, unsure: (Array.isArray(d.unsure) ? d.unsure : []).map(x => str(x, 30)).slice(0, 10) };
  // take the fields wherever the model put them (inside the kind, or loose on the draft), and accept the usual other names
  const x = Object.assign({}, d, d[d.kind] || {}), pick = (...k) => { for (const n of k) if (x[n] != null && String(x[n]).trim() !== '') return x[n]; return ''; };
  x.text = pick('text', 'task', 'title', 'description', 'what', 'name', 'idea', 'note'); x.item = pick('item', 'name', 'what', 'text'); x.title = pick('title', 'name', 'what', 'text');
  const lines = (l, key) => (Array.isArray(l) ? l : []).slice(0, 40).map(y => ({ [key]: str((y || {})[key], 120), qty: num((y || {}).qty, 99999) }));
  if (d.kind === 'event') o.event = { type: ['market', 'brew', 'order', 'other'].indexOf(x.type) >= 0 ? x.type : 'other', title: str(x.title, 80), date: date(x.date), time: time(x.time), end: time(x.end),
    days: Math.max(1, Math.min(7, Number(x.days) || 1)), place: str(x.place, 80), attendees: (Array.isArray(x.attendees) ? x.attendees : []).map(a => str(a, 100).toLowerCase()).slice(0, 10), note: str(x.note, 500) };
  if (d.kind === 'todo') o.todo = { text: str(x.text), due: date(x.due), time: time(x.time), who: str(x.who, 100).toLowerCase() };
  if (d.kind === 'shopping') o.shopping = { item: str(x.item, 120), qty: Math.max(1, Math.min(999, Number(x.qty) || 1)), size: str(x.size, 40) };
  if (d.kind === 'order') o.order = { customer: str(x.customer, 80), due: date(x.due), note: str(x.note, 500), lines: lines(x.lines, 'product').map(l => Object.assign(l, { qty: Math.max(1, l.qty) })) };
  if (d.kind === 'idea') o.idea = { text: str(x.text), kind: ['idea', 'call', 'product'].indexOf(x.kind) >= 0 ? x.kind : 'idea' };
  if (d.kind === 'help') o.help = { topic: str(pick('topic', 'id'), 40).split(':')[0].trim() };
  if (d.kind === 'question') o.question = { ask: ['sales', 'profit', 'whatson', 'stock', 'other'].indexOf(x.ask) >= 0 ? x.ask : 'other', from: date(x.from), to: date(x.to), product: str(x.product, 120), text: str(x.text, 300) };
  if (d.kind === 'made') o.made = { product: str(x.product, 120), qty: num(x.qty, 9999) };
  if (d.kind === 'count') o.count = { lines: lines(x.lines, 'product') };
  if (d.kind === 'cost') o.cost = { what: str(x.what, 120), cents: Math.round(num(x.cents, 10000000)), date: date(x.date), place: str(x.place, 80) };
  if (d.kind === 'fuel') o.fuel = { litres: num(x.litres, 500), cents: Math.round(num(x.cents, 100000)), odometer: Math.round(num(x.odometer, 9999999)), date: date(x.date) };
  if (d.kind === 'contact') o.contact = { business: str(x.business, 80), person: str(x.person, 80), phone: str(x.phone, 40), email: str(x.email, 100).toLowerCase(), note: str(x.note, 300) };
  if (d.kind === 'price') o.price = { item: str(x.item, 80), cents: Math.round(num(x.cents, 10000000)), pack: num(x.pack, 1000000), unit: ['g', 'ml', 'each'].indexOf(x.unit) >= 0 ? x.unit : 'each', supplier: str(x.supplier, 80) };
  if (d.kind === 'recipe') o.recipe = { name: str(x.name, 80), yield: num(x.yield, 1000000), unit: ['g', 'ml', 'each'].indexOf(x.unit) >= 0 ? x.unit : 'ml', lines: lines(x.lines, 'item') };
  return o;
}

/* ---------- lessons learnt: each evening, what people changed in the drafts becomes short rules ---------- */
// The app marks a note it saved after someone edited the drafts (learn: 'todo', with before and after).
// Lessons are kept in Setup → Assistant → What it has learnt, where an owner can read, change or delete them.
// They are never emailed. Costs, pay and recipe amounts are never made into lessons.
function learnTick(b) {
  const nz = nzNow(); if (nz.mins < 21 * 60) return;
  if ((b.aiLearnt || '') === nz.day) return;
  const notes = runQuery(b._id, 'learn', 'todo', 30, 'voicenotes');
  patch('businesses/' + b._id, { aiLearnt: nz.day });
  if (!notes.length || !prop('GEMINI_API_KEY', '')) return;
  const changes = notes.map(n => ({ heard: str(n.heard, 400), edits: n.edits || [] }));
  const old = String((b.settings || {}).aiLessons || '');
  const g = gemini([{ text: 'An assistant turns notes from a small New Zealand natural-products business into drafts (calendar entries, to-dos, shopping, orders and so on). ' +
    'Below are notes, what it drafted, and what the person changed before saving. Write short lessons (one per line, at most 15 words each, New Zealand English) that would have avoided the changes, ' +
    'e.g. "\'lav oil\' means Lavender Infused Oil 50ml" or "Matakana is a Saturday market, 8 am to 1 pm". Merge them with the existing lessons, drop duplicates and anything contradicted, at most 40 lines. ' +
    'Never include prices, costs, pay or recipe amounts. Reply with the lessons only.\nExisting lessons:\n' + old + '\nChanges:\n' + JSON.stringify(changes).slice(0, 20000) }], false, 'low');
  const lessons = String(g.text || '').split('\n').map(l => l.replace(/^[-*•\d.\s]+/, '').trim()).filter(Boolean).slice(0, 40).join('\n').slice(0, 3000);
  if (lessons) patchSetting(b._id, 'aiLessons', lessons);
  notes.forEach(n => patch('businesses/' + b._id + '/voicenotes/' + n._id, { learn: 'done', edits: [] }));
}
// change one setting without touching the others
function patchSetting(bid, key, value) {
  const body = { fields: { settings: { mapValue: { fields: { [key]: enc(value) } } } } };
  check(UrlFetchApp.fetch(BASE + '/businesses/' + bid + '?updateMask.fieldPaths=' + encodeURIComponent('settings.' + key), { method: 'patch', contentType: 'application/json', payload: JSON.stringify(body), headers: headers(), muteHttpExceptions: true }), 'Saving a setting');
}

/* ================= The drive to each place (Google Maps, built into Apps Script: free, no key) =================
   From Setup's home address to each place's address, by road. Saves the km and minutes each way and the
   place's map position (for the weather). Only places whose address (or the home address) has changed. */
function routeTick(b, limit) {
  const home = String((b.settings || {}).homeAddress || '').trim(); if (!home) return 0;
  let n = 0;
  for (const p of listDocs('businesses/' + b._id + '/places')) {
    if (p.gone || !p.address) continue;
    const key = home + '|' + p.address, r = p.route || {};
    if (r.for === key && (r.km || Date.now() - (r.at || 0) < 864e5)) continue;   // done, or failed in the last day
    if (n++ >= (limit || 5)) break;
    const path = 'businesses/' + b._id + '/places/' + p._id;
    try {
      const d = Maps.newDirectionFinder().setOrigin(home).setDestination(p.address).setMode(Maps.DirectionFinder.Mode.DRIVING).setRegion('nz').getDirections();
      const leg = d && d.routes && d.routes[0] && d.routes[0].legs && d.routes[0].legs[0];
      if (!leg) { patch(path, { route: { for: key, err: d && d.status || 'not found', at: Date.now() } }); continue; }
      const km = Math.round(leg.distance.value / 100) / 10, mins = Math.round(leg.duration.value / 60), f = { route: { for: key, km: km, mins: mins, at: Date.now() } };
      if (leg.end_location) { f.lat = leg.end_location.lat; f.lng = leg.end_location.lng; }
      if (!p.km || p.kmAuto !== false) { f.km = Math.round(km * 2); f.kmAuto = true; }
      patch(path, f);
    } catch (e) { patch(path, { route: { for: key, err: String(e && e.message || e).slice(0, 120), at: Date.now() } }); }
  }
  return n;
}
function checkRoutesNow() { myBusinesses().forEach(b => Logger.log(b.name + ': ' + routeTick(b, 50) + ' place(s) checked')); }
// the time to leave home for a market (start less setting up and the drive there)
function leaveAt(e) { const p = e.plan || {}; if (!e.time || p.there == null) return ''; const m = Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3)) - (p.setup || 0) - (p.there || 0); if (m < 0) return '';
  return t12(('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2)); }

/* ================= Shopify orders (read-only) ================= */
// Script properties: SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET from the app made in Shopify's Dev Dashboard
// (inside her store's own organisation, with read_orders and read_products, installed on her store).
// The shop's address (name.myshopify.com) is typed into the app: Setup → Shopify.
const SHOPIFY_EVERY_MIN = 15;
function shopifyToken(shop) {
  const props = PropertiesService.getScriptProperties(), cached = JSON.parse(props.getProperty('SHOPIFY_TOKEN') || '{}');
  if (cached.shop === shop && cached.token && cached.expires > Date.now() + 10 * 60000) return cached.token;
  const r = UrlFetchApp.fetch('https://' + shop + '/admin/oauth/access_token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'client_credentials', client_id: prop('SHOPIFY_CLIENT_ID', ''), client_secret: prop('SHOPIFY_CLIENT_SECRET', '') } });
  if (r.getResponseCode() !== 200) throw new Error('Shopify sign-in ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 120));
  const j = JSON.parse(r.getContentText());
  props.setProperty('SHOPIFY_TOKEN', JSON.stringify({ shop: shop, token: j.access_token, expires: Date.now() + (j.expires_in || 86399) * 1000 }));
  return j.access_token;
}
function shopifyTick(b, force) {
  const shop = String((b.settings || {}).shopifyShop || '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return;
  if (!prop('SHOPIFY_CLIENT_ID', '') || !prop('SHOPIFY_CLIENT_SECRET', '')) { patch('businesses/' + b._id, { shopifyHelper: { lastRun: Date.now(), error: 'No Shopify keys in the helper yet', version: HELPER_VERSION } }); return; }
  const props = PropertiesService.getScriptProperties(), last = Number(props.getProperty('SHOPIFY_LAST_RUN') || 0);
  if (!force && Date.now() - last < SHOPIFY_EVERY_MIN * 60000 - 30000) return;
  props.setProperty('SHOPIFY_LAST_RUN', String(Date.now()));
  let err = '', added = 0;
  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const q = '{ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "created_at:>=' + since + '") { edges { node { id legacyResourceId name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus note ' +
      'totalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } ' +
      'customer { displayName email phone } shippingAddress { name address1 address2 city zip } ' +
      'lineItems(first: 50) { edges { node { title variantTitle quantity sku originalUnitPriceSet { shopMoney { amount } } product { legacyResourceId } } } } } } } }';
    const r = UrlFetchApp.fetch('https://' + shop + '/admin/api/' + prop('SHOPIFY_API_VERSION', '2026-07') + '/graphql.json', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'X-Shopify-Access-Token': shopifyToken(shop) }, payload: JSON.stringify({ query: q }) });
    if (r.getResponseCode() !== 200) throw new Error('Shopify ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 120));
    const j = JSON.parse(r.getContentText()); if (j.errors) throw new Error('Shopify: ' + JSON.stringify(j.errors).slice(0, 160));
    const prods = listDocs('businesses/' + b._id + '/products');
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cents = x => Math.round(Number(x || 0) * 100);
    for (const e of (((j.data || {}).orders || {}).edges || [])) {
      const n = e.node, id = 'shopify-' + n.legacyResourceId, path = 'businesses/' + b._id + '/orders/' + id, existing = getDoc(path);
      const fulfilled = /FULFILLED/.test(n.displayFulfillmentStatus || '') && !/UNFULFILLED|PARTIALLY/.test(n.displayFulfillmentStatus || '');
      const paid = /PAID/.test(n.displayFinancialStatus || '') && !/UNPAID|PARTIALLY/.test(n.displayFinancialStatus || '');
      if (existing) {   // only Shopify's own facts are updated; whatever was done in the app is kept
        const ch = {};
        if (n.cancelledAt && existing.status !== 'cancelled') ch.status = 'cancelled';
        else if (fulfilled && (existing.status === 'new' || existing.status === 'packed')) { ch.status = 'sent'; ch.sentAt = Date.now(); ch.sentBy = 'shopify'; }
        if (paid && !existing.paid) ch.paid = true;
        if (Object.keys(ch).length) patch(path, ch);
        continue;
      }
      if (n.cancelledAt) continue;
      const lines = (((n.lineItems || {}).edges) || []).map(x => x.node).map(l => {
        const spid = String((l.product || {}).legacyResourceId || ''), name = l.title + (l.variantTitle && l.variantTitle !== 'Default Title' ? ' ' + l.variantTitle : '');
        const p = prods.find(p => (p.shopifyIds || []).indexOf(spid) >= 0) || prods.find(p => norm(p.name + (p.size || '')) === norm(name) || norm(p.name) === norm(l.title));
        return { pid: p ? p._id : '', name: String(name).slice(0, 120), qty: Number(l.quantity) || 0, unit: cents((l.originalUnitPriceSet || {}).shopMoney && l.originalUnitPriceSet.shopMoney.amount), shopifyProduct: spid };
      });
      const a = n.shippingAddress || {}, c = n.customer || {};
      const o = { source: 'shopify', status: fulfilled ? 'sent' : 'new', paid: paid, at: Date.parse(n.createdAt) || Date.now(), date: String(n.createdAt || '').slice(0, 10), by: 'shopify',
        customer: { name: String(c.displayName || a.name || 'Shopify customer').slice(0, 80), email: String(c.email || '').slice(0, 120), phone: String(c.phone || '').slice(0, 40),
          address: [a.address1, a.address2, a.city, a.zip].filter(Boolean).join(', ').slice(0, 200) },
        lines: lines, discount: cents(((n.totalDiscountsSet || {}).shopMoney || {}).amount), shipping: cents(((n.totalShippingPriceSet || {}).shopMoney || {}).amount),
        total: cents(((n.totalPriceSet || {}).shopMoney || {}).amount), note: String(n.note || '').slice(0, 500), due: '', shopify: { id: String(n.legacyResourceId), name: n.name } };
      o.gst = Math.round(o.total * 3 / 23);
      if (fulfilled) { o.sentAt = Date.now(); o.sentBy = 'shopify'; }
      patch(path, o); added++;
      try { pushTo(b, bosses(b), 'orders', '📦 New Shopify order ' + (n.name || ''), o.customer.name + ' · ' + o.lines.reduce((t, l) => t + l.qty, 0) + ' items · ' + money(o.total), 'order-' + id); } catch (e) { Logger.log(e); }
    }
  } catch (e) { err = String(e && e.message || e).slice(0, 200); }
  const prev = b.shopifyHelper || {};
  patch('businesses/' + b._id, { shopifyHelper: { lastRun: Date.now(), error: err, added: (prev.added || 0) + added, version: HELPER_VERSION } });
}
// run by hand from the script editor to check the Shopify connection straight away
function checkShopifyNow() { myBusinesses().forEach(b => shopifyTick(b, true)); Logger.log('Checked Shopify. See the Orders screen in the app.'); }

/* ================= Notifications and the market report ================= */
// The business Gmail account needs the "Firebase Cloud Messaging API Admin" role on the Firebase project.
const APP_URL = 'https://batch-sales-planner.web.app/';
function bosses(b) { return (b.owners || []).concat(Object.keys(b.roles || {}).filter(e => b.roles[e] === 'manager')); }
function nzNow() { const t = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd HH mm').split(' '); return { day: t[0], mins: Number(t[1]) * 60 + Number(t[2]) }; }
function addDay(k, n) { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function occursOn(e, key) {   // same rules as the app's calendar
  if (!e || !e.date || key < e.date) return false; if (e.until && key > e.until) return false; if ((e.skip || []).indexOf(key) >= 0) return false;
  const days = Math.max(1, Math.min(14, Number(e.days) || 1)), diff = Math.round((Date.parse(key + 'T12:00:00Z') - Date.parse(e.date + 'T12:00:00Z')) / 864e5), within = n => n >= 0 && n < days;
  if (e.rpt === 'week') return within(diff % 7); if (e.rpt === '2weeks') return within(diff % 14);
  if (e.rpt === 'month') { for (let i = 0; i < days; i++) { const s = addDay(key, -i); if (s >= e.date && s.slice(8) === e.date.slice(8)) return true; } return false; }
  return within(diff);
}
const t12 = t => { if (!t) return ''; let h = Number(t.slice(0, 2)), m = t.slice(3); const ap = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; return h + (m !== '00' ? ':' + m : '') + ap; };
let DEV_CACHE = null;
function devicesOf(b) { if (!DEV_CACHE || DEV_CACHE.bid !== b._id) DEV_CACHE = { bid: b._id, list: listDocs('businesses/' + b._id + '/devices') }; return DEV_CACHE.list; }
// send to these people's devices, for one kind of notification they haven't switched off
function pushTo(b, emails, kind, title, body, tag) {
  const want = {}; emails.forEach(e => want[String(e).toLowerCase()] = 1); let n = 0;
  for (const d of devicesOf(b)) {
    if (!want[d._id] || (d.prefs || {})[kind] === false) continue;
    for (const h of Object.keys(d.tokens || {})) {
      const tok = (d.tokens[h] || {}).token; if (!tok) continue;
      const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send', { method: 'post', contentType: 'application/json', headers: headers(), muteHttpExceptions: true,
        payload: JSON.stringify({ message: { token: tok, data: { title: String(title), body: String(body).slice(0, 300), tag: String(tag || ''), url: APP_URL }, webpush: { headers: { Urgency: 'high', TTL: '3600' } } } }) });
      const code = r.getResponseCode();
      if (code === 404 || (code === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(r.getContentText()))) {   // that device was reset or turned them off: forget it
        delete d.tokens[h]; patch('businesses/' + b._id + '/devices/' + d._id, { tokens: d.tokens });
      } else if (code !== 200) throw new Error('Sending a notification: ' + code + ' ' + r.getContentText().slice(0, 160));
      else n++;
    }
  }
  return n;
}
function notifyTick(b) {
  DEV_CACHE = null;
  const st = b.settings || {}, sent = b.notified || {}, marks = {}, now = Date.now(), nz = nzNow(), today = nz.day, tomorrow = addDay(today, 1);
  const once = (key, fn) => { if (sent[key] || marks[key]) return; marks[key] = now; try { fn(); } catch (e) { Logger.log(e); } };
  const boss = bosses(b), devs = st.vapidKey ? devicesOf(b) : [];
  if (devs.length) {
    // a test from the Notifications screen
    devs.forEach(d => { if (d.test && now - d.test < 15 * 60000) once('test-' + d._id + '-' + d.test, () => pushTo(b, [d._id], 'test', 'Rata & Smudge', 'Notifications are working on this device. 🌿', 'test')); });
    const events = listDocs('businesses/' + b._id + '/events'), who = e => e.type === 'market' ? boss.concat(e.attendees || []) : boss;
    const ty = { market: '🧺 Market', brew: '🫙 Brew day', order: '📦 Order due', other: '📌' };
    for (const e of events) {
      const rem = e.remind || [];
      if (rem.indexOf('day') >= 0 && nz.mins >= 18 * 60 && occursOn(e, tomorrow) && !occursOn(e, today))
        once('rd-' + e._id + '-' + tomorrow, () => pushTo(b, who(e), 'reminders', (ty[e.type] || '📌') + ' tomorrow', (e.title || '') + (e.time ? ' at ' + t12(e.time) : '') + (e.type === 'market' && leaveAt(e) ? ' · leave home ' + leaveAt(e) : ''), 'ev-' + e._id));
      if (rem.indexOf('hour') >= 0 && e.time && occursOn(e, today)) { const start = Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3)), left = start - nz.mins;
        if (left > 0 && left <= 60) once('rh-' + e._id + '-' + today, () => pushTo(b, who(e), 'reminders', (ty[e.type] || '📌') + ' in ' + left + ' min', (e.title || '') + ' at ' + t12(e.time), 'ev-' + e._id)); }
    }
    // the morning list, 7:30 to 10 am: today's markets and that person's to-dos
    if (nz.mins >= 450 && nz.mins < 600) {
      const todos = listDocs('businesses/' + b._id + '/todos').filter(t => !t.done && t.due && t.due <= today);
      for (const d of devs) {
        const isBoss = boss.indexOf(d._id) >= 0, mk = events.filter(e => e.type === 'market' && occursOn(e, today) && (isBoss || (e.attendees || []).indexOf(d._id) >= 0));
        const td = todos.filter(t => t.who === d._id), lines = mk.map(e => '🧺 ' + e.title + (e.time ? ' ' + t12(e.time) : '')).concat(td.slice(0, 5).map(t => (t.due < today ? '⚠️ ' : '✅ ') + t.text));
        if (lines.length) once('am-' + today + '-' + d._id, () => pushTo(b, [d._id], 'todos', 'Today', lines.join('\n') + (td.length > 5 ? '\n…and ' + (td.length - 5) + ' more' : ''), 'morning'));
      }
    }
    // a till left open: 2 hours after the market's finish time, or 10 hours after it opened
    const sessions = listDocs('businesses/' + b._id + '/sessions');
    for (const s of sessions.filter(x => x.status === 'open')) {
      const ev = events.find(e => e._id === s.eventId), endMins = ev && ev.end ? Number(ev.end.slice(0, 2)) * 60 + Number(ev.end.slice(3)) : null;
      const late = (s.date < today) || (endMins != null && s.date === today && nz.mins > endMins + 120) || now - (s.openedAt || now) > 10 * 3600000;
      if (late) once('till-' + s._id, () => pushTo(b, boss.concat(s.openedBy ? [s.openedBy] : []), 'tills', '💵 Till still open', (s.name || 'A selling day') + ': end the day on the till when you\'re finished', 'till-' + s._id));
    }
    // the evening before a market: anything that has run out
    if (nz.mins >= 18 * 60 + 30 && events.some(e => e.type === 'market' && occursOn(e, tomorrow)))
      once('ls-' + tomorrow, () => { const out = productsOut(b); if (out.length) pushTo(b, boss, 'lowstock', '🧺 Before tomorrow\'s market', out.length + ' product' + (out.length === 1 ? '' : 's') + ' at 0: ' + out.slice(0, 6).join(', ') + (out.length > 6 ? '…' : ''), 'lowstock'); });
  }
  // the market report email, once every till for that market and day is closed
  marketReports(b, devs, once);
  summariesTick(b, once);
  const keep = {}; Object.keys(sent).forEach(k => { if (now - sent[k] < 4 * 864e5) keep[k] = sent[k]; }); Object.keys(marks).forEach(k => keep[k] = marks[k]);
  if (Object.keys(marks).length) patch('businesses/' + b._id, { notified: keep });
}
// products whose stock has reached 0 (the same sums as the app: counts and moves, less what was sold since)
function productsOut(b) {
  const moves = listDocs('businesses/' + b._id + '/stockmoves').filter(m => m.product), sales = listDocs('businesses/' + b._id + '/sales').filter(s => !s.voided);
  const prods = listDocs('businesses/' + b._id + '/products').filter(p => p.active !== false), out = [];
  for (const p of prods) {
    const ms = moves.filter(m => m.product === p._id && m.kind !== 'packed' && m.kind !== 'returned').sort((a, c) => a.at - c.at); if (!ms.length) continue;
    let base = 0, since = ms[0].at; const lc = ms.filter(m => m.kind === 'count').pop(); if (lc) { base = lc.qty; since = lc.at; }
    ms.forEach(m => { if (m.at >= since && m.kind !== 'count') base += m.qty; });
    const sold = sales.filter(s => s.at >= since).reduce((n, s) => n + (s.lines || []).filter(l => l.pid === p._id).reduce((a, l) => a + l.qty, 0), 0);
    if (base - sold <= 0) out.push(p.name + (p.size ? ' ' + p.size : ''));
  }
  return out;
}
function marketReports(b, devs, once) {
  const nz = nzNow(), days = [nz.day, addDay(nz.day, -1)], sessions = listDocs('businesses/' + b._id + '/sessions').filter(s => days.indexOf(s.date) >= 0);
  const groups = {}; sessions.forEach(s => { const k = s.date + '|' + (s.name || s.type); (groups[k] = groups[k] || []).push(s); });
  const owners = (b.owners || []).filter(e => { const d = devs.find(x => x._id === e); return !d || (d.prefs || {}).report !== false; });
  if (!owners.length) return;
  for (const k of Object.keys(groups)) {
    const g = groups[k]; if (g.some(s => s.status === 'open') || g.every(s => s.reported)) continue;
    if (g.some(s => s.type === 'market' && !s.checkin && Date.now() - (s.closedAt || 0) < 30 * 60000)) continue;   // give the check-in half an hour
    once('report-' + k, () => {
      const ids = g.map(s => s._id), sales = listDocs('businesses/' + b._id + '/sales').filter(s => ids.indexOf(s.sessionId) >= 0);
      const live = sales.filter(s => !s.voided), total = live.reduce((n, s) => n + s.total, 0), gst = live.reduce((n, s) => n + (s.gst || 0), 0);
      const by = m => live.filter(s => s.method === m).reduce((n, s) => n + s.total, 0), items = {};
      live.forEach(s => (s.lines || []).forEach(l => { const key = l.name + (l.size ? ' ' + l.size : ''); items[key] = (items[key] || 0) + l.qty; }));
      const top = Object.keys(items).sort((a, c) => items[c] - items[a]).slice(0, 8);
      const place = g[0].placeId ? getDoc('businesses/' + b._id + '/places/' + g[0].placeId) : null, dayFee = getDoc('businesses/' + b._id + '/costs/dayfee-' + g[0]._id);
      const fee = dayFee ? { cents: dayFee.cents, days: 1 } : place ? getDoc('businesses/' + b._id + '/costs/fee-' + g[0].placeId) : null;
      const prods = listDocs('businesses/' + b._id + '/products'), pn = id => { const p = prods.find(x => x._id === id); return p ? p.name + (p.size ? ' ' + p.size : '') : ''; };
      const checkinRows = gg => { const c = (gg.find(s => s.checkin && !s.checkin.skipped) || {}).checkin; if (!c) return [];
        const t = c.times || {}, sell = gg[0].closedAt && gg[0].openedAt ? Math.round((gg[0].closedAt - gg[0].openedAt) / 60000) : 0, all = (t.there || 0) + (t.setup || 0) + sell + (t.pack || 0) + (t.home || 0) + (t.unpack || 0);
        return [['How busy', { quiet: 'Quiet', steady: 'Steady', busy: 'Busy', flat: 'Flat out' }[c.busy] || '—'], ['Weather', (c.weather || []).join(', ') || '—'], ['Hours in all (travel to unpacking)', (Math.round(all / 6) / 10) + ' h']]
          .concat((c.soldOut || []).length ? [['Sold out', c.soldOut.map(pn).filter(Boolean).join(', ')]] : []).concat(c.note ? [['Notes', c.note]] : []); };
      const counted = g.reduce((n, s) => n + (s.countedCash != null ? s.countedCash : 0), 0), expected = g.reduce((n, s) => n + (s.expectedCash != null ? s.expectedCash : 0), 0);
      const name = (g[0].name || 'Selling day'), when = Utilities.formatDate(new Date(g[0].openedAt || Date.now()), 'Pacific/Auckland', 'EEEE d MMMM');
      const rows = [['Takings', money(total)], ['Sales', String(live.length)], ['Cash', money(by('cash'))], ['EFTPOS', money(by('eftpos'))], ['Other', money(by('other'))], ['GST in the takings', money(gst)],
        ['Average sale', live.length ? money(Math.round(total / live.length)) : '—'], ['Voided', String(sales.length - live.length)]]
        .concat(fee && fee.cents ? [['Stall fee', money(Math.round(fee.cents / Math.max(1, fee.days || 1))) + (fee.days > 1 ? ' (share of ' + money(fee.cents) + ' for ' + fee.days + ' days)' : '')]] : [])
        .concat(checkinRows(g))
        .concat(expected ? [['Cash counted against expected', money(counted) + ' / ' + money(expected) + (counted === expected ? ' ✓' : ' (' + (counted > expected ? 'over ' : 'short ') + money(Math.abs(counted - expected)) + ')')]] : []);
      const html = '<div style="font-family:Arial,sans-serif;max-width:560px;color:#2b2c22"><h2 style="font-family:Georgia,serif;color:#2f3b1f">' + esc(name) + '</h2><p>' + esc(when) + '</p>' +
        '<table style="width:100%;border-collapse:collapse">' + rows.map(r => '<tr><td style="padding:6px 0;border-bottom:1px solid #e5e1d2">' + esc(r[0]) + '</td><td style="padding:6px 0;text-align:right;border-bottom:1px solid #e5e1d2"><b>' + esc(r[1]) + '</b></td></tr>').join('') + '</table>' +
        (top.length ? '<h3>Top sellers</h3><p>' + top.map(t => esc(items[t] + ' × ' + t)).join('<br>') + '</p>' : '') + '<p style="color:#686a5a">Full figures: Reports in the app.</p></div>';
      MailApp.sendEmail({ to: owners.join(','), subject: name + ' · ' + when + ' · ' + money(total), htmlBody: html, body: rows.map(r => r[0] + ': ' + r[1]).join('\n'), name: b.name || 'Rata & Smudge' });
      g.forEach(s => patch('businesses/' + b._id + '/sessions/' + s._id, { reported: true }));
    });
  }
}


/* ================= Summaries by email (owners only) =================
   Daily briefing: each morning at the time set in the app (Setup → Summaries, default 7:00), only on days
   with something on the calendar or a to-do due. Weekly (Mondays), monthly (the 1st) and yearly (the first
   day of the financial year): sales, products, markets, and how it compares with the one before.
   Owners can switch each one off or change the time in the app. */
function summariesTick(b, once) {
  const st = b.settings || {}, cfg = st.summaries || {}, nz = nzNow(), owners = b.owners || [];
  if (!owners.length) return;
  const at = String(cfg.time || '07:00'), mins = Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
  if (!(nz.mins >= mins && nz.mins < mins + 180)) return;              // a three-hour window after the chosen time
  const day = nz.day, dt = new Date(day + 'T12:00:00Z'), wd = dt.getUTCDay(), dom = dt.getUTCDate(), mo = dt.getUTCMonth() + 1;
  if (cfg.daily !== false) once('sum-d-' + day, () => { const m = dailyBriefing(b, day); if (m) mailOwners(b, m); });
  if (cfg.weekly !== false && wd === Number(cfg.weekday || 1)) once('sum-w-' + day, () => { const to = addDay(day, -1), from = addDay(day, -7); mailOwners(b, periodSummary(b, 'Week', from, to, addDay(from, -7), addDay(from, -1))); });
  if (cfg.monthly !== false && dom === 1) once('sum-m-' + day.slice(0, 7), () => { const to = addDay(day, -1), from = to.slice(0, 8) + '01', pto = addDay(from, -1), pfrom = pto.slice(0, 8) + '01';
    mailOwners(b, periodSummary(b, 'Month', from, to, pfrom, pto)); });
  const fy = Number(st.fyStart || 4);
  if (cfg.yearly !== false && dom === 1 && mo === fy) once('sum-y-' + day.slice(0, 7), () => { const to = addDay(day, -1), y = Number(day.slice(0, 4)), from = (y - 1) + day.slice(4, 8) + '01',
    pfrom = (y - 2) + day.slice(4, 8) + '01', pto = addDay(from, -1); mailOwners(b, periodSummary(b, 'Year', from, to, pfrom, pto)); });
}
function mailOwners(b, m) {
  const devs = (b.settings || {}).vapidKey ? devicesOf(b) : [];
  const to = (b.owners || []).filter(e => { const d = devs.find(x => x._id === e); return !d || (d.prefs || {}).summaries !== false; });
  if (to.length) MailApp.sendEmail({ to: to.join(','), subject: m.subject, body: m.text, htmlBody: m.html, name: b.name || 'Rata & Smudge' });
}
const H = { wrap: (title, sub, inner) => '<div style="font-family:Arial,sans-serif;max-width:560px;color:#2b2c22"><h2 style="font-family:Georgia,serif;color:#2f3b1f;margin-bottom:4px">' + esc(title) + '</h2><p style="color:#686a5a;margin-top:0">' + esc(sub) + '</p>' + inner + '<p style="color:#686a5a">Open the app for more: ' + APP_URL + '</p></div>',
  h3: t => '<h3 style="margin:18px 0 6px">' + esc(t) + '</h3>', list: l => '<ul style="margin:0;padding-left:20px">' + l.map(x => '<li style="margin:3px 0">' + esc(x) + '</li>').join('') + '</ul>',
  table: rows => '<table style="width:100%;border-collapse:collapse">' + rows.map(r => '<tr><td style="padding:6px 0;border-bottom:1px solid #e5e1d2">' + esc(r[0]) + '</td><td style="padding:6px 0;text-align:right;border-bottom:1px solid #e5e1d2"><b>' + esc(r[1]) + '</b></td></tr>').join('') + '</table>' };
// today's briefing; nothing is sent on a day with nothing on
function dailyBriefing(b, day) {
  const events = listDocs('businesses/' + b._id + '/events').filter(e => occursOn(e, day)).sort((x, y) => (x.time || '').localeCompare(y.time || ''));
  const todos = listDocs('businesses/' + b._id + '/todos').filter(t => !t.done && t.due && t.due <= day);
  if (!events.length && !todos.length) return null;
  const ty = { market: '🧺', brew: '🫙', order: '📦', other: '📌' }, names = {}; (b.members || []).forEach(m => names[m] = m.split('@')[0]);
  const yest = addDay(day, -1), ys = listDocs('businesses/' + b._id + '/sales').filter(s => !s.voided && s.date === yest), yt = ys.reduce((n, s) => n + s.total, 0);
  const orders = listDocs('businesses/' + b._id + '/orders').filter(o => o.status !== 'sent' && o.status !== 'cancelled' && o.due && o.due <= addDay(day, 3));
  const out = events.some(e => e.type === 'market') ? productsOut(b) : [];
  const evs = events.map(e => (ty[e.type] || '📌') + ' ' + (e.title || '') + (e.time ? ' ' + t12(e.time) + (e.end ? '–' + t12(e.end) : '') : ''));
  const tds = todos.slice(0, 15).map(t => (t.due < day ? '⚠️ overdue: ' : '') + t.text + (t.who ? ' (' + (names[t.who] || t.who) + ')' : ''));
  const when = Utilities.formatDate(new Date(day + 'T12:00:00Z'), 'Pacific/Auckland', 'EEEE d MMMM');
  let html = (evs.length ? H.h3('On today') + H.list(evs) : '') + (tds.length ? H.h3('To do') + H.list(tds) : '')
    + (out.length ? H.h3('Out of stock before the market') + H.list(out) : '') + (orders.length ? H.h3('Orders due in the next 3 days') + H.list(orders.map(o => ((o.customer || {}).name || 'Order') + ', due ' + o.due)) : '')
    + (ys.length ? H.h3('Yesterday') + '<p>' + esc(money(yt) + ' from ' + ys.length + ' sale' + (ys.length === 1 ? '' : 's')) + '</p>' : '');
  const text = [when, evs.length ? 'On today:\n' + evs.join('\n') : '', tds.length ? 'To do:\n' + tds.join('\n') : '', out.length ? 'Out of stock: ' + out.join(', ') : '',
    orders.length ? 'Orders due soon: ' + orders.map(o => ((o.customer || {}).name || 'Order') + ' ' + o.due).join(', ') : '', ys.length ? 'Yesterday: ' + money(yt) + ' from ' + ys.length + ' sales' : ''].filter(Boolean).join('\n\n');
  return { subject: '☀️ Today: ' + (evs[0] || tds[0] || '').replace(/^\S+ /, '').slice(0, 60) + (evs.length + tds.length > 1 ? ' and ' + (evs.length + tds.length - 1) + ' more' : ''), html: H.wrap('Today, ' + when, b.name || 'Rata & Smudge', html), text: text };
}
// a week, month or year: sales, products and markets, against the one before
function periodSummary(b, kind, from, to, pfrom, pto) {
  const sales = listDocs('businesses/' + b._id + '/sales').filter(s => !s.voided), sessions = listDocs('businesses/' + b._id + '/sessions');
  const crunch = (f, t) => { const l = sales.filter(s => s.date >= f && s.date <= t), items = {}, byDay = {}, ch = {};
    l.forEach(s => { byDay[s.date] = (byDay[s.date] || 0) + s.total; ch[s.channel || 'other'] = (ch[s.channel || 'other'] || 0) + s.total;
      (s.lines || []).forEach(x => { const k = x.name + (x.size ? ' ' + x.size : ''); const it = items[k] || (items[k] = { qty: 0, total: 0 }); it.qty += x.qty; it.total += x.amount != null ? x.amount : x.qty * (x.unit || 0); }); });
    const mk = {}; sessions.filter(x => x.type === 'market' && x.date >= f && x.date <= t).forEach(x => mk[x.date + '|' + (x.name || '')] = 1);
    return { count: l.length, total: l.reduce((n, s) => n + s.total, 0), gst: l.reduce((n, s) => n + (s.gst || 0), 0), items: items, byDay: byDay, ch: ch, markets: Object.keys(mk).length,
      days: Object.keys(byDay).length }; };
  const R = crunch(from, to), P = crunch(pfrom, pto);
  const vs = (a, c) => c ? (a >= c ? '▲ ' : '▼ ') + Math.round(Math.abs(a - c) / c * 100) + '% on the ' + kind.toLowerCase() + ' before' : '';
  const top = Object.keys(R.items).sort((x, y) => R.items[y].total - R.items[x].total).slice(0, 8), best = Object.keys(R.byDay).sort((x, y) => R.byDay[y] - R.byDay[x])[0];
  const chn = { market: 'Markets', farmgate: 'Farm gate', tour: 'Garden tours', shop: 'Shop' };
  const fmt = d => Utilities.formatDate(new Date(d + 'T12:00:00Z'), 'Pacific/Auckland', 'd MMM yyyy'), range = fmt(from) + ' to ' + fmt(to);
  const rows = [['Takings (incl GST)', money(R.total)], ['Compared', vs(R.total, P.total) || '—'], ['Sales', String(R.count)], ['Average sale', R.count ? money(Math.round(R.total / R.count)) : '—'],
    ['Markets', String(R.markets) + (P.markets ? ' (' + P.markets + ' before)' : '')], ['Selling days', String(R.days)], ['GST in the takings', money(R.gst)]]
    .concat(best ? [['Best day', fmt(best) + ', ' + money(R.byDay[best])]] : []);
  const html = H.table(rows) + (Object.keys(R.ch).length ? H.h3('Where it sold') + H.list(Object.keys(R.ch).sort((x, y) => R.ch[y] - R.ch[x]).map(k => (chn[k] || k) + ': ' + money(R.ch[k]))) : '')
    + (top.length ? H.h3('Best sellers') + H.list(top.map(k => R.items[k].qty + ' × ' + k + ' (' + money(R.items[k].total) + ')')) : '') + '<p style="color:#686a5a">Profit and costs: Reports in the app.</p>';
  const text = range + '\n' + rows.map(r => r[0] + ': ' + r[1]).join('\n') + (top.length ? '\n\nBest sellers:\n' + top.map(k => R.items[k].qty + ' × ' + k).join('\n') : '');
  return { subject: (kind === 'Week' ? '📊 Last week: ' : kind === 'Month' ? '📊 Last month: ' : '📊 Last year: ') + money(R.total) + (vs(R.total, P.total) ? ' (' + vs(R.total, P.total).split(' on ')[0] + ')' : ''), html: H.wrap(kind === 'Year' ? 'Your year' : 'Your ' + kind.toLowerCase(), range, html), text: text };
}
