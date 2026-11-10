/* ================= Orders: wholesale, custom and Shopify =================
   Owners and managers only (orders hold customers' names and addresses; helpers never see them).
   Shopify orders are copied in by the business helper every 15 minutes (one-way; the app never changes
   Shopify). Wholesale and custom orders are added here, or from a voice note.
   Each order moves New → Packed → Sent. Stock comes off when it's packed (or as soon as Shopify says it was
   sent, if nobody packed it in the app). The send-by date shows on the Calendar.
   Prices: retail prices include GST, as on the till; a product's wholesale price is also kept GST-inclusive,
   and shown ex GST where that's what shops expect. */
const ORDER_SOURCES={shopify:'🛍️ Shopify',wholesale:'🚚 Wholesale',custom:'✍️ Custom',consign:'🤝 Consignment'};
const ORDER_STATUS={check:'📥 Check it',new:'New',packed:'Packed',sent:'Sent',cancelled:'Cancelled'};
let orderTab=lsGet('rs.ordertab','open');
const orderUnits=o=>(o.lines||[]).reduce((n,l)=>n+(+l.qty||0),0);
const orderTotal=o=>(o.lines||[]).reduce((n,l)=>n+(+l.qty||0)*(+l.unit||0),0)-(o.discount||0)+(o.shipping||0);
const openOrders=()=>S.orders.filter(o=>o.status==='check'||o.status==='new'||o.status==='packed');
const emailOrders=()=>S.orders.filter(o=>o.status==='check');
const dueLabel=o=>o.due?(o.due<nzDay()&&o.status!=='sent'?'⚠️ was due ':'due ')+nzDate(kd(o.due),{weekday:'short',day:'numeric',month:'short'}):'no date';

