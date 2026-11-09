"""Builds Mum's quick guide: guide.html (A4 pages), then make-pdf.js prints it to PDF with bookmarks.
Run from the repo: python3 scripts/guide/make.py && node scripts/guide/make-pdf.js"""
import os, html
HERE = os.path.dirname(os.path.abspath(__file__))
REV, DATE = 'Rev A', '9 November 2026'
NAV = [('contents', 'Contents'), ('selling', 'Selling'), ('calendar', 'Calendar'), ('brew', 'Brew & stock'), ('orders', 'Orders & lists'),
       ('time', 'Time & profit'), ('assistant', 'Assistant'), ('setup', 'Setup'), ('whatif', 'What to do if…')]
pages = []
def e(s): return html.escape(s, quote=False)
def page(body, cls=''):
    n = len(pages) + 1
    nav = '<nav class="bar"><span class="mark">Rata &amp; Smudge</span>' + ''.join(f'<a href="#{i}">{t}</a>' for i, t in NAV) + '</nav>'
    foot = f'<footer><span>Rata &amp; Smudge app · Quick guide · {REV}</span><span>{n}</span><span>Prepared by Tony Ross</span></footer>'
    pages.append(f'<section class="page {cls}">{nav}<div class="body">{body}</div>{foot}</section>')
def shot(name, h, cap='', w=None):
    st = f'height:{h}mm' + (f';width:{w}mm' if w else '')
    return f'<div><figure class="shot" style="{st}"><img src="shots/{name}.png"></figure>' + (f'<figcaption>{cap}</figcaption>' if cap else '') + '</div>'
def steps(items): return '<ol class="steps">' + ''.join(f'<li>{i}</li>' for i in items) + '</ol>'
def table(head, rows, cls=''):
    return f'<table class="{cls}"><thead><tr>' + ''.join(f'<th>{h}</th>' for h in head) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</tbody></table>'
def tip(t, kind='tip'): return f'<div class="box {kind}">{t}</div>'
def two(left, right, lw=95): return f'<div class="two" style="grid-template-columns:{lw}mm 1fr">{left}<div>{right}</div></div>'
def h1(num, t, id_): return f'<h1 id="{id_}"><span class="num">{num}</span>{t}</h1>'
L = lambda id_, t: f'<a href="#{id_}">{t}</a>'

# ---------- cover ----------
pages.append(f'''<section class="page cover"><div class="panel">
  <img class="logo" src="../../src/icon-512.png">
  <div class="title">App<br>Quick Guide</div><div class="rule"></div>
  <div class="sub"><b>The Rata &amp; Smudge app</b><br>Selling, markets, brewing, orders and profit</div>
  <div class="for">For the Rata &amp; Smudge team<br>Keep it by the iPad, or open it on any device</div></div>
  <div class="base"><div><span class="lbl">PREPARED BY</span><br><b>Tony Ross</b></div>
  <div class="r"><span class="lbl rev">{REV.upper()} · FOR USE</span><br>{DATE}<br>Matches the app as at {DATE}</div></div></section>''')

# ---------- contents ----------
toc = [('how', '1', 'How to use this guide'), ('start', '', 'Where to start: I need to…'), ('homescreen', '2', 'The home screen at a glance'),
       ('selling', '3', 'Selling at a market'), ('pay', '', 'Taking payment, discounts and mistakes'), ('endday', '', 'End of the day and the check-in'),
       ('calendar', '4', 'The calendar and market days'), ('brew', '5', 'Brew and stock'), ('orders', '6', 'Orders, to-dos and shopping'),
       ('suppliers', '', 'Ordering from a supplier'), ('time', '7', 'The time clock'), ('profit', '', 'Real profit and reports'),
       ('assistant', '8', 'The assistant: talk, type or take a photo'), ('privacy', '', 'How your information is kept safe'),
       ('setup', '9', 'Setup, people and PINs'), ('whatif', '10', 'What to do if…'), ('help', '11', 'Getting help'), ('index', '12', 'Index A–Z')]
page('<h1 id="contents" class="plain">Contents</h1><ul class="toc">' + ''.join(
    f'<li class="{"sub" if not n else ""}"><a href="#{i}"><span>{(n + " ") if n else ""}{t}</span><span class="dots"></span><span class="pg" data-for="{i}"></span></a></li>' for i, n, t in toc) + '</ul>')

