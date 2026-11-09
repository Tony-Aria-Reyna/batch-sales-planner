/* ================= Brew and stock =================
   The workbook's model, without the #N/A: everything links by ID, never by typed name.
     inputs   ingredients and packaging: price ex GST for a pack, pack size, unit (g, ml, each)
     recipes  (owners only) a batch: yield and unit, and the ingredient lines per batch
     products the till buttons, plus which recipe fills them, how much goes in each, and their packaging
     batches  a planned or made brew, with the cost per unit frozen on the day it was made
     plans    what's being made and how many of each: helpers see this, never the recipe or the cost
     stockmoves  made, packed for a market, returned, used, bought, counted or fixed. Stock is worked out
              from these and the sales, so it is only ever a hint: the till never stops a sale because of it.
   Stock places: "At home" and "Out with me" (packed for today's market, less what's sold there today).
   At the end of the day anything still out counts as home again. */
const UNITS=['g','ml','each'];
const inputCost=i=>i&&i.pack>0?(i.price||0)/i.pack:0;               // cents (ex GST) per g, ml or each
const recipeOf=p=>p&&p.recipe?S.recipes.find(r=>r.id===p.recipe):null;
const recipeCost=r=>(r.lines||[]).reduce((n,l)=>n+(+l.qty||0)*inputCost(S.inputs.find(i=>i.id===l.input)),0);  // cents per batch
const packCost=p=>(p.pack||[]).reduce((n,l)=>n+(+l.qty||0)*inputCost(S.inputs.find(i=>i.id===l.input)),0);
// cost of one unit, ex GST, in cents (null when the recipe or fill isn't set)
function unitCost(p){ const r=S.recipes.find(x=>x.id===p.recipe); if(!r||!(r.yield>0)||!(p.fill>0)) return null; return recipeCost(r)/r.yield*p.fill+packCost(p); }

/* ---------- stock ---------- */
const soldOf=(pid,since)=>S.sales.reduce((n,s)=>s.voided||(since&&s.at<since)?n:n+(s.lines||[]).filter(l=>l.pid===pid).reduce((a,l)=>a+l.qty,0),0);
// stock of one product: counting starts at its first stock record, so sales before tracking began don't count
let stockMemo={key:'',v:{}};
function stockOf(pid){
  const key=S.sales.length+'|'+S.stockmoves.length+'|'+nzDay()+'|'+(S.sales[S.sales.length-1]||{}).id+'|'+S.sales.filter(x=>x.voided).length;
  if(stockMemo.key!==key) stockMemo={key,v:{}}; if(pid in stockMemo.v) return stockMemo.v[pid];
  return stockMemo.v[pid]=stockCalc(pid);
}
function stockCalc(pid){
  const moves=S.stockmoves.filter(m=>m.product===pid&&m.kind!=='packed'&&m.kind!=='returned').sort((a,b)=>a.at-b.at);
  if(!moves.length) return null;
  let base=0, since=moves[0].at; const lastCount=[...moves].reverse().find(m=>m.kind==='count');
  if(lastCount){ base=lastCount.qty; since=lastCount.at; }
  for(const m of moves) if(m.at>=since&&m.kind!=='count') base+=m.qty;
  const total=base-soldOf(pid,since);
  const today=nzDay(), pm=S.stockmoves.filter(m=>m.product===pid&&m.date===today&&(m.kind==='packed'||m.kind==='returned'));
  const packed=pm.reduce((n,m)=>n+(m.kind==='packed'?m.qty:-m.qty),0), packedAt=pm.length?Math.min(...pm.map(m=>m.at)):0;
  // what's sold away from home after packing comes out of what was taken
  const soldOut=packed>0?S.sales.filter(s=>!s.voided&&s.date===today&&s.at>=packedAt&&s.channel!=='farmgate').reduce((n,s)=>n+(s.lines||[]).filter(l=>l.pid===pid).reduce((a,l)=>a+l.qty,0),0):0;
  const out=Math.max(0,packed-soldOut);
  return {total,out,home:total-out};
}
const inputStock=iid=>{ const ms=S.stockmoves.filter(m=>m.input===iid).sort((a,b)=>a.at-b.at); if(!ms.length) return null;
  const c=[...ms].reverse().find(m=>m.kind==='count'); let n=c?c.qty:0; ms.forEach(m=>{ if(m.kind!=='count'&&(!c||m.at>=c.at)) n+=m.qty; }); return n; };
const moveStock=(o)=>{ S.stockmoves.push(Object.assign({id:SYNC.newId('stockmoves'),by:SYNC.me(),at:Date.now(),date:nzDay()},o)); };
const fmtQty=(n,u)=>(Math.round(n*100)/100)+(u==='each'?'':' '+u);

/* ---------- what to make next ---------- */
// average sold at a market day over the last 8 weeks, times the markets in the next 14 days, less stock
function makeNext(){
  const now=Date.now(), since=now-56*864e5;
  const marketDays=S.sessions.filter(s=>s.openedAt>=since&&s.type==='market'), mdIds=new Set(marketDays.map(s=>s.id));
  let upcoming=0; for(let i=0;i<14;i++){ const k=dk(addDays(kd(nzDay()),i)); upcoming+=eventsOn(k).filter(e=>e.type==='market').length; }
  return S.products.filter(p=>p.active!==false&&p.recipe).map(p=>{
    const perMarket=marketDays.length?S.sales.filter(s=>!s.voided&&mdIds.has(s.sessionId)).reduce((n,s)=>n+(s.lines||[]).filter(l=>l.pid===p.id).reduce((a,l)=>a+l.qty,0),0)/marketDays.length:0;
    const st=stockOf(p.id), need=Math.ceil(perMarket*upcoming), have=st?st.total:null;
    return {p,perMarket,need,have,short:have==null?null:need-have};
  }).filter(x=>x.need>0).sort((a,b)=>(b.short??-1e9)-(a.short??-1e9)).map(x=>Object.assign(x,{upcoming}));
}

