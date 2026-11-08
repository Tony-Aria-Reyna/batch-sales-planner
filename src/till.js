/* ================= The till =================
   Two taps per sale: tap the products, tap how they paid. The app does every sum, prices are locked,
   deals apply by themselves, and anything that changes money (a discount, an item that isn't on the till,
   correcting or voiding a sale, seeing the sales, ending the day) needs an owner's or manager's own PIN,
   which is written to the approvals log with who approved it and when. Helpers never see the takings. */
const nzDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(d||new Date());   // 2026-11-07
const nzTime=t=>new Intl.DateTimeFormat('en-NZ',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(t));
// Date stamp for every sale, in New Zealand time, ready for spotting patterns later
// (busiest weekday, hour, month, season). e.g. {local:'2026-11-08 10:42', weekday:'Sun', hour:10, month:'2026-11', week:'2026-W45', season:'Spring'}
function nzStamp(t){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
  const y=+p.year, mo=+p.month, d=+p.day, dt=new Date(Date.UTC(y,mo-1,d)), dow=(dt.getUTCDay()+6)%7;   // Monday = 0
  const th=new Date(dt); th.setUTCDate(dt.getUTCDate()-dow+3); const wy=th.getUTCFullYear(), w1=new Date(Date.UTC(wy,0,4));
  const week=1+Math.round(((th-w1)/864e5-3+((w1.getUTCDay()+6)%7))/7);
  const season=['Summer','Summer','Autumn','Autumn','Autumn','Winter','Winter','Winter','Spring','Spring','Spring','Summer'][mo-1];   // southern hemisphere
  return {local:p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute,weekday:p.weekday,hour:+p.hour,month:p.year+'-'+p.month,week:wy+'-W'+String(week).padStart(2,'0'),season};
}
const DAY_TYPES={market:'🧺 Market',farmgate:'🚪 Farm gate',tour:'🌿 Garden tour',shop:'🏪 Shop'};
const PAY_TXT={cash:'💵 Cash',eftpos:'💳 EFTPOS',other:'🔖 Other'};
const c2=c=>money((c||0)/100);
// GST included in a GST-inclusive amount (15%): 3/23 of the total, rounded to the cent
const gstOf=c=>Math.round((c||0)*3/23);
const gstLine=c=>`<small class="gstl">incl. ${c2(gstOf(c))} GST</small>`;
// The open sale is kept on the device, so a reload mid-sale loses nothing. Everything kept on the device
// is tagged with the business, so another account on the same device never inherits it.
let cart=[], cartDisc=null, correcting=null;
const loadCart=()=>{ const c=lsGet('rs.cart',null), ok=c&&c.bid===SYNC.businessId(); cart=ok?c.items||[]:[]; cartDisc=ok?c.disc||null:null; correcting=ok?c.correcting||null:null; };
const saveCart=()=>lsSet('rs.cart',{bid:SYNC.businessId(),items:cart,disc:cartDisc,correcting});
const clearCart=()=>{ cart=[]; cartDisc=null; correcting=null; saveCart(); };
let lastSale=null, undoTimer=null;
const tillLock=()=>{ const t=lsGet('rs.tillMode',null); return t&&t.bid===SYNC.businessId()?t:null; };   // {servedBy} while handed to a helper
const servedBy=()=>lsGet('rs.servedBy','');
const openDay=()=>S.sessions.filter(s=>s.status==='open').sort((a,b)=>b.openedAt-a.openedAt)[0]||null;
const daySales=s=>S.sales.filter(x=>x.sessionId===s.id).sort((a,b)=>b.at-a.at);
const cartCount=()=>cart.reduce((n,c)=>n+c.qty,0);
// money screens are for owners and managers, never in till mode
const seesMoney=()=>canManage()&&!tillLock();

/* ---------- screen ---------- */
SCREENS.sell={
  title(){ const d=openDay(), lock=tillLock();
    if(!d) return {h:'Start selling'};
    return {h:(DAY_TYPES[d.type]||'').replace(/^\S+ /,'')+(d.name?' · '+d.name:''),s:(servedBy()?'Served by '+servedBy():'')+(lock?' · 🔒 Till mode':'')}; },
  html(){ return openDay()?tillHtml():startHtml(); },
  wire(){ openDay()?wireTill():wireStart(); }
};

/* ---------- start a selling day ---------- */
let startType=lsGet('rs.lastType','market'), startEvent=null;
// markets on the calendar for today, offered first so the name, place and float fill themselves in
const todaysMarkets=()=>(typeof eventsOn==='function'?eventsOn(nzDay()):[]).filter(e=>e.type==='market');
function startHtml(){
  const tm=todaysMarkets();
  const past=[...new Set(S.sessions.filter(s=>s.type===startType&&s.name).sort((a,b)=>b.openedAt-a.openedAt).map(s=>s.name))].slice(0,6);
  const staff=S.settings.staff||[];
  return (tm.length?`<div class="card"><h3>📅 On the calendar today</h3><div class="pastnames">${tm.map(e=>`<button class="chip big ${startEvent===e.id?'on':''}" data-ev0="${e.id}">🧺 ${esc(e.title)}${e.time?' · '+esc(t12(e.time)):''}</button>`).join('')}</div></div>`:'')+`<div class="card"><h3>Where are you selling today?</h3>
      <div class="bigseg">${Object.entries(DAY_TYPES).map(([k,v])=>`<button data-t="${k}" class="${startType===k?'on':''}">${v}</button>`).join('')}</div>
      <label class="note" for="sName">${startType==='market'?'Which market?':'Name (optional)'}</label>
      <input class="txt" id="sName" list="sPast" autocomplete="off" placeholder="${startType==='market'?'e.g. Titirangi Village Market':''}">
      ${past.length?`<div class="pastnames">${past.map(n=>`<button class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>`:''}
      <label class="note" for="sFloat">Cash float in the tin (optional)</label>
      <input class="txt" id="sFloat" inputmode="decimal" placeholder="e.g. 200" value="${S.settings.defaultFloat?(S.settings.defaultFloat/100).toFixed(2):''}"></div>
    <div class="card"><h3>Who is serving?</h3><p class="note">Each sale records who served.</p>
      <div class="pastnames">${staff.map(n=>`<button class="chip big ${servedBy()===n?'on':''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')}<button class="chip big" id="sWhoAdd">＋ Someone new</button></div></div>
    ${activeProducts().length?'':`<div class="card" style="border-color:var(--rata)"><b>No products yet.</b><p class="note">${canManage()?'Add them first in Setup → Products and prices.':'Ask the owner to add the products first.'}</p></div>`}
    <button class="btn bigbtn" id="sGo" ${activeProducts().length?'':'disabled'}>Start selling</button>`;
}
function wireStart(){
  document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ startType=b.dataset.t; lsSet('rs.lastType',startType); render(); });
  document.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{ $('#sName').value=b.dataset.n; startEvent=null; });
  document.querySelectorAll('[data-ev0]').forEach(b=>b.onclick=()=>{ const e=S.events.find(x=>x.id===b.dataset.ev0); if(!e) return;
    startEvent=e.id; startType='market'; lsSet('rs.lastType','market'); render();
    $('#sName').value=e.title; const pl=S.places.find(p=>p.id===e.place); if(pl&&pl.float) $('#sFloat').value=(pl.float/100).toFixed(2); });
  document.querySelectorAll('[data-who]').forEach(b=>b.onclick=()=>{ lsSet('rs.servedBy',b.dataset.who); document.querySelectorAll('[data-who]').forEach(x=>x.classList.toggle('on',x===b)); });
  $('#sWhoAdd').onclick=()=>askName(n=>{ lsSet('rs.servedBy',n); if(canManage()&&!(S.settings.staff||[]).includes(n)){ S.settings.staff=[...(S.settings.staff||[]),n]; save(); } render(); });
  $('#sGo').onclick=()=>{
    if(!servedBy()){ toast('Tap who is serving first'); return; }
    const fl=$('#sFloat').value.trim(), fc=fl?toCents(fl):0; if(fl&&!(fc>=0)){ toast('The float should be a number, e.g. 100'); return; }
    const name=$('#sName').value.trim(); if(startType==='market'&&!name){ toast('Type which market'); return; }
    const ev=startEvent&&S.events.find(x=>x.id===startEvent&&x.title===name);
    S.sessions.push(Object.assign({id:SYNC.newId('sessions'),type:startType,name,date:nzDay(),openedAt:Date.now(),openedBy:SYNC.me(),float:fc||0,status:'open'},ev?{eventId:ev.id,placeId:ev.place||''}:{}));
    startEvent=null;
    cart=[]; saveCart(); save(); render();
  };
}
function askName(done){
  modal((m,close)=>{ m.innerHTML=`<h2>Who is serving?</h2><input class="txt" id="wN" autocapitalize="words" placeholder="First name"><div class="mact"><button class="btn alt" id="wC">Cancel</button><button class="btn" id="wOk">OK</button></div>`;
    const go=()=>{ const n=m.querySelector('#wN').value.trim(); if(!n){ toast('Type a name'); return; } close(); done(n); };
    m.querySelector('#wC').onclick=close; m.querySelector('#wOk').onclick=go; m.querySelector('#wN').onkeydown=e=>{ if(e.key==='Enter') go(); };
    setTimeout(()=>m.querySelector('#wN').focus(),50); });
}