# ---------- 1 how to use ----------
page(h1('1', 'How to use this guide', 'how') + '''<p>This guide shows how to do the everyday jobs in the Rata &amp; Smudge app, one page at a time, with a picture of each screen. Read the part you need; you don't have to read it all.</p>
<h2>Getting around</h2><ul class="dots">
<li><b>Green underlined text is a link.</b> Tap it to go to that page.</li>
<li><b>The green bar at the top of every page</b> goes to each main section.</li>
<li>On the iPad, the <b>bookmarks</b> (the list icon in the PDF viewer) list every section.</li>
<li>Printed, use the <b>page numbers</b> in the contents.</li>
<li>In the app itself, <b>🔍 Find anything</b> on the home screen answers “how do I…?” questions too (page ''' + L('help', '<span data-pg="help"></span>') + ''').</li></ul>
<h2 id="start">Where to start</h2>''' + table(['I need to…', 'Go to'], [
    ['Sell at a market, the farm shop or a garden tour', L('selling', '3 Selling at a market')],
    ['Give a discount, fix a wrong sale, or take card or cash', L('pay', '3 Taking payment, discounts and mistakes')],
    ['Count the cash and close the till', L('endday', '3 End of the day')],
    ['Put a market or brew day on the calendar', L('calendar', '4 The calendar')],
    ['See what stock is left, or pack for a market', L('brew', '5 Brew and stock')],
    ['Record a batch I’ve made', L('brew', '5 Brew and stock')],
    ['Take a wholesale or custom order', L('orders', '6 Orders')],
    ['Order more supplies from a supplier', L('suppliers', '6 Ordering from a supplier')],
    ['Record my time on brewing, orders or admin', L('time', '7 The time clock')],
    ['See what I’m really making, and what to do next', L('profit', '7 Real profit')],
    ['Tell the app something quickly while driving', L('assistant', '8 The assistant')],
    ['Change a price, add a product or a person', L('setup', '9 Setup')],
    ['Sort out a problem', L('whatif', '10 What to do if…')]], 'go') + tip('<b>Nothing breaks it.</b> To practise, use <b>Owner test mode</b> (Setup → View as → Owner test mode). Nothing is saved there. The top bar turns purple: tap <b>Go back</b> to return.'))

# ---------- 2 home ----------
page(h1('2', 'The home screen at a glance', 'homescreen') + two(shot('01-home', 228, 'The home screen (demo data)', 92), '''
<p>Everything starts here. Tap <b>⚙️</b> or <b>‹ Back</b> to get back to it from anywhere.</p>''' + table(['Part', 'What it does'], [
    ['<b>Top right</b>', 'While the time clock runs, its job and time (for example 🫙 1:23). Tap it to switch or stop. ✓ Saved shows everything is saved.'],
    ['<b>Today strip</b>', 'Today’s takings (tap 🔒 Show and your PIN), the selling day, batches and orders due.'],
    ['<b>🎙 Talk · Type · Photo · Drive</b>', 'The assistant (shows once it’s set up). See ' + L('assistant', 'page 8') + '.'],
    ['<b>🧺 Sell</b> and <b>⏱️ Time clock</b>', 'The two big buttons. The clock tile turns purple and shows the job and time while it runs. See ' + L('time', 'page 7') + '.'],
    ['<b>Tiles</b>', 'Calendar, Brew (with Recipes &amp; ingredients 🔒), Orders, Lists, 💰 Real profit (with Reports), Setup 🔒 (asks for your PIN).'],
    ['<b>What to do next</b>', 'The five most useful things to do, each with a button that takes you there, including anything that needs attention.'],
    ['<b>🔍 Find anything</b>', 'Products, markets, settings, and “how do I…?” answers.']], 'small'), 92))

