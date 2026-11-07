/* ================= Products and deals (Setup, owner and managers only) =================
   Prices are set here and only here. The till reads them and never lets anyone type a price.
   All prices include GST. Records link by id, never by name, so renaming can't break a total. */
const COLOURS={balm:['#f3dfb6','#6b4a0c','Balm'],oil:['#d9e8cf','#2f5225','Oil'],tincture:['#f3d2cf','#7d1d16','Tincture'],tea:['#d4ebe6','#1d5249','Tea'],
  spray:['#d8e4f3','#24507a','Spray / drops'],cream:['#eadff1','#55306b','Cream'],gift:['#f6d8e6','#7a2350','Gift set'],other:['#ece6d9','#4b463b','Other']};
function guessColour(name,size){
  const t=(name+' '+size).toLowerCase();
  if(/gift|box|set\b/.test(t)) return 'gift';
  if(/tincture|glycerate/.test(t)) return 'tincture';
  if(/\btea\b|blend|ease\b/.test(t)) return 'tea';
  if(/balm/.test(t)) return 'balm';
  if(/spray|drops|mist/.test(t)) return 'spray';
  if(/cream|lotion/.test(t)) return 'cream';
  if(/oil|roll-?on/.test(t)) return 'oil';
  return 'other';
}
const toCents=v=>{ const n=parseFloat(String(v).replace(/[^0-9.]/g,'')); return isFinite(n)?Math.round(n*100):NaN; };
const activeProducts=()=>S.products.filter(p=>p.active!==false).sort((a,b)=>(a.name+' '+a.size).localeCompare(b.name+' '+b.size,'en',{numeric:true}));
const prodName=p=>p?(p.name+(p.size?' · '+p.size:'')):'(deleted product)';
const swatch=c=>{ const k=COLOURS[c]||COLOURS.other; return `background:${k[0]};color:${k[1]}`; };