/* ---------- the till ---------- */
let tillFilter=lsGet('rs.filter','all'), sheetOpen=false, payRedraw=null;
// the items in the sale, with − and ＋ (used in the sale panel and in "Check the order")
function cartLinesHtml(pc,big){
  if(!pc.lines.length) return `<p class="note cempty">Tap a product to start a sale.</p>`;
  return pc.lines.map(l=>`<div class="cl"><div class="grow"><b>${esc(l.name)}</b><small>${esc(l.size)}${l.size?' · ':''}${c2(l.unit)} each${l.custom?' · not on the till':''}</small></div>
      <button class="qb" data-dec="${l.pid}" aria-label="One less">−</button><b class="qn">${l.qty}</b><button class="qb" data-inc="${l.pid}" aria-label="One more">＋</button><b class="la">${c2(l.amount)}</b>${big?`<button class="qb rm" data-rm="${l.pid}" aria-label="Remove">✕</button>`:''}</div>`).join('')
    +pc.deals.map(d=>`<div class="cl deal"><div class="grow"><b>🎁 ${esc(d.name)}${d.times>1?' ×'+d.times:''}</b></div><b class="la">−${c2(d.saving)}</b></div>`).join('')
    +(pc.manual?`<div class="cl deal"><div class="grow"><b>🏷️ Discount ${pc.manual.kind==='pct'?pc.manual.value+'%':c2(pc.manual.value)}</b><small>${esc(pc.manual.reason)} · approved by ${esc(personName(pc.manual.approvedBy))}</small></div><button class="qb" data-discx="1" aria-label="Remove discount">✕</button><b class="la">−${c2(pc.manual.amount)}</b></div>`:'');
}
// the sale panel slides on phones and iPad portrait: closed shows the total and payment buttons,
// open shows every item. It follows the finger and settles open or closed.
function setSheet(v){ sheetOpen=!!v; const c=$('#cart'); if(c){ c.classList.toggle('open',sheetOpen); c.style.transform=''; const g=c.querySelector('.grab span'); if(g&&cart.length) g.textContent=sheetOpen?'▼ Hide items':'▲ Show items ('+cartCount()+')'; } }
function wireSheet(){
  const c=$('#cart'), g=$('#cGrab'); if(!c||!g) return;
  const sliding=()=>getComputedStyle(g).display!=='none';
  const startDrag=e=>{ if(!sliding()) return; const y0=e.clientY, H=c.offsetHeight, peek=parseFloat(getComputedStyle(c).getPropertyValue('--peek'))||200, base=sheetOpen?0:H-peek; let moved=false;
    c.style.transition='none';
    const mv=ev=>{ const dy=ev.clientY-y0; if(Math.abs(dy)>6) moved=true; c.style.transform=`translateY(${Math.max(0,Math.min(H-peek,base+dy))}px)`; };
    const up=ev=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',up); removeEventListener('pointercancel',up); c.style.transition='';
      if(!moved){ setSheet(!sheetOpen); return; } const at=Math.max(0,Math.min(H-peek,base+(ev.clientY-y0))); setSheet(at<(H-peek)/2); };
    addEventListener('pointermove',mv); addEventListener('pointerup',up); addEventListener('pointercancel',up); };
  g.addEventListener('pointerdown',startDrag);
}
function tillHtml(){
  const pc=priceCart(cart,cartDisc), qty=Object.fromEntries(cart.map(c=>[c.pid,c.qty])), lock=tillLock();
  const undo=lastSale&&Date.now()-lastSale.at<60e3, helper=role()==='helper';
  const all=activeProducts(), cats=Object.keys(COLOURS).filter(k=>all.some(p=>(p.colour||'other')===k));
  if(tillFilter!=='all'&&!cats.includes(tillFilter)) tillFilter='all';
  const shown=tillFilter==='all'?all:all.filter(p=>(p.colour||'other')===tillFilter);
  return `<div class="tbar">
      ${undo?`<button class="btn danger" id="tUndo">↩ Undo last sale (${c2(lastSale.total)})</button>`:''}
      ${helper?'':`<button class="btn alt" id="tList">🧾 Sales <span class="lk">🔒</span></button>`}
      ${lock?`<button class="btn alt" id="tUnlock">🔓 Leave till mode <span class="lk">🔒</span></button>`:(helper?'':`<button class="btn alt" id="tLock">🤝 Hand to a helper</button>`)}
      <button class="btn alt" id="tWho">👤 ${esc(servedBy()||'Who is serving?')}</button>
      ${helper?'':`<button class="btn alt" id="tFloat">💵 Float <span class="lk">🔒</span></button>`}
      ${helper?'':`<button class="btn alt" id="tEnd">🏁 End the day <span class="lk">🔒</span></button>`}</div>
    <div class="filters">${cats.length>1?[['all','All',all.length]].concat(cats.map(k=>[k,COLOURS[k][3],all.filter(p=>(p.colour||'other')===k).length])).map(([k,label,n])=>
      `<button class="fchip ${tillFilter===k?'on':''}" data-f="${k}" style="${k==='all'?'':`--c:${COLOURS[k][0]}`}">${k==='all'?'':'<i></i>'}${esc(label)} <small>${n}</small></button>`).join(''):''}</div>
    <div class="till">
    <section class="tgrid">${shown.map(p=>{ const k=COLOURS[p.colour]||COLOURS.other; return `<button class="ptile" data-add="${p.id}" style="background:${k[0]};color:${k[1]}">
        ${qty[p.id]?`<span class="pq">${qty[p.id]}</span>`:''}<span class="pc">${esc(k[2])}</span><span class="pn">${esc(p.name)}</span><span class="ps">${esc(p.size||'')}</span><span class="pp">${c2(p.price)}</span></button>`; }).join('')}
      <button class="ptile extra" id="tExtra"><span class="pc">🔒 Needs a PIN</span><span class="pn">＋ Item not on the till</span><span class="ps">One-off, or add it for next time</span></button></section>
    <aside class="cart ${sheetOpen?'open':''}" id="cart">
      <div class="grab" id="cGrab"><i></i><span>${pc.lines.length?(sheetOpen?'▼ Hide items':'▲ Show items ('+cartCount()+')'):'Tap a product to start'}</span></div>
      <div class="ctot"><span>${cartCount()} item${cartCount()===1?'':'s'}${pc.lines.length?` · <button class="linkb" id="cClear">Clear</button>${pc.manual?'':` · <button class="linkb" id="cDisc" style="color:var(--green)">🏷️ Discount 🔒</button>`}`:''}</span><span class="tot"><b id="cTotal">${c2(pc.total)}</b>${gstLine(pc.total)}</span></div>
      <div class="pay">${['cash','eftpos','other'].map(k=>`<button class="pb ${k}" data-pay="${k}" ${pc.total>0?'':'disabled'}>${PAY_TXT[k]}</button>`).join('')}</div>
      ${correcting?`<div class="corr">✏️ Correcting the ${c2(correcting.total)} sale from ${nzTime(correcting.at)}. When you take payment, the old sale is voided and replaced. <button class="linkb" id="cCorrX">Cancel correction</button></div>`:''}
      <div class="clines">${cartLinesHtml(pc)}</div>
    </aside></div>`;
}
function changeQty(pid,d){ const c=cart.find(x=>x.pid===pid); if(c) c.qty+=d; else if(d>0) cart.push({pid,qty:d}); cart=cart.filter(x=>x.qty>0); if(!cart.length){ cartDisc=null; sheetOpen=false; } saveCart(); }
function setQty(pid,d){ changeQty(pid,d); render(); }
function wireTill(){
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>setQty(b.dataset.add,1));
  document.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>setQty(b.dataset.inc,1));
  document.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>setQty(b.dataset.dec,-1));
  document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{ tillFilter=b.dataset.f; lsSet('rs.filter',tillFilter); render(); });
  const cl=$('#cClear'); if(cl) cl.onclick=()=>confirmBox('Clear this sale?','The items are taken off. Nothing has been charged.','Clear',()=>{ const c=correcting; cart=[]; cartDisc=null; saveCart(); render(); if(c) toast('Correction still open: add the right items, or cancel the correction'); });
  const cd=$('#cDisc'); if(cd) cd.onclick=giveDiscount;
  document.querySelectorAll('[data-discx]').forEach(b=>b.onclick=()=>{ cartDisc=null; saveCart(); render(); });
  wireSheet();
  const cc=$('#cCorrX'); if(cc) cc.onclick=()=>confirmBox('Cancel the correction?','The original sale stays as it was.','Cancel correction',()=>{ clearCart(); render(); });
  $('#tExtra').onclick=addExtraItem;
  document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>pay(b.dataset.pay));
  const u=$('#tUndo'); if(u) u.onclick=undoLast;
  const tl=$('#tList'); if(tl) tl.onclick=()=>approve('see the sales',who=>showDaySales(who));
  const lk=$('#tLock'); if(lk) lk.onclick=handToHelper;
  const ul=$('#tUnlock'); if(ul) ul.onclick=()=>approve('leave till mode',()=>{ lsSet('rs.tillMode',null); render(); toast('Till mode off'); });
  $('#tWho').onclick=()=>{ if(tillLock()){ toast('In till mode. Leave till mode to change who is serving.'); return; } pickServer(()=>render()); };
  const tf=$('#tFloat'); if(tf) tf.onclick=editFloat;
  const te=$('#tEnd'); if(te) te.onclick=()=>approve('end the day',who=>endDay(who));
  keepAwake(true);
}
function pickServer(done){
  modal((m,close)=>{ const staff=S.settings.staff||[];
    m.innerHTML=`<h2>Who is serving?</h2><div class="pastnames">${staff.map(n=>`<button class="chip big ${servedBy()===n?'on':''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')}<button class="chip big" id="wNew">＋ Someone new</button></div><div class="mact"><button class="btn alt" id="wC">Cancel</button></div>`;
    m.querySelectorAll('[data-who]').forEach(b=>b.onclick=()=>{ lsSet('rs.servedBy',b.dataset.who); close(); done(b.dataset.who); });
    m.querySelector('#wNew').onclick=()=>{ close(); askName(n=>{ lsSet('rs.servedBy',n); if(canManage()&&!staff.includes(n)){ S.settings.staff=[...staff,n]; save(); } done(n); }); };
    m.querySelector('#wC').onclick=close; });
}
function handToHelper(){
  if(!anyPins()){ confirmBox('Set your PIN first','Till mode needs a PIN to leave it, so a helper can\'t. Choose your personal PIN now.','Choose my PIN',()=>setPinFlow(handToHelper)); return; }
  pickServer(n=>{ lsSet('rs.tillMode',{bid:SYNC.businessId(),servedBy:n,at:Date.now()}); stack=['home','sell']; render();
    toast('Till mode on for '+n+'. Prices are locked; a PIN unlocks it.'); });
}

