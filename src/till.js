/* ================= The till =================
   Two taps per sale: tap the products, tap how they paid. The app does every sum, prices are locked,
   deals apply by themselves, and anything that changes money (a discount, an item that isn't on the till,
   correcting or voiding a sale, seeing the sales, ending the day) needs an owner's or manager's own PIN,
   which is written to the approvals log with who approved it and when. Helpers never see the takings. */
const nzDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(d||new Date());   // 2026-11-07
const nzTime=t=>new Intl.DateTimeFormat('en-NZ',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(t));
const DAY_TYPES={market:'🧺 Market',farmgate:'🚪 Farm gate',tour:'🌿 Garden tour',shop:'🏪 Shop'};
const PAY_TXT={cash:'💵 Cash',eftpos:'💳 EFTPOS',other:'🔖 Other'};
const c2=c=>money((c||0)/100);
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
let tillFilter=lsGet('rs.filter','all');
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
      ${helper?'':`<button class="btn alt" id="tEnd">🏁 End the day <span class="lk">🔒</span></button>`}</div>
    <div class="filters">${cats.length>1?[['all','All',all.length]].concat(cats.map(k=>[k,COLOURS[k][3],all.filter(p=>(p.colour||'other')===k).length])).map(([k,label,n])=>
      `<button class="fchip ${tillFilter===k?'on':''}" data-f="${k}" style="${k==='all'?'':`--c:${COLOURS[k][0]}`}">${k==='all'?'':'<i></i>'}${esc(label)} <small>${n}</small></button>`).join(''):''}</div>
    <div class="till">
    <section class="tgrid">${shown.map(p=>{ const k=COLOURS[p.colour]||COLOURS.other; return `<button class="ptile" data-add="${p.id}" style="background:${k[0]};color:${k[1]}">
        ${qty[p.id]?`<span class="pq">${qty[p.id]}</span>`:''}<span class="pc">${esc(k[2])}</span><span class="pn">${esc(p.name)}</span><span class="ps">${esc(p.size||'')}</span><span class="pp">${c2(p.price)}</span></button>`; }).join('')}
      <button class="ptile extra" id="tExtra"><span class="pc">🔒 Needs a PIN</span><span class="pn">＋ Item not on the till</span><span class="ps">One-off, or add it for next time</span></button></section>
    <aside class="cart" id="cart">
      ${correcting?`<div class="corr">✏️ Correcting the ${c2(correcting.total)} sale from ${nzTime(correcting.at)}. When you take payment, the old sale is voided and replaced. <button class="linkb" id="cCorrX">Cancel correction</button></div>`:''}
      <div class="clines">${pc.lines.length?pc.lines.map(l=>`<div class="cl"><div class="grow"><b>${esc(l.name)}</b><small>${esc(l.size)}${l.size?' · ':''}${c2(l.unit)} each${l.custom?' · not on the till':''}</small></div>
          <button class="qb" data-dec="${l.pid}" aria-label="One less">−</button><b class="qn">${l.qty}</b><button class="qb" data-inc="${l.pid}" aria-label="One more">＋</button><b class="la">${c2(l.amount)}</b></div>`).join('')
        +pc.deals.map(d=>`<div class="cl deal"><div class="grow"><b>🎁 ${esc(d.name)}${d.times>1?' ×'+d.times:''}</b></div><b class="la">−${c2(d.saving)}</b></div>`).join('')
        +(pc.manual?`<div class="cl deal"><div class="grow"><b>🏷️ Discount ${pc.manual.kind==='pct'?pc.manual.value+'%':c2(pc.manual.value)}</b><small>${esc(pc.manual.reason)} · approved by ${esc(personName(pc.manual.approvedBy))}</small></div><button class="qb" id="cDiscX" aria-label="Remove discount">✕</button><b class="la">−${c2(pc.manual.amount)}</b></div>`:'')
        :`<p class="note cempty">Tap a product to start a sale.</p>`}</div>
      <div class="ctot"><span>${cartCount()} item${cartCount()===1?'':'s'}${pc.lines.length?` · <button class="linkb" id="cClear">Clear</button>${pc.manual?'':` · <button class="linkb" id="cDisc" style="color:var(--green)">🏷️ Discount 🔒</button>`}`:''}</span><b id="cTotal">${c2(pc.total)}</b></div>
      <div class="pay">${['cash','eftpos','other'].map(k=>`<button class="pb ${k}" data-pay="${k}" ${pc.total>0?'':'disabled'}>${PAY_TXT[k]}</button>`).join('')}</div>
    </aside></div>`;
}
function setQty(pid,d){ const c=cart.find(x=>x.pid===pid); if(c) c.qty+=d; else if(d>0) cart.push({pid,qty:d}); cart=cart.filter(x=>x.qty>0); if(!cart.length) cartDisc=null; saveCart(); render(); }
function wireTill(){
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>setQty(b.dataset.add,1));
  document.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>setQty(b.dataset.inc,1));
  document.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>setQty(b.dataset.dec,-1));
  document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{ tillFilter=b.dataset.f; lsSet('rs.filter',tillFilter); render(); });
  const cl=$('#cClear'); if(cl) cl.onclick=()=>confirmBox('Clear this sale?','The items are taken off. Nothing has been charged.','Clear',()=>{ const c=correcting; cart=[]; cartDisc=null; saveCart(); render(); if(c) toast('Correction still open: add the right items, or cancel the correction'); });
  const cd=$('#cDisc'); if(cd) cd.onclick=giveDiscount;
  const cx=$('#cDiscX'); if(cx) cx.onclick=()=>{ cartDisc=null; saveCart(); render(); };
  const cc=$('#cCorrX'); if(cc) cc.onclick=()=>confirmBox('Cancel the correction?','The original sale stays as it was.','Cancel correction',()=>{ clearCart(); render(); });
  $('#tExtra').onclick=addExtraItem;
  document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>pay(b.dataset.pay));
  const u=$('#tUndo'); if(u) u.onclick=undoLast;
  const tl=$('#tList'); if(tl) tl.onclick=()=>approve('see the sales',who=>showDaySales(who));
  const lk=$('#tLock'); if(lk) lk.onclick=handToHelper;
  const ul=$('#tUnlock'); if(ul) ul.onclick=()=>approve('leave till mode',()=>{ lsSet('rs.tillMode',null); render(); toast('Till mode off'); });
  $('#tWho').onclick=()=>{ if(tillLock()){ toast('In till mode. Leave till mode to change who is serving.'); return; } pickServer(()=>render()); };
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
        approve('give a discount',who=>{ cartDisc={kind,value,reason,approvedBy:who,at:Date.now()}; saveCart(); render(); toast('Discount approved by '+personName(who)); },label); };
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

/* ---------- taking payment ---------- */
function pay(method){
  const pc=priceCart(cart,cartDisc); if(pc.total<=0) return;
  const was=correcting, diff=was?pc.total-was.total:0;
  const corrNote=was?`<p class="change ${diff>0?'bad':'ok'}" style="font-size:17px">Correcting a ${c2(was.total)} ${PAY_TXT[was.method]?PAY_TXT[was.method].replace(/^\S+ /,''):''} sale. ${diff>0?'The customer owes <b>'+c2(diff)+'</b> more.':diff<0?'Give the customer back <b>'+c2(-diff)+'</b>.':'Same total as before.'}${was.method==='eftpos'&&method!=='eftpos'||(was.method!=='eftpos'&&method==='eftpos')?' The payment method has changed: refund or charge on the terminal as needed.':''}</p>`:'';
  modal((m,close)=>{ let tendered=0;
    if(method==='cash'){
      const draw=()=>{ const change=tendered-pc.total, enough=tendered>=pc.total;
        m.innerHTML=`<h2>💵 Cash · ${c2(pc.total)}</h2>${corrNote}<p class="note">Tap the notes and coins you were handed.</p>
          <div class="notes">${[500,1000,2000,5000,10000].map(v=>`<button data-v="${v}">${c2(v).replace('.00','')}</button>`).join('')}<button data-v="exact" class="exact">Exact</button></div>
          <div class="change ${enough?'ok':''}">${tendered?`Handed <b>${c2(tendered)}</b> · `:''}${!tendered?'Nothing tapped yet':enough?`Change <b class="big">${c2(change)}</b>`:`Still to pay <b>${c2(-change)}</b>`}</div>
          <div class="mact">${tendered?'<button class="btn alt" id="pR">Start again</button>':''}<button class="btn alt" id="pC">Cancel</button><button class="btn" id="pOk" ${enough?'':'disabled'}>Done</button></div>`;
        m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{ tendered=b.dataset.v==='exact'?pc.total:tendered+(+b.dataset.v); draw(); });
        const r=m.querySelector('#pR'); if(r) r.onclick=()=>{ tendered=0; draw(); };
        m.querySelector('#pC').onclick=close;
        m.querySelector('#pOk').onclick=()=>{ close(); recordSale('cash',pc,{tendered,change:tendered-pc.total}); };
      }; draw();
    } else if(method==='eftpos'){
      m.innerHTML=`<h2>💳 EFTPOS · ${c2(pc.total)}</h2>${corrNote}<p style="font-size:21px">Put <b>${c2(was?Math.max(0,diff):pc.total)}</b> through the EFTPOS terminal${was&&diff<=0?' (nothing more to charge)':''}.</p><p class="note">Only tap Approved once the terminal says it went through.</p>
        <div class="mact"><button class="btn alt" id="pC">Declined / cancel</button><button class="btn" id="pOk">✓ Approved</button></div>`;
      m.querySelector('#pC').onclick=close; m.querySelector('#pOk').onclick=()=>{ close(); recordSale('eftpos',pc,{}); };
    } else {
      m.innerHTML=`<h2>🔖 Other · ${c2(pc.total)}</h2>${corrNote}<label class="note">How was it paid? (e.g. bank transfer, voucher)</label><input class="txt" id="pN">
        <div class="mact"><button class="btn alt" id="pC">Cancel</button><button class="btn" id="pOk">Record sale</button></div>`;
      m.querySelector('#pC').onclick=close; m.querySelector('#pOk').onclick=()=>{ const note=m.querySelector('#pN').value.trim(); if(!note){ toast('Say how it was paid'); return; } close(); recordSale('other',pc,{note}); };
    }
  });
}
// Saved at once, even with no signal: Firestore keeps it on the device and sends it when the signal returns.
function recordSale(method,pc,extra){
  const d=openDay(); if(!d) return;
  const sale=Object.assign({id:SYNC.newId('sales'),sessionId:d.id,channel:d.type,date:nzDay(),at:Date.now(),
    lines:pc.lines,deals:pc.deals,manualDiscount:pc.manual||null,subtotal:pc.subtotal,discount:pc.discount,total:pc.total,gst:Math.round(pc.total*3/23),
    method,by:SYNC.me(),servedBy:servedBy()||'',voided:false},extra);
  if(correcting){ const old=S.sales.find(s=>s.id===correcting.id);
    sale.replaces=correcting.id; sale.correctedBy=correcting.approvedBy;
    if(old&&!old.voided) Object.assign(old,{voided:true,voidedBy:correcting.approvedBy,voidedAt:Date.now(),voidReason:'corrected',replacedBy:sale.id}); }
  const wasCorr=!!correcting;
  S.sales.push(sale); save();
  clearCart(); lastSale=wasCorr?null:{id:sale.id,at:sale.at,total:sale.total};
  clearTimeout(undoTimer); undoTimer=setTimeout(()=>{ if(cur()==='sell') render(); },60.5e3);
  render(); toast((wasCorr?'✓ Corrected sale saved · ':'✓ Sale saved · ')+c2(sale.total)+' '+PAY_TXT[method].replace(/^\S+ /,''));
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
        <small>${esc(s.lines.map(l=>l.qty+'× '+l.name+(l.size?' '+l.size:'')).join(', '))}${s.manualDiscount?' · discount '+c2(s.manualDiscount.amount):''}${s.servedBy?' · '+esc(s.servedBy):''}${s.replaces?' · corrected sale':''}${s.voided?' · '+(s.voidReason==='corrected'?'CORRECTED':'VOIDED')+' by '+esc(personName(s.voidedBy)):''}</small></div>
        ${s.voided?'':`<button class="btn alt small" data-corr="${s.id}">Correct</button><button class="btn danger small" data-void="${s.id}">Void</button>`}</div>`).join(''):'<p class="note">No sales yet.</p>'}
      <div class="mact"><button class="btn" id="dOk">Close</button></div>`;
    m.querySelector('#dOk').onclick=close;
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

/* ---------- end of day (with a PIN) ---------- */
function dayTotals(d){
  const all=daySales(d), ok=all.filter(s=>!s.voided), by=k=>ok.filter(s=>s.method===k).reduce((n,s)=>n+s.total,0);
  const units={}; ok.forEach(s=>s.lines.forEach(l=>{ const k=l.name+(l.size?' · '+l.size:''); units[k]=(units[k]||0)+l.qty; }));
  return {count:ok.length,total:ok.reduce((n,s)=>n+s.total,0),gst:ok.reduce((n,s)=>n+(s.gst||0),0),cash:by('cash'),eftpos:by('eftpos'),other:by('other'),
    discount:ok.reduce((n,s)=>n+(s.discount||0),0),units,voids:all.filter(s=>s.voided&&s.voidReason!=='corrected'),corrections:all.filter(s=>s.voidReason==='corrected').length};
}
function endDay(approver){
  const d=openDay(); if(!d) return; const t=dayTotals(d), expected=(d.float||0)+t.cash;
  modal((m,close)=>{ m.innerHTML=`<h2>🏁 End of the day</h2><p class="note">Opened with ${esc(personName(approver))}'s PIN.</p>
    <div class="eod"><div><span>Sales</span><b>${t.count}</b></div><div><span>Takings</span><b>${c2(t.total)}</b></div><div><span>GST included</span><b>${c2(t.gst)}</b></div><div><span>Deals and discounts</span><b>${c2(t.discount)}</b></div></div>
    <div class="card" style="margin:12px 0"><div class="row"><div class="grow">💳 EFTPOS<small>Check against the terminal's settlement</small></div><b>${c2(t.eftpos)}</b></div>
      ${t.other?`<div class="row"><div class="grow">🔖 Other</div><b>${c2(t.other)}</b></div>`:''}
      <div class="row"><div class="grow">💵 Cash sales</div><b>${c2(t.cash)}</b></div>
      <div class="row"><div class="grow">Cash expected in the tin<small>Float ${c2(d.float)} + cash sales</small></div><b>${c2(expected)}</b></div>
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
      Object.assign(d,{status:'closed',closedAt:Date.now(),closedBy:SYNC.me(),closeApprovedBy:approver,countedCash:c,expectedCash:expected,totals:{count:t.count,total:t.total,gst:t.gst,cash:t.cash,eftpos:t.eftpos,other:t.other}});
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