SCREENS.products={
  title:()=>({h:'Products and prices',s:'Prices include GST'}),
  html(){
    const all=S.products.slice().sort((a,b)=>(a.name+' '+a.size).localeCompare(b.name+' '+b.size,'en',{numeric:true}));
    return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0">
        <button class="btn" id="pAdd">＋ Add a product</button><button class="btn alt" id="pPaste">📋 Paste a price list</button></div>
      <p class="note">Only you can change these. Helpers see them as till buttons and can't change a price.</p></div>
      <div class="card">${all.length?all.map(p=>`<div class="row" data-edit="${p.id}" style="cursor:pointer${p.active===false?';opacity:.5':''}">
          <span class="chip" style="${swatch(p.colour)}">${esc((COLOURS[p.colour]||COLOURS.other)[2])}</span>
          <div class="grow"><b>${esc(p.name)}</b><small>${esc(p.size||'')}${p.active===false?' · hidden from the till':''}</small></div>
          <b style="font-size:22px">${money(p.price/100)}</b></div>`).join('')
        :'<p class="note">No products yet. Add them one at a time, or paste your price list.</p>'}</div>`;
  },
  wire(){
    $('#pAdd').onclick=()=>editProduct(null);
    $('#pPaste').onclick=pasteProducts;
    document.querySelectorAll('[data-edit]').forEach(r=>r.onclick=()=>editProduct(S.products.find(p=>p.id===r.dataset.edit)));
  }
};
function editProduct(p){
  const isNew=!p; p=p||{name:'',size:'',price:0,colour:'',active:true};
  modal((m,close)=>{ let col=p.colour||'';
    const draw=()=>{ const n=m.querySelector('#eN'),z=m.querySelector('#eZ'),pr=m.querySelector('#eP'); const keep=n?{n:n.value,z:z.value,p:pr.value}:{n:p.name,z:p.size||'',p:p.price?(p.price/100).toFixed(2):''};
      m.innerHTML=`<h2>${isNew?'Add a product':'Edit product'}</h2>
        <label class="note">Name</label><input class="txt" id="eN" value="${esc(keep.n)}" autocapitalize="words">
        <label class="note">Size (e.g. 50ml, 30g, Balm, Gift set)</label><input class="txt" id="eZ" value="${esc(keep.z)}">
        <label class="note">Price, including GST</label><input class="txt" id="eP" inputmode="decimal" value="${esc(keep.p)}" placeholder="25.00">
        <p class="note">Button colour</p><div class="colours">${Object.entries(COLOURS).map(([k,v])=>`<button data-c="${k}" class="${(col||guessColour(keep.n,keep.z))===k?'on':''}" style="background:${v[0]};color:${v[1]}">${v[2]}</button>`).join('')}</div>
        ${isNew?'':`<div class="row"><div class="grow">Show on the till</div><div class="seg"><button data-a="1" class="${p.active!==false?'on':''}">Show</button><button data-a="0" class="${p.active===false?'on':''}">Hide</button></div></div>`}
        <div class="mact">${isNew?'':'<button class="btn danger" id="eD">Delete</button>'}<button class="btn alt" id="eC">Cancel</button><button class="btn" id="eS">Save</button></div>`;
      m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{ col=b.dataset.c; draw(); });
      m.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ p.active=b.dataset.a==='1'; draw(); });
      m.querySelector('#eC').onclick=close;
      const d=m.querySelector('#eD'); if(d) d.onclick=()=>{ close(); confirmBox('Delete '+prodName(p)+'?','Past sales keep their record. To stop selling it for now, Hide it instead.','Delete',()=>{ removeProduct(p); save(); render(); },true); };
      m.querySelector('#eS').onclick=()=>{ const name=m.querySelector('#eN').value.trim(), size=m.querySelector('#eZ').value.trim(), c=toCents(m.querySelector('#eP').value);
        if(!name){ toast('Type the product name'); return; } if(!(c>0)){ toast('Type a price, e.g. 25'); return; }
        Object.assign(p,{name,size,price:c,colour:col||guessColour(name,size),active:p.active!==false,updated:Date.now()});
        if(isNew){ p.id=SYNC.newId('products'); S.products.push(p); }
        save(); close(); render(); toast('Saved '+prodName(p)+' at '+money(c/100)); };
    }; draw(); });
}
// delete has to replace the array contents in place (the sync module watches this array)
const removeProduct=p=>{ const i=S.products.indexOf(p); if(i>=0) S.products.splice(i,1); };

// Paste a price list: one product per line, "Name, size, price" or columns copied from a table or spreadsheet.
function parsePriceList(text){
  const out=[];
  for(let line of String(text).split(/\r?\n/)){
    line=line.trim(); if(!line) continue;
    const m=line.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*$/); if(!m) continue;
    let rest=line.slice(0,m.index).replace(/[\s,;|\t–—-]+$/,'').trim(); if(!rest) continue;
    let parts=rest.split(/\t|\s*[,;|]\s*|\s{2,}|\s[–—]\s/).map(s=>s.trim()).filter(Boolean);
    let name=parts[0], size=parts.slice(1).join(' ');
    if(parts.length===1){ const s=rest.match(/^(.*?)\s+(\d+\s?(?:ml|g|kg|l)|Balm|Tea|Tincture|Blend|Gift set)$/i); if(s){ name=s[1]; size=s[2]; } }
    if(/^product$/i.test(name)) continue;
    out.push({name,size,price:Math.round(parseFloat(m[1])*100)});
  }
  return out;
}
function pasteProducts(){
  modal((m,close)=>{ let rows=[];
    const key=r=>(r.name+'|'+r.size).toLowerCase();
    const draw=txt=>{ const have=new Set(S.products.map(key));
      m.innerHTML=`<h2>📋 Paste a price list</h2><p class="note">One product per line: name, size, price including GST. For example:<br><b>Calendula Infused Oil, 50ml, 20</b></p>
        <textarea class="txt" id="tP" rows="7" style="min-height:160px">${esc(txt||'')}</textarea>
        ${rows.length?`<p class="note"><b>${rows.length}</b> found. Check every price before adding:</p><div style="max-height:260px;overflow:auto">${rows.map(r=>`<div class="row"><div class="grow">${esc(r.name)}<small>${esc(r.size)}${have.has(key(r))?' · already on the list, will be skipped':''}</small></div><b>${money(r.price/100)}</b></div>`).join('')}</div>`:''}
        <div class="mact"><button class="btn alt" id="tC">Cancel</button>${rows.length?`<button class="btn" id="tA">Add ${rows.filter(r=>!have.has(key(r))).length} products</button>`:''}</div>`;
      const ta=m.querySelector('#tP'); ta.oninput=()=>{ rows=parsePriceList(ta.value); const pos=ta.selectionStart; draw(ta.value); const t2=m.querySelector('#tP'); t2.focus(); t2.setSelectionRange(pos,pos); };
      m.querySelector('#tC').onclick=close;
      const a=m.querySelector('#tA'); if(a) a.onclick=()=>{ let n=0; for(const r of rows){ if(have.has(key(r))) continue; have.add(key(r)); S.products.push({id:SYNC.newId('products'),name:r.name,size:r.size,price:r.price,colour:guessColour(r.name,r.size),active:true,updated:Date.now()}); n++; }
        save(); close(); render(); toast('Added '+n+' products'); };
    }; draw(''); });
}

/* ---------- deals: set up once, applied by the till by itself ---------- */
// A deal is "any N of these products for $X". The till groups the dearest qualifying items first,
// so the customer always gets the best price and nobody does sums in their head.
SCREENS.deals={
  title:()=>({h:'Deals',s:'Applied automatically at the till'}),
  html(){ return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="dAdd">＋ Add a deal</button></div>
      <p class="note">For example "Any 3 balms for $50". Helpers can't change deals or give their own discounts.</p></div>
    <div class="card">${S.deals.length?S.deals.map(d=>`<div class="row" data-deal="${d.id}" style="cursor:pointer${d.active===false?';opacity:.5':''}"><div class="grow"><b>${esc(d.name)}</b><small>Any ${d.qty} of ${d.productIds.length} product${d.productIds.length===1?'':'s'} for ${money(d.price/100)}${d.active===false?' · switched off':''}</small></div></div>`).join('')
      :'<p class="note">No deals yet.</p>'}</div>`; },
  wire(){ $('#dAdd').onclick=()=>editDeal(null); document.querySelectorAll('[data-deal]').forEach(r=>r.onclick=()=>editDeal(S.deals.find(d=>d.id===r.dataset.deal))); }
};
function editDeal(d){
  const isNew=!d; d=d||{name:'',qty:3,price:0,productIds:[],active:true};
  const pick=new Set(d.productIds);
  modal((m,close)=>{ const prods=activeProducts();
    const draw=()=>{ const n=m.querySelector('#kN'); const keep=n?{n:n.value,q:m.querySelector('#kQ').value,p:m.querySelector('#kP').value}:{n:d.name,q:d.qty,p:d.price?(d.price/100).toFixed(2):''};
      m.innerHTML=`<h2>${isNew?'Add a deal':'Edit deal'}</h2>
        <label class="note">Name shown on the receipt line</label><input class="txt" id="kN" value="${esc(keep.n)}" placeholder="3 balms for $50">
        <div style="display:flex;gap:12px"><div style="flex:1"><label class="note">How many items</label><input class="txt" id="kQ" inputmode="numeric" value="${esc(keep.q)}"></div>
        <div style="flex:1"><label class="note">For (incl GST)</label><input class="txt" id="kP" inputmode="decimal" value="${esc(keep.p)}" placeholder="50"></div></div>
        <p class="note">Which products count towards it? (${pick.size} ticked) <button class="btn alt small" id="kAllB">Tick all balms</button></p>
        <div style="max-height:300px;overflow:auto">${prods.map(p=>`<label class="row" style="cursor:pointer"><input type="checkbox" data-p="${p.id}" ${pick.has(p.id)?'checked':''} style="width:26px;height:26px"><div class="grow">${esc(p.name)}<small>${esc(p.size)}</small></div><b>${money(p.price/100)}</b></label>`).join('')||'<p class="note">Add products first.</p>'}</div>
        ${isNew?'':`<div class="row"><div class="grow">Use this deal</div><div class="seg"><button data-a="1" class="${d.active!==false?'on':''}">On</button><button data-a="0" class="${d.active===false?'on':''}">Off</button></div></div>`}
        <div class="mact">${isNew?'':'<button class="btn danger" id="kD">Delete</button>'}<button class="btn alt" id="kC">Cancel</button><button class="btn" id="kS">Save</button></div>`;
      m.querySelectorAll('[data-p]').forEach(c=>c.onchange=()=>{ c.checked?pick.add(c.dataset.p):pick.delete(c.dataset.p); });
      m.querySelector('#kAllB').onclick=()=>{ prods.filter(p=>p.colour==='balm').forEach(p=>pick.add(p.id)); draw(); };
      m.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ d.active=b.dataset.a==='1'; draw(); });
      m.querySelector('#kC').onclick=close;
      const del=m.querySelector('#kD'); if(del) del.onclick=()=>{ const i=S.deals.indexOf(d); if(i>=0) S.deals.splice(i,1); save(); close(); render(); };
      m.querySelector('#kS').onclick=()=>{ const name=m.querySelector('#kN').value.trim(), q=parseInt(m.querySelector('#kQ').value,10), c=toCents(m.querySelector('#kP').value);
        if(!name){ toast('Give the deal a name'); return; } if(!(q>=2)){ toast('A deal needs at least 2 items'); return; } if(!(c>0)){ toast('Type the deal price'); return; } if(pick.size<1){ toast('Tick the products it applies to'); return; }
        const cheapest=Math.min(...[...pick].map(id=>(S.products.find(p=>p.id===id)||{}).price||Infinity));
        if(c>=cheapest*q){ toast('That deal costs more than buying them separately'); return; }
        Object.assign(d,{name,qty:q,price:c,productIds:[...pick],active:d.active!==false,updated:Date.now()});
        if(isNew){ d.id=SYNC.newId('deals'); S.deals.push(d); }
        save(); close(); render(); toast('Deal saved'); };
    }; draw(); });
}
// Work out a cart's total. cart: [{pid, qty}] → {lines, deals, subtotal, discount, total} in cents.
function priceCart(cart){
  const lines=[]; let subtotal=0;
  for(const c of cart){ const p=S.products.find(x=>x.id===c.pid); if(!p||c.qty<1) continue; lines.push({pid:p.id,name:p.name,size:p.size||'',qty:c.qty,unit:p.price,amount:p.price*c.qty}); subtotal+=p.price*c.qty; }
  const units=[]; lines.forEach(l=>{ for(let i=0;i<l.qty;i++) units.push({pid:l.pid,price:l.unit,used:false}); });
  units.sort((a,b)=>b.price-a.price);
  const deals=[]; let discount=0;
  for(const d of S.deals.filter(d=>d.active!==false).sort((a,b)=>a.price/a.qty-b.price/b.qty)){
    const ok=new Set(d.productIds);
    for(;;){ const pool=units.filter(u=>!u.used&&ok.has(u.pid)); if(pool.length<d.qty) break;
      const grp=pool.slice(0,d.qty), full=grp.reduce((s,u)=>s+u.price,0); if(full<=d.price) break;
      grp.forEach(u=>u.used=true); const save=full-d.price; discount+=save;
      const ex=deals.find(x=>x.id===d.id); if(ex){ ex.times++; ex.saving+=save; } else deals.push({id:d.id,name:d.name,times:1,saving:save}); }
  }
  return {lines,deals,subtotal,discount,total:subtotal-discount};
}
