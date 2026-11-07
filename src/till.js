/* ================= The till =================
   Two taps per sale: tap the products, tap how they paid. The app does every sum, prices are locked,
   deals apply by themselves, and "Hand to a helper" locks the iPad to selling until her PIN. */
const nzDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(d||new Date());   // 2026-11-07
const nzTime=t=>new Intl.DateTimeFormat('en-NZ',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(t));
const DAY_TYPES={market:'🧺 Market',farmgate:'🚪 Farm gate',tour:'🌿 Garden tour',shop:'🏪 Shop'};
const PAY_TXT={cash:'💵 Cash',eftpos:'💳 EFTPOS',other:'🔖 Other'};
const c2=c=>money((c||0)/100);
// The open sale is kept on the device, so a reload mid-sale loses nothing. Everything kept on the device
// is tagged with the business, so another account on the same device never inherits it.
let cart=[];
const loadCart=()=>{ const c=lsGet('rs.cart',null); cart=c&&c.bid===SYNC.businessId()?c.items:[]; };
const saveCart=()=>lsSet('rs.cart',{bid:SYNC.businessId(),items:cart});
let lastSale=null, undoTimer=null;
const tillLock=()=>{ const t=lsGet('rs.tillMode',null); return t&&t.bid===SYNC.businessId()?t:null; };   // {servedBy} while handed to a helper
const servedBy=()=>lsGet('rs.servedBy','');
const openDay=()=>S.sessions.filter(s=>s.status==='open').sort((a,b)=>b.openedAt-a.openedAt)[0]||null;
const daySales=s=>S.sales.filter(x=>x.sessionId===s.id).sort((a,b)=>b.at-a.at);
const cartCount=()=>cart.reduce((n,c)=>n+c.qty,0);

// PIN that is always asked (voids, leaving till mode, ending the day in till mode). "Don't ask" doesn't apply here.
function ownerPin(why,fn){
  if(role()==='helper'){ toast('Only the owner can '+why+'. Please ask her.'); return; }
  if(!S.settings.pinHash){ if(tillLock()){ toast('Set a PIN in Setup first'); return; } fn(); return; }
  pinPad('PIN to '+why,async pin=>{ if(await pinHashOf(pin)===S.settings.pinHash){ pinFails=0; return true; } if(++pinFails>=3){ pinWaitUntil=Date.now()+30e3; pinFails=0; } return false; },fn,false);
}

/* ---------- screen ---------- */
SCREENS.sell={
  title(){ const d=openDay(), lock=tillLock();
    if(!d) return {h:'Start selling'};
    return {h:(DAY_TYPES[d.type]||'').replace(/^\S+ /,'')+(d.name?' · '+d.name:''),s:(servedBy()?'Served by '+servedBy():'')+(lock?' · 🔒 Till mode':'')}; },
  html(){ return openDay()?tillHtml():startHtml(); },
  wire(){ openDay()?wireTill():wireStart(); }
};

