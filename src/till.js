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
const PAY_TXT={cash:'💵 Cash',eftpos:'💳 EFTPOS',afterpay:'🟢 Afterpay',other:'🔖 Other'};
const payMethods=()=>['cash','eftpos'].concat(S.settings.afterpayOn?['afterpay']:[]).concat(['other']);
const cardLike=m=>m==='eftpos'||m==='afterpay';
const c2=c=>money((c||0)/100);
// GST included in a GST-inclusive amount (15%): 3/23 of the total, rounded to the cent
const gstOf=c=>Math.round((c||0)*3/23);
const gstLine=c=>`<small class="gstl">incl. ${c2(gstOf(c))} GST</small>`;
// The open sale is kept on the device, so a reload mid-sale loses nothing. Everything kept on the device
// is tagged with the business, so another account on the same device never inherits it.
let cart=[], cartDisc=null, correcting=null, lossOk=null;
const loadCart=()=>{ const c=lsGet('rs.cart',null), ok=c&&c.bid===SYNC.businessId(); cart=ok?c.items||[]:[]; cartDisc=ok?c.disc||null:null; correcting=ok?c.correcting||null:null; lossOk=ok?c.lossOk||null:null; };
const saveCart=()=>lsSet('rs.cart',{bid:SYNC.businessId(),items:cart,disc:cartDisc,correcting,lossOk});
const clearCart=()=>{ cart=[]; cartDisc=null; correcting=null; lossOk=null; saveCart(); };
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
let startType=lsGet('rs.lastType','market'), startEvent=null, startPlace=null;
const START_GROUP={market:'markets',farmgate:'farmshop',tour:'tours',shop:'shops'};
// a helper may open only today's markets they're ticked on in the calendar
const myMarketsToday=()=>todaysMarkets().filter(e=>canManage()||(e.attendees||[]).includes(SYNC.me()));
// markets on the calendar for today, offered first so the name, place and float fill themselves in
const todaysMarkets=()=>(typeof eventsOn==='function'?eventsOn(nzDay()):[]).filter(e=>e.type==='market');
function startHtml(){
  const tm=myMarketsToday();
  if(!canManage()) return `<div class="card"><h3>📅 Your markets today</h3>${tm.length?`<div class="pastnames">${tm.map(e=>`<button class="chip big ${startEvent===e.id?'on':''}" data-ev0="${e.id}">🧺 ${esc(e.title)}${e.time?' · '+esc(t12(e.time)):''}</button>`).join('')}</div>`:'<p>You\'re not ticked on any market on today\'s calendar.</p><p class="note">Ask an owner or manager to open the till for you, or to tick you on today\'s market in the calendar.</p>'}
      <input type="hidden" id="sName" value="${esc((S.events.find(e=>e.id===startEvent)||{}).title||'')}"><label class="note" for="sFloat">Cash float in the tin (optional)</label><input class="txt" id="sFloat" inputmode="decimal" placeholder="e.g. 200" value="${S.settings.defaultFloat?(S.settings.defaultFloat/100).toFixed(2):''}"></div>
    <div class="card"><h3>Who is serving?</h3><div class="pastnames">${(S.settings.staff||[]).map(n=>`<button class="chip big ${servedBy()===n?'on':''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')}<button class="chip big" id="sWhoAdd">＋ Someone new</button></div></div>
    <button class="btn bigbtn" id="sGo" ${tm.length&&activeProducts().length?'':'disabled'}>Start selling</button>${askCardHtml()}`;
  const saved=S.places.filter(p=>!p.gone&&p.group===START_GROUP[startType]).sort((a,b)=>a.name.localeCompare(b.name));
  const staff=S.settings.staff||[];
  return (tm.length?`<div class="card"><h3>📅 On the calendar today</h3><div class="pastnames">${tm.map(e=>`<button class="chip big ${startEvent===e.id?'on':''}" data-ev0="${e.id}">🧺 ${esc(e.title)}${e.time?' · '+esc(t12(e.time)):''}</button>`).join('')}</div></div>`:'')+`<div class="card"><h3>Where are you selling today?</h3>
      <div class="bigseg">${Object.entries(DAY_TYPES).map(([k,v])=>`<button data-t="${k}" class="${startType===k?'on':''}">${v}</button>`).join('')}</div>
      <label class="note" for="sName">${startType==='market'?'Which market?':'Name (optional)'}</label>
      <input class="txt" id="sName" list="sPast" autocomplete="off" value="${esc((S.places.find(p=>p.id===startPlace)||{}).name||'')}" placeholder="${startType==='market'?'e.g. Titirangi Village Market':''}">
      ${saved.length?`<p class="note" style="margin:8px 0 0">Saved ${startType==='market'?'markets':'places'}:</p><div class="pastnames">${saved.map(p=>`<button class="chip big ${startPlace===p.id?'on':''}" data-pl="${p.id}">${esc(p.name)}</button>`).join('')}</div>`:''}
      <p class="note">${saved.length?'Not there? Type the name: you\'ll be asked for its details first.':'Type the name: you\'ll be asked for its details (address, float, stall fee) first.'}</p>
      <label class="note" for="sFloat">Cash float in the tin (optional)</label>
      <input class="txt" id="sFloat" inputmode="decimal" placeholder="e.g. 200" value="${(()=>{ const pl=S.places.find(p=>p.id===startPlace), f=pl&&pl.float?pl.float:S.settings.defaultFloat; return f?(f/100).toFixed(2):''; })()}"></div>
    <div class="card"><h3>Who is serving?</h3><p class="note">Each sale records who served.</p>
      <div class="pastnames">${staff.map(n=>`<button class="chip big ${servedBy()===n?'on':''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')}<button class="chip big" id="sWhoAdd">＋ Someone new</button></div></div>
    ${activeProducts().length?'':`<div class="card" style="border-color:var(--rata)"><b>No products yet.</b><p class="note">${canManage()?'Add them first in Setup → Products and prices.':'Ask the owner to add the products first.'}</p></div>`}
    <button class="btn bigbtn" id="sGo" ${activeProducts().length?'':'disabled'}>Start selling</button>`;
}
function wireStart(){
  if(!canManage()) wireAskCard();
  document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ startType=b.dataset.t; lsSet('rs.lastType',startType); render(); });
  document.querySelectorAll('[data-pl]').forEach(b=>b.onclick=()=>{ const p=S.places.find(x=>x.id===b.dataset.pl); if(!p) return; startPlace=p.id; startEvent=null;
    $('#sName').value=p.name; if(p.float) $('#sFloat').value=(p.float/100).toFixed(2); document.querySelectorAll('[data-pl]').forEach(x=>x.classList.toggle('on',x===b)); });
  const sn=$('#sName'); if(sn&&sn.type!=='hidden') sn.oninput=()=>{ startPlace=null; startEvent=null; document.querySelectorAll('[data-pl]').forEach(x=>x.classList.remove('on')); };
  document.querySelectorAll('[data-ev0]').forEach(b=>b.onclick=()=>{ const e=S.events.find(x=>x.id===b.dataset.ev0); if(!e) return;
    startEvent=e.id; startPlace=e.place||null; startType='market'; lsSet('rs.lastType','market'); render();
    $('#sName').value=e.title; const pl=S.places.find(p=>p.id===e.place); if(pl&&pl.float) $('#sFloat').value=(pl.float/100).toFixed(2); });
  document.querySelectorAll('[data-who]').forEach(b=>b.onclick=()=>{ lsSet('rs.servedBy',b.dataset.who); document.querySelectorAll('[data-who]').forEach(x=>x.classList.toggle('on',x===b)); });
  $('#sWhoAdd').onclick=()=>askName(n=>{ lsSet('rs.servedBy',n); if(canManage()&&!(S.settings.staff||[]).includes(n)){ S.settings.staff=[...(S.settings.staff||[]),n]; save(); } render(); });
  $('#sGo').onclick=()=>{
    if(!servedBy()){ toast('Tap who is serving first'); return; }
    const fl=$('#sFloat').value.trim(), fc=fl?toCents(fl):0; if(fl&&!(fc>=0)){ toast('The float should be a number, e.g. 100'); return; }
    const ev=startEvent&&S.events.find(x=>x.id===startEvent);
    const name=$('#sName').value.trim()||(ev&&ev.title)||''; if(!canManage()&&!startEvent){ toast('Tap your market first'); return; }
    if(startType==='market'&&!name){ toast('Tap or type which market'); return; }
    let pl=startPlace&&S.places.find(p=>p.id===startPlace)||(name&&S.places.find(p=>!p.gone&&p.name.toLowerCase()===name.toLowerCase()));
    // a new market or place: its details first, so nothing is half set up
    if(!pl&&name&&canManage()&&START_GROUP[startType]&&startType!=='tour'){ const g=placeGroups().find(x=>x.id===START_GROUP[startType]);
      editPlace({name,group:g?g.id:'markets',channel:g?g.channel:'retail',float:fc||0},p=>{ startPlace=p.id; render(); toast('Saved. Tap Start selling.'); }); return; }
    const open=evx=>{ S.sessions.push(Object.assign({id:SYNC.newId('sessions'),type:startType,name:name||(evx&&evx.title)||'',date:nzDay(),openedAt:Date.now(),openedBy:SYNC.me(),float:fc||0,status:'open'},evx?{eventId:evx.id,placeId:evx.place||''}:pl?{placeId:pl.id}:{}));
      startEvent=null; startPlace=null; cart=[]; saveCart(); save(); render(); };
    // a market that isn't on today's calendar: offer to add it, so the day is planned and costed
    if(startType==='market'&&!ev&&pl&&canManage()){ confirmBox('Add '+esc(pl.name)+' to today\'s calendar?','So its hours, drive and stall fee count in Real profit.','Add and start',()=>{
        const now=new Date(), hh=String(now.getHours()).padStart(2,'0')+':00', e={id:SYNC.newId('events'),type:'market',title:pl.name,place:pl.id,date:nzDay(),time:hh,end:'',days:1,rpt:'',until:'',attendees:[SYNC.me()],remind:[],note:'',by:SYNC.me(),changed:Date.now()};
        S.events.push(e); open(e); }); return; }
    open(ev);
  };
}
function askName(done){
  modal((m,close)=>{ m.innerHTML=`<h2>Who is serving?</h2><input class="txt" id="wN" autocapitalize="words" placeholder="First name"><div class="mact"><button class="btn alt" id="wC">Cancel</button><button class="btn" id="wOk">OK</button></div>`;
    const go=()=>{ const n=m.querySelector('#wN').value.trim(); if(!n){ toast('Type a name'); return; } close(); done(n); };
    m.querySelector('#wC').onclick=close; m.querySelector('#wOk').onclick=go; m.querySelector('#wN').onkeydown=e=>{ if(e.key==='Enter') go(); };
    setTimeout(()=>{ if(!m.contains(document.activeElement)) m.querySelector('#wN').focus(); },50); });
}