/* ---------- a discount on this sale (needs a PIN) ---------- */
function giveDiscount(){
  const base=priceCart(cart,null).total; if(base<=0) return;
  modal((m,close)=>{ let kind='pct', value=10;
    const draw=()=>{ const amt=kind==='pct'?Math.round(base*value/100):Math.min(value,base);
      m.innerHTML=`<h2>🏷️ Discount on this sale</h2><p class="note">Sale total ${c2(base)}. An owner or manager approves it with their PIN.</p>
        <div class="seg"><button data-kind="pct" class="${kind==='pct'?'on':''}">% off</button><button data-kind="amt" class="${kind==='amt'?'on':''}">$ off</button></div>
        <div class="pastnames">${(kind==='pct'?[5,10,15,20,25,50]:[200,500,1000,2000]).map(v=>`<button class="chip big ${value===v?'on':''}" data-v="${v}">${kind==='pct'?v+'%':c2(v).replace('.00','')}</button>`).join('')}</div>
        <label class="note">Or type the ${kind==='pct'?'percentage':'amount'}</label><input class="txt" id="dV" inputmode="decimal" value="${kind==='pct'?value:(value/100).toFixed(2)}">
        <label class="note">Reason (shown in the approvals log)</label><input class="txt" id="dR" placeholder="e.g. regular customer, damaged label">
        <p class="change ok">Takes off <b>${c2(amt)}</b> · new total <b>${c2(base-amt)}</b></p>
        <div class="mact"><button class="btn alt" id="dC">Cancel</button><button class="btn" id="dOk">Approve with PIN</button></div>`;
      const keepR=m.querySelector('#dR');
      m.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{ const r=keepR.value; kind=b.dataset.kind; value=kind==='pct'?10:500; draw(); m.querySelector('#dR').value=r; });
      m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{ const r=keepR.value; value=+b.dataset.v; draw(); m.querySelector('#dR').value=r; });
      m.querySelector('#dV').onchange=e=>{ const r=keepR.value, n=parseFloat(e.target.value); if(!(n>0)) return; value=kind==='pct'?Math.min(100,n):Math.round(n*100); draw(); m.querySelector('#dR').value=r; };
      m.querySelector('#dC').onclick=close;
      m.querySelector('#dOk').onclick=()=>{ const reason=m.querySelector('#dR').value.trim(); if(!reason){ toast('Give a reason for the discount'); return; } close();
        const label=(kind==='pct'?value+'%':c2(value))+' off '+c2(base)+' ('+reason+')';
        approve('give a discount',who=>{ cartDisc={kind,value,reason,approvedBy:who,at:Date.now()}; saveCart(); render(); if(payRedraw) payRedraw(); toast('Discount approved by '+personName(who)); },label); };
    }; draw(); });
}