/* ---------- the Brew screen ---------- */
let brewTab=lsGet('rs.brewtab','next'), brewPlan=null;
const BREW_TABS=()=>canManage()?[['next','🔮 What to make'],['plan','🫙 Plan a brew'],['stock','📦 Stock'],['batches','📒 Batches']]:[['plan','🫙 Brew plan'],['stock','📦 Stock']];
SCREENS.brew={
  title:()=>({h:'Brew and stock',s:canManage()?'What to make, batches and stock':'What\'s being made, and stock'}),
  html(){
    const tabs=BREW_TABS(); if(!tabs.some(t=>t[0]===brewTab)) brewTab=tabs[0][0];
    const body=brewTab==='next'?nextHtml():brewTab==='plan'?(canManage()?planHtml():plansHtml()):brewTab==='batches'?batchesHtml():stockHtml();
    return rulesNotice()+`<div class="ctabs">${tabs.map(([k,v])=>`<button class="chip big ${brewTab===k?'on':''}" data-bt="${k}">${v}</button>`).join('')}</div>`+body;
  },
  wire(){
    document.querySelectorAll('[data-bt]').forEach(b=>b.onclick=()=>{ brewTab=b.dataset.bt; lsSet('rs.brewtab',brewTab); render(); });
    if(brewTab==='next') wireNext(); else if(brewTab==='plan') (canManage()?wirePlan:wirePlans)(); else if(brewTab==='batches') wireBatches(); else wireStock();
  }
};
function needSetupHtml(){
  return `<div class="card"><h3>First, the recipes</h3><p class="note">Add the ingredients, recipes and which products each recipe fills, or import them from the Batch Planning workbook.</p>
    <div class="mact" style="justify-content:flex-start">${role()==='owner'?'<button class="btn" id="goRec">Products, recipes and ingredients</button>':'<p class="note">An owner sets up the recipes.</p>'}</div></div>`;
}
function nextHtml(){
  if(!S.products.some(p=>p.recipe)) return needSetupHtml();
  const l=makeNext(), up=l[0]?l[0].upcoming:0;
  return `<div class="card"><h3>For the next two weeks</h3><p class="note">${up} market${up===1?'':'s'} on the calendar. Based on what usually sells at a market over the last 8 weeks, less what's in stock.</p>
    ${l.length?l.map(x=>`<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(x.p))}</b><small>About ${Math.round(x.perMarket*10)/10} a market · need ${x.need} · ${x.have==null?'stock not counted yet':'have '+x.have}</small></div>
      ${x.short==null?'':x.short>0?`<span class="pill bad">Short ${x.short}</span>`:'<span class="pill ok">Enough</span>'}${x.short>0?`<button class="btn small" data-mk="${x.p.id}" data-n="${x.short}">Plan</button>`:''}</div>`).join('')
      :'<p class="note">Nothing needed yet: either no markets are coming up, or there are no market sales to go on.</p>'}</div>`;
}
function wireNext(){
  const g=$('#goRec'); if(g) g.onclick=()=>go('recipes');
  document.querySelectorAll('[data-mk]').forEach(b=>b.onclick=()=>{ const p=S.products.find(x=>x.id===b.dataset.mk), r=recipeOf(p); if(!r) return;
    const units=+b.dataset.n, mult=Math.max(1,Math.ceil(units*p.fill/r.yield));
    brewPlan={recipe:r.id,mult,date:nzDay(),fill:{[p.id]:units}}; brewTab='plan'; lsSet('rs.brewtab','plan'); render(); });
}

/* ---------- plan a brew (owners and managers) ---------- */
function planLines(r,mult){ return (r.lines||[]).map(l=>{ const i=S.inputs.find(x=>x.id===l.input)||{name:'(missing ingredient)',unit:'',pack:0,price:0}; const need=(+l.qty||0)*mult, have=inputStock(l.input);
  return {i,need,have,short:have==null?null:Math.max(0,need-have),cost:need*inputCost(i)}; }); }
