/* ================= Products and deals (Setup, owner and managers only) =================
   Prices are set here and only here. The till reads them and never lets anyone type a price.
   All prices include GST. Records link by id, never by name, so renaming can't break a total. */
// Category colours: bold and far apart from each other, so a category can be spotted at a glance
// (and each tile is labelled too, for anyone who finds colours hard to tell apart).
// [background, text, name, plural]
const COLOURS={balm:['#E8A317','#2a1c00','Balm','Balms'],oil:['#2E7D32','#ffffff','Oil','Oils'],tincture:['#9E1B32','#ffffff','Tincture','Tinctures'],
  tea:['#00897B','#ffffff','Tea','Teas'],spray:['#1E5BB8','#ffffff','Spray / drops','Sprays & drops'],cream:['#7B3FA6','#ffffff','Cream','Creams'],
  gift:['#D63384','#ffffff','Gift set','Gift sets'],other:['#5C5F66','#ffffff','Other','Other']};
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

// Search that forgives: every word typed must appear (in any order), as part of a word, or with one
// letter wrong. Case, spaces, punctuation and macrons don't matter: "oil lav 50" finds "Lavender Infused Oil · 50ml".
const normText=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function near1(a,b){ if(Math.abs(a.length-b.length)>1) return false; let i=0,j=0,d=0; while(i<a.length&&j<b.length){ if(a[i]===b[j]){ i++; j++; continue; } if(++d>1) return false; if(a.length>b.length) i++; else if(b.length>a.length) j++; else { i++; j++; } } return d+(a.length-i)+(b.length-j)<=1; }
function fuzzyScore(q,text){ const qs=normText(q).split(' ').filter(Boolean); if(!qs.length) return 1; const t=normText(text), tw=t.split(' '), tj=t.replace(/ /g,''); let score=0;
  const swap1=(a,b)=>{ if(a.length!==b.length) return false; const d=[]; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) d.push(i); return d.length===2&&d[1]===d[0]+1&&a[d[0]]===b[d[1]]&&a[d[1]]===b[d[0]]; };   // "tae" → "tea"
  const close=(w,x)=>swap1(w,x)||swap1(w,x.slice(0,w.length))||(w.length>=4&&(near1(w,x)||(x.length>w.length&&near1(w,x.slice(0,w.length)))));
  for(const w of qs){ if(tw.some(x=>x.startsWith(w))) score+=3; else if(tj.includes(w)) score+=2; else if(w.length>=3&&tw.some(x=>close(w,x))) score+=1; else return 0; }
  return score; }