/* ---------- an item that isn't on the till (needs a PIN) ---------- */
function addExtraItem(){
  modal((m,close)=>{ let col='other', keep=false;
    const draw=()=>{ const v=k=>{ const e=m.querySelector('#'+k); return e?e.value:''; }, n=v('xN'), z=v('xZ'), pr=v('xP');
      m.innerHTML=`<h2>＋ Item not on the till</h2><p class="note">For something without a button, e.g. a new batch or a market special. An owner or manager approves the price with their PIN.</p>
        <label class="note">What is it?</label><input class="txt" id="xN" autocapitalize="words" value="${esc(n)}">
        <label class="note">Size (optional)</label><input class="txt" id="xZ" value="${esc(z)}">
        <label class="note">Price, including GST</label><input class="txt" id="xP" inputmode="decimal" value="${esc(pr)}" placeholder="e.g. 18">
        <p class="note">Category</p><div class="colours">${Object.entries(COLOURS).map(([k,c])=>`<button data-c="${k}" class="${col===k?'on':''}" style="background:${c[0]};color:${c[1]}">${c[2]}</button>`).join('')}</div>
        ${canManage()?`<label class="row" style="cursor:pointer"><input type="checkbox" id="xK" ${keep?'checked':''} style="width:26px;height:26px"><div class="grow">Also add it to the till for next time<small>It becomes a normal product button at this price</small></div></label>`:''}
        <div class="mact"><button class="btn alt" id="xC">Cancel</button><button class="btn" id="xOk">Approve with PIN</button></div>`;
      m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{ col=b.dataset.c; draw(); });
      const kk=m.querySelector('#xK'); if(kk) kk.onchange=()=>{ keep=kk.checked; };
      m.querySelector('#xC').onclick=close;
      m.querySelector('#xOk').onclick=()=>{ const name=v('xN').trim(), size=v('xZ').trim(), price=toCents(v('xP'));
        if(!name){ toast('Say what the item is'); return; } if(!(price>0)){ toast('Type the price'); return; } close();
        approve('add an item not on the till',who=>{
          if(keep){ const p={id:SYNC.newId('products'),name,size,price,colour:col,active:true,updated:Date.now(),addedAtTill:true,approvedBy:who}; S.products.push(p); cart.push({pid:p.id,qty:1}); }
          else cart.push({pid:'x-'+Date.now().toString(36),qty:1,custom:{name,size,price,colour:col,approvedBy:who}});
          saveCart(); save(); render(); toast(name+' added · approved by '+personName(who)); },
          name+(size?' '+size:'')+' at '+c2(price)+(keep?', added to the till':', one-off')); };
    }; draw(); setTimeout(()=>m.querySelector('#xN').focus(),50); });
}

/* ---------- taking payment ----------
   1. Check the order (items can still be changed)  2. take the payment  3. confirm it a second time
   4. a green "Payment approved" screen. Declined or cancelled: "Are you sure?", then the sale is cleared.
   The back button steps back through these one at a time. */
