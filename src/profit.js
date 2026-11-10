/* ================= Real profit (owners) =================
   One screen to sit down with: what the business really made, what that is an hour for your time, which
   markets and products are worth it, how sure the numbers are (with a Fix button for each gap), and what to
   do next. All ex GST. The hours are market days (travel to unpacking, from the calendar and check-ins), the
   time clock, and brew days from their check-ins. */
let profPeriod=lsGet('rs.profperiod','month');
const PROF_PERIODS={week:'This week',month:'This month',lastmonth:'Last month',fy:'This year'};
const hourTarget=()=>+(S.settings.hourTarget||2500);       // cents an hour that counts as "worth it"
const isOwnerEmail=e=>!!e&&SYNC.getOwners().includes(e);

// every hour the owners put in over a period, by kind
function ownerHours(from,to){
  const inR=d=>d>=from&&d<=to, out={market:0,clock:0,brew:0,estimated:0,byPlace:{}};
  for(const s of S.sessions){ if(!inR(s.date)||s.status!=='closed'||s.type!=='market') continue;
    const ownerThere=isOwnerEmail(s.openedBy)||isOwnerEmail(s.closedBy)||(s.checkin&&isOwnerEmail(s.checkin.by))||(S.events.find(e=>e.id===s.eventId)||{attendees:[]}).attendees.some(isOwnerEmail);
    if(!ownerThere) continue; const m=sessionMins(s); out.market+=m; if(!s.checkin||s.checkin.skipped) out.estimated++;
    const k=s.placeId||s.name; out.byPlace[k]=(out.byPlace[k]||0)+m; }
  for(const c of (S.clock||[])) if(c.kind==='owner'&&inR(c.date||'')) out.clock+=clockMins(c);
  for(const b of S.batches) if(b.status==='made'&&b.mins>0&&b.minsFrom!=='clock'&&inR(b.date||'')) out.brew+=b.mins;
  out.total=out.market+out.clock+out.brew; return out;
}
const perHour=(cents,mins)=>mins>0?Math.round(cents/(mins/60)):null;
const verdict=(net,ph)=>net<=0?['🔴','Losing money','bad']:ph!=null&&ph>=hourTarget()?['✅','Worth it','good']:['🟡','Borderline','mid'];

