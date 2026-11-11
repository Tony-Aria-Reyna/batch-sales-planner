/* ================= Shared by the app and the business helper =================
   The assistant's instructions, what each role may draft, and the tidy-up of what the model returns.
   ONE copy: edit this file, then `node scripts/sync-shared.js` puts it into helper/Code.gs between the markers,
   and the app build inlines it. */
const VOICE_KINDS = ['event', 'todo', 'shopping', 'idea', 'order', 'question', 'help', 'made', 'count', 'cost', 'fuel', 'contact', 'price', 'recipe'];
// what each role may draft. Helpers: their own to-dos and shopping, questions, and stock news (sent to the owners to confirm).
function kindsFor(role) { return role === 'helper' ? ['todo', 'shopping', 'question', 'help', 'made', 'count'] : role === 'manager' ? VOICE_KINDS.filter(k => k !== 'recipe') : VOICE_KINDS; }
function str(x, n) { return String(x == null ? '' : x).slice(0, n || 200); }
// The instructions for one note. o: {isPhoto, isAudio, allowed, todayK, weekday, context, lessons}
function aiInstructions(o) {
  const isPhoto = !!o.isPhoto, allowed = o.allowed, todayK = o.todayK, context = o.context, lessons = o.lessons || '';
  return [
    o.isAudio ? 'First write down exactly what is said in the recording, in New Zealand English, as "heard" (if nothing is said, "heard" is "" and there are no drafts).' : '',

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
}
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