function pay(method){
  if(priceCart(cart,cartDisc).total<=0) return;
  modal((m,close)=>{ let step='review', tendered=0, note='', hist=[];
    const go=st=>{ hist.push(step); step=st; draw(); };
    close.onBack=()=>{ if(!hist.length){ finish(); return true; } step=hist.pop(); draw(); return true; };
    const finish=()=>{ payRedraw=null; close(); render(); };
    const draw=()=>{ const pc=priceCart(cart,cartDisc), was=correcting, diff=was?pc.total-was.total:0;
      if(!pc.lines.length&&step!=='abandon'){ finish(); return; }
      const corrNote=was?`<p class="change ${diff>0?'bad':'ok'}" style="font-size:17px">Correcting a ${c2(was.total)} ${PAY_TXT[was.method]?PAY_TXT[was.method].replace(/^\S+ /,''):''} sale. ${diff>0?'The customer owes <b>'+c2(diff)+'</b> more.':diff<0?'Give the customer back <b>'+c2(-diff)+'</b>.':'Same total as before.'}${(was.method==='eftpos')!==(method==='eftpos')?' The payment method has changed: refund or charge on the terminal as needed.':''}</p>`:'';
      const mname=PAY_TXT[method].replace(/^\S+ /,''), head=`<h2>${PAY_TXT[method]} · ${c2(pc.total)}</h2><p class="note" style="margin-top:-6px">Includes ${c2(gstOf(pc.total))} GST</p>`;
      if(step==='review'){
        m.innerHTML=`<h2>Check the order</h2><div class="pbody">${corrNote}<div class="clines">${cartLinesHtml(pc,true)}</div>
            ${pc.manual?'':`<p><button class="linkb" id="rDisc" style="color:var(--green)">🏷️ Add a discount 🔒</button></p>`}</div>
          <div class="pfoot"><div class="ctot" style="background:none;padding:6px 0"><span>${cartCount()} item${cartCount()===1?'':'s'}</span><span class="tot"><b>${c2(pc.total)}</b>${gstLine(pc.total)}</span></div>
            <p class="note" style="margin:0 0 6px">Paying by</p><div class="seg" style="width:100%;margin-bottom:10px">${['cash','eftpos','other'].map(k=>`<button data-m="${k}" class="${method===k?'on':''}" style="flex:1">${PAY_TXT[k]}</button>`).join('')}</div>
            <div class="paybig"><button class="btn alt" id="rBack">‹ Back to the till</button><button class="btn" id="rGo">Take payment ›</button></div>
            <p style="text-align:center;margin:12px 0 0"><button class="linkb" id="rCancel">Cancel this sale</button></p></div>`;
        m.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{ changeQty(b.dataset.inc,1); draw(); });
        m.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{ changeQty(b.dataset.dec,-1); draw(); });
        m.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ const c=cart.find(x=>x.pid===b.dataset.rm); if(c) changeQty(c.pid,-c.qty); draw(); });
        m.querySelectorAll('[data-discx]').forEach(b=>b.onclick=()=>{ cartDisc=null; saveCart(); draw(); });
        m.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{ method=b.dataset.m; draw(); });
        const rd=m.querySelector('#rDisc'); if(rd) rd.onclick=giveDiscount;
        m.querySelector('#rBack').onclick=finish;
        m.querySelector('#rGo').onclick=()=>{ tendered=0; go('pay'); };
        m.querySelector('#rCancel').onclick=()=>go('abandon');
        return;
      }
      if(step==='pay'){
        if(method==='cash'){ const change=tendered-pc.total, enough=tendered>=pc.total;
          m.innerHTML=`${head}<div class="pbody">${corrNote}<p class="note">Tap the notes and coins you were handed.</p>
              <div class="notes">${[500,1000,2000,5000,10000].map(v=>`<button data-v="${v}">${c2(v).replace('.00','')}</button>`).join('')}<button data-v="exact" class="exact">Exact</button></div>
              <div class="change ${enough?'ok':''}">${tendered?`Handed <b>${c2(tendered)}</b> · `:''}${!tendered?'Nothing tapped yet':enough?`Change <b class="big">${c2(change)}</b>`:`Still to pay <b>${c2(-change)}</b>`}</div>
              ${tendered?'<p style="text-align:center"><button class="linkb" id="pR">Start again</button></p>':''}</div>
            <div class="pfoot"><div class="paybig"><button class="btn danger" id="pCancel">Cancel sale</button><button class="btn" id="pOk" ${enough?'':'disabled'}>Cash received</button></div></div>`;
          m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{ tendered=b.dataset.v==='exact'?pc.total:tendered+(+b.dataset.v); draw(); });
          const r=m.querySelector('#pR'); if(r) r.onclick=()=>{ tendered=0; draw(); };
          m.querySelector('#pOk').onclick=()=>go('confirm');
        } else if(method==='eftpos'){
          m.innerHTML=`${head}<div class="pbody">${corrNote}<p style="font-size:24px;text-align:center;margin:30px 0">Put <b>${c2(was?Math.max(0,diff):pc.total)}</b> through the EFTPOS terminal${was&&diff<=0?' (nothing more to charge)':''}.</p>
              <p class="note" style="text-align:center">Wait until the terminal says <b>approved</b> or <b>declined</b>.</p></div>
            <div class="pfoot"><div class="paybig"><button class="btn danger" id="pCancel">Declined / cancel</button><button class="btn" id="pOk">✓ Approved</button></div></div>`;
          m.querySelector('#pOk').onclick=()=>go('confirm');
        } else {
          m.innerHTML=`${head}<div class="pbody">${corrNote}<label class="note">How was it paid? (e.g. bank transfer, voucher)</label><input class="txt" id="pN" value="${esc(note)}"></div>
            <div class="pfoot"><div class="paybig"><button class="btn danger" id="pCancel">Cancel sale</button><button class="btn" id="pOk">Paid</button></div></div>`;
          m.querySelector('#pOk').onclick=()=>{ note=m.querySelector('#pN').value.trim(); if(!note){ toast('Say how it was paid'); return; } go('confirm'); };
        }
        m.querySelector('#pCancel').onclick=()=>go('abandon');
        return;
      }
      if(step==='confirm'){
        const q=method==='cash'?`<b>${c2(tendered)}</b> cash received${tendered>pc.total?` and <b>${c2(tendered-pc.total)}</b> change given`:''}?`:method==='eftpos'?`Has the EFTPOS terminal <b>approved</b> ${c2(was?Math.max(0,diff):pc.total)}?`:`Paid <b>${c2(pc.total)}</b> by ${esc(note)}?`;
        m.innerHTML=`<h2>Confirm the payment</h2><div class="pbody"><p style="font-size:26px;text-align:center;margin:40px 0 10px">${q}</p><p class="note" style="text-align:center">Only say yes once the money is really in.</p></div>
          <div class="pfoot"><div class="paybig"><button class="btn alt" id="cNo">No, go back</button><button class="btn" id="cYes">Yes, approved</button></div></div>`;
        m.querySelector('#cNo').onclick=()=>close.onBack();
        m.querySelector('#cYes').onclick=()=>{ const sale=recordSale(method,pc,method==='cash'?{tendered,change:tendered-pc.total}:method==='other'?{note}:{}); payRedraw=null; close(); setSheet(false); showApproved(sale); };
        return;
      }
      if(step==='abandon'){
        m.innerHTML=`<h2>Cancel this sale?</h2><div class="pbody"><p style="font-size:22px;text-align:center;margin:40px 0 10px">${method==='eftpos'&&hist.includes('pay')?'If the card was declined, ':''}All the items will be cleared and nothing is charged.</p>${was?'<p class="note" style="text-align:center">The sale being corrected stays as it was.</p>':''}</div>
          <div class="pfoot"><div class="paybig"><button class="btn alt" id="aNo">No, go back</button><button class="btn danger" id="aYes">Yes, clear the sale</button></div></div>`;
        m.querySelector('#aNo').onclick=()=>close.onBack();
        m.querySelector('#aYes').onclick=()=>{ clearCart(); sheetOpen=false; finish(); toast('Sale cancelled. Nothing was charged.'); };
      }
    };
    payRedraw=draw; draw();
  },{big:true,sticky:true});
}
/* ---------- emailed GST receipts ----------
   The app only records the request (sale + address). The Google helper script running in the business
   Gmail builds the receipt from the saved sale and sends it, within about 5 minutes; it works with no
   signal at the stall because the request waits on the device until it can sync. */
