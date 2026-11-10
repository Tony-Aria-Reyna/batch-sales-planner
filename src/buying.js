/* ================= Stock warnings and buying from suppliers =================
   "Warn me at" levels for products and ingredients. Each ingredient can have its supplier's email or web
   page; the shopping list is grouped by supplier with "Draft order email" (copied to the main owner) or
   "Order online". An unsent draft becomes a to-do that reopens it; a sent order shows as "on order" in
   Stock with when it's due, and "Arrived" checks each item and amount and puts them into stock. */
const suppliedBy=x=>{ const i=x.input?S.inputs.find(y=>y.id===x.input):S.inputs.find(y=>(y.name||'').toLowerCase()===(x.item||'').toLowerCase());
  if(i&&i.supplier&&!x.shop) return {key:i.supplier.trim().toLowerCase(),name:i.supplier.trim(),email:i.supplierEmail||'',link:i.supplierLink||''};
  if(x.shop){ const s=supplierInfo(x.shop); return Object.assign({key:x.shop},s,{name:(S.settings.shopNames||{})[x.shop]||s.name}); } return null; };
// a supplier's details from any ingredient that has them
function supplierInfo(key){ const l=S.inputs.filter(i=>(i.supplier||'').trim().toLowerCase()===key);
  return {name:(l[0]||{}).supplier||(S.settings.shopNames||{})[key]||key,email:(l.find(i=>i.supplierEmail)||{}).supplierEmail||'',link:(l.find(i=>i.supplierLink)||{}).supplierLink||''}; }
const orderItems=oid=>S.shopping.filter(x=>x.ordered&&x.ordered.id===oid);
const lineTxt=x=>[x.qty&&x.qty!=1?x.qty+' ×':'',x.item,x.size||''].filter(Boolean).join(' ');

/* ---------- the shopping list, grouped by supplier (owners and managers) ---------- */
function shopGroupsHtml(want,row){
  const groups={}; want.forEach(x=>{ const s=suppliedBy(x), k=s?s.key:''; (groups[k]=groups[k]||[]).push(x); });
  const keys=Object.keys(groups).sort((a,b)=>(a===''?1:0)-(b===''?1:0)||a.localeCompare(b));
  return keys.map(k=>{ const l=groups[k], si=k?supplierInfo(k):null, todo=l.filter(x=>!x.ordered||x.ordered.status==='drafted');
    const st=x=>x.ordered?(x.ordered.status==='sent'?'🚚 on order'+(x.ordered.eta?', due '+nzDate(kd(x.ordered.eta),{weekday:'short',day:'numeric',month:'short'}):''):'✉️ draft not sent yet'):'';
    return `<div class="card"><h3>${k?'🏪 '+esc(si.name):'Other'}</h3>
      ${l.map(x=>row(x).replace('</small>',(st(x)?(x.by&&x.by!==SYNC.me()?' · ':'')+'<span class="ordst">'+esc(st(x))+'</span>':'')+'</small>')).join('')}
      ${k&&todo.length?`<div class="mact" style="justify-content:flex-start">${si.email?`<button class="btn small" data-draft="${esc(k)}">✉️ Draft order email</button>`:''}${si.link?`<button class="btn ${si.email?'alt ':''}small" data-online="${esc(k)}">🔗 Order online</button>`:''}${!si.email&&!si.link?`<button class="btn alt small" data-supedit="${esc(k)}">Add their email or website</button>`:''}</div>`:''}</div>`; }).join('');
}
function wireShopGroups(){
  document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=()=>draftOrder(b.dataset.draft,'email'));
  document.querySelectorAll('[data-online]').forEach(b=>b.onclick=()=>draftOrder(b.dataset.online,'online'));
  document.querySelectorAll('[data-supedit]').forEach(b=>b.onclick=()=>{ const i=S.inputs.find(y=>(y.supplier||'').trim().toLowerCase()===b.dataset.supedit); if(i) editInput(i,()=>render()); });
}
function orderMail(oid){
  const l=orderItems(oid), s=supplierInfo(l[0].ordered.supplier), main=SYNC.getMainOwner(), me=SYNC.me(), my=personName(me);
  const body=`Kia ora ${s.name},\n\nPlease could we order:\n${l.map(x=>'- '+lineTxt(x)).join('\n')}\n\n${S.settings.homeAddress?'Deliver to: '+S.settings.homeAddress+'\n\n':''}Please let us know when it will arrive.\n\nThanks,\n${my}\n${S.name||'Rata & Smudge'}`;
  return 'mailto:'+encodeURIComponent(s.email)+'?'+(main&&main!==me?'cc='+encodeURIComponent(main)+'&':'')+'subject='+encodeURIComponent('Order from '+(S.name||'Rata & Smudge'))+'&body='+encodeURIComponent(body);
}
let openLink=u=>{ if(/^mailto:/.test(u)) location.href=u; else window.open(u,'_blank','noopener'); };
function draftOrder(key,how){
  const s=supplierInfo(key), l=S.shopping.filter(x=>!x.done&&(!x.ordered||x.ordered.status==='drafted')&&(suppliedBy(x)||{}).key===key); if(!l.length) return;
  const old=l.find(x=>x.ordered), oid=old?old.ordered.id:'o'+Date.now().toString(36);
  l.forEach(x=>x.ordered={id:oid,status:'drafted',how,supplier:key,at:Date.now()}); save(); render();
  openLink(how==='email'?orderMail(oid):s.link);
  setTimeout(()=>askSent(oid),900);
}
function reopenOrder(oid){ const l=orderItems(oid); if(!l.length){ toast('That order is no longer on the list'); return; }
  const o=l[0].ordered, s=supplierInfo(o.supplier); openLink(o.how==='online'?s.link:orderMail(oid)); setTimeout(()=>askSent(oid),900); }