/* ---------- the till ---------- */
let tillFilter=lsGet('rs.filter','all'), sheetOpen=false, payRedraw=null;
// the items in the sale, with − and ＋ (used in the sale panel and in "Check the order")
function cartLinesHtml(pc,big){
  if(!pc.lines.length) return `<p class="note cempty">Tap a product to start a sale.</p>`;
  return pc.lines.map(l=>`<div class="cl"><div class="grow"><b>${esc(l.name)}</b><small>${esc(l.size)}${l.size?' · ':''}${c2(l.unit)} each${l.custom?' · not on the till':''}</small></div>
      <button class="qb" data-dec="${l.pid}" aria-label="One less">−</button><b class="qn">${l.qty}</b><button class="qb" data-inc="${l.pid}" aria-label="One more">＋</button><b class="la">${c2(l.amount)}</b>${big?`<button class="qb rm" data-rm="${l.pid}" aria-label="Remove">✕</button>`:''}</div>`).join('')
    +pc.deals.map(d=>`<div class="cl deal"><div class="grow"><b>🎁 ${esc(d.name)}${d.times>1?' ×'+d.times:''}</b></div><b class="la">−${c2(d.saving)}</b></div>`).join('')
    +(pc.manual?`<div class="cl deal"><div class="grow"><b>🏷️ Discount ${pc.manual.kind==='pct'?pc.manual.value+'%':c2(pc.manual.value)}${pc.manual.pid?' on '+esc((pc.lines.find(l=>l.pid===pc.manual.pid)||{}).name||'one item'):''}</b><small>${esc(pc.manual.reason)} · approved by ${esc(personName(pc.manual.approvedBy))}</small></div><button class="qb" data-discx="1" aria-label="Remove discount">✕</button><b class="la">−${c2(pc.manual.amount)}</b></div>`:'');
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
  return waitingSalesNote()+`<div class="tbar">
      ${undo?`<button class="btn danger" id="tUndo">↩ Undo last sale (${c2(lastSale.total)})</button>`:''}
      ${(()=>{ const q=eftQueue(); return q.length?`<button class="btn qbtn" id="tQueue">💳 EFTPOS queue: ${q.length} · ${c2(q.reduce((n,x)=>n+x.total,0))}</button>`:''; })()}
      ${helper?'':`<button class="btn alt" id="tList">🧾 Sales <span class="lk">🔒</span></button>`}
      ${lock?`<button class="btn alt" id="tUnlock">🔓 Leave till mode <span class="lk">🔒</span></button>`:(helper?'':`<button class="btn alt" id="tLock">🤝 Hand to a helper</button>`)}
      <button class="btn alt" id="tFind">🔍 Find</button>
      <button class="btn alt" id="tWho">👤 ${esc(servedBy()||'Who is serving?')}</button>
      ${helper?'':`<button class="btn alt" id="tFloat">💵 Float <span class="lk">🔒</span></button>`}
      ${helper?'':`<button class="btn alt" id="tEnd">🏁 End the day <span class="lk">🔒</span></button>`}</div>
    <div class="filters">${cats.length>1?[['all','All',all.length]].concat(cats.map(k=>[k,COLOURS[k][3],all.filter(p=>(p.colour||'other')===k).length])).map(([k,label,n])=>
      `<button class="fchip ${tillFilter===k?'on':''}" data-f="${k}" style="${k==='all'?'':`--c:${COLOURS[k][0]}`}">${k==='all'?'':'<i></i>'}${esc(label)} <small>${n}</small></button>`).join(''):''}</div>
    <div class="till">
    <section class="tgrid">${shown.map(p=>{ const k=COLOURS[p.colour]||COLOURS.other; return `<button class="ptile" data-add="${p.id}" style="background:${k[0]};color:${k[1]}">
        ${qty[p.id]?`<span class="pq">${qty[p.id]}</span>`:''}${(()=>{ const st=typeof stockOf==='function'?stockOf(p.id):null; return st&&st.total-(qty[p.id]||0)<=0?'<span class="pout">0 left?</span>':''; })()}<span class="pc">${esc(k[2])}</span><span class="pn">${esc(p.name)}</span><span class="ps">${esc(p.size||'')}</span><span class="pp">${c2(p.price)}</span></button>`; }).join('')}
      <button class="ptile extra" id="tExtra"><span class="pc">🔒 Needs a PIN</span><span class="pn">＋ Item not on the till</span><span class="ps">One-off, or add it for next time</span></button></section>
    <aside class="cart ${sheetOpen?'open':''}" id="cart">
      <div class="grab" id="cGrab"><i></i><span>${pc.lines.length?(sheetOpen?'▼ Hide items':'▲ Show items ('+cartCount()+')'):'Tap a product to start'}</span></div>
      <div class="ctot"><span>${cartCount()} item${cartCount()===1?'':'s'}${pc.lines.length?` · <button class="linkb" id="cClear">Clear</button>${pc.manual?'':` · <button class="linkb" id="cDisc" style="color:var(--green)">🏷️ Discount 🔒</button>`}`:''}</span><span class="tot"><b id="cTotal">${c2(pc.total)}</b>${gstLine(pc.total)}</span></div>
      <div class="pay" style="grid-template-columns:repeat(${payMethods().length},1fr)">${pc.total===0&&pc.lines.length&&pc.manual?`<button class="pb gift" id="giveAway" style="grid-column:1/-1">🎁 Give away · record it</button>`:payMethods().map(k=>`<button class="pb ${k}" data-pay="${k}" ${pc.total>0?'':'disabled'}>${PAY_TXT[k]}</button>`).join('')}</div>
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
  const tq=$('#tQueue'); if(tq) tq.onclick=openQueue;
  const ga=$('#giveAway'); if(ga) ga.onclick=()=>{ const pc=priceCart(cart,cartDisc);
    confirmBox('Give these away?',esc(pc.lines.map(l=>l.qty+' × '+l.name).join(', '))+' at no charge, approved by '+esc(personName(pc.manual.approvedBy))+'. It\'s recorded as a gift, and the stock comes off.','Give away',()=>{ recordSale('gift',pc); toast('🎁 Recorded as a gift'); }); };
  document.querySelectorAll('[data-discx]').forEach(b=>b.onclick=()=>{ cartDisc=null; saveCart(); render(); });
  wireSheet();
  const cc=$('#cCorrX'); if(cc) cc.onclick=()=>confirmBox('Cancel the correction?','The original sale stays as it was.','Cancel correction',()=>{ clearCart(); render(); });
  $('#tExtra').onclick=addExtraItem; $("#tFind").onclick=tillFind;
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

/* ---------- a discount (needs a PIN): on the whole sale, or on one item ----------
   After the PIN, the person approving sees what it costs to make, the margin before and after, and a red
   flag if it's below cost, with one tap for break even or the lowest margin (Setup, default 20%). The
   helper never sees those figures: the approver does this on their own screen, or the iPad in their hands. */
const minMargin=()=>{ const v=+S.settings.minMargin; return v>=0&&v<95?v:20; };
function giveDiscount(){
  const all=priceCart(cart,null); if(all.total<=0) return;
  modal((m,close)=>{ let kind='pct', value=10, pid='';
    const draw=()=>{ const base=pid?all.lines.filter(l=>l.pid===pid).reduce((n,l)=>n+l.amount,0):all.total, amt=kind==='pct'?Math.round(base*value/100):Math.min(value,base);
      m.innerHTML=`<h2>🏷️ Discount</h2><p class="note">On the whole sale, or on one item. An owner or manager approves it with their PIN.</p>
        <div class="pastnames"><button class="chip big ${pid?'':'on'}" data-dp="">Whole sale · ${c2(all.total)}</button>${all.lines.map(l=>`<button class="chip big ${pid===l.pid?'on':''}" data-dp="${esc(l.pid)}">${esc(l.name)}${l.qty>1?' ×'+l.qty:''} · ${c2(l.amount)}</button>`).join('')}</div>
        <div class="seg"><button data-kind="pct" class="${kind==='pct'?'on':''}">% off</button><button data-kind="amt" class="${kind==='amt'?'on':''}">$ off</button></div>
        <div class="pastnames">${(kind==='pct'?[5,10,15,20,25,50,100]:[200,500,1000,2000]).map(v=>`<button class="chip big ${value===v?'on':''}" data-v="${v}">${kind==='pct'?(v===100?'Free':v+'%'):c2(v).replace('.00','')}</button>`).join('')}</div>
        <label class="note">Or type the ${kind==='pct'?'percentage':'amount'}</label><input class="txt" id="dV" inputmode="decimal" value="${kind==='pct'?value:(value/100).toFixed(2)}">
        <label class="note">Reason (shown in the approvals log)</label><textarea class="txt grow" rows="1" id="dR" placeholder="e.g. regular customer, damaged label, freebie"></textarea>
        <p class="change ok">Takes off <b>${c2(amt)}</b>${pid?' from '+esc(all.lines.find(l=>l.pid===pid).name):''} · sale total <b>${c2(all.total-amt)}</b></p>
        <div class="mact"><button class="btn alt" id="dC">Cancel</button><button class="btn" id="dOk">Approve with PIN</button></div>`;
      const keep=()=>m.querySelector('#dR').value, put=r=>{ m.querySelector('#dR').value=r; };
      m.querySelectorAll('[data-dp]').forEach(b=>b.onclick=()=>{ const r=keep(); pid=b.dataset.dp; draw(); put(r); });
      m.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{ const r=keep(); kind=b.dataset.kind; value=kind==='pct'?10:500; draw(); put(r); });
      m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{ const r=keep(); value=+b.dataset.v; draw(); put(r); });
      m.querySelector('#dV').onchange=e=>{ const r=keep(), n=parseFloat(e.target.value); if(!(n>0)) return; value=kind==='pct'?Math.min(100,n):Math.round(n*100); draw(); put(r); };
      m.querySelector('#dC').onclick=close;
      m.querySelector('#dOk').onclick=()=>{ const reason=keep().trim(); if(!reason){ toast('Give a reason for the discount'); return; } close();
        const what=pid?all.lines.find(l=>l.pid===pid).name:'the sale', label=(kind==='pct'?value+'%':c2(value))+' off '+what+' ('+reason+')';
        approve('give a discount',who=>discountReview({kind,value,pid,reason},who),label); };
    }; draw(); });
}
// the approver's window: cost, margin before and after, a flag below cost, and one-tap fixes
function discountReview(d,who){
  const all=priceCart(cart,null), k=cartCost(all);
  modal((m,close)=>{ let cur=Object.assign({},d);
    const draw=()=>{ const pc=priceCart(cart,cur), before=marginTxt(all.total,k.cost), after=marginTxt(pc.total,k.cost), below=k.cost>0&&exGst(pc.total)<k.cost;
      const target=p=>Math.max(0,all.total-Math.ceil(k.cost*1.15/(1-p/100)/10)*10), even=Math.max(0,all.total-Math.ceil(k.cost*1.15/10)*10);
      m.innerHTML=`<h2>🔒 Check this discount</h2><p class="note">For ${esc(personName(who))}'s eyes: the cost figures aren't shown to helpers.</p>
        ${k.cost>0?`<div class="eod"><div><span>Costs to make (ex GST)</span><b>${c2(k.cost)}</b></div><div><span>Before: ${c2(all.total)}</span><b>${esc(before.txt.split(' · ')[1])}</b></div><div><span>After: ${c2(pc.total)}</span><b class="${below?'bad':''}">${esc(after.txt.split(' · ')[1])}</b></div></div>
        ${below?`<p class="change bad">⚠️ Below cost: this sale loses ${c2(k.cost-exGst(pc.total))} (ex GST).</p>`:`<p class="change ok">${esc(after.txt)}</p>`}
        <div class="pastnames"><button class="chip big" data-fix="even">Break even · ${c2(all.total-even)}</button><button class="chip big" data-fix="min">${minMargin()}% margin · ${c2(all.total-target(minMargin()))}</button><button class="chip big" data-fix="asked">As asked · ${c2(priceCart(cart,d).total)}</button></div>`
        :`<p class="note">${k.unknown?'No cost has been worked out for '+(k.unknown===1?'this item':'these items')+' yet, so the margin can\'t be checked.':''}</p><p class="change ok">New total ${c2(pc.total)}</p>`}
        ${k.unknown&&k.cost>0?`<p class="note">${k.unknown} item${k.unknown===1?' has':'s have'} no cost yet, so the real margin may be lower.</p>`:''}
        <div class="mact"><button class="btn alt" id="drC">Don't give it</button><button class="btn" id="drOk">${below?'Give it anyway':'Give the discount'}</button></div>`;
      m.querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>{ const f=b.dataset.fix;
        if(f==='asked') cur=Object.assign({},d); else { const off=f==='even'?even:target(minMargin()); cur=Object.assign({},d,{pid:'',kind:'amt',value:Math.max(0,off)}); } draw(); });
      m.querySelector('#drC').onclick=close;
      m.querySelector('#drOk').onclick=()=>{ close(); if(!(priceCart(cart,cur).manual||{}).amount){ cartDisc=null; saveCart(); render(); toast('No discount needed'); return; }
        cartDisc=Object.assign({},cur,{approvedBy:who,at:Date.now()});
        const pc=priceCart(cart,cartDisc); if(k.cost>0&&exGst(pc.total)<k.cost){ lossOk={sig:cartSig(),by:who,at:Date.now(),cost:k.cost,total:pc.total}; logApproval('sell below cost',who,c2(pc.total)+' total, costs '+c2(k.cost)+' ex GST to make ('+(cur.reason||'')+')',true); }
        saveCart(); render(); if(payRedraw) payRedraw(); toast('Discount approved by '+personName(who)); };
    }; draw(); });
}