# ---------- 3 selling ----------
page(h1('3', 'Selling at a market', 'selling') + two(shot('02-sell-start', 108, 'Start selling', 80), '<h2 class="first">Start a selling day</h2>' + steps([
    'Home → <b>🧺 Sell</b>.',
    'If the market is on today’s calendar, tap it under <b>📅 On the calendar today</b>. Its name and float fill in.',
    'Otherwise choose <b>Market, Farm gate, Garden tour or Shop</b>, and tap a <b>saved market</b>. A new one: type its name and you’re asked for its details (address, float, stall fee) first.',
    'Check the <b>cash float</b> in the tin.',
    'Tap <b>who is serving</b>, then <b>Start selling</b>.']) + tip('Helpers can only open today’s markets where they’re ticked on the calendar. The screen stays on while the till is open.'), 80)
    + '<h2>Sell in two taps</h2>' + two(shot('03-till', 112, 'The till: tap products to add them', 80), steps([
    'Tap each product. Tap again for two. The total shows at the bottom.',
    'To change a number, tap <b>Show items</b> and use <b>−</b> and <b>+</b>.',
    'Tap <b>Cash</b>, <b>EFTPOS</b> or <b>Other</b> (bank transfer and so on).',
    'Check the order, tap <b>Take payment</b>, confirm, and wait for the green <b>Payment approved</b>.',
    'Tap <b>Next customer</b>.']) + tip('Prices are locked: helpers can’t change them. <b>🔍 Find</b> finds a product that isn’t on the till.'), 80))

page('<h2 id="pay" class="first">Taking payment, discounts and mistakes</h2>' + two(shot('04-pay', 140, 'Check the order before payment', 80), table(['To…', 'Do this'], [
    ['Take cash', 'Cash → Take payment → tap the notes given (or Exact) → the change to give shows big.'],
    ['Take EFTPOS', 'Put the total on your own terminal first. When it’s approved there, tap EFTPOS → Take payment → confirm.'],
    ['Give a discount', '<b>🏷️ Discount 🔒</b>: on the whole sale or one item, % or $ (or Free). After the PIN, the approver sees the cost and margin (page ' + L('pay', 'below') + ').'],
    ['Give something away', 'Discount it 100% (Free). The payment buttons become <b>🎁 Give away</b>: it’s recorded as a gift.'],
    ['Undo a sale just made', '<b>↩ Undo last sale</b> shows for a minute after each sale.'],
    ['Fix an older sale', '<b>🧾 Sales</b> → tap the sale → <b>Void</b>. Refund the cash or the card first. It needs a PIN.'],
    ['Add money to the float', '<b>💵 Float</b> → type the amount added.'],
    ['Let a helper sell', '<b>🤝 Hand to a helper</b>: the till locks to selling only, until a PIN unlocks it.']], 'small'), 80)
    + two(shot('04b-discount-check', 92, 'Checking a discount (approver only)', 80), '<h2 class="first">Checking a discount</h2><p>After the PIN, the person approving sees what the items cost to make, the margin before and after, and a red flag if it’s below cost. One tap sets <b>Break even</b> or the <b>lowest margin</b> (20%, changeable in Setup), or keep it <b>as asked</b>. Do this on your own screen: helpers never see these figures.</p>' + tip('Selling below cost is always recorded in the approvals log, with who approved it.', 'warn'), 80))

page(h1('', 'End of the day and the check-in', 'endday') + two(shot('05-end-day', 118, 'End of the day: count the tin', 80), steps([
    'On the till, tap <b>🏁 End the day</b> and enter your PIN.',
    'Check the <b>EFTPOS</b> total against the terminal’s settlement.',
    'Count the cash in the tin and type the total. It shows <b>✓ The cash is right</b>, or over or short.',
    'Tap <b>Close the day</b>.']), 80) + two(shot('06-checkin', 118, 'The check-in, all filled in already', 80), '<h2 class="first">The one-minute check-in</h2>' + steps([
    'It opens straight after Close the day.',
    'Tap how busy it was. The weather is already ticked from the forecast.',
    'Check the stall fee, and your time: travel there, set up, pack up, drive home, unpack the car. It shows when you’ll be done.',
    'Tap anything that sold out, and type (or tap 🎤 on the keyboard and say) anything to remember.',
    'Tap <b>Save</b>, or Skip.']) + tip('The check-in makes Real profit right: your real hours and costs for each market.'), 80))