function askSent(oid){
  const l=orderItems(oid); if(!l.length) return; const o=l[0].ordered, s=supplierInfo(o.supplier), online=o.how==='online';
  modal((m,close)=>{ const eta=dk(addDays(kd(nzDay()),5));
    m.innerHTML=`<h2>${online?'Did you order it?':'Did you send it?'}</h2><p class="note">${online?'Your order on '+esc(s.name)+'\'s website':'The order email to '+esc(s.name)}: ${l.length} item${l.length===1?'':'s'}.</p>
      <label class="note" for="oEta">When should it arrive?</label><input class="txt" id="oEta" type="date" value="${eta}">
      <div class="mact"><button class="btn alt" id="oNo">Not yet</button><button class="btn" id="oYes">${online?'Yes, ordered':'Yes, sent'}</button></div>`;
    m.querySelector('#oNo').onclick=()=>{ const ex=S.todos.find(t=>t.order===oid&&!t.done);
      if(!ex) S.todos.push({id:SYNC.newId('todos'),text:(online?'Order from ':'Send the order to ')+s.name,who:SYNC.me(),done:false,due:nzDay(),by:SYNC.me(),at:Date.now(),order:oid});
      save(); close(); render(); toast('Added to your to-dos: tap it to pick up where you left off'); };
    m.querySelector('#oYes').onclick=()=>{ const e=m.querySelector('#oEta').value||eta; l.forEach(x=>Object.assign(x.ordered,{status:'sent',sentAt:Date.now(),eta:e}));
      S.todos.filter(t=>t.order===oid&&!t.done).forEach(t=>{ t.done=true; t.doneAt=Date.now(); t.doneBy=SYNC.me(); });
      save(); close(); render(); toast('On order · due '+nzDate(kd(e),{weekday:'short',day:'numeric',month:'short'})); };
  });
}