let prodFilter='all', prodQuery='', tillPinUntil=0;
// putting a product on the till needs an owner's or manager's PIN (one PIN covers the next two minutes here)
function withTillPin(what,fn){ if(Date.now()<tillPinUntil){ fn(SYNC.me()); return; } approve('put a product on the till',who=>{ tillPinUntil=Date.now()+120e3; fn(who); },what); }
const needsSetup=p=>!!p.needsSetup||(typeof productIssues==='function'&&role()==='owner'&&productIssues(p).length>0);
SCREENS.products={
  title:()=>({h:'Products and prices',s:'Prices include GST'}),
  html(){
    const all=S.products.slice().sort((a,b)=>(a.name+' '+a.size).localeCompare(b.name+' '+b.size,'en',{numeric:true}));
    const hit=prodQuery?all.filter(p=>fuzzyScore(prodQuery,p.name+' '+(p.size||''))>0):all;
    const show=prodFilter==='on'?hit.filter(p=>p.active!==false):prodFilter==='off'?hit.filter(p=>p.active===false):prodFilter==='setup'?hit.filter(needsSetup):hit;
    const on=show.filter(p=>p.active!==false), off=show.filter(p=>p.active===false);
    const row=p=>`<div class="row prodrow ${p.active===false?'offtill':''}"><span class="chip" style="${swatch(p.colour)}">${esc((COLOURS[p.colour]||COLOURS.other)[2])}</span>
        <div class="grow" data-edit="${p.id}" style="cursor:pointer"><b>${esc(p.name)}</b><small>${esc(p.size||'')}${needsSetup(p)?' · <span class="bad">⚠️ Needs setting up</span>':''}</small></div>
        <b style="font-size:20px">${money(p.price/100)}</b>
        <button class="switch ${p.active!==false?'on':''}" data-onoff="${p.id}" role="switch" aria-checked="${p.active!==false}" aria-label="On the till: ${esc(prodName(p))}"><i></i></button></div>`;
    const counts={all:all.length,on:all.filter(p=>p.active!==false).length,off:all.filter(p=>p.active===false).length,setup:all.filter(needsSetup).length};
    return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0">
        <button class="btn" id="pAdd">＋ Add a product</button><button class="btn alt" id="pPaste">📄 Load a price list</button></div>
      <p class="note">Only you can change these. Helpers see them as till buttons and can't change a price. The switch puts a product on the till or takes it off (putting one on needs a PIN).</p>
      <input class="txt" id="pQ" type="search" placeholder="🔍 Search products" value="${esc(prodQuery)}" autocomplete="off">
      <div class="pastnames">${[['all','All'],['on','On the till'],['off','Off the till'],['setup','Needs setting up']].map(([k,l])=>`<button class="chip big ${prodFilter===k?'on':''}" data-pf="${k}">${l} · ${counts[k]}</button>`).join('')}</div></div>
      ${all.length?'':'<div class="card"><p class="note">No products yet. Add them one at a time, or paste your price list.</p></div>'}
      ${on.length?`<div class="card"><h3>On the till (${on.length})</h3>${on.map(row).join('')}</div>`:''}
      ${off.length?`<div class="card"><h3>Off the till (${off.length})</h3><p class="note">Not shown as till buttons. They can still be found with 🔍 Find on the till, with a PIN.</p>${off.map(row).join('')}</div>`:''}
      ${all.length&&!show.length?'<div class="card"><p class="note">Nothing matches.</p></div>':''}`;
  },
  wire(){
    $('#pAdd').onclick=()=>editProduct(null);
    $('#pPaste').onclick=loadPriceList;
    const q=$('#pQ'); q.oninput=()=>{ prodQuery=q.value; const at=q.selectionStart; render(); const q2=$('#pQ'); if(q2){ q2.focus(); try{ q2.setSelectionRange(at,at); }catch(e){} } };
    document.querySelectorAll('[data-pf]').forEach(b=>b.onclick=()=>{ prodFilter=b.dataset.pf; render(); });
    document.querySelectorAll('[data-edit]').forEach(r=>r.onclick=()=>editProduct(S.products.find(p=>p.id===r.dataset.edit)));
    document.querySelectorAll('[data-onoff]').forEach(b=>b.onclick=()=>{ const p=S.products.find(x=>x.id===b.dataset.onoff); if(!p) return;
      if(p.active!==false){ p.active=false; p.updated=Date.now(); save(); render(); toast(prodName(p)+' is off the till'); return; }
      withTillPin(prodName(p),()=>{ p.active=true; p.updated=Date.now(); save(); render(); toast(prodName(p)+' is on the till'); }); });
  }
};
function editProduct(p,done){
  const isNew=!p; p=p||{name:'',size:'',price:0,colour:'',active:true};
  const wasOff=!isNew&&p.active===false;
  modal((m,close)=>{ let col=p.colour||'';
    const draw=()=>{ const n=m.querySelector('#eN'),z=m.querySelector('#eZ'),pr=m.querySelector('#eP'); const ww=m.querySelector('#eW'); const nw=m.querySelector('#eNW'); const keep=n?{n:n.value,z:z.value,p:pr.value,w:ww?ww.value:'',nw:nw?nw.checked:false}:{n:p.name,z:p.size||'',p:p.price?(p.price/100).toFixed(2):'',w:p.wholesale?(p.wholesale/100).toFixed(2):'',nw:!!p.noWholesale};
      m.innerHTML=`<h2>${isNew?'Add a product':'Edit product'}</h2>
        <label class="note">Name</label><input class="txt" id="eN" value="${esc(keep.n)}" autocapitalize="words">
        <label class="note">Size (e.g. 50ml, 30g, Balm, Gift set)</label><input class="txt" id="eZ" value="${esc(keep.z)}">
        <label class="note">Price, including GST</label><input class="txt" id="eP" inputmode="decimal" value="${esc(keep.p)}" placeholder="25.00">
        <label class="note">Wholesale price, including GST</label><input class="txt" id="eW" inputmode="decimal" value="${esc(keep.w)}" placeholder="for shop orders">
        <label class="tickrow"><input type="checkbox" id="eNW" ${keep.nw?'checked':''}><span>Not sold wholesale</span></label>
        <p class="note">Button colour</p><div class="colours">${Object.entries(COLOURS).map(([k,v])=>`<button data-c="${k}" class="${(col||guessColour(keep.n,keep.z))===k?'on':''}" style="background:${v[0]};color:${v[1]}">${v[2]}</button>`).join('')}</div>
        ${isNew?'':`<div class="row"><div class="grow">Show on the till</div><div class="seg"><button data-a="1" class="${p.active!==false?'on':''}">Show</button><button data-a="0" class="${p.active===false?'on':''}">Hide</button></div></div>`}
        <div class="mact">${isNew?'':'<button class="btn danger" id="eD">Delete</button>'}<button class="btn alt" id="eC">Cancel</button><button class="btn" id="eS">Save</button></div>`;
      m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{ col=b.dataset.c; draw(); });
      m.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ p.active=b.dataset.a==='1'; draw(); });
      m.querySelector('#eC').onclick=close;
      const d=m.querySelector('#eD'); if(d) d.onclick=()=>{ close(); confirmBox('Delete '+prodName(p)+'?','Past sales keep their record. To stop selling it for now, Hide it instead.','Delete',()=>{ removeProduct(p); save(); render(); },true); };
      m.querySelector('#eS').onclick=()=>{ const name=m.querySelector('#eN').value.trim(), size=m.querySelector('#eZ').value.trim(), c=toCents(m.querySelector('#eP').value);
        if(!name){ toast('Type the product name'); return; } if(!(c>0)){ toast('Type a price, e.g. 25'); return; }
        const wT=m.querySelector('#eW').value.trim(), w=wT?toCents(wT):0; if(wT&&!(w>0)){ toast('Type the wholesale price, e.g. 18'); return; }
const doSave=()=>{         Object.assign(p,{name,size,price:c,wholesale:w||0,noWholesale:!(w>0)&&m.querySelector('#eNW').checked,colour:col||guessColour(name,size),active:p.active!==false,updated:Date.now()});
        if(isNew){ p.id=SYNC.newId('products'); S.products.push(p); }
        save(); close(); render(); toast('Saved '+prodName(p)+' at '+money(c/100)); if(done) done(p); };
        if(wasOff&&p.active!==false) withTillPin(name,doSave); else doSave(); };
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
    if(/^(product|item|name)s?$/i.test(name)||/^(total|subtotal|gst)\b/i.test(name)) continue;
    out.push({name,size,price:Math.round(parseFloat(m[1])*100)});
  }
  return out;
}
/* ---------- Load a price list: PDF, Excel, CSV or pasted text ----------
   The file is read on this device and never uploaded. Nothing changes until the owner has checked every
   line: new products, price changes (old → new), unchanged, and products missing from the list. */
const normKey=(name,size)=>(String(name).trim()+'|'+String(size||'').trim()).toLowerCase().replace(/\s+/g,' ').replace(/(\d)\s+(ml|g|kg|l)\b/g,'$1$2');
const productKey=p=>normKey(p.name,p.size);
function loadScript(src){ return new Promise((ok,bad)=>{ const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>bad(new Error('Could not load '+src+'. Are you online?')); document.head.appendChild(s); }); }
// PDF → lines of text, columns separated by tabs (from the gaps between words on each line)
async function pdfToText(file){
  const pdfjs=await import('./lib/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc='lib/pdf.worker.min.mjs';
  const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise; const out=[];
  for(let n=1;n<=doc.numPages;n++){
    const items=(await (await doc.getPage(n)).getTextContent()).items.filter(i=>i.str&&i.str.trim());
    const rows=[];
    for(const it of items){ const y=it.transform[5], x=it.transform[4]; let r=rows.find(r=>Math.abs(r.y-y)<3); if(!r){ r={y,items:[]}; rows.push(r); } r.items.push({x,w:it.width,s:it.str,h:Math.abs(it.transform[3])||10}); }
    rows.sort((a,b)=>b.y-a.y);
    for(const r of rows){ r.items.sort((a,b)=>a.x-b.x); let line='', end=null;
      for(const it of r.items){ if(end!==null){ const gap=it.x-end; line+=gap>it.h*1.2?'\t':(gap>it.h*0.15?' ':''); } line+=it.s; end=it.x+it.w; }
      out.push(line.trim()); }
  }
  return out.join('\n');
}
async function sheetToText(file){
  if(!window.XLSX) await loadScript('lib/xlsx.js');
  const wb=XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array'}), out=[];
  for(const name of wb.SheetNames){ for(const row of XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,blankrows:false})){ const cells=row.map(c=>String(c==null?'':c).trim()).filter(Boolean); if(cells.length) out.push(cells.join('\t')); } }
  return out.join('\n');
}
async function fileToText(file){
  const n=file.name.toLowerCase();
  if(/\.pdf$/.test(n)||file.type==='application/pdf') return pdfToText(file);
  if(/\.(xlsx|xlsm|xls|ods)$/.test(n)) return sheetToText(file);
  if(/\.(csv|txt|tsv)$/.test(n)||/^text\//.test(file.type)) return file.text();
  if(/^image\//.test(file.type)||/\.(png|jpe?g|heic|webp)$/.test(n)) throw new Error('That is a picture. Reading prices from a photo isn\'t reliable enough for a till: please choose the PDF or spreadsheet instead.');
  throw new Error('That type of file can\'t be read. Choose a PDF, Excel or CSV file.');
}
// Compare a parsed list with the products already on the till.
function comparePriceList(rows){
  const byKey=new Map(S.products.map(p=>[productKey(p),p])), seen=new Map(), dupes=[];
  for(const r of rows){ const k=normKey(r.name,r.size); if(seen.has(k)){ if(seen.get(k).price!==r.price) dupes.push(r); continue; } seen.set(k,r); }
  const add=[], change=[], same=[];
  for(const [k,r] of seen){ const p=byKey.get(k); if(!p) add.push(r); else if(p.price!==r.price||p.active===false) change.push({r,p}); else same.push({r,p}); }
  const missing=S.products.filter(p=>p.active!==false&&!seen.has(productKey(p)));
  const odd=[...seen.values()].filter(r=>r.price<100||r.price>50000);
  return {add,change,same,missing,dupes,odd};
}
function loadPriceList(){
  modal((m,close)=>{ let text='', source='', cmp=null, pick={add:new Set(),change:new Set(),hide:new Set()};
    const rowsHtml=(list,kind,fn)=>list.map((x,i)=>`<label class="row" style="cursor:pointer"><input type="checkbox" data-k="${kind}" data-i="${i}" ${pick[kind].has(i)?'checked':''} style="width:26px;height:26px;flex:none">${fn(x)}</label>`).join('');
    const draw=()=>{
      if(!cmp){ m.innerHTML=`<h2>📄 Load a price list</h2>
        <p class="note">Choose your price list: a <b>PDF</b>, an <b>Excel</b> sheet or a <b>CSV</b> file. It's read on this device and isn't uploaded anywhere. Every price must <b>include GST</b>.</p>
        <label class="btn bigbtn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">📂 Choose a file<input type="file" id="lF" accept=".pdf,.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,application/pdf" hidden></label>
        <p class="note" id="lMsg" style="min-height:24px"></p>
        <details><summary class="note">Or paste the list as text</summary><p class="note">One product per line: name, size, price. For example: <b>Calendula Infused Oil, 50ml, 20</b></p>
          <textarea class="txt" id="lT" rows="6" style="min-height:140px"></textarea><div class="mact"><button class="btn alt" id="lP">Read this text</button></div></details>
        <div class="mact"><button class="btn alt" id="lC">Cancel</button></div>`;
        m.querySelector('#lC').onclick=close;
        m.querySelector('#lF').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; const msg=m.querySelector('#lMsg'); msg.textContent='Reading '+f.name+'…';
          try{ text=await fileToText(f); source=f.name; read(); }catch(x){ msg.innerHTML='<b style="color:var(--danger)">'+esc(x.message||x)+'</b>'; } };
        m.querySelector('#lP').onclick=()=>{ text=m.querySelector('#lT').value; source='pasted text'; read(); };
        return; }
      const {add,change,same,missing,dupes,odd}=cmp, nA=pick.add.size, nC=pick.change.size, nH=pick.hide.size;
      m.innerHTML=`<h2>Check before updating the till</h2><p class="note">From <b>${esc(source)}</b>. Untick anything that's wrong; fix it afterwards in Products and prices. Prices include GST.</p>
        ${odd.length?`<p class="change bad" style="font-size:16px;text-align:left">⚠️ Check these prices, they look unusual: ${odd.map(r=>esc(r.name)+' '+c2(r.price)).join(', ')}</p>`:''}
        ${dupes.length?`<p class="change bad" style="font-size:16px;text-align:left">⚠️ Listed twice with different prices (the first one is used): ${dupes.map(r=>esc(r.name)+' '+esc(r.size)).join(', ')}</p>`:''}
        <div style="max-height:55vh;overflow:auto">
        ${add.length?`<h3 style="margin:14px 0 4px">🆕 New products (${add.length})</h3>`+rowsHtml(add,'add',r=>`<div class="grow"><b>${esc(r.name)}</b><small>${esc(r.size)}</small></div><b>${c2(r.price)}</b>`):''}
        ${change.length?`<h3 style="margin:14px 0 4px">✏️ Price changes (${change.length})</h3>`+rowsHtml(change,'change',x=>`<div class="grow"><b>${esc(x.r.name)}</b><small>${esc(x.r.size)}${x.p.active===false?' · will be shown on the till again':''}</small></div><span style="white-space:nowrap"><s style="color:var(--muted)">${c2(x.p.price)}</s> → <b>${c2(x.r.price)}</b></span>`):''}
        ${missing.length?`<h3 style="margin:14px 0 4px">❓ On the till but not in this list (${missing.length})</h3><p class="note">Tick any to <b>hide</b> from the till. Past sales are kept.</p>`+rowsHtml(missing,'hide',p=>`<div class="grow">${esc(p.name)}<small>${esc(p.size||'')}</small></div><span>${c2(p.price)}</span>`):''}
        ${same.length?`<p class="note" style="margin-top:14px">✓ ${same.length} product${same.length===1?'':'s'} already on the till at the same price.</p>`:''}
        ${!add.length&&!change.length&&!missing.length?'<p>Everything already matches the till. Nothing to change.</p>':''}
        </div>
        <div class="mact"><button class="btn alt" id="lB">Choose another file</button>${nA+nC+nH?`<button class="btn" id="lGo">Update the till: ${[nA&&'add '+nA,nC&&'change '+nC,nH&&'hide '+nH].filter(Boolean).join(', ')}</button>`:'<button class="btn" id="lX">Close</button>'}</div>`;
      m.querySelectorAll('[data-k]').forEach(c=>c.onchange=()=>{ const set=pick[c.dataset.k], i=+c.dataset.i; c.checked?set.add(i):set.delete(i); draw(); });
      m.querySelector('#lB').onclick=()=>{ cmp=null; draw(); };
      const x=m.querySelector('#lX'); if(x) x.onclick=close;
      const go=m.querySelector('#lGo'); if(go) go.onclick=()=>{ const now=Date.now();
        add.forEach((r,i)=>{ if(pick.add.has(i)) S.products.push({id:SYNC.newId('products'),name:r.name,size:r.size,price:r.price,colour:guessColour(r.name,r.size),active:true,updated:now}); });
        change.forEach((x,i)=>{ if(pick.change.has(i)) Object.assign(x.p,{price:x.r.price,active:true,updated:now}); });
        missing.forEach((p,i)=>{ if(pick.hide.has(i)) Object.assign(p,{active:false,updated:now}); });
        save(); close(); render(); toast('Till updated: '+[nA&&nA+' added',nC&&nC+' changed',nH&&nH+' hidden'].filter(Boolean).join(', ')); };
    };
    const read=()=>{ const rows=parsePriceList(text);
      if(!rows.length){ const msg=m.querySelector('#lMsg'); if(msg) msg.innerHTML='<b style="color:var(--danger)">No products with prices were found in '+esc(source)+'. Each line needs a name and a price.</b>'; else toast('No products found'); return; }
      cmp=comparePriceList(rows); pick={add:new Set(cmp.add.map((_,i)=>i)),change:new Set(cmp.change.map((_,i)=>i)),hide:new Set()}; draw(); };
    draw(); });
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
// cart items are {pid, qty} for till products, or {pid:'x-…', qty, custom:{name,size,price,colour,approvedBy}} for an
// approved item that isn't on the till. disc is an approved discount {kind:'pct'|'amt', value, reason, approvedBy}.
function priceCart(cart,disc){
  const lines=[]; let subtotal=0;
  for(const c of cart){ if(c.qty<1) continue;
    if(c.custom){ const u=c.custom; lines.push({pid:c.pid,name:u.name,size:u.size||'',qty:c.qty,unit:u.price,amount:u.price*c.qty,custom:true,approvedBy:u.approvedBy||null}); subtotal+=u.price*c.qty; continue; }
    const p=S.products.find(x=>x.id===c.pid); if(!p) continue; lines.push(Object.assign({pid:p.id,name:p.name,size:p.size||'',qty:c.qty,unit:p.price,amount:p.price*c.qty},c.approvedBy?{approvedBy:c.approvedBy,offTill:true}:{})); subtotal+=p.price*c.qty; }
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
  let manual=null;
  if(disc&&subtotal-discount>0){ const base=subtotal-discount, amt=disc.kind==='pct'?Math.round(base*disc.value/100):Math.min(disc.value,base);
    manual=Object.assign({},disc,{amount:amt}); discount+=amt; }
  return {lines,deals,manual,subtotal,discount,total:subtotal-discount};
}