// the gaps that make the figures less sure, each with what fixes it
function profitGaps(from,to,R){
  const g=[], inR=d=>d>=from&&d<=to;
  if(R.unknownCost) g.push({w:30,t:R.unknownCost+' item'+(R.unknownCost===1?'':'s')+' sold with no product cost',d:'Profit looks higher than it is. Link each product to its recipe.',fix:'Fix',act:()=>go('recipes')});
  const noCk=S.sessions.filter(s=>inR(s.date)&&s.status==='closed'&&s.type==='market'&&!s.checkin);
  if(noCk.length) g.push({w:Math.min(20,noCk.length*5),t:noCk.length+' market'+(noCk.length===1?'':'s')+' without a check-in',d:'Their hours are estimated from the calendar.',fix:'Check in',act:()=>marketCheckin(noCk[0],()=>render())});
  const noMade=S.batches.filter(b=>b.status==='made'&&inR(b.date||'')&&b.mins==null);
  if(noMade.length) g.push({w:Math.min(15,noMade.length*5),t:noMade.length+' brew day'+(noMade.length===1?'':'s')+' with no time',d:'Your brewing hours are missing from profit per hour.',fix:'Add the time',act:()=>brewCheckin(noMade[0].id,()=>render())});
  const used=new Set(S.sessions.filter(s=>inR(s.date)&&s.placeId).map(s=>s.placeId)), places=S.places.filter(p=>used.has(p.id));
  const noKm=places.filter(p=>!p.km); if(noKm.length) g.push({w:10,t:noKm.length+' place'+(noKm.length===1?'':'s')+' with no distance',d:'No mileage is taken off for '+noKm.map(p=>p.name).join(', ')+'.',fix:'Fix',act:()=>editPlace(noKm[0],()=>render())});
  const noFee=places.filter(p=>p.group==='markets'&&!feeOf(p.id)&&!S.costs.some(c=>c.kind==='dayfee'&&c.place===p.id)); if(noFee.length) g.push({w:10,t:noFee.length+' market'+(noFee.length===1?'':'s')+' with no stall fee',d:noFee.map(p=>p.name).join(', ')+'. Add 0 if it\'s free.',fix:'Fix',act:()=>editPlace(noFee[0],()=>render())});
  if(R.mileage===0&&places.some(p=>p.km)&&!(R.vc&&R.vc.perKm)) g.push({w:10,t:'No fuel records yet',d:'Mileage needs the fuel you buy (or the car\'s L/100 km).',fix:'Fix',act:()=>go('vehicle')});
  const unpaid=[...new Set(S.sales.filter(x=>inR(x.date)&&x.servedBy).map(x=>x.servedBy))].filter(n=>!(S.pay||[]).some(p=>(p.name||'').toLowerCase()===n.toLowerCase())&&!S.pins.some(p=>p.name===n&&isOwnerEmail(p.id)));
  if(unpaid.length) g.push({w:10,t:'No pay rate for '+unpaid.join(', '),d:'If they\'re paid, their pay isn\'t taken off yet. Leave it if they help for free.',fix:'Fix',act:()=>{ repTab='costs'; lsSet('rs.reptab','costs'); go('reports'); }});
  return g.sort((a,b)=>b.w-a.w);
}
const sureness=g=>{ const n=Math.max(0,100-g.reduce((a,x)=>a+x.w,0)); return n>=85?['Very sure',n,'good']:n>=60?['Fairly sure',n,'mid']:['A rough guess',n,'bad']; };