# ---------- 4 calendar ----------
page(h1('4', 'The calendar and market days', 'calendar') + two(shot('07-calendar', 105, 'Month view. Swipe for the next month.', 80), steps([
    'Home → <b>📅 Calendar</b>. Swipe left or right for the next week or month; <b>Today</b> comes back.',
    'Tap a day to see what’s on, then <b>Add on…</b> to add to it.',
    'Choose <b>Market, Brew day, Order due</b> or <b>Other</b>.',
    'For a market, pick it under <b>Which market?</b> (or <b>＋ a new one</b>), then the date and start and finish times.',
    'Set <b>Repeats</b> for a weekly or fortnightly market.',
    'Tick <b>who’s on the stall</b> and when to be reminded, then <b>Save</b>.']), 80)
    + '<h2>The whole market day</h2>' + two(shot('08-market-entry', 122, 'A market entry with the whole day', 80), '''<p>Each market works out <b>when to leave home and when you’ll be back</b>, from:</p><ul class="dots">
<li><b>Travel there</b> and <b>travel home</b>: the drive, worked out by road from the home address.</li><li><b>Set up</b> and <b>pack down</b>: your usual times, which each market then remembers.</li></ul>
<p>Change any of the minutes and the leave-home time moves. The forecast weather shows here too, up to 16 days ahead.</p>''' + tip('The evening before, the reminder says when to leave home.'), 80))

# ---------- 5 brew ----------
page(h1('5', 'Brew and stock', 'brew') + two(shot('09-stock', 116, 'Stock: at home, and out with you', 80), '<h2 class="first">Stock</h2>' + table(['To…', 'Do this'], [
    ['See what’s left', 'Brew → <b>Stock</b>. Red means none at home; amber means at or below your warning level.'],
    ['Pack for a market', '<b>🧺 Pack for…</b>: each product is filled in from last time there. Change and tap Done. They move to “Out with me”.'],
    ['Count the stock', '<b>🔢 Count stock</b>: type what’s really there.'],
    ['Get warned before running out', '<b>⚠️ Warn me at…</b>: a level for each product and ingredient. Low ones show under Running low and in What to do next.'],
    ['Fix one product', 'Tap its row.']], 'small'), 80)
    + two(shot('10-brew-plan', 120, 'Plan a brew', 80), '<h2 class="first">Plan and record a brew</h2>' + steps([
    'Brew → <b>Plan a brew</b>, choose the recipe and how many batches.',
    'It shows the ingredients needed and what you have. <b>Add what’s short to the shopping list</b> in one tap.',
    'Share the batch between products (for example 30 lip balms and 10 tins).',
    'Tap <b>Save as planned</b>, or <b>✓ Made it</b> when it’s done: products go into stock and ingredients come off.',
    'It then asks <b>how long it took</b>, for your hours (not if the time clock was running).']) + tip('<b>What to make</b> suggests what’s running low before the next markets.'), 80))

# ---------- 6 orders & lists ----------
page(h1('6', 'Orders, to-dos and shopping', 'orders') + two(shot('11-orders', 105, 'Orders', 80), '<h2 class="first">Orders</h2>' + steps([
    'Home → <b>📦 Orders</b> → <b>＋ New order</b>.',
    'Choose the shop (wholesale prices apply) or a customer, and the date it’s to be sent by.',
    'Add products and amounts, then save.',
    'When it’s packed, tap <b>📦 Packed</b> (stock comes off). When it’s gone, <b>🚚 Sent</b>.']) + tip('Shopify orders come in by themselves every 15 minutes once Shopify is connected.'), 80)
    + two(shot('12-todo', 105, 'To-dos', 80), '<h2 class="first">To-dos</h2>' + steps([
    'Home → <b>✅ Lists</b> → <b>To do</b>. Type it and tap <b>Add</b>.',
    'Tap a to-do to give it a date (it shows on the calendar) or hand it to someone.',
    'Tick it when done.']) + '<p class="note">Lists also holds <b>Ideas</b> (product ideas, people to call) and <b>Voice notes</b>.</p>', 80))