/* ---------- 🔍 Find: any product, including ones off the till ----------
   On-till products add straight to the sale. Off-till ones are greyed and struck through, and need an
   owner's or manager's PIN: sold once (it stays off the till) or put back on the till. */
function tillFind(){
  modal((m,close)=>{ let q='';
    const list=()=>{ const all=S.products.filter(p=>p.price>0).map(p=>({p,sc:fuzzyScore(q,p.name+' '+(p.size||''))})).filter(x=>x.sc>0)
        .sort((a,b)=>(a.p.active===false)-(b.p.active===false)||b.sc-a.sc||prodName(a.p).localeCompare(prodName(b.p))).slice(0,40);
      return all.length?all.map(({p})=>`<button class="frow ${p.active===false?'off':''}" data-fp="${p.id}"><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.size||'')}${p.active===false?' · Not on the till · 🔒 needs a PIN':''}</small></span><b>${c2(p.price)}</b></button>`).join('')
        :'<p class="note">Nothing matches. Use ＋ Item not on the till for something new.</p>'; };
    m.innerHTML=`<h2>🔍 Find a product</h2><input class="txt" id="fQ" type="search" placeholder="Type part of the name, e.g. lav oil" autocomplete="off"><div class="findlist" id="fL">${list()}</div>
      <div class="mact"><button class="btn alt" id="fC">Close</button></div>`;
    const wireL=()=>m.querySelectorAll('[data-fp]').forEach(b=>b.onclick=()=>{ const p=S.products.find(x=>x.id===b.dataset.fp); if(!p) return;
      if(p.active!==false){ close(); setQty(p.id,1); toast(prodName(p)+' added'); return; }
      close(); sellOffTill(p); });
    m.querySelector('#fQ').oninput=e=>{ q=e.target.value; m.querySelector('#fL').innerHTML=list(); wireL(); };
    m.querySelector('#fC').onclick=close; wireL();
    setTimeout(()=>{ const f=m.querySelector('#fQ'); if(f&&!m.contains(document.activeElement)) f.focus(); },50); },{big:true});
}
function sellOffTill(p){
  modal((m,close)=>{ m.innerHTML=`<h2>${esc(prodName(p))} · ${c2(p.price)}</h2><p>This isn't on the till, so an owner or manager approves it with their PIN.</p>
      <div class="mact"><button class="btn alt" id="oC">Cancel</button>${canManage()?'<button class="btn alt" id="oKeep">Sell and put it on the till</button>':''}<button class="btn" id="oOnce">Sell it once</button></div>`;
    m.querySelector('#oC').onclick=close;
    const go=keep=>{ close(); approve(keep?'put a product on the till':'sell an item not on the till',who=>{
        if(keep){ p.active=true; p.updated=Date.now(); cart.push({pid:p.id,qty:1}); }
        else { const c=cart.find(x=>x.pid===p.id); if(c){ c.qty++; c.approvedBy=who; } else cart.push({pid:p.id,qty:1,approvedBy:who}); }
        saveCart(); save(); render(); toast(prodName(p)+(keep?' is back on the till':' added, just this once')+' · approved by '+personName(who)); },
      prodName(p)+' at '+c2(p.price)+(keep?', put back on the till':', sold once')); };
    m.querySelector('#oOnce').onclick=()=>go(false); const k=m.querySelector('#oKeep'); if(k) k.onclick=()=>go(true); });
}