/* ---------- on order, in Stock ---------- */
function onOrderGroups(){ const g={}; S.shopping.filter(x=>!x.done&&x.ordered&&x.ordered.status==='sent').forEach(x=>{ (g[x.ordered.id]=g[x.ordered.id]||[]).push(x); }); return Object.values(g); }
function onOrderHtml(){
  if(!canManage()) return ''; const gs=onOrderGroups(); if(!gs.length) return '';
  return `<div class="card"><h3>🚚 On order</h3>${gs.map(l=>{ const o=l[0].ordered, late=o.eta&&o.eta<nzDay();
    return `<div class="lrow"><div class="grow ltxt"><b>${esc(supplierInfo(o.supplier).name)}</b><small>${late?'⚠️ was due ':'due '}${o.eta?esc(nzDate(kd(o.eta),{weekday:'short',day:'numeric',month:'short'})):'(no date)'} · ${esc(l.map(lineTxt).join(', '))}</small></div><button class="btn small" data-arrived="${o.id}">📦 Arrived</button></div>`; }).join('')}</div>`;
}
function arrived(oid){
  const l=orderItems(oid).filter(x=>!x.done); if(!l.length) return;
  modal((m,close)=>{ m.innerHTML=`<h2>📦 ${esc(supplierInfo(l[0].ordered.supplier).name)}: what arrived?</h2><p class="note">Untick anything that didn't come, and change any amount that's different. It goes into stock.</p>
      ${l.map(x=>`<div class="arrow"><label class="tickrow"><input type="checkbox" data-arr="${x.id}" checked><b>${esc(x.item)}</b></label>
        <div class="formrow"><div><label class="note">How many</label><input class="txt" data-aq="${x.id}" inputmode="decimal" value="${x.qty||1}"></div><div><label class="note">Size</label><input class="txt" data-as="${x.id}" value="${esc(x.size||'')}"></div></div>
        ${canManage()?`<label class="note">Price paid, total (optional)</label><input class="txt" data-ap="${x.id}" inputmode="decimal" placeholder="e.g. 24.90">`:''}</div>`).join('')}
      <div class="mact"><button class="btn alt" id="aC">Cancel</button><button class="btn" id="aOk">✓ Into stock</button></div>`;
    m.querySelector('#aC').onclick=close;
    m.querySelector('#aOk').onclick=()=>{ let n=0, bad=false;
      l.forEach(x=>{ if(!m.querySelector(`[data-arr="${x.id}"]`).checked) return; const q=+m.querySelector(`[data-aq="${x.id}"]`).value.replace(/[^0-9.]/g,'')||1, sz=m.querySelector(`[data-as="${x.id}"]`).value.trim().slice(0,40);
        const pe=m.querySelector(`[data-ap="${x.id}"]`), pt=pe?pe.value.trim():'', cents=pt?toCents(pt):0; if(pt&&!(cents>=0)){ bad=true; return; }
        Object.assign(x,{done:true,doneAt:Date.now(),doneBy:SYNC.me(),gotQty:q,gotSize:sz}); x.ordered.status='arrived'; n++;
        const inp=x.input?S.inputs.find(i=>i.id===x.input):S.inputs.find(i=>(i.name||'').toLowerCase()===(x.item||'').toLowerCase());
        if(inp&&inputStock(inp.id)!=null) moveStock({kind:'bought',input:inp.id,qty:q*(inp.pack||0)});
        if(cents) S.prices.push({id:SYNC.newId('prices'),input:inp?inp.id:'',item:x.item,size:sz,qty:q,cents,at:Date.now(),date:nzDay(),by:SYNC.me(),from:'order'}); });
      if(bad){ toast('Type the price, e.g. 24.90'); return; }
      save(); close(); render(); toast(n?n+' item'+(n===1?'':'s')+' into stock':'Nothing ticked'); }; },{big:true});
}

