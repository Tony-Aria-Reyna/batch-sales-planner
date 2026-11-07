/**
 * Rata & Smudge — receipt helper (Google Apps Script).
 * Runs every 5 minutes inside the business Gmail account. Finds GST receipts that the till has asked
 * to be emailed, builds each receipt from the saved sale, and sends it from this Gmail account.
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
const HELPER_VERSION = 1;
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
    st.receiptNote || 'Thank you.'].filter(x => x !== '').join('\n');
  const tr = (a, b, bold) => '<tr><td style="padding:6px 0;' + (bold ? 'font-weight:700;' : '') + '">' + esc(a) + '</td><td style="padding:6px 0;text-align:right;' + (bold ? 'font-weight:700;' : '') + '">' + esc(b) + '</td></tr>';
  const html = '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2b2c22">' +
    '<h1 style="color:#2f3b1f;font-weight:600;letter-spacing:.04em;margin:0 0 2px">' + esc(name.toUpperCase()) + '</h1>' +
    '<div style="color:#6b703e;letter-spacing:.08em;font-size:13px;margin-bottom:18px">HERBAL HUGS</div>' +
    '<div style="font-family:Arial,sans-serif;font-size:15px">' +
    '<p style="margin:0 0 14px"><b>GST receipt ' + esc(no) + '</b><br>GST number: ' + esc(st.gstNumber || '') + '<br>' + esc(when) + (req.buyerName ? '<br>Customer: ' + esc(req.buyerName) : '') + '</p>' +
    '<table style="width:100%;border-collapse:collapse;border-top:2px solid #e5e1d2;border-bottom:2px solid #e5e1d2">' + rows.map(r => tr(r[0], r[1])).join('') + '</table>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:8px">' + tr('Total excluding GST', money(excl)) + tr('GST (15%)', money(gst)) + tr('Total including GST', money(sale.total), true) + tr('Paid by', paid) + '</table>' +
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
function runQuery(bid, field, value, limit) {
  const body = { structuredQuery: { from: [{ collectionId: 'receipts' }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }, limit: limit || 50 } };
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