// what to do next: each idea is {t, d, why (the number behind it), score, link label, act}
function profitIdeas(from,to,R,H){
  const ideas=[], tgt=hourTarget();
  const mk=Object.entries(R.byPlace).filter(([k,p])=>p.group==='markets'&&p.days>0).map(([k,p])=>{ const net=p.ex-p.cogs-p.fees-p.mileage-p.staff, mins=H.byPlace[k]||0; return {k,p,net,mins,ph:perHour(net,mins)}; });
  mk.filter(x=>x.net<0&&x.p.days>=2).forEach(x=>ideas.push({score:90,t:'Think about dropping '+x.p.name,d:'It lost '+c2(-x.net)+' over '+x.p.days+' days once fees, fuel, staff and stock are taken off.',lbl:'See the market',go:'reports:places',act:()=>{ repTab='places'; lsSet('rs.reptab','places'); go('reports'); }}));
  mk.filter(x=>x.net>0&&x.ph!=null&&x.ph<tgt).forEach(x=>ideas.push({score:60,t:'Make '+x.p.name+' pay better',d:'It earns '+c2(x.ph)+' an hour of your time. A bigger range, a better spot or sharing the stall would lift it.',lbl:'See the market',go:'reports:places',act:()=>{ repTab='places'; lsSet('rs.reptab','places'); go('reports'); }}));
  const best=mk.filter(x=>x.ph!=null&&x.ph>=tgt).sort((a,b)=>b.ph-a.ph)[0];
  if(best) ideas.push({score:70,t:'Book more days at '+best.p.name,d:'Your best market: '+c2(best.ph)+' an hour, '+c2(Math.round(best.net/best.p.days))+' a day.',lbl:'Open the calendar',go:'calendar',act:()=>go('calendar')});
  const prods=Object.entries(R.byProduct).map(([pid,v])=>{ const p=S.products.find(x=>x.id===pid), u=p?unitCost(p):null, ex=v.total/1.15; return {p,v,u,ex,m:u!=null&&ex>0?1-u*v.qty/ex:null}; }).filter(x=>x.p);
  prods.filter(x=>x.m!=null&&x.m<0.35&&x.v.qty>=3).sort((a,b)=>b.v.qty-a.v.qty).slice(0,3).forEach(x=>ideas.push({score:80,t:'Raise the price of '+prodName(x.p),d:'You keep only '+Math.round(x.m*100)+'% of each sale after its cost, and it sold '+x.v.qty+'.',lbl:'Change the price',go:'setup:products',act:()=>requirePin(()=>{ go('setup'); setTimeout(()=>editProduct(x.p,()=>render()),50); })}));
  const star=prods.filter(x=>x.m!=null&&x.m>=0.6).sort((a,b)=>(b.ex-(b.u||0)*b.v.qty)-(a.ex-(a.u||0)*a.v.qty))[0];
  if(star) ideas.push({score:55,t:'Make more '+prodName(star.p),d:'Your best earner: '+Math.round(star.m*100)+'% margin, '+star.v.qty+' sold.',lbl:'Plan a brew',go:'brew:next',act:()=>go('brew')});
  const so={}; S.sessions.filter(s=>s.date>=from&&s.date<=to&&s.checkin&&s.checkin.soldOut).forEach(s=>s.checkin.soldOut.forEach(id=>so[id]=(so[id]||0)+1));
  Object.entries(so).filter(([,n])=>n>=2).forEach(([id,n])=>{ const p=S.products.find(x=>x.id===id); if(p) ideas.push({score:75,t:'Take more '+prodName(p)+' to markets',d:'It sold out '+n+' times: those were lost sales.',lbl:'Plan a brew',go:'brew:next',act:()=>go('brew')}); });
  const since=dk(addDays(kd(nzDay()),-60)), sold60=new Set(S.sales.filter(s=>!s.voided&&s.date>=since).flatMap(s=>(s.lines||[]).map(l=>l.pid)));
  const idle=S.products.filter(p=>p.active!==false&&p.price>0&&!sold60.has(p.id)&&(p.created||0)<Date.now()-60*864e5);
  if(idle.length&&S.sales.length>20) ideas.push({score:35,t:idle.length+' product'+(idle.length===1?' hasn\'t':'s haven\'t')+' sold in 2 months',d:idle.slice(0,4).map(prodName).join(', ')+(idle.length>4?'…':'')+'. Put them on special or stop making them.',lbl:'See the products',go:'setup:products',act:()=>requirePin(()=>{ go('setup'); setTimeout(()=>go('products'),30); })});
  if(H.total>0&&R.net>0&&perHour(R.net,H.total)<tgt) ideas.push({score:50,t:'Your time is worth more than '+c2(perHour(R.net,H.total))+' an hour',d:'Look at which markets and products earn the least for the time they take (below).',lbl:'See the markets',go:'profit',act:()=>{ const el=$('#pfMk'); if(el) el.scrollIntoView({behavior:'smooth'}); }});
  if(typeof stockIdeas==='function') stockIdeas().forEach(x=>ideas.push(x));
  return dedupeIdeas(ideas);
}
// one line per thing to do: the same action twice keeps the more urgent, with both reasons
function dedupeIdeas(l){ const m=new Map(); l.sort((a,b)=>b.score-a.score).forEach(x=>{ const k=x.t.toLowerCase(); if(!m.has(k)) m.set(k,x); else { const y=m.get(k); if(y.d!==x.d) y.d=y.d+' '+x.d; } }); return [...m.values()]; }
// the action list: top five, then "Show more ideas"
let ideasMore=false;   // (the Lists screen has its own ideas list; these are action ideas)
function ideasCard(ideas,title){
  if(!ideas.length) return `<div class="card"><h3>${title||'What to do next'}</h3><p class="note">Nothing needs doing. 🌿</p></div>`;
  const l=ideasMore?ideas:ideas.slice(0,5);
  return `<div class="card"><h3>${title||'What to do next'}</h3><ol class="ideas">${l.map((x,i)=>`<li><div class="grow"><b>${esc(x.t)}</b><small>${esc(x.d)}</small></div><button class="btn small" data-idea="${i}">${esc(x.lbl||'Go')} ›</button></li>`).join('')}</ol>
    ${ideas.length>5&&!ideasMore?`<div class="mact" style="justify-content:flex-start"><button class="btn alt" id="ideasMore">Show more ideas (${ideas.length-5})</button></div>`:''}</div>`;
}
function wireActionIdeas(ideas){ document.querySelectorAll('[data-idea]').forEach(b=>b.onclick=()=>{ const x=ideas[+b.dataset.idea]; if(x&&x.act) x.act(); });
  const mo=$('#ideasMore'); if(mo) mo.onclick=()=>{ ideasMore=true; render(); }; }