/* ---------- start a selling day ---------- */
let startType=lsGet('rs.lastType','market');
function startHtml(){
  const past=[...new Set(S.sessions.filter(s=>s.type===startType&&s.name).sort((a,b)=>b.openedAt-a.openedAt).map(s=>s.name))].slice(0,6);
  const staff=S.settings.staff||[];
  return `<div class="card"><h3>Where are you selling today?</h3>
      <div class="bigseg">${Object.entries(DAY_TYPES).map(([k,v])=>`<button data-t="${k}" class="${startType===k?'on':''}">${v}</button>`).join('')}</div>
      <label class="note" for="sName">${startType==='market'?'Which market?':'Name (optional)'}</label>
      <input class="txt" id="sName" list="sPast" autocomplete="off" placeholder="${startType==='market'?'e.g. Titirangi Village Market':''}">
      ${past.length?`<div class="pastnames">${past.map(n=>`<button class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>`:''}
      <label class="note" for="sFloat">Cash float in the tin (optional)</label>
      <input class="txt" id="sFloat" inputmode="decimal" placeholder="e.g. 100"></div>
    <div class="card"><h3>Who is serving?</h3><p class="note">Each sale records who served.</p>
      <div class="pastnames">${staff.map(n=>`<button class="chip big ${servedBy()===n?'on':''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')}<button class="chip big" id="sWhoAdd">＋ Someone new</button></div></div>
    ${activeProducts().length?'':`<div class="card" style="border-color:var(--rata)"><b>No products yet.</b><p class="note">${canManage()?'Add them first in Setup → Products and prices.':'Ask the owner to add the products first.'}</p></div>`}
    <button class="btn bigbtn" id="sGo" ${activeProducts().length?'':'disabled'}>Start selling</button>`;
}
function wireStart(){
  document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ startType=b.dataset.t; lsSet('rs.lastType',startType); render(); });
  document.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{ $('#sName').value=b.dataset.n; });
  document.querySelectorAll('[data-who]').forEach(b=>b.onclick=()=>{ lsSet('rs.servedBy',b.dataset.who); document.querySelectorAll('[data-who]').forEach(x=>x.classList.toggle('on',x===b)); });
  $('#sWhoAdd').onclick=()=>askName(n=>{ lsSet('rs.servedBy',n); if(canManage()&&!(S.settings.staff||[]).includes(n)){ S.settings.staff=[...(S.settings.staff||[]),n]; save(); } render(); });
  $('#sGo').onclick=()=>{
    if(!servedBy()){ toast('Tap who is serving first'); return; }
    const fl=$('#sFloat').value.trim(), fc=fl?toCents(fl):0; if(fl&&!(fc>=0)){ toast('The float should be a number, e.g. 100'); return; }
    const name=$('#sName').value.trim(); if(startType==='market'&&!name){ toast('Type which market'); return; }
    S.sessions.push({id:SYNC.newId('sessions'),type:startType,name,date:nzDay(),openedAt:Date.now(),openedBy:SYNC.me(),float:fc||0,status:'open'});
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
function tillHtml(){
  const pc=priceCart(cart), qty=Object.fromEntries(cart.map(c=>[c.pid,c.qty])), lock=tillLock();
  const undo=lastSale&&Date.now()-lastSale.at<60e3;
  return `<div class="tbar">
      ${undo?`<button class="btn danger" id="tUndo">↩ Undo last sale (${c2(lastSale.total)})</button>`:''}
      <button class="btn alt" id="tList">🧾 Today's sales</button>
      ${lock?`<button class="btn alt" id="tUnlock">🔒 Leave till mode</button>`:(role()!=='helper'?`<button class="btn alt" id="tLock">🤝 Hand to a helper</button>`:'')}
      <button class="btn alt" id="tWho">👤 ${esc(servedBy()||'Who is serving?')}</button>
      <button class="btn alt" id="tEnd">🏁 End the day</button></div>
    <div class="till">
    <section class="tgrid">${activeProducts().map(p=>`<button class="ptile" data-add="${p.id}" style="${swatch(p.colour)}">
        ${qty[p.id]?`<span class="pq">${qty[p.id]}</span>`:''}<span class="pn">${esc(p.name)}</span><span class="ps">${esc(p.size||'')}</span><span class="pp">${c2(p.price)}</span></button>`).join('')}</section>
    <aside class="cart" id="cart">
      <div class="clines">${pc.lines.length?pc.lines.map(l=>`<div class="cl"><div class="grow"><b>${esc(l.name)}</b><small>${esc(l.size)} · ${c2(l.unit)} each</small></div>
          <button class="qb" data-dec="${l.pid}" aria-label="One less">−</button><b class="qn">${l.qty}</b><button class="qb" data-inc="${l.pid}" aria-label="One more">＋</button><b class="la">${c2(l.amount)}</b></div>`).join('')
        +pc.deals.map(d=>`<div class="cl deal"><div class="grow"><b>🎁 ${esc(d.name)}${d.times>1?' ×'+d.times:''}</b></div><b class="la">−${c2(d.saving)}</b></div>`).join('')
        :`<p class="note cempty">Tap a product to start a sale.</p>`}</div>
      <div class="ctot"><span>${cartCount()} item${cartCount()===1?'':'s'}${pc.lines.length?' · <button class="linkb" id="cClear">Clear</button>':''}</span><b id="cTotal">${c2(pc.total)}</b></div>
      <div class="pay">${['cash','eftpos','other'].map(k=>`<button class="pb ${k}" data-pay="${k}" ${pc.total>0?'':'disabled'}>${PAY_TXT[k]}</button>`).join('')}</div>
    </aside></div>`;
}
function setQty(pid,d){ const c=cart.find(x=>x.pid===pid); if(c) c.qty+=d; else if(d>0) cart.push({pid,qty:d}); cart=cart.filter(x=>x.qty>0); saveCart(); render(); }
function wireTill(){
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>setQty(b.dataset.add,1));
  document.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>setQty(b.dataset.inc,1));
  document.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>setQty(b.dataset.dec,-1));
  const cl=$('#cClear'); if(cl) cl.onclick=()=>confirmBox('Clear this sale?','The items are taken off. Nothing has been charged.','Clear',()=>{ cart=[]; saveCart(); render(); });
  document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>pay(b.dataset.pay));
  const u=$('#tUndo'); if(u) u.onclick=undoLast;
  $('#tList').onclick=showDaySales;
  const lk=$('#tLock'); if(lk) lk.onclick=handToHelper;
  const ul=$('#tUnlock'); if(ul) ul.onclick=()=>ownerPin('leave till mode',()=>{ lsSet('rs.tillMode',null); render(); toast('Till mode off'); });
  $('#tWho').onclick=()=>{ if(tillLock()){ toast('In till mode. Leave till mode to change who is serving.'); return; } pickServer(()=>render()); };
  $('#tEnd').onclick=()=>tillLock()?ownerPin('end the day',endDay):endDay();
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
  if(!S.settings.pinHash){ confirmBox('Set a PIN first','Till mode needs your PIN so a helper can\'t leave it. Choose a 4-digit PIN now.','Choose a PIN',()=>setPinFlow(handToHelper)); return; }
  pickServer(n=>{ lsSet('rs.tillMode',{bid:SYNC.businessId(),servedBy:n,at:Date.now()}); stack=['home','sell']; render();
    toast('Till mode on for '+n+'. Prices are locked; your PIN unlocks it.'); });
}

