/* ================= Address suggestions, supplier price lists, weather trends, and branding ================= */

/* ---------- address suggestions while typing (free: Photon, built on OpenStreetMap) ----------
   Typing in an address box offers up to five matching New Zealand addresses; tapping one fills it in.
   Typing it by hand always works too, and with no signal nothing is offered. Only what's typed in the box
   is sent, nothing else. */
const ADDR_IDS=['pA','oA','homeAddr'];
let addrTimer=null, addrSeq=0;
document.addEventListener('input',e=>{ const el=e.target; if(!el||!ADDR_IDS.includes(el.id)) return;
  clearTimeout(addrTimer); const q=el.value.trim(); addrClose(el); if(q.length<5||!navigator.onLine) return;
  addrTimer=setTimeout(()=>addrLookup(el,q),450); });
document.addEventListener('focusout',e=>{ if(ADDR_IDS.includes(e.target&&e.target.id)) setTimeout(()=>addrClose(e.target),250); });
function addrClose(el){ const n=el&&el.nextElementSibling; if(n&&n.classList.contains('addrlist')) n.remove(); }
async function addrLookup(el,q){
  const seq=++addrSeq;
  try{ const r=await fetch('https://photon.komoot.io/api/?limit=5&lang=en&bbox=166,-47.5,179,-34&q='+encodeURIComponent(q)); if(!r.ok||seq!==addrSeq) return;
    const j=await r.json(), l=[...new Set((j.features||[]).map(f=>addrText(f.properties||{})).filter(Boolean))];
    if(seq!==addrSeq||!document.body.contains(el)||el.value.trim()!==q) return; addrClose(el); if(!l.length) return;
    const box=document.createElement('div'); box.className='addrlist';
    box.innerHTML=l.map(a=>`<button type="button" data-addr="${esc(a)}">📍 ${esc(a)}</button>`).join('')+'<small>Suggestions from OpenStreetMap · or keep typing</small>';
    el.after(box);
    box.querySelectorAll('[data-addr]').forEach(b=>b.onmousedown=b.ontouchstart=ev=>{ ev.preventDefault(); el.value=b.dataset.addr; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); addrClose(el); });
  }catch(e){}
}
function addrText(p){ const street=[p.housenumber,p.street].filter(Boolean).join(' ')||(p.name&&p.name!==p.city?p.name:'');
  return [street,p.district||p.locality,p.city||p.county,p.postcode].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(', '); }

/* ---------- import a supplier's price list ----------
   Paste it (copy the rows from their email or spreadsheet), or open a .csv file. Each line with a price is
   read as an item; anything that matches an ingredient or packaging item already here updates its price
   (kept in the price history), and the rest can be added. A photo or PDF of a list goes to the assistant instead. */