let profCache=null;
function profitData(){
  const [from,to]=periodRange(profPeriod), R=crunch(from,to,'all'), H=ownerHours(from,to), gaps=profitGaps(from,to,R);
  return profCache={from,to,R,H,gaps,ideas:profitIdeas(from,to,R,H)};
}
SCREENS.profit={
  title:()=>({h:'Real profit',s:'What you really make, and what to do next'}),
  html(){
    if(role()!=='owner') return '<div class="card"><p>Only owners see profit.</p></div>';
    const {from,to,R,H,gaps,ideas}=profitData(), ph=perHour(R.net,H.total), sure=sureness(gaps), v=verdict(R.net,ph);
    const mk=Object.entries(R.byPlace).filter(([,p])=>p.days>0).map(([k,p])=>{ const net=p.ex-p.cogs-p.fees-p.mileage-p.staff, mins=H.byPlace[k]||0; return {p,net,mins,ph:perHour(net,mins)}; }).sort((a,b)=>(b.ph==null?-1e12:b.ph)-(a.ph==null?-1e12:a.ph)||b.net-a.net);
    const pr=Object.entries(R.byProduct).map(([pid,x])=>{ const p=S.products.find(y=>y.id===pid), u=p?unitCost(p):null, ex=Math.round(x.total/1.15); return {p,qty:x.qty,ex,prof:u==null?null:Math.round(ex-u*x.qty),m:u==null||!ex?null:1-u*x.qty/ex}; }).filter(x=>x.p).sort((a,b)=>(b.prof==null?-1e12:b.prof)-(a.prof==null?-1e12:a.prof));
    const months=[...Array(6)].map((_,i)=>{ const t=kd(nzDay()), a=new Date(t.getFullYear(),t.getMonth()-5+i,1), b=new Date(t.getFullYear(),t.getMonth()-4+i,0), r=crunch(dk(a),dk(b)>nzDay()?nzDay():dk(b),'all'); return [nzDate(a,{month:'short'}),r.net]; });
    return `<button class="homesearch" id="pfRep">📈 <span><b>Reports</b>: takings by day, place and product, GST, costs, CSV</span> ›</button><div class="ctabs">${Object.entries(PROF_PERIODS).map(([k,t])=>`<button class="chip big ${profPeriod===k?'on':''}" data-pp="${k}">${t}</button>`).join('')}</div>
      <div class="card profhead ${v[2]}"><span>${esc(PROF_PERIODS[profPeriod])}: real profit</span><b class="${R.net<0?'neg':''}">${c2(R.net)}</b>
        <small>${H.total?`${ph!=null?c2(ph)+' an hour':''} for your ${hmTxt(H.total)} · ${v[0]} ${v[1]}`:'Your hours aren\'t recorded yet: use the time clock and the check-ins.'}</small>
        <small>From ${c2(R.ex)} sales ex GST, less ${c2(R.cogs)} stock, ${c2(R.fees)} stall fees, ${c2(R.mileage)} fuel and car, ${c2(R.staff)} helpers, ${c2(R.otherCosts)} other costs.</small></div>
      ${ideasCard(ideas)}
      <div class="card"><h3>How sure are these numbers? <span class="sure ${sure[2]}">${sure[0]}</span></h3>
        ${gaps.length?gaps.map((x,i)=>`<div class="lrow"><div class="grow ltxt"><b>${esc(x.t)}</b><small>${esc(x.d)}</small></div><button class="btn alt small" data-gap="${i}">${esc(x.fix)} ›</button></div>`).join(''):'<p class="note">✓ Every sale has a cost, every market has a check-in, and the fees and mileage are in.</p>'}</div>
      <div class="card"><h3>Your hours</h3><div class="ptable"><span>🧺 Markets (travel to unpacking)</span><b>${hmTxt(H.market)}</b><span>🫙 Brew days</span><b>${hmTxt(H.brew)}</b><span>⏱️ Time clock</span><b>${hmTxt(H.clock)}</b><span><b>All</b></span><b>${hmTxt(H.total)}</b></div>
        <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="pfClock">⏱️ Time clock</button></div></div>
      <div class="card" id="pfMk"><h3>Markets and places, best first</h3><p class="note">Profit after stock, fees, fuel and helpers, for each hour you spent there. Worth it is ${c2(hourTarget())} an hour or more (<button class="linkb" id="pfTgt">change</button>).</p>
        ${mk.length?mk.map(x=>{ const vv=verdict(x.net,x.ph); return `<div class="lrow"><div class="grow ltxt"><b>${vv[0]} ${esc(x.p.name)}</b><small>${vv[1]} · ${x.p.days} day${x.p.days===1?'':'s'} · ${c2(x.net)} profit${x.ph!=null?' · '+c2(x.ph)+' an hour':''} · ${c2(Math.round(x.net/x.p.days))} a day</small></div></div>`; }).join(''):'<p class="note">No selling days in this period.</p>'}</div>
      <div class="card"><h3>Products, best earners first</h3>
        ${pr.length?pr.slice(0,20).map(x=>{ const vv=x.m==null?['❓','No cost yet']:x.m>=0.55?['✅','Worth it']:x.m>=0.35?['🟡','Borderline']:['🔴','Low margin']; return `<div class="lrow"><div class="grow ltxt"><b>${vv[0]} ${esc(prodName(x.p))}</b><small>${vv[1]} · ${x.qty} sold · ${x.prof==null?'cost unknown':c2(x.prof)+' profit · '+Math.round(x.m*100)+'% margin'}</small></div></div>`; }).join(''):'<p class="note">Nothing sold in this period.</p>'}</div>
      <div class="card"><h3>The last six months</h3>${bars(months.map(([k,n])=>[k,Math.max(0,n)]),c2)}<p class="note">Real profit each month (a month that lost money shows empty).</p></div>`;
  },
  wire(){
    document.querySelectorAll('[data-pp]').forEach(b=>b.onclick=()=>{ profPeriod=b.dataset.pp; lsSet('rs.profperiod',profPeriod); ideasMore=false; render(); });
    const d=profCache; if(!d) return; wireActionIdeas(d.ideas);
    document.querySelectorAll('[data-gap]').forEach(b=>b.onclick=()=>{ const x=d.gaps[+b.dataset.gap]; if(x) x.act(); });
    const c=$('#pfClock'); if(c) c.onclick=()=>go('clock'); const rp=$('#pfRep'); if(rp) rp.onclick=()=>go('reports');
    const t=$('#pfTgt'); if(t) t.onclick=()=>modal((m,close)=>{ m.innerHTML=`<h2>What's "worth it"?</h2><p class="note">The profit an hour of your time that makes a market worth doing.</p>
      <label class="note" for="tgV">Dollars an hour</label><input class="txt" id="tgV" inputmode="decimal" value="${(hourTarget()/100).toFixed(2)}"><div class="mact"><button class="btn alt" id="tgC">Cancel</button><button class="btn" id="tgOk">Save</button></div>`;
      m.querySelector('#tgC').onclick=close; m.querySelector('#tgOk').onclick=()=>{ const v=toCents(m.querySelector('#tgV').value); if(!(v>0)){ toast('Type an amount, e.g. 25'); return; } S.settings.hourTarget=v; save(); close(); render(); }; });
  }
};

