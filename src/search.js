/* ================= Search: find anything, go straight there =================
   One box on the home screen. Results are grouped (screens and settings, products, calendar, orders,
   lists, places, ingredients, recipes, people) and each one opens the exact window.
   It only ever looks through what this person can see: the data on the device is already cut to their
   role, and every group checks the role too, so a helper never gets a result for recipes, costs, pay,
   reports or anyone else's notes. It works offline (it searches what's on the device). */

// screens and settings, in plain words, so "stall fee" or "change a price" finds the right place.
// who: 'all', 'manage' (owners and managers), 'costs' (owners, and managers if allowed) or 'owner'
const HELP=[
  {t:'Change a price or add a product',w:'price prices product add new change till button colour sell hide show on off',who:'manage',go:()=>openSetupArea('products')},
  {t:'Put a product on or off the till',w:'on the till off hide show switch button',who:'manage',go:()=>openSetupArea('products')},
  {t:'Wholesale prices',w:'wholesale shop price trade stockist',who:'manage',go:()=>openSetupArea('products')},
  {t:'Deals (e.g. 3 for $50)',w:'deal deals special offer bundle 3 for multibuy',who:'manage',go:()=>openSetupArea('deals')},
  {t:'Markets and places: stall fees and distances',w:'stall fee fees market place places distance km farm shop online venue',who:'manage',go:()=>openSetupArea('places')},
  {t:'Recipes, ingredients and costs',w:'recipe recipes ingredient ingredients packaging cost costs margin import workbook excel batch fill unit',who:'costs',go:()=>go('recipes')},
  {t:'Ingredients and packaging prices',w:'ingredient packaging bottle jar label supplier price pack size free',who:'manage',go:()=>{ recTab='inputs'; go('recipes'); }},
  {t:'Needs attention: missing information',w:'missing attention warning fix problems gaps check',who:'owner',go:()=>go('attention')},
  {t:'Plan a brew',w:'brew plan make batch made what to make',who:'manage',go:()=>{ brewTab='plan'; go('brew'); }},
  {t:'Stock: count, pack for a market',w:'stock count pack packing how many left inventory',who:'all',go:()=>{ brewTab='stock'; go('brew'); }},
  {t:'Calendar: markets, brew days, to-dos',w:'calendar market day add event diary schedule tomorrow week',who:'all',go:()=>go('calendar')},
  {t:'To-do list',w:'todo to do task tasks jobs list',who:'all',go:()=>{ listTab='todo'; go('lists'); }},
  {t:'Shopping list',w:'shopping buy list supplies',who:'all',go:()=>{ listTab='shop'; go('lists'); }},
  {t:'Ideas',w:'idea ideas notes',who:'manage',go:()=>{ listTab='ideas'; go('lists'); }},
  {t:'Orders: wholesale, custom and Shopify',w:'order orders wholesale shopify online send custom',who:'manage',go:()=>go('orders')},
  {t:'Reports: takings, profit and GST',w:'report reports takings profit gst sales money best sellers margin',who:'owner',go:()=>go('reports')},
  {t:'Vehicle and fuel (mileage, road user charges)',w:'vehicle fuel petrol diesel mileage ruc road user charges car van km',who:'owner',go:()=>go('vehicle')},
  {t:'Helpers\' pay rates',w:'pay rate rates wages staff hourly day',who:'owner',go:()=>{ repTab='costs'; go('reports'); }},
  {t:'Start selling (the till)',w:'sell till sale start day market farm gate',who:'all',go:()=>go('sell')},
  {t:'People: add a helper or manager',w:'people person add helper manager owner staff account invite role',who:'manage',go:()=>openSetupArea('setup:people')},
  {t:'My PIN',w:'pin code password approve change my pin forgot',who:'manage',go:()=>openSetupArea('setup:pins')},
  {t:'Approvals log',w:'approvals log audit who approved discount void',who:'manage',go:()=>openSetupArea('audit')},
  {t:'View as a helper or manager (practice mode)',w:'view as practice test pretend helper see what',who:'owner',go:()=>openSetupArea('setup:people',()=>viewAsPicker())},
  {t:'Notifications on this device',w:'notification notifications alerts reminders push',who:'all',go:()=>go('notify')},
  {t:'GST receipts and GST number',w:'gst receipt receipts number email ird',who:'manage',go:()=>openSetupArea('setup:business')},
  {t:'Voice assistant',w:'voice assistant talk speak gemini ai notes',who:'owner',go:()=>openSetupArea('setup:assistant')},
  {t:'Shopify',w:'shopify online store shop',who:'owner',go:()=>openSetupArea('setup:shopify')},
  {t:'Customer contacts and loyalty programme',w:'contacts customers loyalty email list newsletter',who:'manage',go:()=>openSetupArea('contacts')},
];
// Setup areas are behind the PIN (so a helper in till mode can't wander in)
function openSetupArea(id,then){ requirePin(()=>{ if(id.startsWith('setup')){ SETUP_TOOL=id.split(':')[1]||null; if(cur()==='setup') render(); else go('setup'); } else { if(cur()!=='setup') stack.push('setup'); go(id); } if(then) then(); }); }
const allowed=who=>who==='all'||(who==='manage'&&canManage())||(who==='costs'&&seesCosts())||(who==='owner'&&role()==='owner');