page('<h2 id="suppliers" class="first">Shopping and ordering from a supplier</h2>' + two(shot('13-shopping', 150, 'The shopping list, by supplier', 80), steps([
    'Give each ingredient its <b>supplier</b>, and their <b>email</b> or <b>website</b> (Setup → Products, recipes and ingredients → tap the ingredient). Do it once.',
    'Things to buy go on <b>Lists → Shopping</b>, grouped by supplier.',
    'Tap <b>✉️ Draft order email</b>. Your email app opens with the order written, copied to the main owner. Check it and send. (Or <b>🔗 Order online</b> opens their website.)',
    'Back in the app, answer <b>Did you send it?</b> “Yes, sent” with when it should arrive, or “Not yet”: it becomes a to-do that reopens the same email.',
    'When it arrives, Brew → Stock → <b>🚚 On order</b> → <b>📦 Arrived</b>. Untick anything missing, change any amount, add the price, and tap <b>Into stock</b>.']) + tip('Ticking off something you bought at the shop asks what you really bought and the price, so costs stay right.'), 80))

# ---------- 7 time & profit ----------
page(h1('7', 'The time clock', 'time') + two(shot('14b-clock-switch', 88, 'Tap the tile or the top-right time', 80), steps([
    'Home → tap the <b>⏱️ Time clock</b> tile.',
    'Tap what you’re doing: <b>🫙 Brewing</b> (picking and drying too), <b>📦 Orders and packing, 🗂️ Admin</b> (calls, emails, social media) or <b>🛒 Buying supplies</b>. It starts.',
    'The tile turns purple with the job and time, and the time shows top right on every screen.',
    'To change job, tap either and choose another: it asks “Switch to…?”. To finish, <b>⏹ Stop the clock</b>.',
    'Forgot? Time clock → <b>See my hours</b> → <b>＋ Add time I forgot to clock</b>. After 10 hours it asks if you’re still working.']) + tip('Markets aren’t clocked: their hours come from the calendar and the check-in. Helpers’ hours are kept with their pay in Reports → Costs.'), 80)
    + '<h2 id="profit">Real profit</h2>' + two(shot('15-profit', 120, 'Real profit (demo figures)', 80), '''<p>Home → <b>💰 Real profit</b>. Choose This week, month, last month or this year.</p><ul class="dots">
<li><b>Real profit</b>: sales (ex GST) less stock, stall fees, fuel and car, helpers and other costs.</li>
<li><b>An hour</b>: that profit for each hour you put in. ✅ worth it, 🟡 borderline, 🔴 losing money.</li>
<li><b>What to do next</b>: tap the button beside each.</li>
<li><b>How sure are these numbers?</b> Each gap has a <b>Fix</b> button.</li>
<li>Markets and products ranked, best first.</li></ul><p><b>📈 Reports</b> (the button at the top of Real profit) has takings by day, place and product, GST, costs, and a CSV for the accountant.</p>''', 80))

# ---------- 8 assistant ----------
ex = [('“Matakana market next Saturday, 8 till 1, Sam’s coming”', 'A market on the calendar'), ('“Remind me to label the lip balm jars on Thursday”', 'A to-do for Thursday'),
      ('“Add 2 kilos of beeswax and 50 amber jars to the shopping list”', 'Two shopping items'), ('“Kowhai Gifts wants 12 lavender soaps by the 20th”', 'A wholesale order'),
      ('“Made 24 lavender lip balms today”', 'A batch made, into stock'), ('“We’ve got 15 calendula balms at home”', 'A stock count'),
      ('“Paid 45 dollars stall fee at Cromwell”', 'A cost against that market'), ('📷 A photo of the fuel pump or receipt', 'A fuel fill-up'),
      ('“Idea: rose and kawakawa balm for Mother’s Day”', 'An idea'), ('“What’s on this week?”', 'Answered, with a link'),
      ('“How much did we take at the weekend?”', 'The takings (owners only)'), ('“How do I change a price?”', 'The steps, and Take me there')]
page(h1('8', 'The assistant: talk, type or take a photo', 'assistant') + '''<p>Say it the way you’d say it to a person. The assistant turns it into calendar entries, to-dos, shopping, orders and more, and shows you a draft first. <b>Nothing is saved until you tap Save</b> (or say “yes”). Say “throw away” to bin it.</p>
<ul class="dots"><li><b>🎙 Talk</b>: tap, speak, tap again. Several things in one go is fine.</li><li><b>⌨️ Type</b>: the same, typed.</li><li><b>📷 Photo</b>: a fuel pump, a supplier’s price list, a recipe card.</li><li><b>🚗 Drive</b>: big buttons for the car, and it reads the draft out.</li></ul>
<h2>Things to say</h2>''' + table(['Say this', 'It makes'], [[e(a), b] for a, b in ex], 'small') + tip('It learns from your corrections each evening. What it has learnt is in Setup → Assistant, where you can change or delete any line.'))