/* ---------- taking payment ---------- */
function pay(method){
  const pc=priceCart(cart); if(pc.total<=0) return;
  modal((m,close)=>{ let tendered=0;
    if(method==='cash'){
      const draw=()=>{ const change=tendered-pc.total, enough=tendered>=pc.total;
        m.innerHTML=`<h2>💵 Cash · ${c2(pc.total)}</h2><p class="note">Tap the notes and coins you were handed.</p>
          <div class="notes">${[500,1000,2000,5000,10000].map(v=>`<button data-v="${v}">${c2(v).replace('.00','')}</button>`).join('')}<button data-v="exact" class="exact">Exact</button></div>
          <div class="change ${enough?'ok':''}">${tendered?`Handed <b>${c2(tendered)}</b> · `:''}${!tendered?'Nothing tapped yet':enough?`Change <b class="big">${c2(change)}</b>`:`Still to pay <b>${c2(-change)}</b>`}</div>
          <div class="mact">${tendered?'<button class="btn alt" id="pR">Start again</button>':''}<button class="btn alt" id="pC">Cancel</button><button class="btn" id="pOk" ${enough?'':'disabled'}>Done</button></div>`;
        m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{ tendered=b.dataset.v==='exact'?pc.total:tendered+(+b.dataset.v); draw(); });
        const r=m.querySelector('#pR'); if(r) r.onclick=()=>{ tendered=0; draw(); };
        m.querySelector('#pC').onclick=close;
        m.querySelector('#pOk').onclick=()=>{ close(); recordSale('cash',pc,{tendered,change:tendered-pc.total}); };
      }; draw();
    } else if(method==='eftpos'){
      m.innerHTML=`<h2>💳 EFTPOS · ${c2(pc.total)}</h2><p style="font-size:21px">Put <b>${c2(pc.total)}</b> through the EFTPOS terminal.</p><p class="note">Only tap Approved once the terminal says it went through.</p>
        <div class="mact"><button class="btn alt" id="pC">Declined / cancel</button><button class="btn" id="pOk">✓ Approved</button></div>`;
      m.querySelector('#pC').onclick=close; m.querySelector('#pOk').onclick=()=>{ close(); recordSale('eftpos',pc,{}); };
    } else {
      m.innerHTML=`<h2>🔖 Other · ${c2(pc.total)}</h2><label class="note">How was it paid? (e.g. bank transfer, voucher)</label><input class="txt" id="pN">
        <div class="mact"><button class="btn alt" id="pC">Cancel</button><button class="btn" id="pOk">Record sale</button></div>`;
      m.querySelector('#pC').onclick=close; m.querySelector('#pOk').onclick=()=>{ const note=m.querySelector('#pN').value.trim(); if(!note){ toast('Say how it was paid'); return; } close(); recordSale('other',pc,{note}); };
    }
  });
}
// Saved at once, even with no signal: Firestore keeps it on the device and sends it when the signal returns.
function recordSale(method,pc,extra){
  const d=openDay(); if(!d) return;
  const sale=Object.assign({id:SYNC.newId('sales'),sessionId:d.id,channel:d.type,date:nzDay(),at:Date.now(),
    lines:pc.lines,deals:pc.deals,subtotal:pc.subtotal,discount:pc.discount,total:pc.total,gst:Math.round(pc.total*3/23),
    method,by:SYNC.me(),servedBy:servedBy()||'',voided:false},extra);
  S.sales.push(sale); save();
  cart=[]; saveCart(); lastSale={id:sale.id,at:sale.at,total:sale.total};
  clearTimeout(undoTimer); undoTimer=setTimeout(()=>{ if(cur()==='sell') render(); },60.5e3);
  render(); toast('✓ Sale saved · '+c2(sale.total)+' '+PAY_TXT[method].replace(/^\S+ /,''));
}
function undoLast(){
  if(!lastSale||Date.now()-lastSale.at>=60e3){ toast('Too late to undo. Use Today\'s sales to void it (needs the PIN).'); render(); return; }
  const i=S.sales.findIndex(s=>s.id===lastSale.id); const s=S.sales[i];
  if(s){ cart=s.lines.map(l=>({pid:l.pid,qty:l.qty})); saveCart(); S.sales.splice(i,1); save(); }
  lastSale=null; render(); toast('Sale undone. The items are back in the sale.');
}

