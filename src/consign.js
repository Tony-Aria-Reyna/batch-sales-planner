/* ================= Shops: payment terms and consignment =================
   Wholesale shops buy outright; each can have payment terms (e.g. 14 days), so an order shows when it's due
   and an unpaid one goes on What to do next once overdue.
   Consignment shops (sale or return): "Drop off" moves stock from home to the shop. When the shop reports what
   sold, in whatever way suits it (a list of what sold, or a stock count of what's left, at any time), that
   becomes an order at the shop's shelf price less its commission, which she's then owed. "Pick up" brings
   unsold stock home. Each drive there can count, so Real profit treats the shop like a market.
   Others' products sold here (e.g. a friend's soap at the farm shop): the product is marked as someone else's
   with the share she keeps; what she owes them is worked out from the till and settled with "Paid them". */
const consignShops=()=>S.places.filter(p=>!p.gone&&p.channel==='wholesale'&&p.mode==='consign').sort((a,b)=>a.name.localeCompare(b.name));
const termsOf=o=>{ const pl=o&&S.places.find(p=>p.id===o.place); return pl&&+pl.terms>0?+pl.terms:0; };
// the day payment is due: the terms counted from when it was sent (or ordered)
function payDue(o){ const t=termsOf(o); if(!t||o.paid||o.status==='cancelled') return ''; const from=o.sentAt?nzDay(new Date(o.sentAt)):o.date||nzDay(); return dk(addDays(kd(from),t)); }
const overdueOrders=()=>S.orders.filter(o=>{ const d=payDue(o); return d&&d<nzDay()&&(o.status==='sent'||o.source==='consign'); });

// what's at a consignment shop now, by product: dropped off − picked up − reported sold
function atShop(placeId){
  const n={};
  S.stockmoves.forEach(m=>{ if(m.place!==placeId) return; if(m.kind==='consign') n[m.product]=(n[m.product]||0)-m.qty; else if(m.kind==='consign-back') n[m.product]=(n[m.product]||0)-m.qty; });
  S.orders.forEach(o=>{ if(o.source!=='consign'||o.place!==placeId||o.status==='cancelled') return; (o.lines||[]).forEach(l=>{ if(l.pid) n[l.pid]=(n[l.pid]||0)-(+l.qty||0); }); });
  Object.keys(n).forEach(k=>{ if(n[k]<=0) delete n[k]; }); return n;
}
const owedBy=placeId=>S.orders.filter(o=>o.source==='consign'&&o.place===placeId&&o.status!=='cancelled'&&!o.paid).reduce((t,o)=>t+(o.total!=null?o.total:orderTotal(o)),0);
const shelfPrice=(pl,p)=>pl&&pl.shelf==='wholesale'&&p.wholesale?p.wholesale:p.price;