/* ---------- an item that isn't on the till (needs a PIN) ---------- */
function addExtraItem(){
  modal((m,close)=>{ let col='other', keep='once';
    const draw=()=>{ const v=k=>{ const e=m.querySelector('#'+k); return e?e.value:''; }, n=v('xN'), z=v('xZ'), pr=v('xP');
      m.innerHTML=`<h2>＋ Item not on the till</h2><p class="note">For something without a button, e.g. a new batch or a market special. An owner or manager approves the price with their PIN.</p>
        <label class="note">What is it?</label><textarea class="txt grow" rows="1" id="xN" autocapitalize="words">${esc(n)}</textarea>
        <label class="note">Size (optional)</label><input class="txt" id="xZ" value="${esc(z)}">
        <label class="note">Price, including GST</label><input class="txt" id="xP" inputmode="decimal" value="${esc(pr)}" placeholder="e.g. 18">
        <p class="note">Category</p><div class="colours">${Object.entries(COLOURS).map(([k,c])=>`<button data-c="${k}" class="${col===k?'on':''}" style="background:${c[0]};color:${c[1]}">${c[2]}</button>`).join('')}</div>
        ${canManage()?`<p class="note">Afterwards</p><div class="bigseg">${[['once','Just this sale'],['off','Add to products (off the till)'],['on','Add to products and the till']].map(([k,l])=>`<button data-keep="${k}" class="${keep===k?'on':''}">${l}</button>`).join('')}</div>
          ${keep!=='once'?'<p class="note">It goes on the owners\' to-do list as "Finish setting up", to add its recipe, packaging and wholesale price.</p>':''}`:''}
        <div class="mact"><button class="btn alt" id="xC">Cancel</button><button class="btn" id="xOk">Approve with PIN</button></div>`;
      m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{ col=b.dataset.c; draw(); });
      m.querySelectorAll('[data-keep]').forEach(b=>b.onclick=()=>{ keep=b.dataset.keep; draw(); });
      m.querySelector('#xC').onclick=close;
      m.querySelector('#xOk').onclick=()=>{ const name=v('xN').trim(), size=v('xZ').trim(), price=toCents(v('xP'));
        if(!name){ toast('Say what the item is'); return; } if(!(price>0)){ toast('Type the price'); return; } close();
        approve('add an item not on the till',who=>{
          if(keep!=='once'){ const p={id:SYNC.newId('products'),name,size,price,colour:col,active:keep==='on',updated:Date.now(),addedAtTill:true,approvedBy:who,needsSetup:true}; S.products.push(p);
            cart.push(keep==='on'?{pid:p.id,qty:1}:{pid:p.id,qty:1,approvedBy:who}); setupTodo(p,who); }
          else cart.push({pid:'x-'+Date.now().toString(36),qty:1,custom:{name,size,price,colour:col,approvedBy:who}});
          saveCart(); save(); render(); toast(name+' added · approved by '+personName(who)); },
          name+(size?' '+size:'')+' at '+c2(price)+(keep==='on'?', added to the till':keep==='off'?', added to products (off the till)':', one-off')); };
    }; draw(); setTimeout(()=>{ if(!m.contains(document.activeElement)) m.querySelector('#xN').focus(); },50); });
}