/* ---------- today's sales and voids ---------- */
function showDaySales(){
  const d=openDay(); if(!d) return;
  modal((m,close)=>{ const draw=()=>{ const list=daySales(d);
    m.innerHTML=`<h2>🧾 Sales so far</h2>${list.length?list.map(s=>`<div class="row ${s.voided?'voided':''}"><div class="grow"><b>${nzTime(s.at)} · ${c2(s.total)} ${PAY_TXT[s.method]||''}</b>
        <small>${esc(s.lines.map(l=>l.qty+'× '+l.name+(l.size?' '+l.size:'')).join(', '))}${s.servedBy?' · '+esc(s.servedBy):''}${s.voided?' · VOIDED by '+esc(s.voidedBy||''):''}</small></div>
        ${s.voided?'':`<button class="btn danger small" data-void="${s.id}">Void</button>`}</div>`).join(''):'<p class="note">No sales yet.</p>'}
      <div class="mact"><button class="btn" id="dOk">Close</button></div>`;
    m.querySelector('#dOk').onclick=close;
    m.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>{ const s=S.sales.find(x=>x.id===b.dataset.void);
      ownerPin('void a sale',()=>confirmBox('Void this '+c2(s.total)+' sale?',s.method==='cash'?'Give back the cash, then tap Void.':s.method==='eftpos'?'Do the refund on the EFTPOS terminal, then tap Void.':'Refund it, then tap Void.','Void',()=>{
        Object.assign(s,{voided:true,voidedBy:SYNC.me(),voidedAt:Date.now()}); save(); draw(); toast('Voided'); },true)); });
  }; draw(); });
}