function shopsHtml(){
  const ws=S.places.filter(p=>!p.gone&&p.channel==='wholesale').sort((a,b)=>a.name.localeCompare(b.name));
  const others=othersOwed();
  return `${ws.length?ws.map(pl=>{ const con=pl.mode==='consign', at=con?atShop(pl.id):{}, units=Object.values(at).reduce((a,b)=>a+b,0), owed=con?owedBy(pl.id):0;
      const unpaid=S.orders.filter(o=>o.place===pl.id&&!o.paid&&o.status!=='cancelled'&&o.source!=='consign'), od=overdueOrders().filter(o=>o.place===pl.id);
      const last=S.orders.filter(o=>o.source==='consign'&&o.place===pl.id).sort((a,b)=>(b.at||0)-(a.at||0))[0];
      return `<div class="card"><h3>${con?'🤝':'🚚'} ${esc(pl.name)}</h3>
        <p class="note">${con?'Consignment'+(pl.commission?' · they keep '+pl.commission+'%':' · commission not set'):'Wholesale'}${pl.terms?' · pays in '+pl.terms+' days':''} · <button class="linkb" data-shedit="${pl.id}">Change</button></p>
        ${con?`<div class="row"><div class="grow"><b>At the shop now</b><small>${units?Object.entries(at).map(([pid,q])=>q+' × '+esc(prodName(S.products.find(x=>x.id===pid)||{name:'?'}))).join(', '):'Nothing yet'}</small></div><b>${units}</b></div>
          <div class="row"><div class="grow"><b>Owed to you</b><small>${last?'Last sales report '+nzDate(kd(last.date),{day:'numeric',month:'short'}):'No sales reported yet'}</small></div><b>${c2(owed)}</b></div>
          <div class="mact" style="justify-content:flex-start"><button class="btn" data-cdrop="${pl.id}">📦 Drop off</button><button class="btn" data-csold="${pl.id}" ${units?'':'disabled'}>🧾 They sold…</button>
            <button class="btn alt" data-cback="${pl.id}" ${units?'':'disabled'}>↩ Pick up</button>${owed?`<button class="btn alt" data-cpaid="${pl.id}">💰 They paid ${c2(owed)}</button>`:''}</div>`
        :`<div class="row"><div class="grow"><b>Not paid yet</b><small>${unpaid.length?unpaid.length+' order'+(unpaid.length===1?'':'s')+(od.length?' · ⚠️ '+od.length+' overdue':''):'All paid'}</small></div><b>${c2(unpaid.reduce((t,o)=>t+(o.total!=null?o.total:orderTotal(o)),0))}</b></div>`}</div>`; }).join('')
    :'<div class="card"><p class="note">No shops yet. Add them in Setup → Markets and places, under Shops.</p></div>'}
    <div class="card"><h3>🧺 Others' products you sell</h3><p class="note">Mark a product as someone else's (Setup → Products, “Someone else's product”) and say what share you keep. What you owe them is worked out from the till.</p>
      ${others.length?others.map(x=>`<div class="row"><div class="grow"><b>${esc(x.who)}</b><small>${x.qty} sold since ${x.since?nzDate(kd(x.since),{day:'numeric',month:'short'}):'the start'} · ${c2(x.sales)} taken</small></div><b>${c2(x.owe)}</b><button class="btn small" data-opaid="${esc(x.who)}" ${x.owe?'':'disabled'}>Paid them</button></div>`).join(''):'<p class="note">None yet.</p>'}</div>`;
}
function wireShops(){
  document.querySelectorAll('[data-shedit]').forEach(b=>b.onclick=()=>editPlace(S.places.find(p=>p.id===b.dataset.shedit),()=>render()));
  document.querySelectorAll('[data-cdrop]').forEach(b=>b.onclick=()=>consignMove(b.dataset.cdrop,'drop'));
  document.querySelectorAll('[data-cback]').forEach(b=>b.onclick=()=>consignMove(b.dataset.cback,'back'));
  document.querySelectorAll('[data-csold]').forEach(b=>b.onclick=()=>consignSold(b.dataset.csold));
  document.querySelectorAll('[data-cpaid]').forEach(b=>b.onclick=()=>{ const id=b.dataset.cpaid, pl=S.places.find(p=>p.id===id);
    confirmBox(pl.name+' paid '+c2(owedBy(id))+'?','Marks their sales reports paid.','Yes, paid',()=>{ S.orders.forEach(o=>{ if(o.source==='consign'&&o.place===id&&!o.paid&&o.status!=='cancelled') Object.assign(o,{paid:true,paidAt:Date.now(),changed:Date.now()}); }); save(); render(); toast('Marked paid'); }); });
  document.querySelectorAll('[data-opaid]').forEach(b=>b.onclick=()=>{ const x=othersOwed().find(y=>y.who===b.dataset.opaid); if(!x) return;
    confirmBox('Paid '+x.who+' '+c2(x.owe)+'?','For '+x.qty+' sold up to today. The count starts again from tomorrow.','Yes, paid',()=>{ S.costs.push({id:SYNC.newId('costs'),kind:'othersPaid',who:x.who,cents:x.owe,upTo:nzDay(),date:nzDay(),at:Date.now(),by:SYNC.me()}); save(); render(); toast('Recorded'); }); });
}
// a drive there: counted as mileage in Real profit, against that shop
function tripCost(pl){ if(pl&&+pl.km>0) S.costs.push({id:SYNC.newId('costs'),kind:'trip',place:pl.id,km:+pl.km,date:nzDay(),at:Date.now(),by:SYNC.me()}); }