SCREENS.orders={
  title:()=>({h:'Orders',s:'Wholesale, custom and Shopify'}),
  html(){
    if(missingCols.has('orders')) return rulesNotice();
    const tabs=[['open','To do ('+openOrders().length+')'],['sent','Sent'],['all','All'],['shops','🏪 Shops'+(overdueOrders().length?' ⚠️':'')]];
    if(orderTab==='shops') return `<div class="ctabs">${tabs.map(([k,v])=>`<button class="chip big ${orderTab===k?'on':''}" data-ot="${k}">${v}</button>`).join('')}</div>${shopsHtml()}`;
    let l=orderTab==='open'?openOrders():orderTab==='sent'?S.orders.filter(o=>o.status==='sent'):S.orders.slice();
    l=l.sort((a,b)=>orderTab==='open'?((a.due||'9')+a.at).localeCompare((b.due||'9')+b.at):(b.at||0)-(a.at||0)).slice(0,100);
    const sh=S.settings.shopifyShop, st=S.shopifyHelper;
    return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="oNew">＋ New order</button></div>
        ${emailOrders().length?`<p class="note"><b>📥 ${emailOrders().length} order${emailOrders().length===1?'':'s'} from email to check.</b> Nothing is final until you press Confirm.</p>`:''}
        <p class="note">${sh?`🛍️ Shopify (${esc(sh)}): ${st&&st.lastRun?'checked '+agoText(st.lastRun)+(st.error?' · ⚠️ '+esc(st.error):''):'waiting for the business helper to be set up'}`:'Shopify isn\'t connected yet (Setup → Shopify).'}</p></div>
      <div class="ctabs">${tabs.map(([k,v])=>`<button class="chip big ${orderTab===k?'on':''}" data-ot="${k}">${v}</button>`).join('')}</div>
      <div class="card">${l.length?l.map(o=>`<button class="orow" data-ord="${o.id}"><span class="grow"><b>${esc(o.customer&&o.customer.name||'Customer')}${o.shopify?' · '+esc(o.shopify.name||''):''}</b>
          <small>${o.fromEmail?'📥 From email · ':''}${ORDER_SOURCES[o.source]||''} · ${orderUnits(o)} item${orderUnits(o)===1?'':'s'} · ${c2(orderTotal(o))}${o.paid?' · paid':payDue(o)?(payDue(o)<nzDay()?' · ⚠️ payment overdue':' · payment due '+nzDate(kd(payDue(o)),{day:'numeric',month:'short'})):' · not paid'} · ${esc(dueLabel(o))}</small></span>
          <span class="ost ${o.status}">${ORDER_STATUS[o.status]||o.status}</span></button>`).join(''):'<p class="note">No orders here.</p>'}</div>`;
  },
  wire(){
    if(orderTab==='shops'){ document.querySelectorAll('[data-ot]').forEach(b=>b.onclick=()=>{ orderTab=b.dataset.ot; lsSet('rs.ordertab',orderTab); render(); }); wireShops(); return; }
    if(!$('#oNew')) return;
    $('#oNew').onclick=()=>editOrder({});
    document.querySelectorAll('[data-ot]').forEach(b=>b.onclick=()=>{ orderTab=b.dataset.ot; lsSet('rs.ordertab',orderTab); render(); });
    document.querySelectorAll('[data-ord]').forEach(b=>b.onclick=()=>openOrder(S.orders.find(o=>o.id===b.dataset.ord)));
  }
};
const agoText=t=>{ const m=Math.round((Date.now()-t)/60000); return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':nzDate(new Date(t),{day:'numeric',month:'short'}); };

/* ---------- one order ---------- */
function openOrder(o){
  if(!o) return;
  const unmatched=(o.lines||[]).filter(l=>!l.pid);
  modal((m,close)=>{ const draw=()=>{ const c=o.customer||{};
    m.innerHTML=`<h2>${ORDER_SOURCES[o.source]||''} ${esc(c.name||'Customer')}${o.shopify?' · '+esc(o.shopify.name||''):''}</h2>
      <p>${[c.email,c.phone,c.address].filter(Boolean).map(esc).join('<br>')}</p>
      ${o.status==='check'&&o.fromEmail?`<div class="card nudge"><b>📥 From email: check it</b><small>${esc(o.fromEmail.from||'')}${o.fromEmail.subject?' · “'+esc(o.fromEmail.subject)+'”':''}${o.fromEmail.ref?' · their ref '+esc(o.fromEmail.ref):''}</small>
        <small>The assistant read this from the email. Check the products and quantities against it, then Confirm.</small>${o.fromEmail.link?`<p><a class="linkb" href="${esc(o.fromEmail.link)}" target="_blank" rel="noopener">✉️ Open the email</a></p>`:''}</div>`:''}
      <p><b>${ORDER_STATUS[o.status]}</b> · ${esc(dueLabel(o))} · ${o.paid?'paid':payDue(o)?(payDue(o)<nzDay()?'⚠️ payment was due ':'payment due ')+nzDate(kd(payDue(o)),{weekday:'short',day:'numeric',month:'short'})+' ('+termsOf(o)+'-day terms)':'not paid'}</p>
      <div class="card packslip">${(o.lines||[]).map((l,i)=>`<div class="lrow"><b class="pqty">${l.qty} ×</b><div class="grow ltxt"><b>${esc(l.name)}</b><small>${c2(l.unit)} each${l.pid?'':' · not linked to a till product'}</small></div>${!l.pid&&o.status!=='sent'?`<button class="btn small alt" data-linkl="${i}">Link</button>`:''}</div>`).join('')}
        <p class="note">${o.discount?'Discount −'+c2(o.discount)+' · ':''}${o.shipping?'Shipping '+c2(o.shipping)+' · ':''}<b>Total ${c2(orderTotal(o))}</b> incl. GST ${c2(Math.round(orderTotal(o)*3/23))}</p></div>
      ${o.note?`<p class="note">📝 ${esc(o.note)}</p>`:''}
      ${unmatched.length&&o.status!=='sent'?'<p class="note">Link each line to a till product so stock comes off when it\'s packed.</p>':''}
      ${o.status==='check'?`<button class="btn bigyes" id="oConf">✅ Confirm order</button>`:''}
      <div class="mact">${o.source!=='shopify'&&o.source!=='consign'?'<button class="btn alt" id="oEd">Change</button>':''}${o.status!=='cancelled'?'<button class="btn alt" id="oSlip">🖨️ Packing slip</button>':''}<button class="btn alt" id="oPaid">${o.paid?'Mark not paid':'💰 Mark paid'}</button>
        ${o.status==='new'?'<button class="btn" id="oPack">📦 Packed</button>':''}${o.status==='packed'?'<button class="btn" id="oSend">🚚 Sent</button>':''}
        ${o.status!=='cancelled'&&o.status!=='sent'?`<button class="btn danger" id="oX">${o.status==='check'?'Not an order':'Cancel order'}</button>`:''}<button class="btn alt" id="oC">Close</button></div>`;
    const set=ch=>{ Object.assign(o,ch,{changed:Date.now(),changedBy:SYNC.me()}); orderStock(o); save(); draw(); render(); };
    m.querySelector('#oC').onclick=close;
    m.querySelector('#oPaid').onclick=()=>set({paid:!o.paid,paidAt:o.paid?null:Date.now()});
    const pk=m.querySelector('#oPack'); if(pk) pk.onclick=()=>set({status:'packed',packedAt:Date.now(),packedBy:SYNC.me()});
    const sd=m.querySelector('#oSend'); if(sd) sd.onclick=()=>set({status:'sent',sentAt:Date.now(),sentBy:SYNC.me()});
    const cf=m.querySelector('#oConf'); if(cf) cf.onclick=()=>{ if(!(o.lines||[]).length){ toast('Add what they ordered first (Change)'); return; } set({status:'new',confirmedAt:Date.now(),confirmedBy:SYNC.me()}); toast('Order confirmed'); };
    const sl=m.querySelector('#oSlip'); if(sl) sl.onclick=()=>packingSlip(o);
    const x=m.querySelector('#oX'); if(x&&o.status==='check') x.onclick=()=>confirmBox('Not an order?','It\'s taken off the list. The email stays in Gmail.','Not an order',()=>{ set({status:'cancelled',cancelledAt:Date.now(),notOrder:true}); },true);
    else if(x) x.onclick=()=>confirmBox('Cancel this order?',o.source==='shopify'?'This only changes it here. Cancel or refund it in Shopify too.':'It stays in the list as cancelled.','Cancel order',()=>{ set({status:'cancelled',cancelledAt:Date.now()}); },true);
    const ed=m.querySelector('#oEd'); if(ed) ed.onclick=()=>{ close(); editOrder(o); };
    m.querySelectorAll('[data-linkl]').forEach(b=>b.onclick=()=>linkLine(o,+b.dataset.linkl,draw));
  }; draw(); },{big:true});
}
// a Shopify line that didn't match a till product by name: link it once, and that Shopify product remembers it
function linkLine(o,i,done){
  const l=o.lines[i];
  modal((m,close)=>{ m.innerHTML=`<h2>Which till product is "${esc(l.name)}"?</h2><select class="txt" id="lkP">${S.products.map(p=>`<option value="${p.id}">${esc(prodName(p))}</option>`).join('')}</select>
      <div class="mact"><button class="btn alt" id="lkC">Cancel</button><button class="btn" id="lkOk">Link</button></div>`;
    m.querySelector('#lkC').onclick=close;
    m.querySelector('#lkOk').onclick=()=>{ const p=S.products.find(x=>x.id===m.querySelector('#lkP').value); if(!p) return;
      l.pid=p.id; if(!l.unit) l.unit=p.wholesale||p.price; if(l.shopifyProduct) p.shopifyIds=[...new Set([...(p.shopifyIds||[]),l.shopifyProduct])];
      // the same Shopify product in other open orders gets linked too
      if(l.shopifyProduct) S.orders.forEach(x=>x.status!=='sent'&&(x.lines||[]).forEach(y=>{ if(!y.pid&&y.shopifyProduct===l.shopifyProduct) y.pid=p.id; }));
      save(); close(); done(); }; });
}
// stock comes off once an order is packed or sent; one record per order line, so it's never taken twice
function orderStock(o){
  if(!['packed','sent'].includes(o.status)) return;
  (o.lines||[]).forEach((l,i)=>{ if(!l.pid||l.stockTaken) return; moveStock({kind:'order',product:l.pid,qty:-(+l.qty||0),order:o.id}); l.stockTaken=true; });
}
// Shopify orders the helper marked as sent before anyone packed them in the app: take their stock off too
function settleOrders(){
  if(!canManage()||tillLock()) return;
  let n=0; S.orders.forEach(o=>{ if(['packed','sent'].includes(o.status)&&(o.lines||[]).some(l=>l.pid&&!l.stockTaken)){ orderStock(o); n++; } });
  if(n) save();
}

/* ---------- adding or changing a wholesale or custom order ---------- */
function editOrder(src){
  const isNew=!src.id, o=JSON.parse(JSON.stringify(Object.assign({source:'wholesale',customer:{name:'',email:'',phone:'',address:''},place:'',lines:[],due:'',paid:false,note:'',discount:0,shipping:0,status:'new'},src)));
  const shops=S.places.filter(p=>!p.gone&&p.channel==='wholesale');
  modal((m,close)=>{ const draw=()=>{ const ws=o.source==='wholesale';
    m.innerHTML=`<h2>${isNew?'New order':'Change the order'}</h2>
      <div class="bigseg"><button data-src="wholesale" class="${ws?'on':''}">🚚 Wholesale</button><button data-src="custom" class="${!ws?'on':''}">✍️ Custom</button></div>
      ${ws&&shops.length?`<label class="note" for="oS">Shop</label><select class="txt" id="oS"><option value="">Someone else (type below)</option>${shops.map(p=>`<option value="${p.id}" ${o.place===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`:''}
      <label class="note" for="oN">Customer name</label><textarea class="txt grow" rows="1" id="oN" autocapitalize="words">${esc(o.customer.name)}</textarea>
      <div class="formrow"><div><label class="note" for="oE">Email (optional)</label><input class="txt" id="oE" type="email" autocapitalize="none" value="${esc(o.customer.email||'')}"></div>
        <div><label class="note" for="oPh">Phone (optional)</label><input class="txt" id="oPh" inputmode="tel" value="${esc(o.customer.phone||'')}"></div></div>
      <label class="note" for="oA">Delivery address</label><textarea class="txt grow" rows="1" id="oA" autocomplete="street-address" placeholder="Street, suburb, town (printed on the packing slip)">${esc(o.customer.address||'')}</textarea>
      <label class="note" for="oD">Send by</label><input class="txt" id="oD" type="date" value="${o.due}">
      <h3>What</h3>${o.lines.map((l,i)=>`<div class="oline"><div class="ltxt"><b>${esc(l.name)}</b><small>${c2(l.unit)} each${ws?' ('+c2(Math.round(l.unit/1.15))+' ex GST)':''}</small></div><input class="txt qty" type="number" min="0" data-oq="${i}" value="${l.qty}"><button class="qb rm" data-ox="${i}">✕</button></div>`).join('')}
      <input class="txt" id="oAdd" list="oAddL" autocomplete="off" placeholder="＋ Add a product: type to search…"><datalist id="oAddL">${S.products.filter(p=>p.active!==false).map(p=>`<option value="${esc(prodName(p))}">${c2(ws&&p.wholesale?p.wholesale:p.price)}</option>`).join('')}</datalist>
      <p><b>Total ${c2(orderTotal(o))}</b> incl. GST${ws?' · '+c2(Math.round(orderTotal(o)/1.15))+' ex GST':''}</p>
      <div class="row"><div class="grow">Paid already</div><div class="seg"><button data-pd="1" class="${o.paid?'on':''}">Yes</button><button data-pd="0" class="${!o.paid?'on':''}">No</button></div></div>
      <label class="note" for="oNo">Notes (optional)</label><textarea class="txt" id="oNo" rows="2">${esc(o.note||'')}</textarea>
      <div class="mact"><button class="btn alt" id="oCx">Cancel</button><button class="btn" id="oOk">${o.status==='check'?'✅ Save and confirm':'Save'}</button></div>`;
    const grab=()=>{ const s=m.querySelector('#oS'); if(s) o.place=s.value; o.customer.name=m.querySelector('#oN').value.trim(); o.customer.email=m.querySelector('#oE').value.trim(); o.customer.phone=m.querySelector('#oPh').value.trim(); o.customer.address=m.querySelector('#oA').value.trim().slice(0,200);
      o.due=m.querySelector('#oD').value; o.note=m.querySelector('#oNo').value.trim(); m.querySelectorAll('[data-oq]').forEach(i=>o.lines[+i.dataset.oq].qty=Math.max(0,Math.floor(+i.value||0))); };
    m.querySelectorAll('[data-src]').forEach(b=>b.onclick=()=>{ grab(); o.source=b.dataset.src; o.lines.forEach(l=>{ const p=S.products.find(x=>x.id===l.pid); if(p) l.unit=o.source==='wholesale'&&p.wholesale?p.wholesale:p.price; }); draw(); });
    const s=m.querySelector('#oS'); if(s) s.onchange=()=>{ grab(); const p=S.places.find(x=>x.id===s.value); if(p){ o.customer.name=p.name; if(!o.customer.address&&p.address) o.customer.address=p.address; } draw(); };
    m.querySelectorAll('[data-oq]').forEach(i=>i.onchange=()=>{ grab(); draw(); });
    m.querySelectorAll('[data-ox]').forEach(b=>b.onclick=()=>{ grab(); o.lines.splice(+b.dataset.ox,1); draw(); });
    m.querySelector('#oAdd').onchange=e=>{ grab(); const q=e.target.value.trim().toLowerCase(), p=S.products.find(x=>x.id===e.target.value)||S.products.find(x=>x.active!==false&&prodName(x).toLowerCase()===q)||(q.length>1?S.products.find(x=>x.active!==false&&prodName(x).toLowerCase().includes(q)):null); if(!p){ toast('No product called that'); return; } const ex=o.lines.find(l=>l.pid===p.id);
      if(ex) ex.qty++; else o.lines.push({pid:p.id,name:prodName(p),qty:1,unit:o.source==='wholesale'&&p.wholesale?p.wholesale:p.price}); draw(); };
    m.querySelectorAll('[data-pd]').forEach(b=>b.onclick=()=>{ grab(); o.paid=b.dataset.pd==='1'; draw(); });
    m.querySelector('#oCx').onclick=close;
    m.querySelector('#oOk').onclick=()=>{ grab(); o.lines=o.lines.filter(l=>l.qty>0);
      if(!o.customer.name){ toast('Type who it\'s for'); return; } if(!o.lines.length){ toast('Add what they ordered'); return; }
      o.total=orderTotal(o); o.gst=Math.round(o.total*3/23); o.changed=Date.now(); if(o.status==='check') Object.assign(o,{status:'new',confirmedAt:Date.now(),confirmedBy:SYNC.me()});
      if(isNew){ Object.assign(o,{id:SYNC.newId('orders'),at:Date.now(),date:nzDay(),by:SYNC.me()}); S.orders.push(o); }
      else { const x=S.orders.find(y=>y.id===o.id); if(x) Object.assign(x,o); }
      save(); close(); render(); toast('Order saved'); }; };
    draw(); },{big:true});
}