const receiptNo=s=>'RS-'+String(s.date||'').replace(/-/g,'')+'-'+String(s.id||'').slice(-5).toUpperCase();
const receiptsReady=()=>!!(S.settings.gstNumber&&S.settings.receiptEmail);
// The exact words shown to the customer; stored with every consent record.
const LOYALTY_TEXT='Would you like to join the Rata & Smudge Loyalty programme? We\'ll email you news, offers and loyalty rewards now and then. You can leave at any time.';
function emailReceipt(sale){
  if(!sale) return;
  if(!receiptsReady()){ toast(canManage()?'Set up GST receipts in Setup first (GST number and the business Gmail).':'Emailed receipts aren\'t set up yet. Ask the owner.'); return; }
  modal((m,close)=>{ const big=sale.total>100000; let joins=null;
    const v=id=>{ const e=m.querySelector('#'+id); return e?e.value:''; };
    const draw=()=>{ const keep={rE:v('rE'),rNm:v('rNm')};
      m.innerHTML=`<h2>📧 Email a GST receipt</h2><p class="note">For the ${c2(sale.total)} sale at ${nzTime(sale.at)} (includes ${c2(sale.gst)} GST). Sent from <b>${esc(S.settings.receiptEmail)}</b> within about 5 minutes, even if there's no signal right now.</p>
        <label class="note" for="rE">Customer's email</label><input class="txt" id="rE" type="email" inputmode="email" autocomplete="off" autocapitalize="none" placeholder="name@example.com" value="${esc(keep.rE)}">
        <label class="note" for="rNm">Customer's name ${big?'(needed on receipts over $1,000)':'(optional)'}</label><input class="txt" id="rNm" autocapitalize="words" value="${esc(keep.rNm)}">
        <div class="loyal"><b>💚 Loyalty programme</b><p>${esc(LOYALTY_TEXT)}</p><p class="note" style="margin:4px 0 10px">Please ask the customer. Their email is kept to send this receipt either way.</p>
          <div class="paybig"><button class="btn ${joins===true?'':'alt'}" id="lYes">${joins===true?'✓ ':''}Yes, join</button><button class="btn ${joins===false?'':'alt'}" id="lNo">${joins===false?'✓ ':''}No thanks</button></div></div>
        <div class="mact"><button class="btn alt" id="rC">Cancel</button><button class="btn" id="rS">Send receipt</button></div>`;
      m.querySelector('#lYes').onclick=()=>{ joins=true; draw(); };
      m.querySelector('#lNo').onclick=()=>{ joins=false; draw(); };
      m.querySelector('#rC').onclick=close;
      m.querySelector('#rS').onclick=()=>{ const to=v('rE').trim().toLowerCase(), nm=v('rNm').trim();
        if(!/^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(to)){ toast('Type the full email address'); return; } if(big&&!nm){ toast('Add the customer\'s name'); return; }
        if(joins===null){ toast('Ask about the Loyalty programme: Yes or No'); return; }
        const d=S.sessions.find(x=>x.id===sale.sessionId), where=d?((DAY_TYPES[d.type]||'').replace(/^\S+ /,'')+(d.name?' · '+d.name:'')):'';
        S.receipts.push({id:SYNC.newId('receipts'),saleId:sale.id,sessionId:sale.sessionId||'',to,buyerName:nm,loyalty:joins,by:SYNC.me(),at:Date.now(),status:'queued',receiptNo:receiptNo(sale)});
        S.contacts.push({id:SYNC.newId('contacts'),email:to,name:nm,loyalty:joins,consentText:joins?LOYALTY_TEXT:'',kind:joins?'joined':'receipt',source:where,saleId:sale.id,by:SYNC.me(),servedBy:servedBy()||'',at:Date.now()});
        save(); close(); toast('Receipt '+receiptNo(sale)+' will be emailed to '+to+(joins?' · joined the Loyalty programme 💚':'')); };
      const f=m.querySelector(keep.rE?'#rNm':'#rE'); if(f&&!keep.rE) setTimeout(()=>f.focus(),60);
    }; draw(); });
}
const receiptNote=s=>S.receipts.filter(r=>r.saleId===s.id).map(r=>r.status==='sent'?'📧 receipt sent to '+r.to:r.status==='failed'?'⚠️ receipt to '+r.to+' failed'+(r.error?': '+r.error:''):'📧 receipt to '+r.to+' waiting to send').join(' · ');

// the green "Payment approved" screen; it stays for cash until tapped (so the change isn't missed)
function showApproved(sale){
  if(!sale) return;
  const d=document.createElement('div'); d.className='approved';
  d.innerHTML=`<div class="tick">✓</div><h1>Payment approved</h1><p><b>${c2(sale.total)}</b> · ${PAY_TXT[sale.method].replace(/^\S+ /,'')}</p><p style="font-size:17px;opacity:.9;margin-top:0">Includes ${c2(sale.gst)} GST</p>
    ${sale.method==='cash'&&sale.change>0?`<p style="font-size:30px;margin-top:16px">Give change: <b>${c2(sale.change)}</b></p>`:''}
    <button class="btn" id="apOk">Next customer</button>${receiptsReady()?'<button class="btn mailbtn" id="apMail">📧 Email a GST receipt</button>':''}`;
  document.body.appendChild(d);
  let timer=null;
  const done=()=>{ clearTimeout(timer); d.remove(); modalStack=modalStack.filter(x=>x!==done); }; modalStack.push(done);
  d.querySelector('#apOk').onclick=done;
  const mb=d.querySelector('#apMail'); if(mb) mb.onclick=()=>{ done(); emailReceipt(sale); };
  d.addEventListener('pointerdown',()=>clearTimeout(timer));   // touching it keeps it up
  if(!(sale.method==='cash'&&sale.change>0)) timer=setTimeout(done,6000);
}
// Saved at once, even with no signal: Firestore keeps it on the device and sends it when the signal returns.
function recordSale(method,pc,extra){
  const d=openDay(); if(!d) return;
  const now=Date.now();
  const sale=Object.assign({id:SYNC.newId('sales'),sessionId:d.id,channel:d.type,where:d.name||'',date:nzDay(new Date(now)),at:now,when:nzStamp(now),
    lines:pc.lines,deals:pc.deals,manualDiscount:pc.manual||null,subtotal:pc.subtotal,discount:pc.discount,total:pc.total,gst:Math.round(pc.total*3/23),
    method,by:SYNC.me(),servedBy:servedBy()||'',voided:false},extra);
  if(correcting){ const old=S.sales.find(s=>s.id===correcting.id);
    sale.replaces=correcting.id; sale.correctedBy=correcting.approvedBy;
    if(old&&!old.voided) Object.assign(old,{voided:true,voidedBy:correcting.approvedBy,voidedAt:Date.now(),voidReason:'corrected',replacedBy:sale.id}); }
  const wasCorr=!!correcting;
  S.sales.push(sale); save();
  clearCart(); lastSale=wasCorr?null:{id:sale.id,at:sale.at,total:sale.total};
  clearTimeout(undoTimer); undoTimer=setTimeout(()=>{ if(cur()==='sell') render(); },60.5e3);
  render(); if(wasCorr) toast('✓ Corrected sale saved · '+c2(sale.total));
  return sale;
}
function undoLast(){
  if(!lastSale||Date.now()-lastSale.at>=60e3){ toast('Too late to undo. An owner can correct or void it under Sales.'); render(); return; }
  const i=S.sales.findIndex(s=>s.id===lastSale.id); const s=S.sales[i];
  if(s){ cart=s.lines.map(l=>l.custom?{pid:l.pid,qty:l.qty,custom:{name:l.name,size:l.size,price:l.unit,approvedBy:l.approvedBy}}:{pid:l.pid,qty:l.qty}); cartDisc=s.manualDiscount?Object.assign({},s.manualDiscount):null; saveCart(); S.sales.splice(i,1); save(); }
  lastSale=null; render(); toast('Sale undone. The items are back in the sale.');
}