/* ---------- selling below cost (needs a PIN) ----------
   If a discount or deal would sell a sale for less than it costs to make (ingredients and packaging,
   ex GST), the sale stops. An owner or manager enters their PIN, sees cost, price and margin, then
   approves it or sets a new total (the margin recalculates as they type), and confirms a second time.
   Only then does it go on to payment; the approvals log records it. Costs come from the recipes,
   which are owners-only: on a device that can't see them (or for an item with no recipe) it can't check. */
const exGst=c=>Math.round((c||0)/1.15);
function cartCost(pc){ let cost=0, unknown=0;
  for(const l of pc.lines){ const p=l.custom?null:S.products.find(x=>x.id===l.pid), c=p&&typeof unitCost==='function'?unitCost(p):null;
    if(c==null) unknown+=l.qty; else cost+=c*l.qty; }
  return {cost:Math.round(cost),unknown}; }
const cartSig=()=>JSON.stringify([cart.map(c=>[c.pid,c.qty]),cartDisc?[cartDisc.kind,cartDisc.value,cartDisc.pid||'']:null]);
const lossApproved=()=>!!(lossOk&&lossOk.sig===cartSig());
function belowCost(pc){ const k=cartCost(pc); return k.cost>0&&exGst(pc.total)<k.cost?k:null; }
const marginTxt=(total,cost)=>{ const ex=exGst(total), m=ex>0?Math.round((ex-cost)/ex*100):-100; return {m,txt:(ex>=cost?'Makes ':'Loses ')+c2(Math.abs(ex-cost))+' · margin '+m+'%'}; };
function lossCheck(pc,k,done){
  modal((m,close)=>{ const mt=marginTxt(pc.total,k.cost);
    m.innerHTML=`<h2>⚠️ This sale loses money</h2>
      <div class="eod"><div><span>Costs to make (ex GST)</span><b>${c2(k.cost)}</b></div><div><span>Sale (ex GST)</span><b>${c2(exGst(pc.total))}</b></div><div><span>Result</span><b class="bad">${esc(mt.txt.replace(' · ','<br>')).replace('&lt;br&gt;','<br>')}</b></div></div>
      ${pc.manual?`<p class="note">Discount: ${pc.manual.kind==='pct'?pc.manual.value+'%':c2(pc.manual.value)} (${esc(pc.manual.reason||'')})</p>`:''}${pc.deals.length?`<p class="note">Deals: ${pc.deals.map(d=>esc(d.name)).join(', ')}</p>`:''}
      ${k.unknown?`<p class="note">${k.unknown} item${k.unknown===1?' has':'s have'} no cost yet, so the real loss may be bigger.</p>`:''}
      <p>The sale can't go ahead until an owner or manager approves it.</p>
      <div class="mact"><button class="btn alt" id="lcN">Back to the order</button><button class="btn" id="lcY">Approve with PIN</button></div>`;
    m.querySelector('#lcN').onclick=close;
    m.querySelector('#lcY').onclick=()=>{ close(); approve('look at a sale below cost',who=>lossAdjust(k,who,done),c2(pc.total)+' total, costs '+c2(k.cost)+' ex GST to make'); }; });
}
function lossAdjust(k,who,done){
  const base=priceCart(cart,null).total, even=Math.min(base,Math.ceil(k.cost*1.15/10)*10);
  modal((m,close)=>{ let total=priceCart(cart,cartDisc).total;
    const draw=()=>{ const mt=marginTxt(total,k.cost), quick=[['Break even',even]].concat([20,30,40].map(p=>[p+'% margin',Math.min(base,Math.ceil(k.cost*1.15/(1-p/100)/10)*10)])).concat(cartDisc?[['No discount',base]]:[]);
      m.innerHTML=`<h2>Set this sale's total</h2><p class="note">Till price ${c2(base)}${cartDisc?' before the discount':''}. Costs ${c2(k.cost)} to make, ex GST.</p>
        <div class="pastnames">${quick.filter((q,i,a)=>a.findIndex(x=>x[1]===q[1])===i).map(([l,v])=>`<button class="chip big ${v===total?'on':''}" data-qt="${v}">${esc(l)} · ${c2(v)}</button>`).join('')}</div>
        <label class="note" for="laT">Or type the total, including GST</label><input class="txt" id="laT" inputmode="decimal" value="${(total/100).toFixed(2)}">
        <p class="change ${exGst(total)>=k.cost?'ok':'bad'}" style="font-size:18px"><b>${c2(total)}</b> · ${esc(mt.txt)}</p>
        <div class="mact"><button class="btn alt" id="laC">Cancel</button><button class="btn" id="laOk">Approve ${c2(total)}</button></div>`;
      m.querySelectorAll('[data-qt]').forEach(b=>b.onclick=()=>{ total=+b.dataset.qt; draw(); });
      const t=m.querySelector('#laT'); t.oninput=()=>{ const v=toCents(t.value); if(v>0){ total=Math.min(base,v); const p=m.querySelector('.change'); const mt2=marginTxt(total,k.cost); p.className='change '+(exGst(total)>=k.cost?'ok':'bad'); p.innerHTML='<b>'+c2(total)+'</b> · '+esc(mt2.txt); m.querySelector('#laOk').textContent='Approve '+c2(total); } };
      t.onchange=()=>{ const v=toCents(t.value); if(v>base) toast('It can\'t be more than the till price, '+c2(base)); draw(); };
      m.querySelector('#laC').onclick=close;
      m.querySelector('#laOk').onclick=()=>{ const mt2=marginTxt(total,k.cost); close();
        confirmBox('Confirm again','Sell this for <b>'+c2(total)+'</b>? It costs '+c2(k.cost)+' to make (ex GST): '+esc(mt2.txt)+'.','Yes, approve',()=>{
          const old=cartDisc;
          cartDisc=total>=base?null:{kind:'amt',value:base-total,reason:(old&&old.reason?old.reason+' · ':'')+'approved below cost',approvedBy:who,at:Date.now()};
          lossOk={sig:cartSig(),by:who,at:Date.now(),cost:k.cost,total};
          saveCart(); logApproval('sell below cost',who,c2(total)+' total, costs '+c2(k.cost)+' ex GST to make ('+mt2.txt+')',true);
          render(); if(payRedraw) payRedraw(); toast('Approved by '+personName(who)); done(); }); };
    }; draw(); });
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
            <p class="note" style="margin:0 0 6px">Paying by</p><div class="seg" style="width:100%;margin-bottom:10px">${payMethods().map(k=>`<button data-m="${k}" class="${method===k?'on':''}" style="flex:1">${PAY_TXT[k]}</button>`).join('')}</div>
            <div class="paybig"><button class="btn alt" id="rBack">‹ Back to the till</button><button class="btn" id="rGo">Take payment ›</button></div>
            <p style="text-align:center;margin:12px 0 0"><button class="linkb" id="rCancel">Cancel this sale</button></p></div>`;
        m.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{ changeQty(b.dataset.inc,1); draw(); });
        m.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{ changeQty(b.dataset.dec,-1); draw(); });
        m.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ const c=cart.find(x=>x.pid===b.dataset.rm); if(c) changeQty(c.pid,-c.qty); draw(); });
        m.querySelectorAll('[data-discx]').forEach(b=>b.onclick=()=>{ cartDisc=null; saveCart(); draw(); });
        m.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{ method=b.dataset.m; draw(); });
        const rd=m.querySelector('#rDisc'); if(rd) rd.onclick=giveDiscount;
        m.querySelector('#rBack').onclick=finish;
        m.querySelector('#rGo').onclick=()=>{ const k=belowCost(pc);
          if(k&&!lossApproved()){ lossCheck(pc,k,()=>{ tendered=0; go('pay'); }); return; }
          tendered=0; go('pay'); };
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
        } else if(cardLike(method)){ const ap=method==='afterpay', q=method==='eftpos'&&S.settings.eftQueue&&!was;
          m.innerHTML=`${head}<div class="pbody">${corrNote}<p style="font-size:24px;text-align:center;margin:30px 0">${ap?`The customer pays <b>${c2(was?Math.max(0,diff):pc.total)}</b> with Afterpay`:`Put <b>${c2(was?Math.max(0,diff):pc.total)}</b> through the EFTPOS terminal`}${was&&diff<=0?' (nothing more to charge)':''}.</p>
              <p class="note" style="text-align:center">${ap?'They tap their Afterpay card (in their phone wallet) on the terminal. ':''}Wait until it says <b>approved</b> or <b>declined</b>.</p>
              ${q?`<button class="btn alt bigbtn" id="pQueue">📋 Busy? Pay on EFTPOS next<small style="display:block;font-weight:400">Puts this sale in the queue for whoever is on the terminal, and frees the till</small></button>`:''}</div>
            <div class="pfoot"><div class="paybig"><button class="btn danger" id="pCancel">Declined / cancel</button><button class="btn" id="pOk">✓ Approved</button></div></div>`;
          m.querySelector('#pOk').onclick=()=>go('confirm');
          const pq=m.querySelector('#pQueue'); if(pq) pq.onclick=()=>{ queueSale(pc); payRedraw=null; close(); setSheet(false); render(); toast('📋 In the EFTPOS queue · '+c2(pc.total)); };
        } else {
          m.innerHTML=`${head}<div class="pbody">${corrNote}<label class="note">How was it paid? (e.g. bank transfer, voucher)</label><input class="txt" id="pN" value="${esc(note)}"></div>
            <div class="pfoot"><div class="paybig"><button class="btn danger" id="pCancel">Cancel sale</button><button class="btn" id="pOk">Paid</button></div></div>`;
          m.querySelector('#pOk').onclick=()=>{ note=m.querySelector('#pN').value.trim(); if(!note){ toast('Say how it was paid'); return; } go('confirm'); };
        }
        m.querySelector('#pCancel').onclick=()=>go('abandon');
        return;
      }
      if(step==='confirm'){
        const q=method==='cash'?`<b>${c2(tendered)}</b> cash received${tendered>pc.total?` and <b>${c2(tendered-pc.total)}</b> change given`:''}?`:cardLike(method)?`Has ${method==='afterpay'?'Afterpay':'the EFTPOS terminal'} <b>approved</b> ${c2(was?Math.max(0,diff):pc.total)}?`:`Paid <b>${c2(pc.total)}</b> by ${esc(note)}?`;
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
    method,by:SYNC.me(),servedBy:servedBy()||'',voided:false},lossApproved()?{belowCost:{cost:lossOk.cost,approvedBy:lossOk.by}}:{},extra);
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
        <input class="txt" id="fA" inputmode="decimal" placeholder="e.g. 50"><textarea class="txt grow" rows="1" id="fN" placeholder="Note (optional), e.g. more coins" style="margin-top:8px"></textarea>
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
/* ---------- "Pay on EFTPOS next" queue (Setup → Till: on a busy day) ----------
   The sale waits on the selling day (everyone at the market sees it), not in the takings. Whoever is on the
   terminal opens the queue on their own phone, puts each one through and ticks it paid: only then is it a sale. */
const eftQueue=()=>{ const d=openDay(); return ((d&&d.queue)||[]).slice().sort((a,b)=>a.at-b.at); };
function queueSale(pc){
  const d=openDay(); if(!d) return;
  d.queue=(d.queue||[]).concat([{id:SYNC.newId('sales'),at:Date.now(),by:SYNC.me(),servedBy:servedBy()||'',total:pc.total,
    pc:{lines:pc.lines,deals:pc.deals,manual:pc.manual||null,subtotal:pc.subtotal,discount:pc.discount,total:pc.total},belowCost:lossApproved()?{cost:lossOk.cost,approvedBy:lossOk.by}:null}]);
  clearCart(); save();
}
function queuePaid(q){
  const d=openDay(); if(!d||!q) return;
  d.queue=(d.queue||[]).filter(x=>x.id!==q.id);
  if(!S.sales.some(s=>s.id===q.id)){ const now=Date.now(), pc=q.pc;
    S.sales.push(Object.assign({id:q.id,sessionId:d.id,channel:d.type,where:d.name||'',date:nzDay(new Date(now)),at:now,when:nzStamp(now),
      lines:pc.lines,deals:pc.deals||[],manualDiscount:pc.manual||null,subtotal:pc.subtotal,discount:pc.discount,total:pc.total,gst:Math.round(pc.total*3/23),
      method:'eftpos',by:SYNC.me(),servedBy:q.servedBy||'',voided:false,queuedAt:q.at,queuedBy:q.by},q.belowCost?{belowCost:q.belowCost}:{})); }
  save();
}
function openQueue(){
  modal((m,close)=>{ let tmr;
    const draw=()=>{ const l=eftQueue(); if(!document.body.contains(m)){ clearInterval(tmr); return; }
      m.innerHTML=`<h2>💳 EFTPOS queue</h2><p class="note">Oldest first. Put each total through the terminal, then tap Paid. It only counts as a sale once it's paid.</p>
        ${l.length?l.map((q,i)=>`<div class="card qrow"><div class="grow"><b class="qtot">${c2(q.total)}</b><small>${i===0?'Next · ':''}${q.pc.lines.map(x=>x.qty+' × '+esc(x.name)).join(', ')}${q.servedBy?' · served by '+esc(q.servedBy):''} · ${agoText(q.at)}</small></div>
          <button class="btn qpaid" data-qp="${q.id}">✓ Paid</button><button class="btn alt small" data-qx="${q.id}">Declined</button></div>`).join(''):'<p class="chkline">All paid. 🌿</p>'}
        <div class="mact"><button class="btn alt" id="qC">Close</button></div>`;
      m.querySelector('#qC').onclick=()=>{ clearInterval(tmr); close(); render(); };
      m.querySelectorAll('[data-qp]').forEach(b=>b.onclick=()=>{ queuePaid(eftQueue().find(x=>x.id===b.dataset.qp)); toast('✓ Paid'); draw(); });
      m.querySelectorAll('[data-qx]').forEach(b=>b.onclick=()=>{ const q=eftQueue().find(x=>x.id===b.dataset.qx); if(!q) return;
        confirmBox('Card declined: '+c2(q.total),cart.length?'Take it off the queue (nothing charged). The till is busy, so it can\'t go back on it.':'Put it back on the till so they can pay another way?',cart.length?'Take it off':'Back to the till',()=>{
          const d=openDay(); d.queue=(d.queue||[]).filter(x=>x.id!==q.id);
          if(!cart.length){ q.pc.lines.forEach(l=>{ if(l.custom) cart.push({pid:l.pid,qty:l.qty,custom:typeof l.custom==='object'?l.custom:{name:l.name,size:l.size||'',price:l.unit}}); else if(l.pid) cart.push({pid:l.pid,qty:l.qty}); }); if(q.pc.manual) cartDisc=q.pc.manual; saveCart(); }
          save(); clearInterval(tmr); close(); render(); }); });
    };
    draw(); tmr=setInterval(draw,2000); });
}
function dayTotals(d){
  const all=daySales(d), ok=all.filter(s=>!s.voided), by=k=>ok.filter(s=>s.method===k).reduce((n,s)=>n+s.total,0);
  const units={}; ok.forEach(s=>s.lines.forEach(l=>{ const k=l.name+(l.size?' · '+l.size:''); units[k]=(units[k]||0)+l.qty; }));
  return {count:ok.length,total:ok.reduce((n,s)=>n+s.total,0),gst:ok.reduce((n,s)=>n+(s.gst||0),0),cash:by('cash'),eftpos:by('eftpos'),afterpay:by('afterpay'),other:by('other'),
    discount:ok.reduce((n,s)=>n+(s.discount||0),0),units,voids:all.filter(s=>s.voided&&s.voidReason!=='corrected'),corrections:all.filter(s=>s.voidReason==='corrected').length};
}
function endDay(approver){
  const d=openDay(); if(!d) return; const t=dayTotals(d), added=floatAdded(d), expected=(d.float||0)+added+t.cash;
  modal((m,close)=>{ m.innerHTML=`<h2>🏁 End of the day</h2><p class="note">Opened with ${esc(personName(approver))}'s PIN.</p>
    ${waitingSalesNote()}<div class="eod"><div><span>Sales</span><b>${t.count}</b></div><div><span>Takings</span><b>${c2(t.total)}</b></div><div><span>GST included</span><b>${c2(t.gst)}</b></div><div><span>Deals and discounts</span><b>${c2(t.discount)}</b></div></div>
    <div class="card" style="margin:12px 0"><div class="row"><div class="grow">💳 EFTPOS<small>Check against the terminal's settlement</small></div><b>${c2(t.eftpos)}</b></div>
      ${t.afterpay?`<div class="row"><div class="grow">🟢 Afterpay</div><b>${c2(t.afterpay)}</b></div>`:''}
      ${eftQueue().length?`<div class="card nudge"><b>⚠️ ${eftQueue().length} sale${eftQueue().length===1?'':'s'} in the EFTPOS queue not paid yet (${c2(eftQueue().reduce((n,x)=>n+x.total,0))})</b><small>They aren't counted. Put them through, or take them off the queue, before ending the day.</small><button class="btn small" id="eQ">Open the queue</button></div>`:''}
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
    m.querySelector('#eK').onclick=close; const eq=m.querySelector('#eQ'); if(eq) eq.onclick=()=>{ close(); openQueue(); };
    m.querySelector('#eX').onclick=()=>{ const c=toCents(inp.value); if(!(c>=0)){ toast('Type the cash you counted first'); inp.focus(); return; }
      Object.assign(d,{status:'closed',closedAt:Date.now(),closedBy:SYNC.me(),closeApprovedBy:approver,countedCash:c,expectedCash:expected,floatAdded:added,totals:{count:t.count,total:t.total,gst:t.gst,cash:t.cash,eftpos:t.eftpos,other:t.other}});
      logApproval('close the day',approver,c2(t.total)+' taken; cash counted '+c2(c)+(c===expected?' (right)':(c>expected?' (over '+c2(c-expected)+')':' (short '+c2(expected-c)+')')));
      save(); close(); clearCart(); lsSet('rs.tillMode',null); lastSale=null; keepAwake(false); stack=['home']; render(); toast('Day closed · '+c2(t.total)+' taken');
      if(d.type==='market') setTimeout(()=>marketCheckin(d),400); };
  });
}

/* ---------- keep the screen on while the till is open ---------- */
let wake=null;
function keepAwake(on){
  try{ if(on&&!wake&&navigator.wakeLock) navigator.wakeLock.request('screen').then(w=>{ wake=w; w.addEventListener('release',()=>{ wake=null; }); }).catch(()=>{});
       if(!on&&wake){ wake.release(); wake=null; } }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&cur()==='sell'&&openDay()) keepAwake(true); });