page('<h2 id="privacy" class="first">How your information is kept safe</h2>' + table(['', ''], [
    ['<b>Private to the business</b>', 'Your data is kept in the business’s own Google database. Only the Google accounts you invite can open it, and each person sees only what their role allows: helpers never see costs, recipes, pay or takings.'],
    ['<b>Where the assistant runs</b>', 'In the business’s own Gmail (rata.smudge@gmail.com). Its key is kept there, never in the app.'],
    ['<b>What it’s sent</b>', 'Only what it needs to understand a note: your words, recording or photo, and a short list of names (people, markets, products, ingredients) and the next 14 days of the calendar.'],
    ['<b>What it’s never sent</b>', 'Prices, costs, takings, sales, pay rates, recipe amounts or customer contacts. Questions about money are worked out by the app itself.'],
    ['<b>Google doesn’t learn from it</b>', 'It uses Google’s paid Gemini service: your notes aren’t used to improve Google’s products, and are kept only briefly to check for misuse.'],
    ['<b>Recordings</b>', 'Deleted once they’re worked out.'],
    ['<b>Cost</b>', 'Capped each month. If the cap is reached it stops until the next month.']], 'plainhead')
    + '<h2>PINs and the approvals log</h2><p>Your PIN is asked for before anything sensitive: Setup, seeing the takings, discounts, voids, closing the till. Anything approved by a manager or helper, or a PIN used by someone else, is recorded in <b>Setup → Approvals log</b> with who and when.</p>'
    + tip('<b>Recipes are the business’s secret.</b> Only owners can open them, with an owner’s PIN every time, and they lock again after 2 minutes. Managers and helpers can’t see them at all.'))

# ---------- 9 setup ----------
page(h1('9', 'Setup, people and PINs', 'setup') + two(shot('17-setup', 112, 'Setup (asks for your PIN)', 80), table(['To…', 'Go to Setup →'], [
    ['Change a price, add a product, put one on or off the till', '<b>Products and prices</b>'],
    ['Add or change an ingredient or packaging', 'Brew → <b>Recipes &amp; ingredients</b>'],
    ['Open a recipe', 'Brew → <b>Recipes &amp; ingredients 🔒</b>: an owner’s PIN every time; it locks again after 2 minutes'],
    ['Add a market, shop or place; home address; usual set-up times', '<b>Markets and places</b>'],
    ['Set up a deal (for example 3 for $30)', '<b>Deals</b>'],
    ['Invite someone, make them a manager or helper', '<b>People</b>: type their Google (Gmail) address'],
    ['Set or change your PIN', '<b>Your PIN</b>'],
    ['See who approved what', '<b>Approvals log</b>'],
    ['Practise, or see what a helper sees', '<b>View as</b> → a role, a person, or Owner test mode (the top bar turns purple; tap <b>Go back</b>)'],
    ['Lowest margin for discounts', '<b>Lowest margin on a discount</b> (20%)'],
    ['Daily briefing and summary emails', '<b>Summaries by email</b>'],
    ['Check-ins on or off', '<b>Check-ins</b>'],
    ['Notifications on this device', '<b>Notifications</b>']], 'small'), 80)
    + ('<h2>Markets and places</h2><p>Add each market, the farm shop and each shop you supply, with its address, usual float and stall fee. With the home address in, the drive and its km are worked out by themselves (within about 5 minutes).</p>' + tip('Owners: the main owner can never be removed. Add helpers as <b>Helper</b>: they can sell and see stock, but no costs or takings.')))