/* ---------- the day's sales: correct or void (owners and managers, with a PIN) ---------- */
function showDaySales(approver){
  const d=openDay(); if(!d) return;
  modal((m,close)=>{ const draw=()=>{ const list=daySales(d), t=dayTotals(d);
    m.innerHTML=`<h2>🧾 Sales so far · ${c2(t.total)}</h2><p class="note">Opened with ${esc(personName(approver))}'s PIN. ${t.count} sale${t.count===1?'':'s'}; cash ${c2(t.cash)}, EFTPOS ${c2(t.eftpos)}${t.other?', other '+c2(t.other):''}.</p>
      ${list.length?list.map(s=>`<div class="row ${s.voided?'voided':''}"><div class="grow"><b>${nzTime(s.at)} · ${c2(s.total)} ${PAY_TXT[s.method]||''}</b>
        <small>${esc(s.lines.map(l=>l.qty+'× '+l.name+(l.size?' '+l.size:'')).join(', '))}${s.manualDiscount?' · discount '+c2(s.manualDiscount.amount):''}${s.servedBy?' · '+esc(s.servedBy):''}${s.replaces?' · corrected sale':''}${s.voided?' · '+(s.voidReason==='corrected'?'CORRECTED':'VOIDED')+' by '+esc(personName(s.voidedBy)):''}${receiptNote(s)?'<br>'+esc(receiptNote(s)):''}</small></div>
        ${s.voided?'':`<button class="btn alt small" data-mail="${s.id}" aria-label="Email a GST receipt">📧</button><button class="btn alt small" data-corr="${s.id}">Correct</button><button class="btn danger small" data-void="${s.id}">Void</button>`}</div>`).join(''):'<p class="note">No sales yet.</p>'}
      <div class="mact"><button class="btn" id="dOk">Close</button></div>`;
    m.querySelector('#dOk').onclick=close;
    m.querySelectorAll('[data-mail]').forEach(b=>b.onclick=()=>emailReceipt(S.sales.find(x=>x.id===b.dataset.mail)));
    m.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>{ const s=S.sales.find(x=>x.id===b.dataset.void);
      confirmBox('Void this '+c2(s.total)+' sale?',(s.method==='cash'?'Give back the cash, then tap Void.':s.method==='eftpos'?'Do the refund on the EFTPOS terminal, then tap Void.':'Refund it, then tap Void.')+' You\'ll be asked for a PIN.','Void',()=>
        approve('void a sale',who=>{ Object.assign(s,{voided:true,voidedBy:who,voidedAt:Date.now(),voidReason:'voided'}); save(); draw(); toast('Voided · approved by '+personName(who)); },
          c2(s.total)+' '+s.method+' sale from '+nzTime(s.at)),true); });
    m.querySelectorAll('[data-corr]').forEach(b=>b.onclick=()=>{ const s=S.sales.find(x=>x.id===b.dataset.corr);
      const go=()=>approve('correct a sale',who=>{
        cart=s.lines.map(l=>l.custom?{pid:l.pid,qty:l.qty,custom:{name:l.name,size:l.size,price:l.unit,approvedBy:l.approvedBy}}:{pid:l.pid,qty:l.qty});
        cartDisc=s.manualDiscount?{kind:s.manualDiscount.kind,value:s.manualDiscount.value,reason:s.manualDiscount.reason,approvedBy:s.manualDiscount.approvedBy,at:s.manualDiscount.at}:null;
        correcting={id:s.id,total:s.total,method:s.method,at:s.at,approvedBy:who}; saveCart(); close(); render();
        toast('Change the items, then take payment again'); },c2(s.total)+' '+s.method+' sale from '+nzTime(s.at));
      if(cart.length&&!correcting) confirmBox('Put this sale aside?','There is a sale in progress. Correcting replaces it.','Correct anyway',go); else go(); });
  }; draw(); });
}

/* ---------- the cash float (with a PIN) ----------
   The opening float can be corrected, and more float added during the day (e.g. extra change).
   End of day expects: opening float + float added + cash sales. */