/* ---------- packing slip: what goes in the box and where it goes. No prices (it travels with the parcel). ---------- */
function packingSlip(o){
  const c=o.customer||{}, old=document.getElementById('printSlip'); if(old) old.remove();
  const d=document.createElement('div'); d.id='printSlip';
  d.innerHTML=`<div class="slip"><h1>${esc(S.name||'Rata & Smudge')}</h1><p class="sm">Packing slip · ${nzDate(new Date(),{day:'numeric',month:'long',year:'numeric'})}${o.shopify?' · '+esc(o.shopify.name||''):''}${o.fromEmail&&o.fromEmail.ref?' · your ref '+esc(o.fromEmail.ref):''}</p>
    <h2>Deliver to</h2><p class="to"><b>${esc(c.name||'')}</b>${c.address?'<br>'+esc(c.address).replace(/, /g,'<br>'):''}${c.phone?'<br>'+esc(c.phone):''}</p>
    <table><thead><tr><th>Qty</th><th>Product</th><th>✓</th></tr></thead><tbody>${(o.lines||[]).filter(l=>+l.qty>0).map(l=>`<tr><td class="q">${+l.qty}</td><td>${esc(l.name)}</td><td class="tick">☐</td></tr>`).join('')}</tbody></table>
    <p class="sm">${orderUnits(o)} item${orderUnits(o)===1?'':'s'}${o.note?' · '+esc(o.note):''}</p><p class="thanks">Thank you 🌿</p></div>
    <div class="noprint mact"><button class="btn" id="slP">🖨️ Print</button><button class="btn alt" id="slC">Close</button></div>`;
  document.body.appendChild(d); document.body.classList.add('printing');
  const done=()=>{ d.remove(); document.body.classList.remove('printing'); };
  d.querySelector('#slC').onclick=done; d.querySelector('#slP').onclick=()=>window.print();
}
// for What to do next: emails to check, then orders to pack (soonest first)
function orderIdeas(){
  if(!canManage()||missingCols.has('orders')) return [];
  const l=[], e=emailOrders(), t=nzDay(), todo=S.orders.filter(o=>o.status==='new');
  if(e.length) l.push({score:93,t:'📥 '+e.length+' order email'+(e.length===1?'':'s')+' to check',d:e.map(o=>(o.customer&&o.customer.name)||'Customer').slice(0,3).join(', ')+'. Check and confirm so it can be packed.',lbl:'Check',go:'orders',act:()=>openOrder(e[0])});
  const late=todo.filter(o=>o.due&&o.due<=t), rest=todo.filter(o=>!(o.due&&o.due<=t));
  if(late.length) l.push({score:90,t:'📦 '+late.length+' order'+(late.length===1?'':'s')+' to pack '+(late.some(o=>o.due<t)?'(late)':'today'),d:late.map(o=>(o.customer&&o.customer.name)||'Customer').slice(0,3).join(', '),lbl:'Pack',go:'orders',act:()=>openOrder(late[0])});
  const od=overdueOrders(); if(od.length) l.push({score:80,t:'💰 '+od.length+' unpaid order'+(od.length===1?'':'s')+' past the shop\'s terms',d:od.slice(0,3).map(o=>((o.customer&&o.customer.name)||'Customer')+' '+c2(o.total!=null?o.total:orderTotal(o))).join(', '),lbl:'Open',go:'orders',act:()=>openOrder(od[0])});
  if(rest.length) l.push({score:55,t:'📦 '+rest.length+' order'+(rest.length===1?'':'s')+' not packed yet',d:rest.sort((a,b)=>(a.due||'9').localeCompare(b.due||'9')).slice(0,3).map(o=>((o.customer&&o.customer.name)||'Customer')+' · '+dueLabel(o)).join(', '),lbl:'Open',go:'orders',act:()=>go('orders')});
  return l;
}