/* ================= Action plans everywhere: the home screen, and the summary emails =================
   The same list as the Profit screen (owners), or just stock and orders (managers). The top five, then
   "Show more ideas". Owners' copy is saved (owner-only) for the helper to put in the briefing and summaries,
   each with a link that opens the app at the right place (#go=…). */
function homeIdeas(){
  if(tillLock()||!canManage()) return [];
  if(role()!=='owner') return dedupeIdeas(stockIdeas());
  const to=nzDay(), from=dk(addDays(kd(to),-60)), R=crunch(from,to,'all'), H=ownerHours(from,to), l=profitIdeas(from,to,R,H);
  const g=profitGaps(from,to,R)[0]; if(g) l.push({score:40,t:g.t,d:g.d,lbl:g.fix,go:'profit',act:g.act});
  const n=typeof issueCount==='function'?issueCount():0; if(n){ const hi=healthIssues()[0]; l.push({score:88,t:n+' thing'+(n===1?' needs':'s need')+' attention',d:hi?hi.name+': '+hi.issues[0].t:'Missing information that makes a number wrong.',lbl:'Fix',go:'attention',act:()=>go('attention')}); }
  return dedupeIdeas(l);
}
let homeIdeasList=[];
function homeIdeasHtml(){ homeIdeasList=homeIdeas(); return homeIdeasList.length?ideasCard(homeIdeasList):''; }
function wireHomeIdeas(){ if(homeIdeasList.length) wireActionIdeas(homeIdeasList); saveActionPlan(homeIdeasList); }
// keep the owners' list for the emails (only when it changes, and at most every 10 minutes)
function saveActionPlan(l){
  if(role()!=='owner'||practice||missingCols.has('clock')) return;
  const list=l.slice(0,8).map(x=>({t:x.t,d:x.d,go:x.go||'profit'})), key=JSON.stringify(list), c=clockList().find(x=>x.id==='actions');
  if(c&&c.key===key) return; if(Date.now()-(saveActionPlan.at||0)<60e3) return; saveActionPlan.at=Date.now(); const titles=list.map(x=>x.t).join('|'); if(c&&c.titles===titles&&Date.now()-c.at<10*60e3) return;   // only the figures changed: not more than every 10 minutes
  if(c) Object.assign(c,{list,key,titles,at:Date.now()}); else clockList().push({id:'actions',kind:'plan',list,key,titles,at:Date.now()}); save();
}
// open the app at a place: #go=profit, #go=brew:stock, #go=lists:shop, #go=setup:products …
function runGo(g){
  const [scr,tab]=String(g||'').split(':'), owner=role()==='owner';
  if(tillLock()) return;
  if(scr==='brew'){ if(tab){ brewTab=tab; lsSet('rs.brewtab',tab); } stack=['home','brew']; render(); return; }
  if(scr==='lists'){ if(tab){ listTab=tab; lsSet('rs.listtab',tab); } stack=['home','lists']; render(); return; }
  if(scr==='reports'&&owner){ if(tab){ repTab=tab; lsSet('rs.reptab',tab); } stack=['home','reports']; render(); return; }
  if((scr==='profit'||scr==='clock')&&owner){ stack=['home',scr]; render(); return; }
  if(scr==='calendar'||scr==='attention'){ stack=['home',scr]; render(); return; }
  if(scr==='setup'&&canManage()){ requirePin(()=>{ stack=['home','setup']; if(tab&&SCREENS[tab]) stack.push(tab); render(); }); return; }
}
function deepLink(){ const m=location.hash.match(/^#go=([\w:-]+)/); if(!m) return; history.replaceState(null,'',location.pathname+location.search); setTimeout(()=>runGo(m[1]),600); }
addEventListener('hashchange',()=>{ if(SYNC.businessId&&SYNC.businessId()) deepLink(); });