const floatAdded=d=>(d.floatAdds||[]).reduce((n,a)=>n+(a.amount||0),0);
function editFloat(){
  const d=openDay(); if(!d) return;
  modal((m,close)=>{ const draw=()=>{
    m.innerHTML=`<h2>💵 Cash float</h2>
      <div class="row"><div class="grow"><b>Opening float</b><small>What was in the tin at the start</small></div><b style="font-size:22px">${c2(d.float)}</b></div>
      ${(d.floatAdds||[]).map(a=>`<div class="row"><div class="grow">Float added at ${nzTime(a.at)}<small>${esc(a.note||'')} · approved by ${esc(personName(a.approvedBy))}</small></div><b>${c2(a.amount)}</b></div>`).join('')}
      <div class="row"><div class="grow"><b>Float in total</b></div><b style="font-size:22px">${c2((d.float||0)+floatAdded(d))}</b></div>
      <div class="card" style="margin:12px 0 0"><h3 style="font-size:18px">Add more float</h3><p class="note">Extra notes or coins put in the tin during the day.</p>
        <input class="txt" id="fA" inputmode="decimal" placeholder="e.g. 50"><input class="txt" id="fN" placeholder="Note (optional), e.g. more coins" style="margin-top:8px">
        <div class="mact"><button class="btn" id="fAdd">Add with PIN</button></div></div>
      <div class="card" style="margin:12px 0 0"><h3 style="font-size:18px">Correct the opening float</h3>
        <input class="txt" id="fO" inputmode="decimal" placeholder="${S.settings.defaultFloat?(S.settings.defaultFloat/100).toFixed(2):'200.00'}" value="${d.float?(d.float/100).toFixed(2):''}">
        <div class="mact"><button class="btn alt" id="fSet">Change with PIN</button></div></div>
      <div class="mact"><button class="btn" id="fX">Done</button></div>`;
    m.querySelector('#fX').onclick=close;
    m.querySelector('#fAdd').onclick=()=>{ const c=toCents(m.querySelector('#fA').value), note=m.querySelector('#fN').value.trim(); if(!(c>0)){ toast('Type the amount added, e.g. 50'); return; }
      approve('add float',who=>{ d.floatAdds=(d.floatAdds||[]).concat([{amount:c,at:Date.now(),note,approvedBy:who,by:SYNC.me()}]); save(); draw(); toast(c2(c)+' float added'); },c2(c)+(note?' ('+note+')':'')+' to '+(d.name||'the day')); };
    m.querySelector('#fSet').onclick=()=>{ const v=m.querySelector('#fO').value.trim(), c=toCents(v); if(!(c>=0)||!v){ toast('Type the opening float, e.g. 200'); return; }
      if(c===(d.float||0)){ toast('That\'s the float already'); return; }
      approve('change the opening float',who=>{ const was=d.float||0; d.float=c; d.floatChanges=(d.floatChanges||[]).concat([{from:was,to:c,at:Date.now(),approvedBy:who}]); save(); draw(); toast('Opening float now '+c2(c)); },c2(d.float)+' → '+c2(c)+' for '+(d.name||'the day')); };
  }; draw(); });
}

/* ---------- end of day (with a PIN) ---------- */
function dayTotals(d){
  const all=daySales(d), ok=all.filter(s=>!s.voided), by=k=>ok.filter(s=>s.method===k).reduce((n,s)=>n+s.total,0);
  const units={}; ok.forEach(s=>s.lines.forEach(l=>{ const k=l.name+(l.size?' · '+l.size:''); units[k]=(units[k]||0)+l.qty; }));
  return {count:ok.length,total:ok.reduce((n,s)=>n+s.total,0),gst:ok.reduce((n,s)=>n+(s.gst||0),0),cash:by('cash'),eftpos:by('eftpos'),other:by('other'),
    discount:ok.reduce((n,s)=>n+(s.discount||0),0),units,voids:all.filter(s=>s.voided&&s.voidReason!=='corrected'),corrections:all.filter(s=>s.voidReason==='corrected').length};
}
function endDay(approver){
  const d=openDay(); if(!d) return; const t=dayTotals(d), added=floatAdded(d), expected=(d.float||0)+added+t.cash;
  modal((m,close)=>{ m.innerHTML=`<h2>🏁 End of the day</h2><p class="note">Opened with ${esc(personName(approver))}'s PIN.</p>
    <div class="eod"><div><span>Sales</span><b>${t.count}</b></div><div><span>Takings</span><b>${c2(t.total)}</b></div><div><span>GST included</span><b>${c2(t.gst)}</b></div><div><span>Deals and discounts</span><b>${c2(t.discount)}</b></div></div>
    <div class="card" style="margin:12px 0"><div class="row"><div class="grow">💳 EFTPOS<small>Check against the terminal's settlement</small></div><b>${c2(t.eftpos)}</b></div>
      ${t.other?`<div class="row"><div class="grow">🔖 Other</div><b>${c2(t.other)}</b></div>`:''}
      <div class="row"><div class="grow">💵 Cash sales</div><b>${c2(t.cash)}</b></div>
      <div class="row"><div class="grow">Cash expected in the tin<small>Float ${c2(d.float)}${added?' + float added '+c2(added):''} + cash sales</small></div><b>${c2(expected)}</b></div>
      <label class="note" for="eC">Count the cash in the tin</label><input class="txt" id="eC" inputmode="decimal" placeholder="e.g. 412.50"><p class="change" id="eDiff">Count the tin, then type the total.</p></div>
    ${t.voids.length?`<p class="note"><b>${t.voids.length} voided sale${t.voids.length>1?'s':''}:</b> ${t.voids.map(s=>c2(s.total)+' at '+nzTime(s.at)+' ('+esc(personName(s.voidedBy))+')').join(', ')}</p>`:''}
    ${t.corrections?`<p class="note"><b>${t.corrections} corrected sale${t.corrections>1?'s':''}</b> (see the approvals log).</p>`:''}
    <details><summary class="note">Units sold by product</summary>${Object.entries(t.units).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="row"><div class="grow">${esc(k)}</div><b>${v}</b></div>`).join('')||'<p class="note">None</p>'}</details>
    <div class="mact"><button class="btn alt" id="eK">Keep selling</button><button class="btn" id="eX">Close the day</button></div>`;
    const inp=m.querySelector('#eC'), out=m.querySelector('#eDiff');
    inp.oninput=()=>{ const c=toCents(inp.value); if(!(c>=0)){ out.className='change'; out.textContent='Count the tin, then type the total.'; return; } const diff=c-expected;
      out.className='change '+(diff===0?'ok':'bad'); out.innerHTML=diff===0?'✓ The cash is right':(diff>0?'Over by <b>'+c2(diff)+'</b>':'Short by <b>'+c2(-diff)+'</b>'); };
    m.querySelector('#eK').onclick=close;
    m.querySelector('#eX').onclick=()=>{ const c=toCents(inp.value); if(!(c>=0)){ toast('Type the cash you counted first'); inp.focus(); return; }
      Object.assign(d,{status:'closed',closedAt:Date.now(),closedBy:SYNC.me(),closeApprovedBy:approver,countedCash:c,expectedCash:expected,floatAdded:added,totals:{count:t.count,total:t.total,gst:t.gst,cash:t.cash,eftpos:t.eftpos,other:t.other}});
      logApproval('close the day',approver,c2(t.total)+' taken; cash counted '+c2(c)+(c===expected?' (right)':(c>expected?' (over '+c2(c-expected)+')':' (short '+c2(expected-c)+')')));
      save(); close(); clearCart(); lsSet('rs.tillMode',null); lastSale=null; keepAwake(false); stack=['home']; render(); toast('Day closed · '+c2(t.total)+' taken'); };
  });
}

/* ---------- keep the screen on while the till is open ---------- */
let wake=null;
function keepAwake(on){
  try{ if(on&&!wake&&navigator.wakeLock) navigator.wakeLock.request('screen').then(w=>{ wake=w; w.addEventListener('release',()=>{ wake=null; }); }).catch(()=>{});
       if(!on&&wake){ wake.release(); wake=null; } }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&cur()==='sell'&&openDay()) keepAwake(true); });