/* ---------- running low ---------- */
function lowProducts(){ return S.products.filter(p=>p.active!==false&&p.warnAt>0).map(p=>({p,st:stockOf(p.id)})).filter(x=>x.st&&x.st.total<=x.p.warnAt); }
function lowInputs(){ return S.inputs.filter(i=>i.warnAt>0).map(i=>({i,n:inputStock(i.id)})).filter(x=>x.n!=null&&x.n<=x.i.warnAt); }
const onListOrOrder=i=>S.shopping.some(x=>!x.done&&(x.input===i.id||(x.item||'').toLowerCase()===(i.name||'').toLowerCase()));
function addToShopping(i){ if(onListOrOrder(i)) return false; S.shopping.push({id:SYNC.newId('shopping'),item:i.name,qty:1,size:i.pack?fmtQty(i.pack,i.unit):'',input:i.id,done:false,by:SYNC.me(),at:Date.now()}); return true; }
function lowHtml(){
  if(!canManage()) return ''; const lp=lowProducts(), li=lowInputs(); if(!lp.length&&!li.length) return '';
  return `<div class="card lowcard"><h3>⚠️ Running low</h3>${lp.map(x=>`<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(x.p))}</b><small>${x.st.total} left · warn at ${x.p.warnAt}</small></div><button class="btn alt small" data-lowbrew="1">Plan a brew</button></div>`).join('')}
    ${li.map(x=>`<div class="lrow"><div class="grow ltxt"><b>${esc(x.i.name)}</b><small>${fmtQty(x.n,x.i.unit)} left · warn at ${fmtQty(x.i.warnAt,x.i.unit)}</small></div>${onListOrOrder(x.i)?'<small class="note">on the list</small>':`<button class="btn alt small" data-lowshop="${x.i.id}">＋ Shopping list</button>`}</div>`).join('')}</div>`;
}
function wireLow(){
  document.querySelectorAll('[data-lowbrew]').forEach(b=>b.onclick=()=>{ brewTab='next'; lsSet('rs.brewtab','next'); render(); });
  document.querySelectorAll('[data-lowshop]').forEach(b=>b.onclick=()=>{ const i=S.inputs.find(x=>x.id===b.dataset.lowshop); if(i&&addToShopping(i)){ save(); render(); toast('On the shopping list'); } });
  document.querySelectorAll('[data-arrived]').forEach(b=>b.onclick=()=>arrived(b.dataset.arrived));
  const w=$('#sWarn'); if(w) w.onclick=warnLevels;
}
// one place to set every "warn me at" level
function warnLevels(){
  const prods=S.products.filter(p=>p.active!==false).sort((a,b)=>prodName(a).localeCompare(prodName(b))), ins=S.inputs.filter(i=>inputStock(i.id)!=null).sort((a,b)=>a.name.localeCompare(b.name));
  modal((m,close)=>{ m.innerHTML=`<h2>⚠️ Warn me at</h2><p class="note">When stock gets down to this, it shows under Running low, on the home screen's to-do ideas and in the morning briefing. Leave empty for no warning.</p>
      <h3>Products (units)</h3>${prods.map(p=>`<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(p))}</b><small>${(stockOf(p.id)||{}).total??'–'} now</small></div><input class="txt qty" type="number" min="0" data-wp="${p.id}" value="${p.warnAt||''}" placeholder="–"></div>`).join('')||'<p class="note">No products yet.</p>'}
      <h3>Ingredients and packaging</h3>${ins.map(i=>`<div class="lrow"><div class="grow ltxt"><b>${esc(i.name)}</b><small>${fmtQty(inputStock(i.id),i.unit)} now</small></div><input class="txt qty" type="number" min="0" step="any" data-wi="${i.id}" value="${i.warnAt||''}" placeholder="${esc(i.unit)}"></div>`).join('')||'<p class="note">Only ingredients whose stock you track are listed (type "How much you have now" on the ingredient).</p>'}
      <div class="mact"><button class="btn alt" id="wC">Cancel</button><button class="btn" id="wOk">Save</button></div>`;
    m.querySelector('#wC').onclick=close;
    m.querySelector('#wOk').onclick=()=>{ m.querySelectorAll('[data-wp]').forEach(x=>{ const p=S.products.find(y=>y.id===x.dataset.wp), v=+x.value; if(p) p.warnAt=v>0?Math.round(v):0; });
      m.querySelectorAll('[data-wi]').forEach(x=>{ const i=S.inputs.find(y=>y.id===x.dataset.wi), v=+x.value; if(i) i.warnAt=v>0?v:0; });
      save(); close(); render(); toast('Saved'); }; },{big:true});
}
// for the action plans: stock and orders that need doing
function stockIdeas(){
  if(!canManage()) return []; const out=[];
  lowProducts().forEach(x=>out.push({score:x.st.total<=0?85:65,t:'Make more '+prodName(x.p),d:(x.st.total<=0?'None left':x.st.total+' left')+' (you asked to be warned at '+x.p.warnAt+').',lbl:'Plan a brew',go:'brew:next',act:()=>{ brewTab='next'; lsSet('rs.brewtab','next'); go('brew'); }}));
  lowInputs().filter(x=>!onListOrOrder(x.i)).forEach(x=>out.push({score:60,t:'Buy '+x.i.name,d:fmtQty(x.n,x.i.unit)+' left (warn at '+fmtQty(x.i.warnAt,x.i.unit)+').',lbl:'Add to the list',go:'lists:shop',act:()=>{ addToShopping(x.i); save(); listTab='shop'; lsSet('rs.listtab','shop'); go('lists'); toast('On the shopping list'); }}));
  const drafts={}; S.shopping.filter(x=>!x.done&&x.ordered&&x.ordered.status==='drafted').forEach(x=>drafts[x.ordered.id]=x.ordered);
  Object.values(drafts).forEach(o=>out.push({score:70,t:'Send the order to '+supplierInfo(o.supplier).name,d:'The draft hasn\'t been sent yet.',lbl:'Open the draft',go:'lists:shop',act:()=>reopenOrder(o.id)}));
  onOrderGroups().filter(l=>l[0].ordered.eta&&l[0].ordered.eta<nzDay()).forEach(l=>{ const o=l[0].ordered, s=supplierInfo(o.supplier);
    out.push({score:55,t:'Chase '+s.name,d:'Your order was due '+nzDate(kd(o.eta),{weekday:'short',day:'numeric',month:'short'})+'. Arrived? Tick it off in Stock.',lbl:'See the order',go:'brew:stock',act:()=>{ brewTab='stock'; lsSet('rs.brewtab','stock'); go('brew'); }}); });
  return out;
}