function planHtml(){
  const recs=seesCosts()?S.recipes:[];
  if(!seesCosts()) return plansHtml()+`<div class="card"><p class="note">Recipes are owners-only, so planning a brew is done by an owner.</p></div>`;
  if(!recs.length) return needSetupHtml();
  const pl=brewPlan=brewPlan||{recipe:recs[0].id,mult:1,date:nzDay(),fill:{}}, r=S.recipes.find(x=>x.id===pl.recipe)||recs[0]; pl.recipe=r.id;
  const prods=S.products.filter(p=>p.recipe===r.id&&p.active!==false), total=r.yield*pl.mult;
  const used=prods.reduce((n,p)=>n+(+pl.fill[p.id]||0)*(p.fill||0),0), lines=planLines(r,pl.mult), pf=prods.find(p=>p.fill>0);
  const chosen=prods.filter(p=>(+pl.fill[p.id]||0)>0), gaps=chosen.some(p=>!(p.fill>0))||lines.some(l=>noPrice(l.i))||chosen.some(p=>(p.pack||[]).some(x=>noPrice(S.inputs.find(i=>i.id===x.input))));
  const ing=lines.reduce((n,l)=>n+l.cost,0), pk=prods.reduce((n,p)=>n+(+pl.fill[p.id]||0)*packCost(p),0), units=prods.reduce((n,p)=>n+(+pl.fill[p.id]||0),0);
  return `<div class="card"><h3>Plan a brew</h3>
      <div class="formrow"><div><label class="note" for="bR">Recipe</label><select class="txt" id="bR">${recs.map(x=>`<option value="${x.id}" ${x.id===r.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div><label class="note" for="bM">How many batches</label><input class="txt" id="bM" type="number" min="0.25" step="0.25" value="${pl.mult}"></div></div>
      <label class="note" for="bD">Brew day</label><input class="txt" id="bD" type="date" value="${pl.date}">
      <p class="note">Makes ${fmtQty(total,r.unit)}${prods.length?'. How many of each:':'. No products use this recipe yet: link them under Products, recipes and ingredients → 🔗 Products.'}</p>
      ${recipeIssues(r).map(x=>`<p class="note clash">⚠️ ${esc(x.t)} <button class="linkb" data-fixrec="${r.id}">Fix it now</button></p>`).join('')}
      ${prods.map(p=>{ const st=stockOf(p.id), nf=!(p.fill>0); return `<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(p))}</b>${nf?'<small class="bad">⚠️ No fill set, so the amounts and cost are wrong</small>':`<small>${fmtQty(p.fill,r.unit)} each${st?' · '+st.total+' in stock':''}</small>`}</div>${nf?`<button class="btn small" data-fixlink="${p.id}">Fix it now</button>`:''}<input class="txt qty" type="number" min="0" data-fill="${p.id}" value="${pl.fill[p.id]||''}" placeholder="0"></div>`; }).join('')}
      ${prods.length?`<p class="note ${used>total?'clash':''}" id="bUse">${used>total?'⚠️ ':''}Uses ${fmtQty(used,r.unit)} of ${fmtQty(total,r.unit)}${used<total&&pf&&total-used>=pf.fill?` · ${fmtQty(total-used,r.unit)} left (about ${Math.floor((total-used)/pf.fill)} more ${esc(prodName(pf))})`:''}</p>`:''}</div>
    <div class="card"><h3>Ingredients</h3>${lines.map(l=>`<div class="lrow"><div class="grow ltxt"><b>${esc(l.i.name)}</b>${noPrice(l.i)?'<small class="bad">⚠️ No price, so the cost is too low</small>':''}<small>Need ${fmtQty(l.need,l.i.unit)}${l.have==null?'':' · have '+fmtQty(l.have,l.i.unit)}</small></div>${noPrice(l.i)?`<button class="btn small" data-fixin="${l.i.id}">Fix it now</button>`:''}${l.short>0?`<span class="pill bad">Short ${fmtQty(l.short,l.i.unit)}</span>`:l.have!=null?'<span class="pill ok">OK</span>':''}</div>`).join('')}
      <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="bShop">🛒 Add ${lines.some(l=>l.short!=null)?'what\'s short':'all of these'} to the shopping list</button></div></div>
    <div class="card"><h3>Cost (ex GST)</h3>${gaps?'<p class="note clash">⚠️ Something above has no price or no fill, so this cost is wrong.</p>':''}<p class="${gaps?'bad':''}">Ingredients ${c2(ing)} · packaging ${c2(pk)}${units&&used>0?` · <b>${c2((ing*Math.min(1,used/total||0)+pk)/units)} a unit</b>`:''}</p>
      <div class="mact"><button class="btn alt" id="bSave">Save as planned</button><button class="btn" id="bMade">✓ Made it</button></div></div>`
    +plansHtml(true);
}
function wirePlan(){
  const g=$('#goRec'); if(g){ g.onclick=()=>go('recipes'); return; }
  wirePlans();
  if(!$('#bR')) return;
  const pl=brewPlan;
  $('#bR').onchange=e=>{ brewPlan={recipe:e.target.value,mult:1,date:pl.date,fill:{}}; render(); };
  $('#bM').onchange=e=>{ pl.mult=Math.max(0.25,+e.target.value||1); render(); };
  $('#bD').onchange=e=>{ pl.date=e.target.value||nzDay(); };
  document.querySelectorAll('[data-fill]').forEach(i=>i.onchange=()=>{ pl.fill[i.dataset.fill]=Math.max(0,Math.floor(+i.value||0)); render(); });
  $('#bShop').onclick=()=>{ const r=S.recipes.find(x=>x.id===pl.recipe); let n=0;
    for(const l of planLines(r,pl.mult)){ const want=l.short!=null?l.short:l.need; if(!(want>0)||S.shopping.some(x=>!x.done&&x.input===l.i.id)) continue;
      const packs=l.i.pack>0?Math.ceil(want/l.i.pack):1; S.shopping.push({id:SYNC.newId('shopping'),item:l.i.name,qty:packs,size:l.i.pack?fmtQty(l.i.pack,l.i.unit):'',input:l.i.id,done:false,by:SYNC.me(),at:Date.now(),from:'brew'}); n++; }
    save(); toast(n?n+' added to the shopping list':'Already on the list'); };
  document.querySelectorAll('[data-fixlink]').forEach(b=>b.onclick=()=>editLink(S.products.find(p=>p.id===b.dataset.fixlink)));
  document.querySelectorAll('[data-fixrec]').forEach(b=>b.onclick=()=>editRecipe(S.recipes.find(r=>r.id===b.dataset.fixrec)));
  document.querySelectorAll('[data-fixin]').forEach(b=>b.onclick=()=>editInput(S.inputs.find(i=>i.id===b.dataset.fixin)));
  // missing information: "Fix it now", or "Carry on anyway" (confirmed, and the batch shows ⚠️ with who and when)
  const checked=(status,go)=>{ const r=S.recipes.find(x=>x.id===pl.recipe), prods=S.products.filter(p=>p.recipe===r.id&&(+pl.fill[p.id]||0)>0);
    if(!prods.length){ toast('Fill in how many of each'); return; }
    const gaps=[...prods.filter(p=>!(p.fill>0)).map(p=>prodName(p)+' has no fill'),...planLines(r,pl.mult).filter(l=>noPrice(l.i)).map(l=>l.i.name+' has no price'),
      ...[...new Set(prods.flatMap(p=>(p.pack||[]).map(x=>S.inputs.find(i=>i.id===x.input)).filter(noPrice)))].map(i=>i.name+' has no price')];
    if(!gaps.length){ go(null); return; }
    modal((m,close)=>{ m.innerHTML=`<h2>⚠️ Something's missing</h2><ul>${gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul><p>So the ${status==='made'?'stock amounts and ':''}cost of this batch will be wrong.</p>
        <div class="mact"><button class="btn alt" id="gAny">Carry on anyway</button><button class="btn" id="gFix">Fix it now</button></div>`;
      m.querySelector('#gFix').onclick=()=>{ close(); const nf=prods.find(p=>!(p.fill>0)); if(nf) editLink(nf); else { const l=planLines(r,pl.mult).find(x=>noPrice(x.i)); if(l) editInput(l.i); else { const pi=prods.flatMap(p=>(p.pack||[]).map(x=>S.inputs.find(i=>i.id===x.input))).find(noPrice); if(pi) editInput(pi); } } };
      m.querySelector('#gAny').onclick=()=>{ close(); confirmBox('Carry on anyway?','The batch is saved with its cost marked ⚠️ and your name, until the missing information is filled in.','Carry on anyway',()=>go({by:SYNC.me(),at:Date.now(),what:gaps.join('; ')})); }; });
  };
  const keep=(status,override)=>{ const r=S.recipes.find(x=>x.id===pl.recipe), prods=S.products.filter(p=>p.recipe===r.id), items=prods.filter(p=>pl.fill[p.id]>0).map(p=>({pid:p.id,units:pl.fill[p.id]}));
    if(!items.length){ toast('Fill in how many of each'); return null; }
    const used=items.reduce((n,x)=>n+x.units*(S.products.find(p=>p.id===x.pid).fill||0),0);
    if(used>r.yield*pl.mult+1e-6){ toast('That needs more than the batch makes'); return null; }
    const id=SYNC.newId('batches'), ingCost=planLines(r,pl.mult).reduce((n,l)=>n+l.cost,0), share=used/(r.yield*pl.mult);
    // a product with no fill gets only its packaging cost (and the batch is marked), never a divide-by-zero
    const unitCosts={}; items.forEach(x=>{ const p=S.products.find(y=>y.id===x.pid); unitCosts[x.pid]=Math.round((p.fill>0&&used>0?ingCost*share*(x.units*p.fill/used)/x.units:0)+packCost(p)); });
    S.batches.push(Object.assign({id,recipe:r.id,recipeName:r.name,mult:pl.mult,date:pl.date,status,items,unitCost:unitCosts,ingredientCost:Math.round(ingCost),by:SYNC.me(),at:Date.now()},override?{override}:{}));
    S.plans.push({id:SYNC.newId('plans'),batch:id,date:pl.date,status,items:items.map(x=>({pid:x.pid,units:x.units})),at:Date.now()});
    return {id,r,items};
  };
  $('#bSave').onclick=()=>checked('planned',o=>{ if(keep('planned',o)){ save(); brewPlan=null; toast('Planned'); render(); } });
  $('#bMade').onclick=()=>checked('made',o=>{ const k=keep('made',o); if(!k) return; madeStock(k.id); save(); brewPlan=null; toast('Made: stock added'); render(); brewCheckin(k.id); });
}
// a batch made: products into stock (at home), ingredients and packaging used
function madeStock(batchId){
  const b=S.batches.find(x=>x.id===batchId), r=S.recipes.find(x=>x.id===b.recipe);
  b.items.forEach(x=>{ moveStock({kind:'made',product:x.pid,qty:x.units,batch:b.id}); const p=S.products.find(y=>y.id===x.pid);
    (p.pack||[]).forEach(l=>{ if(inputStock(l.input)!=null) moveStock({kind:'used',input:l.input,qty:-(l.qty*x.units),batch:b.id}); }); });
  if(r) (r.lines||[]).forEach(l=>{ if(inputStock(l.input)!=null) moveStock({kind:'used',input:l.input,qty:-(l.qty*b.mult),batch:b.id}); });
  b.status='made'; b.madeAt=Date.now(); const pl=S.plans.find(x=>x.batch===b.id); if(pl) pl.status='made';
}
// what's planned or recently made: helpers see this (no recipe, no cost)
function plansHtml(under){
  const l=S.plans.filter(p=>p.status!=='made'||p.date>=dk(addDays(kd(nzDay()),-14))).sort((a,b)=>a.date.localeCompare(b.date));
  return `<div class="card"><h3>${under?'Planned and recently made':'Brew plan'}</h3>${l.length?l.map(p=>`<div class="lrow"><div class="grow ltxt"><b>${esc(nzDate(kd(p.date),{weekday:'short',day:'numeric',month:'short'}))} · ${p.status==='made'?'✓ made':'planned'}</b>
      <small>${p.items.map(x=>{ const pr=S.products.find(y=>y.id===x.pid); return x.units+' × '+esc(pr?prodName(pr):'?'); }).join(', ')}</small></div>
      ${canManage()&&p.status!=='made'?`<button class="btn small" data-made="${p.batch}">✓ Made</button>`:''}</div>`).join(''):'<p class="note">Nothing planned.</p>'}</div>`;
}
function wirePlans(){ document.querySelectorAll('[data-made]').forEach(b=>b.onclick=()=>confirmBox('Mark it made?','The products are added to stock at home.','Made',()=>{ madeStock(b.dataset.made); save(); render(); toast('Stock added'); brewCheckin(b.dataset.made); })); }
function batchesHtml(){
  const l=S.batches.filter(b=>b.status==='made').sort((a,b)=>(b.madeAt||0)-(a.madeAt||0)).slice(0,40);
  return `<div class="card"><h3>Batches made</h3>${l.length?l.map(b=>`<div class="lrow"><div class="grow ltxt"><b>${esc(b.recipeName||'Batch')} ×${b.mult} · ${esc(nzDate(kd(b.date),{day:'numeric',month:'short',year:'numeric'}))}</b>
      <small>${b.items.map(x=>{ const p=S.products.find(y=>y.id===x.pid); return x.units+' × '+esc(p?prodName(p):'?')+(b.unitCost&&b.unitCost[x.pid]!=null?' at '+c2(b.unitCost[x.pid]):''); }).join(' · ')}</small>
      ${b.override?`<small class="bad">⚠️ Saved with missing information (${esc(b.override.what)}) by ${esc(personName(b.override.by))}, so its cost is wrong</small>`:''}</div></div>`).join(''):'<p class="note">No batches made yet.</p>'}
    <p class="note">The cost a unit is fixed on the day it was made, so later price changes never change past figures.</p></div>`;
}
function wireBatches(){}

/* ---------- stock ---------- */
function stockHtml(){
  const prods=S.products.filter(p=>p.active!==false).sort((a,b)=>prodName(a).localeCompare(prodName(b)));
  const rows=prods.map(p=>({p,st:stockOf(p.id)}));
  const tm=typeof todaysMarkets==='function'?todaysMarkets():[];
  return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="sPack">🧺 Pack for ${tm[0]?esc(tm[0].title):'a market'}</button><button class="btn alt" id="sCount">🔢 Count stock</button></div>
      <p class="note">Stock is a guide. The till never stops a sale because of it: if something's in the car, sell it.</p>
      ${canManage()?'<div class="mact" style="justify-content:flex-start"><button class="btn alt small" id="sWarn">⚠️ Warn me at…</button></div>':''}</div>
    ${lowHtml()}${onOrderHtml()}
    <div class="card"><div class="stockhead"><span></span><b>At home</b><b>Out with me</b></div>${rows.map(({p,st})=>`<button class="stockrow" data-st="${p.id}"><span class="grow">${esc(prodName(p))}</span><b class="${st&&st.home<=0?'zero':st&&p.warnAt>0&&st.total<=p.warnAt?'low':''}">${st?st.home:'–'}</b><b>${st&&st.out?st.out:''}</b></button>`).join('')}</div>`;
}
function wireStock(){
  $('#sPack').onclick=packForMarket; $('#sCount').onclick=()=>countStock(); wireLow();
  document.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>fixStock(S.products.find(p=>p.id===b.dataset.st)));
}
// one screen: each product with a count, pre-filled from the last time at this market
function packForMarket(){
  const tm=typeof todaysMarkets==='function'?todaysMarkets():[], ev=tm[0];
  const last=ev?S.stockmoves.filter(m=>m.kind==='packed'&&m.event&&S.events.find(e=>e.id===m.event&&e.place&&e.place===ev.place)&&m.date<nzDay()).sort((a,b)=>b.at-a.at):[];
  const lastDate=last[0]&&last[0].date, prev={}; last.filter(m=>m.date===lastDate).forEach(m=>prev[m.product]=(prev[m.product]||0)+m.qty);
  const already={}; S.stockmoves.filter(m=>m.kind==='packed'&&m.date===nzDay()).forEach(m=>already[m.product]=(already[m.product]||0)+m.qty);
  const prods=S.products.filter(p=>p.active!==false).sort((a,b)=>prodName(a).localeCompare(prodName(b)));
  modal((m,close)=>{ m.innerHTML=`<h2>🧺 Packing for ${ev?esc(ev.title):'a market'}</h2><p class="note">${lastDate?'Filled in from last time ('+esc(nzDate(kd(lastDate),{day:'numeric',month:'short'}))+'). ':''}Change what you need, then Done.</p>
      ${prods.map(p=>{ const st=stockOf(p.id), v=already[p.id]?'':(prev[p.id]||''); return `<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(p))}</b><small>${st?st.home+' at home':''}${already[p.id]?' · '+already[p.id]+' packed already':''}</small></div><input class="txt qty" type="number" min="0" data-pk="${p.id}" value="${v}" placeholder="0"></div>`; }).join('')}
      <div class="mact"><button class="btn alt" id="kC">Cancel</button><button class="btn" id="kOk">✓ Done</button></div>`;
    m.querySelector('#kC').onclick=close;
    m.querySelector('#kOk').onclick=()=>{ let n=0; m.querySelectorAll('[data-pk]').forEach(i=>{ const q=Math.floor(+i.value||0); if(q>0){ moveStock({kind:'packed',product:i.dataset.pk,qty:q,event:ev?ev.id:''}); n+=q; } });
      if(n) save(); close(); render(); toast(n?n+' packed':'Nothing packed'); }; },{big:true});
}
// count: set what's really there (a worker's count needs an owner's or manager's PIN)
function countStock(){
  const prods=S.products.filter(p=>p.active!==false).sort((a,b)=>prodName(a).localeCompare(prodName(b)));
  modal((m,close)=>{ m.innerHTML=`<h2>🔢 Count stock at home</h2><p class="note">Type what's really there. Leave a box empty to skip it.</p>
      ${prods.map(p=>{ const st=stockOf(p.id); return `<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(p))}</b><small>${st?'The app thinks '+st.home:'Not counted yet'}</small></div><input class="txt qty" type="number" min="0" data-ct="${p.id}" placeholder="–"></div>`; }).join('')}
      <div class="mact"><button class="btn alt" id="cC">Cancel</button><button class="btn" id="cOk">Save the count</button></div>`;
    m.querySelector('#cC').onclick=close;
    m.querySelector('#cOk').onclick=()=>{ const counts=[]; m.querySelectorAll('[data-ct]').forEach(i=>{ if(i.value!=='') counts.push({pid:i.dataset.ct,qty:Math.max(0,Math.floor(+i.value))}); });
      if(!counts.length){ close(); return; }
      const label=counts.map(c=>{ const p=S.products.find(x=>x.id===c.pid); return prodName(p)+' = '+c.qty; }).join(', ');
      const doIt=who=>{ counts.forEach(c=>{ const st=stockOf(c.pid), out=st?st.out:0; moveStock(Object.assign({kind:'count',product:c.pid,qty:c.qty+out},who?{approvedBy:who}:{})); }); save(); close(); render(); toast('Count saved'); };
      if(canManage()&&!tillLock()) doIt(null); else approve('save a stock count: '+label,who=>doIt(who),label); }; },{big:true});
}
// add or take off a few (breakage, a gift, found a box): a worker's fix needs a PIN, showing exactly what
function fixStock(p){
  const st=stockOf(p.id);
  modal((m,close)=>{ m.innerHTML=`<h2>${esc(prodName(p))}</h2><p>${st?`At home ${st.home}${st.out?' · out with me '+st.out:''}`:'Not counted yet.'}</p>
      <div class="formrow"><div><label class="note" for="fQ">Add (+) or take off (−)</label><input class="txt" id="fQ" type="number" placeholder="e.g. -2"></div>
        <div><label class="note" for="fW">Why</label><select class="txt" id="fW"><option>Broken or spoilt</option><option>Given away</option><option>Found more</option><option>Other</option></select></div></div>
      <div class="mact"><button class="btn alt" id="fC">Cancel</button><button class="btn" id="fOk">Save</button></div>`;
    m.querySelector('#fC').onclick=close;
    m.querySelector('#fOk').onclick=()=>{ const q=Math.round(+m.querySelector('#fQ').value||0), why=m.querySelector('#fW').value; if(!q){ toast('Type how many, e.g. -2'); return; }
      const what=(q>0?'add '+q:'take '+(-q)+' off')+' '+prodName(p)+' ('+why.toLowerCase()+')';
      const doIt=who=>{ moveStock(Object.assign({kind:'fix',product:p.id,qty:q,note:why},who?{approvedBy:who}:{})); save(); close(); render(); toast('Saved'); };
      if(canManage()&&!tillLock()) doIt(null); else approve(what,who=>doIt(who),what); }; });
}