// drop off at, or pick up from, a consignment shop
function consignMove(placeId,way){
  const pl=S.places.find(p=>p.id===placeId); if(!pl) return; const drop=way==='drop', at=atShop(placeId);
  const list=drop?activeProducts():S.products.filter(p=>at[p.id]);
  modal((m,close)=>{ m.innerHTML=`<h2>${drop?'📦 Drop off at ':'↩ Pick up from '}${esc(pl.name)}</h2><p class="note">${drop?'How many of each you\'re leaving there. They come out of your stock.':'How many of each you\'re bringing home. They go back into your stock.'}</p>
      ${list.map(p=>{ const st=drop?stockOf(p.id):null; return `<div class="oline"><div class="ltxt"><b>${esc(prodName(p))}</b><small>${drop?(st?st.total+' at home':'stock not counted')+(at[p.id]?' · '+at[p.id]+' there now':''):at[p.id]+' at the shop'}</small></div><input class="txt qty" type="number" min="0" ${drop?'':`max="${at[p.id]}"`} data-cq="${p.id}" placeholder="0"></div>`; }).join('')}
      ${pl.km?`<label class="tickrow"><input type="checkbox" id="cTrip" checked><span>Count the drive (${pl.km} km there and back) in Real profit</span></label>`:''}
      <div class="mact"><button class="btn alt" id="cmC">Cancel</button><button class="btn" id="cmOk">Save</button></div>`;
    m.querySelector('#cmC').onclick=close;
    m.querySelector('#cmOk').onclick=()=>{ let n=0, bad=false;
      m.querySelectorAll('[data-cq]').forEach(i=>{ const q=Math.floor(+i.value||0); if(q<=0) return; if(!drop&&q>(at[i.dataset.cq]||0)){ bad=true; return; } moveStock({kind:drop?'consign':'consign-back',product:i.dataset.cq,qty:drop?-q:q,place:placeId}); n+=q; });
      if(bad){ toast('That\'s more than is at the shop'); return; } if(!n){ toast('Type how many'); return; }
      const t=m.querySelector('#cTrip'); if(t&&t.checked) tripCost(pl);
      save(); close(); render(); toast((drop?'Dropped off ':'Picked up ')+n); };
  },{big:true});
}
// the shop says what sold: either what sold, or a count of what's left on their shelf
function consignSold(placeId){
  const pl=S.places.find(p=>p.id===placeId); if(!pl) return; const at=atShop(placeId), list=S.products.filter(p=>at[p.id]); let mode='sold';
  modal((m,close)=>{ const draw=()=>{ const com=+(pl.commission||0);
      m.innerHTML=`<h2>🧾 ${esc(pl.name)}: what sold</h2>
        <div class="bigseg"><button data-cm="sold" class="${mode==='sold'?'on':''}">They told me what sold</button><button data-cm="left" class="${mode==='left'?'on':''}">I counted what's left</button></div>
        ${list.map(p=>`<div class="oline"><div class="ltxt"><b>${esc(prodName(p))}</b><small>${at[p.id]} there · sells at ${c2(shelfPrice(pl,p))}</small></div><input class="txt qty" type="number" min="0" max="${at[p.id]}" data-cs="${p.id}" placeholder="${mode==='left'?at[p.id]:'0'}"></div>`).join('')}
        <div class="formrow"><div><label class="note" for="csCom">Their commission (%)</label><input class="txt" id="csCom" inputmode="decimal" value="${com||''}" placeholder="e.g. 30"></div>
          <div><label class="note" for="csD">Up to</label><input class="txt" id="csD" type="date" value="${nzDay()}"></div></div>
        <p class="chkline" id="csSum"></p>
        <div class="mact"><button class="btn alt" id="csC">Cancel</button><button class="btn" id="csOk">Save</button></div>`;
      const sold=()=>{ const r={}; m.querySelectorAll('[data-cs]').forEach(i=>{ const v=i.value.trim(), pid=i.dataset.cs; if(v==='') return; const q=Math.floor(+v||0); const s=mode==='left'?at[pid]-q:q; if(s>0) r[pid]=Math.min(s,at[pid]); }); return r; };
      const sum=()=>{ const r=sold(), gross=Object.entries(r).reduce((t,[pid,q])=>t+q*shelfPrice(pl,S.products.find(x=>x.id===pid)),0), c=+m.querySelector('#csCom').value||0;
        m.querySelector('#csSum').innerHTML=gross?`${Object.values(r).reduce((a,b)=>a+b,0)} sold · ${c2(gross)} − ${c}% = <b>${c2(gross-Math.round(gross*c/100))} owed to you</b>`:'Type what sold (or what\'s left).'; };
      m.querySelectorAll('[data-cs]').forEach(i=>i.oninput=sum); m.querySelector('#csCom').oninput=sum; sum();
      m.querySelectorAll('[data-cm]').forEach(b=>b.onclick=()=>{ mode=b.dataset.cm; draw(); });
      m.querySelector('#csC').onclick=close;
      m.querySelector('#csOk').onclick=()=>{ const r=sold(), c=Math.max(0,Math.min(90,+m.querySelector('#csCom').value||0)), d=m.querySelector('#csD').value||nzDay();
        if(!Object.keys(r).length){ toast('Type what sold (or what\'s left)'); return; }
        if(c!==+(pl.commission||0)){ pl.commission=c; }
        const lines=Object.entries(r).map(([pid,q])=>{ const p=S.products.find(x=>x.id===pid); return {pid,name:prodName(p),qty:q,unit:shelfPrice(pl,p),stockTaken:true}; });
        const gross=lines.reduce((t,l)=>t+l.qty*l.unit,0), o={id:SYNC.newId('orders'),source:'consign',status:'sent',paid:false,at:Date.now(),date:d,by:SYNC.me(),place:pl.id,
          customer:{name:pl.name,email:pl.email||'',phone:'',address:pl.address||''},lines,discount:Math.round(gross*c/100),shipping:0,due:'',note:'Consignment sales'+(mode==='left'?' (from a stock count)':'')+(c?', less '+c+'% commission':''),consign:{commission:c,how:mode},sentAt:Date.now()};
        o.total=orderTotal(o); o.gst=Math.round(o.total*3/23); S.orders.push(o); save(); close(); render(); toast(c2(o.total)+' owed by '+pl.name); };
    }; draw(); },{big:true});
}

// what's owed to the people whose products are sold here, since each was last paid
function othersOwed(){
  const by={};
  S.products.filter(p=>p.consignFrom).forEach(p=>{ const w=p.consignFrom.trim(); if(w) (by[w]=by[w]||[]).push(p); });
  return Object.entries(by).map(([who,ps])=>{ const paid=S.costs.filter(c=>c.kind==='othersPaid'&&c.who===who).sort((a,b)=>(b.upTo||'').localeCompare(a.upTo||''))[0], since=paid?dk(addDays(kd(paid.upTo),1)):'';
    let qty=0, sales=0, owe=0;
    S.sales.forEach(s=>{ if(s.voided||(since&&s.date<since)) return; (s.lines||[]).forEach(l=>{ const p=ps.find(x=>x.id===l.pid); if(!p) return; const amt=l.amount!=null?l.amount:l.qty*l.unit; qty+=l.qty; sales+=amt; owe+=Math.round(amt*(100-(+p.consignKeep||0))/100); }); });
    return {who,qty,sales,owe,since}; });
}