function searchAll(q){
  q=String(q||'').trim(); if(!q) return [];
  const out=[], add=(group,title,sub,text,open)=>{ const sc=fuzzyScore(q,text||title); if(sc>0) out.push({group,title,sub,sc,open}); };
  const locked=!!tillLock();
  HELP.filter(h=>allowed(h.who)&&!locked).forEach(h=>add('Screens and settings',h.t,'',h.t+' '+h.w,h.go));
  S.products.forEach(p=>add('Products',prodName(p),c2(p.price)+(p.active===false?' · off the till':''),p.name+' '+(p.size||''),()=>{ if(canManage()&&!locked) openSetupArea('products',()=>editProduct(p)); else go('sell'); }));
  S.events.forEach(e=>add('Calendar',e.title||'Calendar entry',(e.date?nzDate(kd(e.date),{weekday:'short',day:'numeric',month:'short'}):'')+(e.time?' · '+t12(e.time):''),(e.title||'')+' '+(e.where||'')+' '+(e.note||''),()=>{ if(e.date){ calSel=e.date; calMonth=null; } go('calendar'); setTimeout(()=>openEvent(e),60); }));
  if(canManage()&&!locked){
    S.orders.forEach(o=>add('Orders',(o.customer||o.name||'Order')+(o.shopify&&o.shopify.name?' '+o.shopify.name:''),(o.due?'Send by '+nzDate(kd(o.due),{day:'numeric',month:'short'}):'')+(o.status?' · '+o.status:''),(o.customer||'')+' '+(o.name||'')+' '+((o.shopify||{}).name||'')+' '+(o.lines||[]).map(l=>l.name).join(' '),()=>{ go('orders'); setTimeout(()=>openOrder(o),60); }));
    S.places.filter(p=>!p.gone).forEach(p=>add('Markets and places',p.name,p.address||'',p.name+' '+(p.address||''),()=>openSetupArea('places',()=>editPlace(p))));
    S.inputs.forEach(i=>add('Ingredients and packaging',i.name,i.cat==='packaging'?'Packaging':'Ingredient',i.name+' '+(i.supplier||''),()=>{ recTab='inputs'; go('recipes'); setTimeout(()=>editInput(i),60); }));
    S.ideas.forEach(x=>add('Ideas',x.text||'Idea','',x.text,()=>{ listTab='ideas'; go('lists'); }));
  }
  if(role()==='owner'&&recipesOpen()&&!locked) S.recipes.forEach(r=>add('Recipes',r.name,'Makes '+fmtQty(r.yield,r.unit),r.name,()=>{ recTab='recipes'; go('recipes'); setTimeout(()=>editRecipe(r),60); }));
  // to-dos: owners and managers see everyone's; a helper's device only ever holds their own
  S.todos.filter(t=>!t.done).forEach(t=>add('To-dos',t.text,t.due?nzDate(kd(t.due),{day:'numeric',month:'short'}):'',t.text,()=>{ listTab='todo'; go('lists'); setTimeout(()=>{ if(t.setup&&typeof finishSetup==='function') finishSetup(t.setup); else openTodo(t); },60); }));
  S.shopping.filter(x=>!x.done).forEach(x=>add('Shopping list',x.item,x.size||'',x.item,()=>{ listTab='shop'; go('lists'); }));
  if(role()==='owner'&&!locked&&typeof contactList==='function') contactList().forEach(c=>add('Customer contacts',c.name||c.email,c.email,(c.name||'')+' '+c.email,()=>openSetupArea('contacts')));
  if(role()==='owner'&&!locked) SYNC.getMembers().forEach(e=>add('People',personName(e),e,personName(e)+' '+e,()=>openSetupArea('setup:people')));
  const order=['Screens and settings','Products','Calendar','Orders','To-dos','Shopping list','Ideas','Markets and places','Ingredients and packaging','Recipes','Customer contacts','People'];
  return out.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group)||b.sc-a.sc);
}
function openSearch(){
  modal((m,close)=>{ let q='', hits=[];
    const draw=()=>{ hits=searchAll(q); const groups=[...new Set(hits.map(h=>h.group))], hp=q.trim().length>2?helpMatch(q,HELP_ASK.test(q)):null;
      m.querySelector('#sR').innerHTML=(hp?helpCard(hp):'')+(!q.trim()?'<p class="note">Type part of a name or what you want to do, e.g. "stall fee", "lav oil", "Matakana", "add a helper".</p>'
        :hits.length?groups.map(g=>{ const l=hits.filter(h=>h.group===g).slice(0,g==='Screens and settings'?5:8); return `<h3 style="margin:14px 0 4px">${esc(g)}</h3>`+l.map(h=>`<button class="frow" data-si="${hits.indexOf(h)}"><span class="grow"><b>${esc(h.title)}</b>${h.sub?`<small>${esc(h.sub)}</small>`:''}</span><span class="chev">›</span></button>`).join(''); }).join('')
        :hp?'':'<p class="note">Nothing found. Try fewer or different words.</p>');
      wireHelp(m,close);
      m.querySelectorAll('[data-si]').forEach(b=>b.onclick=()=>{ const h=hits[+b.dataset.si]; close(); h.open(); }); };
    m.innerHTML=`<h2>🔍 Find anything</h2><input class="txt" id="sQ" type="search" placeholder="e.g. how do I change a price? · lav oil · Matakana" autocomplete="off" enterkeyhint="search"><div class="findlist" id="sR"></div>
      <div class="mact"><button class="btn alt" id="sC">Close</button></div>`;
    m.querySelector('#sQ').oninput=e=>{ q=e.target.value; draw(); };
    m.querySelector('#sC').onclick=close; draw();
    setTimeout(()=>{ const f=m.querySelector('#sQ'); if(f) f.focus(); },50); },{big:true});
}