# ---------- 10 what if ----------
page(h1('10', 'What to do if…', 'whatif') + table(['Situation', 'Action'], [
    ['<b>No internet at the market</b>', 'Keep selling. Sales are saved on the device and sent when the signal comes back. The top bar shows when it’s saved.'],
    ['<b>Wrong sale just now</b>', '<b>↩ Undo last sale</b> (for about a minute). After that, 🧾 Sales → the sale → Void, with a PIN.'],
    ['<b>Cash is short or over</b>', 'Count again. The difference is recorded at Close the day; it’s in the end-of-day email.'],
    ['<b>The payment buttons are grey</b>', 'The total is $0 (a free item). Tap <b>🎁 Give away</b>, or remove the discount.'],
    ['<b>A product isn’t on the till</b>', '<b>🔍 Find</b> on the till. A product that’s off the till needs a PIN to sell.'],
    ['<b>A helper can’t open the till</b>', 'Tick them on that day’s market in the calendar (Calendar → the market → who’s on the stall), or an owner or manager opens it.'],
    ['<b>Forgot my PIN</b>', 'On the PIN pad, tap “Forgot?”. Another owner resets it, or Tony can.'],
    ['<b>Left the till open</b>', 'You’ll get a reminder. Open the app, Sell → 🏁 End the day.'],
    ['<b>The assistant doesn’t answer</b>', 'Check the signal. If it says the monthly limit is reached, type it in instead. Setup shows if the helper is running.'],
    ['<b>Something looks out of date</b>', 'Close the app fully and open it again. A green “Update” bar means a new version: tap it.'],
    ['<b>A number looks wrong in Real profit</b>', 'Look at “How sure are these numbers?” and tap Fix.'],
    ['<b>I want to try something safely</b>', 'Setup → View as → Owner test mode. Nothing is saved.']], 'situ'))

# ---------- 11 help & index ----------
idx = [('Approvals log', 'setup'), ('Assistant', 'assistant'), ('Calendar', 'calendar'), ('Check-in', 'endday'), ('Count stock', 'brew'), ('Deals', 'setup'),
       ('Discount', 'pay'), ('EFTPOS', 'pay'), ('End of the day', 'endday'), ('Find anything', 'help'), ('Float', 'pay'), ('Fuel', 'assistant'), ('Helpers', 'setup'),
       ('Home screen', 'homescreen'), ('Ideas', 'orders'), ('Markets and places', 'setup'), ('Notifications', 'setup'), ('Orders', 'orders'), ('Owner test mode', 'setup'),
       ('Pack for a market', 'brew'), ('PIN', 'privacy'), ('Plan a brew', 'brew'), ('Prices', 'setup'), ('Privacy', 'privacy'), ('Real profit', 'profit'), ('Recipes', 'setup'),
       ('Reports', 'profit'), ('Shopping list', 'suppliers'), ('Stock', 'brew'), ('Suppliers', 'suppliers'), ('Time clock', 'time'), ('To-dos', 'orders'), ('Void a sale', 'pay'),
       ('Warn me at', 'brew'), ('Weather', 'calendar'), ('What to do next', 'profit'), ('Whole market day', 'calendar')]
page(h1('11', 'Getting help', 'help') + two(shot('16-help', 95, 'Find anything: “how do I…?”', 80), '''<h2 class="first">In the app</h2><p>Home → <b>🔍 Find anything</b>, and type a question such as “how do I change a price?”. It shows the buttons to tap, and <b>Take me there</b>. You can also ask the assistant “How do I…?”.</p>
<h2>Who to call</h2>''' + table(['Who', 'For', 'Phone'], [['Tony Ross', 'The app, anything not working', '<span class="blank"></span>'], ['EFTPOS provider', 'The card terminal', '<span class="blank"></span>'], ['Shopify', 'The online shop', '<span class="blank"></span>']], 'small'), 80)
    + h1('12', 'Index A–Z', 'index') + '<div class="idx">' + ''.join(f'<a href="#{i}"><span>{t}</span><span class="pg" data-for="{i}"></span></a>' for t, i in idx) + '</div>')

css = open(os.path.join(HERE, 'guide.css')).read()
js = '''<script>
// page numbers for the contents and index: the page each target sits on
document.querySelectorAll('[data-for],[data-pg]').forEach(el=>{ const id=el.dataset.for||el.dataset.pg, t=document.getElementById(id); if(!t) return;
  const pages=[...document.querySelectorAll('.page')], n=pages.indexOf(t.closest('.page'))+1; el.textContent=n; });
</script>'''
open(os.path.join(HERE, 'guide.html'), 'w').write(f'<!DOCTYPE html><html lang="en-NZ"><head><meta charset="utf-8"><title>Rata & Smudge app: quick guide ({REV})</title><style>{css}</style></head><body>{"".join(pages)}{js}</body></html>')
print(len(pages), 'pages')
