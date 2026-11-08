/* ================= Health check =================
   Finds information that's missing, so a number is never quietly wrong. It shows in three places:
   in red where the gap is, in the owners' "Needs attention" list (each with a Fix button that opens
   the exact window), and at the moment it matters (planning a brew, selling below cost).
   A $0 ingredient or packaging item is fine only when it's ticked "Yes, this is free". */
const UNIT_WORDS={ml:'ml (by volume)',g:'g (by weight)',each:'each (by count)'};
// the unit a product's size suggests: "30ml" → ml, "100 g" → g, "Balm" → ''
const sizeUnit=p=>{ const m=String((p&&p.size)||'').toLowerCase().match(/\d\s*(ml|mls|l|g|gm|gms|grams?|kg)\b/); return m?(/^(ml|mls|l)$/.test(m[1])?'ml':'g'):''; };
const noPrice=i=>!!i&&!(i.price>0)&&!i.free;          // an ingredient or packaging at $0 that isn't ticked free

function productIssues(p){
  const out=[]; if(!p||p.active===false) return out;
  const r=recipeOf(p);
  if(!(p.price>0)) out.push({t:'No till price',fix:'product'});
  if(p.recipe&&!r) out.push({t:'Its recipe has been deleted',fix:'link'});
  else if(!p.recipe&&!p.noRecipe) out.push({t:'Not linked to a recipe (or ticked as bought in)',fix:'link'});
  if(r&&!(p.fill>0)) out.push({t:'No fill set, so brew amounts and costs are wrong',fix:'link'});
  if(r&&!(p.pack||[]).length&&!p.noPack) out.push({t:'No packaging (or ticked as none needed)',fix:'link'});
  if(!(p.wholesale>0)&&!p.noWholesale) out.push({t:'No wholesale price (or ticked as not sold wholesale)',fix:'product'});
  return out;
}
function recipeIssues(r){
  const out=[];
  if(!(r.yield>0)) out.push({t:'No batch size'});
  if(!(r.lines||[]).length) out.push({t:'No ingredients'});
  const units=[...new Set(S.products.filter(p=>p.recipe===r.id&&p.active!==false).map(sizeUnit).filter(Boolean))];
  if(r.unit==='each'&&units.length) out.push({t:'Unit is "each", but it fills '+units.join(' and ')+' products: set it to '+units[0]});
  else if(r.unitGuessed) out.push({t:'The import guessed the unit ('+r.unit+'): check it and save'});
  return out;
}
function inputIssues(i){
  const out=[];
  if(!(i.pack>0)) out.push({t:'No pack size'});
  if(noPrice(i)) out.push({t:'No price (tick "Yes, this is free" if it is)'});
  return out;
}
// everything that needs attention, grouped by what it's about. Recipes and costs are owners-only.
function healthIssues(){
  if(role()!=='owner') return [];
  const g=[];
  S.products.filter(p=>p.active!==false).sort((a,b)=>prodName(a).localeCompare(prodName(b))).forEach(p=>{ const l=productIssues(p); if(l.length) g.push({kind:'product',id:p.id,name:prodName(p),issues:l}); });
  S.recipes.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(r=>{ const l=recipeIssues(r); if(l.length) g.push({kind:'recipe',id:r.id,name:r.name,issues:l}); });
  S.inputs.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(i=>{ const l=inputIssues(i); if(l.length) g.push({kind:'input',id:i.id,name:i.name,issues:l}); });
  return g;
}
const issueCount=()=>healthIssues().reduce((n,x)=>n+x.issues.length,0);
// opens the window that fixes it; saving there redraws the screen you came from
function fixIssue(kind,id,fix){
  if(kind==='product'){ const p=S.products.find(x=>x.id===id); if(p) (fix==='product'?editProduct(p):editLink(p)); }
  else if(kind==='recipe'){ const r=S.recipes.find(x=>x.id===id); if(r) editRecipe(r); }
  else { const i=S.inputs.find(x=>x.id===id); if(i) editInput(i); }
}
const KIND_HEAD={product:'🏷️ Products',recipe:'📖 Recipes',input:'🧴 Ingredients and packaging'};
SCREENS.attention={
  title:()=>({h:'Needs attention',s:'Missing information that makes a number wrong'}),
  html(){
    const g=healthIssues();
    if(!g.length) return `<div class="card"><h3>✓ Nothing needs attention</h3><p class="note">Every product, recipe and ingredient has what its sums need.</p></div>`;
    return `<div class="card"><p class="note">Each one is something a cost, a brew amount or a price depends on. Tap <b>Fix</b> to open the right window; you come back here when it's saved.</p></div>`
      +['product','recipe','input'].map(k=>{ const l=g.filter(x=>x.kind===k); return l.length?`<div class="card"><h3>${KIND_HEAD[k]} (${l.length})</h3>${l.map(x=>`<div class="lrow attn"><div class="grow ltxt"><b>${esc(x.name)}</b>${x.issues.map(s=>`<small class="bad">⚠️ ${esc(s.t)}</small>`).join('')}</div>
        <div class="fixes">${[...new Set(x.issues.map(s=>s.fix||''))].map(f=>`<button class="btn small" data-fix="${k}|${x.id}|${f}">Fix${f==='link'?' recipe link':f==='product'?' price':''}</button>`).join('')}</div></div>`).join('')}</div>`:''; }).join('');
  },
  wire(){ document.querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>{ const [k,id,f]=b.dataset.fix.split('|'); fixIssue(k,id,f); }); }
};
// the card on the owners' home screen
function attentionCard(){
  if(role()!=='owner'||tillLock()) return '';
  const g=healthIssues(); if(!g.length) return '';
  const n=g.reduce((a,x)=>a+x.issues.length,0);
  return `<div class="card attncard"><div class="row" style="border:0;padding:0;min-height:0"><div class="grow"><b>⚠️ ${n} thing${n===1?'':'s'} need${n===1?'s':''} attention</b><small>${esc(g[0].name)}: ${esc(g[0].issues[0].t)}${g.length>1?' · and '+(g.length-1)+' more':''}</small></div><button class="btn small" id="hAttn">Show</button></div></div>`;
}