/* ---------- end of day ---------- */
function dayTotals(d){
  const all=daySales(d), ok=all.filter(s=>!s.voided), by=k=>ok.filter(s=>s.method===k).reduce((n,s)=>n+s.total,0);
  const units={}; ok.forEach(s=>s.lines.forEach(l=>{ const k=l.name+(l.size?' · '+l.size:''); units[k]=(units[k]||0)+l.qty; }));
  return {count:ok.length,total:ok.reduce((n,s)=>n+s.total,0),gst:ok.reduce((n,s)=>n+(s.gst||0),0),cash:by('cash'),eftpos:by('eftpos'),other:by('other'),
    discount:ok.reduce((n,s)=>n+(s.discount||0),0),units,voids:all.filter(s=>s.voided)};
}
function endDay(){
  const d=openDay(); if(!d) return; const t=dayTotals(d), expected=(d.float||0)+t.cash;
  modal((m,close)=>{ m.innerHTML=`<h2>🏁 End of the day</h2>
    <div class="eod"><div><span>Sales</span><b>${t.count}</b></div><div><span>Takings</span><b>${c2(t.total)}</b></div><div><span>GST included</span><b>${c2(t.gst)}</b></div><div><span>Deals given</span><b>${c2(t.discount)}</b></div></div>
    <div class="card" style="margin:12px 0"><div class="row"><div class="grow">💳 EFTPOS<small>Check against the terminal's settlement</small></div><b>${c2(t.eftpos)}</b></div>
      ${t.other?`<div class="row"><div class="grow">🔖 Other</div><b>${c2(t.other)}</b></div>`:''}
      <div class="row"><div class="grow">💵 Cash sales</div><b>${c2(t.cash)}</b></div>
      <div class="row"><div class="grow">Cash expected in the tin<small>Float ${c2(d.float)} + cash sales</small></div><b>${c2(expected)}</b></div>
      <label class="note" for="eC">Count the cash in the tin</label><input class="txt" id="eC" inputmode="decimal" placeholder="e.g. 412.50"><p class="change" id="eDiff">Count the tin, then type the total.</p></div>
    ${t.voids.length?`<p class="note"><b>${t.voids.length} voided sale${t.voids.length>1?'s':''}:</b> ${t.voids.map(s=>c2(s.total)+' at '+nzTime(s.at)).join(', ')}</p>`:''}
    <details><summary class="note">Units sold by product</summary>${Object.entries(t.units).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="row"><div class="grow">${esc(k)}</div><b>${v}</b></div>`).join('')||'<p class="note">None</p>'}</details>
    <div class="mact"><button class="btn alt" id="eK">Keep selling</button><button class="btn" id="eX">Close the day</button></div>`;
    const inp=m.querySelector('#eC'), out=m.querySelector('#eDiff');
    inp.oninput=()=>{ const c=toCents(inp.value); if(!(c>=0)){ out.className='change'; out.textContent='Count the tin, then type the total.'; return; } const diff=c-expected;
      out.className='change '+(diff===0?'ok':'bad'); out.innerHTML=diff===0?'✓ The cash is right':(diff>0?'Over by <b>'+c2(diff)+'</b>':'Short by <b>'+c2(-diff)+'</b>'); };
    m.querySelector('#eK').onclick=close;
    m.querySelector('#eX').onclick=()=>{ const c=toCents(inp.value); if(!(c>=0)){ toast('Type the cash you counted first'); inp.focus(); return; }
      Object.assign(d,{status:'closed',closedAt:Date.now(),closedBy:SYNC.me(),countedCash:c,expectedCash:expected,totals:{count:t.count,total:t.total,gst:t.gst,cash:t.cash,eftpos:t.eftpos,other:t.other}});
      save(); close(); cart=[]; saveCart(); lsSet('rs.tillMode',null); lastSale=null; keepAwake(false); stack=['home']; render(); toast('Day closed · '+c2(t.total)+' taken'); };
  });
}

/* ---------- keep the screen on while the till is open ---------- */
let wake=null;
function keepAwake(on){
  try{ if(on&&!wake&&navigator.wakeLock) navigator.wakeLock.request('screen').then(w=>{ wake=w; w.addEventListener('release',()=>{ wake=null; }); }).catch(()=>{});
       if(!on&&wake){ wake.release(); wake=null; } }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&cur()==='sell'&&openDay()) keepAwake(true); });