document.addEventListener('click',e=>{ if(e.target.closest&&e.target.closest('#inImp')) importPrices(); });
function parseSupplierList(txt){
  const out=[];
  String(txt||'').split(/\r?\n/).forEach(line=>{ const cells=line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)|;/).map(c=>c.replace(/^"|"$/g,'').trim()).filter(Boolean); if(!cells.length) return;
    const money=cells.map(c=>/^\$?\s*\d{1,5}(?:[.,]\d{1,2})?$/.test(c.replace(/NZD|ex|incl|gst/ig,'').trim())?+c.replace(/[^0-9.,]/g,'').replace(',','.'):null);
    const pi=money.map((v,i)=>v!=null&&/\$|\./.test(cells[i])?i:-1).filter(i=>i>=0).pop(); const k=pi!=null&&pi>=0?pi:money.findIndex((v,i)=>v!=null&&i>0);
    if(k<0||money[k]==null||!(money[k]>0)) return;
    const name=cells.filter((c,i)=>i!==k&&money[i]==null&&/[a-z]/i.test(c)).join(' ').slice(0,80); if(!name||/^(item|product|description|name)$/i.test(name)) return;
    const pkg=/jar|bottle|lid|label|tin|box|bag|tube|pump|cap|dropper|pot|sleeve|ribbon/i.test(name);
    const pm=pkg?null:name.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/i), cm=name.match(/(?:pack|box|qty|x)\s*(?:of)?\s*(\d+)|(\d+)\s*(?:pack|pcs|pk)\b/i);
    out.push({name,price:Math.round(money[k]*100),pack:cm?+(cm[1]||cm[2]):pm?(/kg|^l$/i.test(pm[2])?+pm[1]*1000:+pm[1]):1,unit:cm||pkg?'each':pm?(/^(ml|l)$/i.test(pm[2])?'ml':'g'):'each'}); });
  return out;
}
const supKey=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function matchInput(n){ const k=supKey(n); return S.inputs.find(i=>supKey(i.name)===k)||S.inputs.find(i=>{ const a=supKey(i.name); return a.length>4&&(k.includes(a)||a.includes(k)); })||null; }
function importPrices(){
  let rows=[], gstIn=false, sup='';
  modal((m,close)=>{ const draw=()=>{
      m.innerHTML=`<h2>📥 Import a price list</h2>
        ${rows.length?`<p class="note">${rows.length} item${rows.length===1?'':'s'} read. Check each: update an item you have, add it as new, or skip it.</p>
          <label class="tickrow"><input type="checkbox" id="plG" ${gstIn?'checked':''}><span>These prices include GST (they're stored ex GST)</span></label>
          ${rows.map((r,i)=>`<div class="lrow"><div class="grow ltxt"><b>${esc(r.name)}</b><small>${c2(r.price)}${r.pack>1?' for '+fmtQty(r.pack,r.unit):''}${r.match?' · now '+c2(r.match.price):''}</small></div>
            <select class="txt" data-pla="${i}" style="width:auto;min-height:44px">${r.match?`<option value="upd" ${r.act==='upd'?'selected':''}>Update “${esc(r.match.name)}”</option>`:''}<option value="new" ${r.act==='new'?'selected':''}>Add as new</option><option value="skip" ${r.act==='skip'?'selected':''}>Skip</option></select></div>`).join('')}
          <div class="mact"><button class="btn alt" id="plBack">Start again</button><button class="btn" id="plOk">Save</button></div>`
        :`<p class="note">Copy the rows from the supplier's email or spreadsheet and paste them here, or open their list saved as a .csv file. A photo or PDF of a list: send it to the assistant (🎙) instead.</p>
          <label class="note" for="plS">Supplier</label><input class="txt" id="plS" list="plSl" value="${esc(sup)}"><datalist id="plSl">${[...new Set(S.inputs.map(x=>x.supplier).filter(Boolean))].map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
          <textarea class="txt" id="plT" rows="7" placeholder="e.g.\nAmber jar 50ml, $1.20\nAmber jar 100ml, $1.55"></textarea>
          <div class="mact"><label class="btn alt">📄 Open a .csv file<input type="file" id="plF" accept=".csv,.txt,text/csv,text/plain" hidden></label><button class="btn alt" id="plC">Cancel</button><button class="btn" id="plRead">Read it</button></div>`}`;
      if(!rows.length){
        const read=t=>{ sup=m.querySelector('#plS').value.trim(); rows=parseSupplierList(t).map(r=>{ const mt=matchInput(r.name); return Object.assign(r,{match:mt,act:mt?'upd':'new'}); }); if(!rows.length){ toast('No prices found in that'); return; } draw(); };
        m.querySelector('#plC').onclick=close; m.querySelector('#plRead').onclick=()=>read(m.querySelector('#plT').value);
        m.querySelector('#plF').onchange=e=>{ const f=e.target.files[0]; if(!f) return; if(f.size>500e3){ toast('That file is too big'); return; } f.text().then(read); };
        return; }
      m.querySelector('#plG').onchange=e=>{ gstIn=e.target.checked; };
      m.querySelectorAll('[data-pla]').forEach(s=>s.onchange=()=>{ rows[+s.dataset.pla].act=s.value; });
      m.querySelector('#plBack').onclick=()=>{ rows=[]; draw(); };
      m.querySelector('#plOk').onclick=()=>{ let u=0,a=0;
        rows.forEach(r=>{ if(r.act==='skip') return; const cents=gstIn?Math.round(r.price/1.15):r.price;
          if(r.act==='upd'&&r.match){ const i=r.match; if(r.unit===i.unit&&i.pack>0) i.price=Math.round(cents*i.pack/(r.pack||1)); else Object.assign(i,{price:cents,pack:r.pack||1,unit:r.unit}); if(sup&&!i.supplier) i.supplier=sup; i.updated=Date.now();
            S.prices.push({id:SYNC.newId('prices'),input:i.id,item:i.name,cents:i.price,pack:i.pack,unit:i.unit,date:nzDay(),at:Date.now(),by:SYNC.me(),from:'price list'}); u++; }
          else { const i={id:SYNC.newId('inputs'),name:r.name,cat:/jar|bottle|lid|label|tin|box|bag|tube|pump|cap|dropper/i.test(r.name)?'packaging':'ingredient',price:cents,pack:r.pack||1,unit:r.unit,supplier:sup,updated:Date.now()};
            S.inputs.push(i); S.prices.push({id:SYNC.newId('prices'),input:i.id,item:i.name,cents,pack:i.pack,unit:i.unit,date:nzDay(),at:Date.now(),by:SYNC.me(),from:'price list'}); a++; } });
        save(); close(); render(); toast((u?u+' price'+(u===1?'':'s')+' updated':'')+(u&&a?', ':'')+(a?a+' added':'')||'Nothing changed'); };
    }; draw(); },{big:true});
}

/* ---------- weather and takings (Real profit) ----------
   From the market check-ins: what each kind of weather did to the takings, over the last two years. */
function weatherTrends(){
  const from=dk(addDays(kd(nzDay()),-730)), by={}; let all=0, n=0;
  S.sessions.forEach(ses=>{ if(ses.type!=='market'||ses.date<from||!ses.checkin) return; const tk=S.sales.filter(s=>!s.voided&&s.sessionId===ses.id).reduce((t,s)=>t+s.total,0); all+=tk; n++;
    (ses.checkin.weather||[]).forEach(w=>{ const x=by[w]||(by[w]={days:0,tk:0,busy:0}); x.days++; x.tk+=tk; if(/busy|flat/.test(ses.checkin.busy||'')) x.busy++; }); });
  const avg=n?all/n:0;
  return {n,avg,rows:WEATHER.filter(([k])=>by[k]).map(([k,t])=>({k,t,days:by[k].days,avg:by[k].tk/by[k].days,busy:by[k].busy,diff:avg?by[k].tk/by[k].days/avg-1:0})).sort((a,b)=>b.avg-a.avg)};
}
function weatherCard(){
  const w=weatherTrends();
  return `<div class="card"><h3>🌦️ Weather and takings</h3>${w.n<3?`<p class="note">Builds up from the check-in after each market (the weather is filled in for you). ${w.n} market${w.n===1?'':'s'} so far: it needs 3 or more.</p>`
    :`<p class="note">An average market day takes ${c2(Math.round(w.avg))} (${w.n} markets with a check-in, last two years).</p>${w.rows.map(r=>`<div class="lrow"><div class="grow ltxt"><b>${r.t}</b><small>${r.days} market${r.days===1?'':'s'} · ${r.busy} busy or flat out</small></div><b>${c2(Math.round(r.avg))}</b><span class="pill ${r.diff>=0.05?'ok':r.diff<=-0.05?'bad':''}">${r.diff>=0?'+':''}${Math.round(r.diff*100)}%</span></div>`).join('')}`}</div>`;
}

/* ---------- branding: logo, colours and font for each business (Setup, owners) ---------- */
const THEMES={olive:{n:'Olive and sage',c:['#2f3b1f','#6b703e','#806092','#f7f5ee']},ocean:{n:'Ocean',c:['#1f3b4d','#3e6a7a','#5a7fa0','#f3f6f7']},berry:{n:'Berry',c:['#4a1f35','#8a4d6a','#b0678f','#f8f2f4']},
  clay:{n:'Terracotta',c:['#4d2a1f','#a0583e','#c98a3b','#f8f3ee']},slate:{n:'Charcoal',c:['#2b2b2b','#5f6b6d','#7a8a8c','#f5f5f3']},forest:{n:'Forest',c:['#173d2a','#3f7a55','#7a6aa0','#f2f6f0']}};
const FONTS={brand:{n:'Classic capitals',f:'"Cinzel",Georgia,serif'},serif:{n:'Book',f:'Georgia,"Times New Roman",serif'},sans:{n:'Clean',f:'-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'},round:{n:'Friendly',f:'"Trebuchet MS","Gill Sans",sans-serif'}};
let brandApplied='';
function applyBrand(){
  const b=(S.settings&&S.settings.brand)||{}, key=JSON.stringify([b.theme,b.font]); if(key===brandApplied) return; brandApplied=key;
  const t=THEMES[b.theme]||THEMES.olive, f=FONTS[b.font]||FONTS.brand, r=document.documentElement.style;
  r.setProperty('--green',t.c[0]); r.setProperty('--green2',t.c[1]); r.setProperty('--lav',t.c[2]); r.setProperty('--cream',t.c[3]); r.setProperty('--brand-font',f.f);
  const mt=document.querySelector('meta[name="theme-color"]'); if(mt) mt.setAttribute('content',t.c[0]);
}
const brandLogo=()=>((S.settings&&S.settings.brand)||{}).logo||'brand-logo.webp';
function brandCardHtml(){
  if(role()!=='owner') return ''; const b=S.settings.brand||{};
  return `<div class="card"><h3>🎨 Look and branding</h3><p class="note">For this business only: its logo on the home screen, its colours and its heading font.</p>
    <div class="row"><div class="grow"><b>Logo</b><small>${b.logo?'Your own logo':'The Rata &amp; Smudge logo'}</small></div><img src="${esc(brandLogo())}" alt="" style="max-height:56px;max-width:140px;object-fit:contain"><label class="btn alt small">Change<input type="file" id="brLogo" accept="image/*" hidden></label>${b.logo?'<button class="btn alt small" id="brLogoX">Remove</button>':''}</div>
    <p class="note" style="margin-bottom:4px"><b>Colours</b></p><div class="themes">${Object.entries(THEMES).map(([k,t])=>`<button class="theme ${(b.theme||'olive')===k?'on':''}" data-theme="${k}"><span>${t.c.map(c=>`<i style="background:${c}"></i>`).join('')}</span>${t.n}</button>`).join('')}</div>
    <p class="note" style="margin-bottom:4px"><b>Heading font</b></p><div class="pastnames">${Object.entries(FONTS).map(([k,f])=>`<button class="chip big ${(b.font||'brand')===k?'on':''}" data-font="${k}" style="font-family:${f.f.replace(/"/g,'&quot;')}">${f.n}</button>`).join('')}</div>
    <p class="note">The icon on the home screen stays the app's own.</p></div>`;
}
document.addEventListener('click',e=>{ const t=e.target.closest&&e.target.closest('[data-theme],[data-font],#brLogoX'); if(!t||role()!=='owner') return;
  const b=Object.assign({},S.settings.brand);
  if(t.dataset.theme) b.theme=t.dataset.theme; else if(t.dataset.font) b.font=t.dataset.font; else delete b.logo;
  S.settings.brand=b; save(); render(); });
document.addEventListener('change',e=>{ if(!e.target||e.target.id!=='brLogo'||role()!=='owner') return; const f=e.target.files[0]; if(!f) return;
  const img=new Image(), url=URL.createObjectURL(f);
  img.onload=()=>{ const s=Math.min(1,400/Math.max(img.width,img.height)), c=document.createElement('canvas'); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url); let d=c.toDataURL('image/webp',0.85); if(!/^data:image\/webp/.test(d)) d=c.toDataURL('image/png');
    if(d.length>150e3){ toast('That logo is too detailed. Try a smaller image.'); return; }
    S.settings.brand=Object.assign({},S.settings.brand,{logo:d}); save(); render(); toast('Logo saved'); };
  img.onerror=()=>toast('Couldn\'t open that picture'); img.src=url; });