/* ---------- Setup → Ingredients and recipes ---------- */
let recTab=lsGet('rs.rectab','inputs');
SCREENS.recipes={
  title:()=>({h:'Products, recipes and ingredients',s:'Costs are ex GST'}),
  html(){
    const tabs=[['inputs','🧴 Ingredients and packaging']].concat(seesCosts()?[['recipes','📖 Recipes'],['links','🔗 Products']]:[]);
    if(!tabs.some(t=>t[0]===recTab)) recTab='inputs';
    return rulesNotice()+`<div class="ctabs">${tabs.map(([k,v])=>`<button class="chip big ${recTab===k?'on':''}" data-rt="${k}">${v}</button>`).join('')}</div>
      ${role()==='owner'?`<div class="card"><div class="row" style="border:0"><div class="grow"><b>Import from the Batch Planning workbook</b><small>Brings in the ingredients, recipes and packaging. Till prices aren't changed.</small></div><label class="btn small" style="cursor:pointer">📂 Choose<input type="file" id="wbF" accept=".xlsx,.xlsm" hidden></label></div></div>`:''}`
      +(recTab==='recipes'?recipesHtml():recTab==='links'?linksHtml():inputsHtml());
  },
  wire(){
    document.querySelectorAll('[data-rt]').forEach(b=>b.onclick=()=>{ recTab=b.dataset.rt; lsSet('rs.rectab',recTab); render(); });
    const f=$('#wbF'); if(f) f.onchange=()=>{ if(f.files[0]) importWorkbook(f.files[0]); };
    $('#addIn')&&($('#addIn').onclick=()=>editInput({}));
    document.querySelectorAll('[data-in]').forEach(b=>b.onclick=()=>editInput(S.inputs.find(i=>i.id===b.dataset.in)));
    $('#addRec')&&($('#addRec').onclick=()=>editRecipe({}));
    document.querySelectorAll('[data-rec]').forEach(b=>b.onclick=()=>editRecipe(S.recipes.find(r=>r.id===b.dataset.rec)));
    document.querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>editLink(S.products.find(p=>p.id===b.dataset.link)));
  }
};
function inputsHtml(){
  const l=S.inputs.slice().sort((a,b)=>(a.cat||'').localeCompare(b.cat||'')||a.name.localeCompare(b.name));
  return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="addIn">＋ Add an ingredient or packaging</button></div>
    ${['ingredient','packaging'].map(c=>{ const g=l.filter(i=>(i.cat||'ingredient')===c); return g.length?`<h3 style="margin-top:14px">${c==='ingredient'?'Ingredients':'Packaging'}</h3>`+g.map(i=>{ const st=inputStock(i.id);
      return `<button class="row prow" data-in="${i.id}"><div class="grow">${esc(i.name)}${inputIssues(i).map(x=>`<small class="bad">⚠️ ${esc(x.t)}</small>`).join('')}<small>${i.free&&!(i.price>0)?'Free · packs of '+fmtQty(i.pack,i.unit):`${c2(i.price)} for ${fmtQty(i.pack,i.unit)}${i.unit==='each'?' each':''} · ${c2(inputCost(i)*(i.unit==='each'?1:(i.unit==='g'||i.unit==='ml'?100:1)))} per ${i.unit==='each'?'one':'100 '+i.unit}`}${st!=null?' · have '+fmtQty(st,i.unit):''}</small></div><span class="chev">›</span></button>`; }).join(''):''; }).join('')||'<p class="note">None yet.</p>'}</div>`;
}
function editInput(src,done){
  const isNew=!src.id, i=Object.assign({name:'',cat:'ingredient',price:0,pack:1,unit:'g',supplier:''},src);
  modal((m,close)=>{ m.innerHTML=`<h2>${isNew?'Add an ingredient or packaging':esc(i.name)}</h2>
      <label class="note" for="iN">Name</label><input class="txt" id="iN" value="${esc(i.name)}" autocapitalize="sentences">
      <div class="bigseg"><button data-cat="ingredient" class="${i.cat!=='packaging'?'on':''}">🌿 Ingredient</button><button data-cat="packaging" class="${i.cat==='packaging'?'on':''}">🫙 Packaging</button></div>
      <div class="formrow"><div><label class="note" for="iP">Price you pay for a pack, ex GST ($)</label><input class="txt" id="iP" inputmode="decimal" value="${i.price?(i.price/100).toFixed(2):''}"></div>
        <div><label class="note" for="iK">Pack size (in the unit below)</label><input class="txt" id="iK" type="number" min="0" step="any" value="${i.pack||''}"></div></div>
      <label class="tickrow freebox ${i.free?'green':'red'}" id="iFreeBox" style="${i.price>0?'display:none':''}"><input type="checkbox" id="iFree" ${i.free?'checked':''}><span><b>Yes, this is free</b> <small>(e.g. grown at home), so $0 is right</small></span></label>
      <label class="note" for="iU">Measured</label><select class="txt" id="iU">${UNITS.map(u=>`<option value="${u}" ${i.unit===u?'selected':''}>${UNIT_WORDS[u]}</option>`).join('')}</select>
      <label class="note" for="iS">Supplier (optional)</label><input class="txt" id="iS" value="${esc(i.supplier||'')}" list="iSl"><datalist id="iSl">${[...new Set(S.inputs.map(x=>x.supplier).filter(Boolean))].map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <div class="formrow"><div><label class="note" for="iSe">Their email (to order)</label><input class="txt" id="iSe" type="email" autocapitalize="none" value="${esc(i.supplierEmail||'')}" placeholder="orders@…"></div>
        <div><label class="note" for="iSw">or their website</label><input class="txt" id="iSw" type="url" autocapitalize="none" value="${esc(i.supplierLink||'')}" placeholder="https://…"></div></div>
      <label class="note" for="iH">How much you have now (optional, starts tracking it)</label><input class="txt" id="iH" type="number" min="0" step="any" placeholder="${i.id&&inputStock(i.id)!=null?inputStock(i.id):'not tracked'}">
      <div class="mact">${isNew?'':'<button class="btn danger" id="iD">Delete</button>'}<button class="btn alt" id="iC">Cancel</button><button class="btn" id="iOk">Save</button></div>`;
    // the "free" tick only appears at $0: red until it's ticked, then green
    const fb=m.querySelector('#iFreeBox'), fr=m.querySelector('#iFree'), paint=()=>{ const zero=!(toCents(m.querySelector('#iP').value||'0')>0); fb.style.display=zero?'':'none'; fb.classList.toggle('green',zero&&fr.checked); fb.classList.toggle('red',zero&&!fr.checked); };
    m.querySelector('#iP').oninput=paint; fr.onchange=paint; paint();
    // a supplier already used on another ingredient: fill in their email and website
    m.querySelector('#iS').onchange=()=>{ const k=m.querySelector('#iS').value.trim().toLowerCase(), o=S.inputs.find(x=>x.id!==i.id&&(x.supplier||'').trim().toLowerCase()===k&&(x.supplierEmail||x.supplierLink));
      if(o){ const e=m.querySelector('#iSe'), w=m.querySelector('#iSw'); if(!e.value) e.value=o.supplierEmail||''; if(!w.value) w.value=o.supplierLink||''; } };
    let cat=i.cat; m.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{ cat=b.dataset.cat; m.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('on',x===b)); });
    m.querySelector('#iC').onclick=close;
    const d=m.querySelector('#iD'); if(d) d.onclick=()=>{ if(S.recipes.some(r=>(r.lines||[]).some(l=>l.input===i.id))||S.products.some(p=>(p.pack||[]).some(l=>l.input===i.id))){ toast('It\'s used in a recipe or product: take it out there first'); return; }
      const k=S.inputs.findIndex(x=>x.id===i.id); if(k>=0) S.inputs.splice(k,1); save(); close(); render(); };
    m.querySelector('#iOk').onclick=()=>{ const name=m.querySelector('#iN').value.trim(), price=toCents(m.querySelector('#iP').value||'0'), pack=+m.querySelector('#iK').value, unit=m.querySelector('#iU').value;
      if(!name){ toast('Type the name'); return; } if(!(pack>0)){ toast('Type the pack size'); return; } const free=!(price>0)&&m.querySelector('#iFree').checked;
      if(!(price>0)&&!free){ toast('Type the price, or tick "Yes, this is free"'); return; }
      const se=m.querySelector('#iSe').value.trim(), sw=m.querySelector('#iSw').value.trim();
      if(se&&!isEmail(se)){ toast('Check the supplier\'s email'); return; } if(sw&&!/^https?:\/\/\S+\.\S+/.test(sw)){ toast('The website should start with https://'); return; }
      const changed=!isNew&&(price!==i.price||pack!==i.pack);
      Object.assign(i,{name:name.slice(0,80),cat,price:price>0?price:0,free:free&&!(price>0),pack,unit,supplier:m.querySelector('#iS').value.trim().slice(0,80),supplierEmail:se.slice(0,120),supplierLink:sw.slice(0,300),updated:Date.now()});
      if(isNew){ i.id=SYNC.newId('inputs'); S.inputs.push(i); } else Object.assign(S.inputs.find(x=>x.id===i.id),i);
      if(isNew||changed) S.prices.push({id:SYNC.newId('prices'),input:i.id,item:i.name,cents:price,pack,unit,date:nzDay(),at:Date.now(),by:SYNC.me(),from:'setup'});
      const h=m.querySelector('#iH').value; if(h!=='') moveStock({kind:'count',input:i.id,qty:Math.max(0,+h)});
      save(); close(); render(); toast('Saved'); if(done) done(i); }; });
}
function recipesHtml(){
  return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="addRec">＋ Add a recipe</button></div>
    ${S.recipes.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(r=>`<button class="row prow" data-rec="${r.id}"><div class="grow">${esc(r.name)}<small>Makes ${fmtQty(r.yield,r.unit)} · ${(r.lines||[]).length} ingredient${(r.lines||[]).length===1?'':'s'} · ${c2(recipeCost(r))} a batch</small></div><span class="chev">›</span></button>`).join('')||'<p class="note">No recipes yet.</p>'}
    <p class="note">Recipes are only ever seen by owners.</p></div>`;
}
function editRecipe(src,done){
  const isNew=!src.id, r=JSON.parse(JSON.stringify(Object.assign({name:'',yield:1000,unit:'ml',lines:[]},src)));
  const ins=S.inputs.filter(i=>i.cat!=='packaging').sort((a,b)=>a.name.localeCompare(b.name));
  modal((m,close)=>{ const draw=()=>{ m.innerHTML=`<h2>${isNew?'Add a recipe':esc(r.name)}</h2>
      <label class="note" for="rN">Name</label><input class="txt" id="rN" value="${esc(r.name)}">
      <div class="formrow"><div><label class="note" for="rY">One batch makes</label><input class="txt" id="rY" type="number" min="0" step="any" value="${r.yield}"></div>
        <div><label class="note" for="rU">Measured</label><select class="txt" id="rU">${UNITS.map(u=>`<option value="${u}" ${r.unit===u?'selected':''}>${UNIT_WORDS[u]}</option>`).join('')}</select></div></div>
      ${recipeIssues(r).filter(x=>!/batch size|ingredients/.test(x.t)).map(x=>`<p class="note clash">⚠️ ${esc(x.t)}</p>`).join('')}
      <h3>In one batch</h3>${r.lines.map((l,k)=>{ const i=S.inputs.find(x=>x.id===l.input); return `<div class="lrow"><select class="txt grow" data-li="${k}">${ins.map(x=>`<option value="${x.id}" ${x.id===l.input?'selected':''}>${esc(x.name)}</option>`).join('')}</select><input class="txt qty" type="number" min="0" step="any" data-lq="${k}" value="${l.qty}"><span class="unit">${i?esc(i.unit):''}</span><button class="qb rm" data-lx="${k}">✕</button></div>`; }).join('')}
      <div class="mact" style="justify-content:flex-start;margin-top:6px">${ins.length?'<button class="btn alt small" id="rAdd">＋ Add an ingredient</button>':''}<button class="btn alt small" id="rNewI">＋ New ingredient</button></div>
      <p class="note">Batch cost ${c2(recipeCost(r))} ex GST.</p>
      <div class="mact">${isNew?'':'<button class="btn danger" id="rD">Delete</button>'}<button class="btn alt" id="rC">Cancel</button><button class="btn" id="rOk">Save</button></div>`;
      const grab=()=>{ r.name=m.querySelector('#rN').value; r.yield=+m.querySelector('#rY').value||0; r.unit=m.querySelector('#rU').value;
        m.querySelectorAll('[data-li]').forEach(s=>r.lines[+s.dataset.li].input=s.value); m.querySelectorAll('[data-lq]').forEach(s=>r.lines[+s.dataset.lq].qty=+s.value||0); };
      m.querySelectorAll('[data-li],[data-lq],#rY').forEach(x=>x.onchange=()=>{ grab(); draw(); });
      const a=m.querySelector('#rAdd'); if(a) a.onclick=()=>{ grab(); r.lines.push({input:ins[0].id,qty:0}); draw(); };
      m.querySelector('#rNewI').onclick=()=>{ grab(); close(); editInput({cat:'ingredient',unit:r.unit==='each'?'g':r.unit},i2=>{ r.lines.push({input:i2.id,qty:0}); editRecipe(r,done); }); };
      m.querySelectorAll('[data-lx]').forEach(b=>b.onclick=()=>{ grab(); r.lines.splice(+b.dataset.lx,1); draw(); });
      m.querySelector('#rC').onclick=close;
      const d=m.querySelector('#rD'); if(d) d.onclick=()=>{ if(S.products.some(p=>p.recipe===r.id)){ toast('Products use this recipe: unlink them first'); return; } const k=S.recipes.findIndex(x=>x.id===r.id); if(k>=0) S.recipes.splice(k,1); save(); close(); render(); };
      m.querySelector('#rOk').onclick=()=>{ if(role()!=='owner'){ toast('Only owners change recipes'); return; } grab(); r.name=r.name.trim(); if(!r.name){ toast('Type the name'); return; } if(!(r.yield>0)){ toast('Type what one batch makes'); return; }
        r.lines=r.lines.filter(l=>l.qty>0); r.updated=Date.now(); delete r.unitGuessed;
        if(isNew){ r.id=SYNC.newId('recipes'); S.recipes.push(r); } else { const o=S.recipes.find(x=>x.id===r.id); delete o.unitGuessed; Object.assign(o,r); }
        save(); close(); render(); toast('Saved'); if(done) done(r); }; };
    draw(); },{big:true});
}
function linksHtml(){
  return `<div class="card"><p class="note">Which recipe fills each product, how much goes in each, and what it's packed in. Cost a unit is ex GST.</p>
    ${S.products.filter(p=>p.active!==false).sort((a,b)=>prodName(a).localeCompare(prodName(b))).map(p=>{ const r=recipeOf(p), c=unitCost(p);
      const iss=productIssues(p).filter(x=>x.fix==='link');
      return `<button class="row prow" data-link="${p.id}"><div class="grow">${esc(prodName(p))}${iss.map(x=>`<small class="bad">⚠️ ${esc(x.t)}</small>`).join('')}<small>${r?esc(r.name)+(p.fill>0?' · '+fmtQty(p.fill,r.unit)+' each':'')+(c!=null?' · costs '+c2(c)+' · sells '+c2(Math.round(p.price/1.15))+' ex GST · margin '+Math.round((1-c/(p.price/1.15))*100)+'%':''):p.noRecipe?'Bought in, not made here':''}</small></div><span class="chev">›</span></button>`; }).join('')}</div>`;
}
function editLink(p,done,keepV){
  const v=keepV||JSON.parse(JSON.stringify({recipe:p.recipe||(p.noRecipe?'-':''),fill:p.fill||'',pack:p.pack||[],noPack:!!p.noPack})), packs=S.inputs.filter(i=>i.cat==='packaging').sort((a,b)=>a.name.localeCompare(b.name));
  modal((m,close)=>{ const draw=()=>{ const r=S.recipes.find(x=>x.id===v.recipe);
      m.innerHTML=`<h2>${esc(prodName(p))}</h2>
        <label class="note" for="lR">Made from</label><select class="txt" id="lR"><option value="" ${v.recipe===''?'selected':''}>Choose a recipe…</option><option value="-" ${v.recipe==='-'?'selected':''}>Bought in, not made here</option>${S.recipes.map(x=>`<option value="${x.id}" ${x.id===v.recipe?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
        <p style="margin:6px 0 0"><button class="linkb" id="lNewR">＋ A new recipe</button></p>
        ${v.recipe===''?'<p class="note clash">⚠️ Choose its recipe, or "Bought in, not made here"</p>':''}
        ${r?`<label class="note" for="lF">How much goes in each one</label><div class="unitin"><input class="txt" id="lF" type="number" min="0" step="any" value="${v.fill}" placeholder="e.g. ${r.unit==='g'?'15':'30'}"><span class="u">${esc(r.unit)}</span></div>
          ${!(v.fill>0)?'<p class="note clash">⚠️ Needed for brew amounts and the cost of each one</p>':''}
          ${r.unit==='each'&&sizeUnit(p)?`<p class="note clash">⚠️ ${esc(r.name)} is measured in "each", but this is a ${esc(sizeUnit(p))} product. <button class="linkb" id="lRU">Change the recipe's unit</button></p>`:''}`:''}
        <h3>Packed in (each)</h3>${v.pack.map((l,k)=>`<div class="lrow"><select class="txt grow" data-pi="${k}">${packs.map(x=>`<option value="${x.id}" ${x.id===l.input?'selected':''}>${esc(x.name)}</option>`).join('')}</select><input class="txt qty" type="number" min="0" step="any" data-pq="${k}" value="${l.qty}"><button class="qb rm" data-px="${k}">✕</button></div>`).join('')}
        <div class="mact" style="justify-content:flex-start;margin-top:6px">${packs.length?'<button class="btn alt small" id="lAdd">＋ Add packaging</button>':''}<button class="btn alt small" id="lNewP">＋ New packaging item</button></div>
        ${v.recipe&&v.recipe!=='-'&&!v.pack.length?`<label class="tickrow"><input type="checkbox" id="lNP" ${v.noPack?'checked':''}><span>No packaging needed</span></label>`:''}
        <div class="mact"><button class="btn alt" id="lC">Cancel</button><button class="btn" id="lOk">Save</button></div>`;
      const grab=()=>{ v.recipe=m.querySelector('#lR').value; const f=m.querySelector('#lF'); if(f) v.fill=+f.value||0; const np=m.querySelector('#lNP'); if(np) v.noPack=np.checked;
        m.querySelectorAll('[data-pi]').forEach(s=>v.pack[+s.dataset.pi].input=s.value); m.querySelectorAll('[data-pq]').forEach(s=>v.pack[+s.dataset.pq].qty=+s.value||0); };
      m.querySelector('#lR').onchange=()=>{ grab(); draw(); }; const lf=m.querySelector('#lF'); if(lf) lf.onchange=()=>{ grab(); draw(); };
      const ru=m.querySelector('#lRU'); if(ru) ru.onclick=()=>{ close(); editRecipe(r); };
      m.querySelector('#lNewR').onclick=()=>{ grab(); close(); editRecipe({name:p.name},r2=>{ v.recipe=r2.id; editLink(p,done,v); }); };
      m.querySelector('#lNewP').onclick=()=>{ grab(); close(); editInput({cat:'packaging',unit:'each',pack:1},i2=>{ v.pack.push({input:i2.id,qty:1}); editLink(p,done,v); }); };
      const a=m.querySelector('#lAdd'); if(a) a.onclick=()=>{ grab(); v.pack.push({input:packs[0].id,qty:1}); draw(); };
      m.querySelectorAll('[data-px]').forEach(b=>b.onclick=()=>{ grab(); v.pack.splice(+b.dataset.px,1); draw(); });
      m.querySelector('#lC').onclick=close;
      m.querySelector('#lOk').onclick=()=>{ grab(); const made=v.recipe&&v.recipe!=='-'; if(made&&!(v.fill>0)){ toast('Type how much goes in each one'); return; }
        const pk=v.pack.filter(l=>l.qty>0);
        Object.assign(p,{recipe:made?v.recipe:'',noRecipe:v.recipe==='-',fill:made?v.fill:0,pack:pk,noPack:!pk.length&&!!v.noPack,updated:Date.now()}); save(); close(); render(); toast('Saved'); if(done) done(p); }; };
    draw(); });
}

/* ---------- import the Batch Planning workbook ---------- */
// reads the Inputs, Batch Recipes, Packaging and Products sheets by their column headings, then asks
// which till product each workbook product is (names rarely match exactly). Till prices are not changed.
async function importWorkbook(file){
  if(!window.XLSX) await loadScript('lib/xlsx.js');
  let wb; try{ wb=XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array'}); }catch(e){ toast('That file can\'t be read'); return; }
  const rows=name=>{ const ws=wb.Sheets[name]; return ws?XLSX.utils.sheet_to_json(ws,{header:1,raw:true,blankrows:false}):[]; };
  const table=(sheet,first,second)=>{ const r=rows(sheet), out=[]; let cols=null;
    for(const row of r){ const cells=row.map(c=>typeof c==='string'?c.trim():c);
      if(cells[0]===first&&cells[1]===second){ cols=cells; continue; }
      if(cols){ if(typeof cells[0]==='string'&&/^(Recipe|Product|Input Name)$/.test(cells[0])){ cols=null; continue; }
        if(cells[0]==null||cells[0]==='') continue; const o={}; cols.forEach((c,k)=>{ if(c) o[c]=cells[k]; }); out.push(o); } }
    return out; };
  const inputs=table('Inputs','Input Name','Category').filter(o=>o['Input Name']);
  const recipes=table('Batch Recipes','Recipe','Batch Yield'), lines=table('Batch Recipes','Recipe','Input'), packs=table('Packaging','Product','Packaging Item'), prods=table('Products','Product','Base Recipe');
  if(!inputs.length&&!recipes.length){ toast('No Inputs or Batch Recipes sheet found'); return; }
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const unitOf=u=>{ u=String(u||'').toLowerCase(); return /^ml|mls|millil/.test(u)?'ml':/^g|gram|kg/.test(u)?'g':'each'; };
  const guess=name=>{ const n=norm(name); let best=null,score=0; for(const p of S.products){ const a=norm(prodName(p)), b=norm(p.name); const s=a===n||b===n?3:(n.includes(b)||b.includes(n))?2:0; if(s>score){ score=s; best=p; } } return best; };
  const plan=prods.map(o=>({name:o['Product'],recipe:o['Base Recipe'],fill:+o['Fill per Unit (ml/g)']||0,ws:+o['Wholesale Price ($)']||0,match:(guess(o['Product'])||{}).id||''}));
  modal((m,close)=>{ m.innerHTML=`<h2>Import from the workbook</h2>
      <p>Found ${inputs.length} ingredients and packaging items, ${recipes.length} recipes (${lines.length} ingredient lines), ${packs.length} packaging lines and ${prods.length} products.</p>
      <p class="note">Names already here are updated (a new price is kept with today's date); new ones are added. Till prices aren't changed; a wholesale price is added (plus GST) where a product hasn't got one.</p>
      ${plan.length?'<h3>Which till product is each one?</h3>'+plan.map((x,k)=>`<label class="note" for="im${k}">${esc(x.name)}</label><select class="txt" id="im${k}" data-im="${k}"><option value="">Skip</option>${S.products.map(p=>`<option value="${p.id}" ${p.id===x.match?'selected':''}>${esc(prodName(p))}</option>`).join('')}</select>`).join(''):''}
      <div class="mact"><button class="btn alt" id="imC">Cancel</button><button class="btn" id="imOk">Import</button></div>`;
    m.querySelector('#imC').onclick=close;
    m.querySelector('#imOk').onclick=()=>{ m.querySelectorAll('[data-im]').forEach(s=>plan[+s.dataset.im].match=s.value);
      const byName={}; S.inputs.forEach(i=>byName[norm(i.name)]=i); let added=0, updated=0;
      for(const o of inputs){ const name=String(o['Input Name']).trim(), price=Math.round((+o['Purchase Price ($ ex GST)']||0)*100), pack=+o['Pack Size']||0, unit=unitOf(o['Unit']), cat=/pack/i.test(o['Category']||'')?'packaging':'ingredient';
        if(!pack) continue; const ex=byName[norm(name)];
        if(ex){ if(ex.price!==price||ex.pack!==pack){ S.prices.push({id:SYNC.newId('prices'),input:ex.id,item:ex.name,cents:price,pack,unit,date:nzDay(),at:Date.now(),by:SYNC.me(),from:'workbook'}); updated++; } Object.assign(ex,{price,pack,unit,cat,updated:Date.now()}); }
        else { const i={id:SYNC.newId('inputs'),name:name.slice(0,80),cat,price,pack,unit,supplier:'',updated:Date.now()}; S.inputs.push(i); byName[norm(name)]=i; S.prices.push({id:SYNC.newId('prices'),input:i.id,item:i.name,cents:price,pack,unit,date:nzDay(),at:Date.now(),by:SYNC.me(),from:'workbook'}); added++; } }
      const recByName={}; S.recipes.forEach(r=>recByName[norm(r.name)]=r); let recs=0, missing=new Set();
      for(const o of recipes){ const name=String(o['Recipe']).trim(); if(!name) continue;
        const ls=lines.filter(l=>norm(l['Recipe'])===norm(name)).map(l=>{ const i=byName[norm(l['Input'])]; if(!i) missing.add(String(l['Input'])); return i?{input:i.id,qty:+l['Qty per Batch']||0}:null; }).filter(Boolean);
        // a yield unit it can't read is guessed from the ingredients (ml or g) and flagged in Needs attention
        const yu=String(o['Yield Unit']||'').trim().toLowerCase(), known=/^(ml|mls|millil|g|gram|gm|kg|each|ea\b|unit|pcs?|pieces?)/.test(yu);
        const lu=ls.map(l=>(S.inputs.find(i=>i.id===l.input)||{}).unit).filter(u=>u==='ml'||u==='g'), guess=lu.filter(u=>u==='ml').length>=lu.filter(u=>u==='g').length?'ml':'g';
        const r=recByName[norm(name)], v={name:name.slice(0,80),yield:+o['Batch Yield']||0,unit:known?unitOf(yu):(lu.length?guess:'ml'),lines:ls,updated:Date.now()};
        if(!known) v.unitGuessed=true; else if(r) delete r.unitGuessed;
        if(r) Object.assign(r,v); else { const n=Object.assign({id:SYNC.newId('recipes')},v); S.recipes.push(n); recByName[norm(name)]=n; } recs++; }
      let linked=0; for(const x of plan){ if(!x.match) continue; const p=S.products.find(y=>y.id===x.match), r=recByName[norm(x.recipe)]; if(!p) continue;
        const pk=packs.filter(o=>norm(o['Product'])===norm(x.name)).map(o=>{ const i=byName[norm(o['Packaging Item'])]; if(!i) missing.add(String(o['Packaging Item'])); return i?{input:i.id,qty:+o['Qty per Unit']||1}:null; }).filter(Boolean);
        Object.assign(p,{recipe:r?r.id:(p.recipe||''),fill:x.fill||p.fill||0,pack:pk.length?pk:(p.pack||[]),updated:Date.now()},x.ws>0&&!p.wholesale?{wholesale:Math.round(x.ws*115)}:{}); linked++; }
      save(); close(); render();
      modal((m2,c2)=>{ m2.innerHTML=`<h2>Imported</h2><p>${added} new and ${updated} re-priced ingredients and packaging, ${recs} recipes, ${linked} products linked.</p>
          ${missing.size?`<p class="note">Not found in the Inputs sheet (check the spelling there): ${[...missing].map(esc).join(', ')}.</p>`:''}<div class="mact"><button class="btn" id="iOk2">OK</button></div>`;
        m2.querySelector('#iOk2').onclick=c2; }); }; },{big:true});
}
