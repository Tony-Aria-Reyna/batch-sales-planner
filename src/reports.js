/* ================= Reports (owners only) =================
   Takings and real profit, by period, channel and place. Everything is worked out on the device from the
   records, so nothing extra is stored and nothing can drift.
     Revenue      till sales plus orders (not cancelled), shown incl. and ex GST; GST collected
     Product cost the cost a unit fixed on the batch it most likely came from (or today's recipe cost)
     Gross profit revenue ex GST − product cost
     Net profit   gross − stall fees − mileage − staff − other costs (all ex GST)
       Stall fee  the place's usual fee, shared across the days it covers (or a fee typed for that day)
       Mileage    the place's return km × her real cost a km (fuel used, fuel price, road user charges)
       Staff      each helper's day rate, or hourly rate × the hours the till was open
   Channels: Retail (Markets, Farm Shop, Online, Tours…) and Wholesale (Shops…), then each place. */
let repPeriod=lsGet('rs.repperiod','month'), repFrom='', repTo='', repChan='all', repTab=lsGet('rs.reptab','summary');
const fyStartMonth=()=>+(S.settings.fyStart||4);
function periodRange(p){
  const t=kd(nzDay()), y=t.getFullYear(), mo=t.getMonth(), k=dk;
  if(p==='today') return [nzDay(),nzDay()];
  if(p==='week') return [k(monday(t)),nzDay()];
  if(p==='month') return [k(new Date(y,mo,1)),nzDay()];
  if(p==='lastmonth') return [k(new Date(y,mo-1,1)),k(new Date(y,mo,0))];
  if(p==='fy'){ const sm=fyStartMonth()-1, fy=mo>=sm?y:y-1; return [k(new Date(fy,sm,1)),nzDay()]; }
  if(p==='lastfy'){ const sm=fyStartMonth()-1, fy=(mo>=sm?y:y-1)-1; return [k(new Date(fy,sm,1)),k(new Date(fy+1,sm,0))]; }
  if(p==='gst'){ const n=+(S.settings.gstMonths||2), sm=(fyStartMonth()-1)%n, start=mo-((mo-sm+12)%n); return [k(new Date(y,start,1)),k(new Date(y,start+n,0))]; }
  return [repFrom||nzDay(),repTo||nzDay()];
}
const PERIODS={today:'Today',week:'This week',month:'This month',lastmonth:'Last month',gst:'This GST period',fy:'Financial year to date',lastfy:'Last financial year',custom:'Choose dates'};
const TYPE_GROUP={market:'markets',farmgate:'farmshop',tour:'tours',shop:'farmshop'};
// which channel group and place a sale or order belongs to
function saleWhere(s){
  const ses=S.sessions.find(x=>x.id===s.sessionId)||{}, pl=S.places.find(p=>p.id===ses.placeId)||S.places.find(p=>!p.gone&&p.name&&p.name===(ses.name||s.where));
  const group=pl?pl.group:(TYPE_GROUP[s.channel]||s.channel||'other');
  return {group,place:pl?pl.id:'',placeName:pl?pl.name:(s.where||ses.name||''),session:ses};
}
function orderWhere(o){ const pl=S.places.find(p=>p.id===o.place); return {group:o.source==='shopify'?'online':o.source==='wholesale'?(pl?pl.group:'shops'):'custom',place:pl?pl.id:'',placeName:pl?pl.name:((o.customer||{}).name||'')}; }
const groupName=g=>{ const x=(typeof placeGroups==='function'?placeGroups():[]).find(y=>y.id===g); return x?x.name:{tours:'Garden tours',custom:'Custom orders',other:'Other'}[g]||g; };
const groupChannel=g=>{ const x=(typeof placeGroups==='function'?placeGroups():[]).find(y=>y.id===g); return x?x.channel:'retail'; };
// the cost of one unit when it was sold: the most recent batch made before the sale, else today's recipe cost
function costAt(pid,at){
  const b=S.batches.filter(x=>x.status==='made'&&x.unitCost&&x.unitCost[pid]!=null&&(x.madeAt||x.at)<=at).sort((a,c)=>(c.madeAt||c.at)-(a.madeAt||a.at))[0];
  if(b) return b.unitCost[pid]; const p=S.products.find(x=>x.id===pid); const u=p?unitCost(p):null; return u==null?null:Math.round(u);
}
/* ---------- the vehicle's real cost a kilometre ---------- */
function vehicleCost(){
  const f=S.fuel.filter(x=>x.litres>0&&x.cents>0).sort((a,b)=>(a.odo||0)-(b.odo||0)||a.at-b.at);
  let l100=+(S.settings.vehicle&&S.settings.vehicle.l100)||0, perL=0;
  const recent=f.slice(-8); if(recent.length) perL=recent.reduce((n,x)=>n+x.cents,0)/recent.reduce((n,x)=>n+x.litres,0);
  const withOdo=f.filter(x=>x.odo>0); if(withOdo.length>=2){ const a=withOdo[0], b=withOdo[withOdo.length-1], km=b.odo-a.odo, used=withOdo.slice(1).reduce((n,x)=>n+x.litres,0); if(km>50) l100=used/km*100; }
  const ruc=+(S.settings.vehicle&&S.settings.vehicle.ruc)||0;      // cents per 1000 km, incl GST
  const fuelKm=l100&&perL?l100/100*perL:0, perKm=(fuelKm+ruc/1000)/1.15;   // ex GST
  return {l100,perL,ruc,perKm,fills:f.length};
}
/* ---------- crunch one period ---------- */
function crunch(from,to,chan){
  const inRange=d=>d>=from&&d<=to, keep=w=>chan==='all'||(chan.startsWith('c:')?groupChannel(w.group)===chan.slice(2):chan.startsWith('g:')?w.group===chan.slice(2):w.place===chan.slice(2));
  const R={count:0,revenue:0,gst:0,cogs:0,unknownCost:0,cash:0,eftpos:0,afterpay:0,other:0,fees:0,mileage:0,staff:0,otherCosts:0,byDay:{},byGroup:{},byPlace:{},byProduct:{},byHour:Array(24).fill(0),byWeekday:Array(7).fill(0),days:new Set(),sales:[]};
  const add=(w,total,gst,date)=>{ const ex=total-gst; R.revenue+=total; R.gst+=gst; R.byDay[date]=(R.byDay[date]||0)+total;
    const g=R.byGroup[w.group]||(R.byGroup[w.group]={total:0,ex:0}); g.total+=total; g.ex+=ex;
    if(w.placeName){ const k=w.place||w.placeName, p=R.byPlace[k]||(R.byPlace[k]={name:w.placeName,group:w.group,total:0,ex:0,cogs:0,fees:0,mileage:0,staff:0,days:0}); p.total+=total; p.ex+=ex; } };
  const lineCost=(w,l,at)=>{ if(!l.pid) return; const c=costAt(l.pid,at); const pr=R.byProduct[l.pid]||(R.byProduct[l.pid]={qty:0,total:0}); pr.qty+=l.qty; pr.total+=l.amount!=null?l.amount:l.qty*l.unit;
    if(c==null){ R.unknownCost+=l.qty; return; } R.cogs+=c*l.qty; if(w.placeName){ const p=R.byPlace[w.place||w.placeName]; if(p) p.cogs+=c*l.qty; } };
  for(const s of S.sales){ if(s.voided||!inRange(s.date)) continue; const w=saleWhere(s); if(!keep(w)) continue;
    R.count++; add(w,s.total,s.gst!=null?s.gst:Math.round(s.total*3/23),s.date); R.sales.push(s);
    if(s.method==='cash') R.cash+=s.total; else if(s.method==='eftpos') R.eftpos+=s.total; else if(s.method==='afterpay') R.afterpay+=s.total; else R.other+=s.total;
    const st=s.when||{}; if(st.hour!=null) R.byHour[st.hour]+=s.total; const wd=kd(s.date).getDay(); R.byWeekday[(wd+6)%7]+=s.total;
    (s.lines||[]).forEach(l=>lineCost(w,l,s.at)); }
  for(const o of S.orders){ if(o.status==='cancelled'||!inRange(o.date||'')) continue; const w=orderWhere(o); if(!keep(w)) continue;
    const total=o.total!=null?o.total:orderTotal(o); R.count++; add(w,total,o.gst!=null?o.gst:Math.round(total*3/23),o.date); (o.lines||[]).forEach(l=>lineCost(w,Object.assign({amount:l.qty*l.unit},l),o.at)); }
  // costs of each selling day: stall fee share, mileage, staff
  const vc=vehicleCost(), pay=S.pay||[];
  for(const ses of S.sessions){ if(!inRange(ses.date)) continue; const w=saleWhere({sessionId:ses.id,channel:ses.type,where:ses.name}); if(!keep(w)) continue;
    const pl=S.places.find(p=>p.id===w.place), fee=pl?feeOf(pl.id):null, dfee=S.costs.find(c=>c.id==='dayfee-'+ses.id), day=dfee?dfee.cents:ses.fee!=null?ses.fee:(fee&&fee.cents?Math.round(fee.cents/Math.max(1,fee.days||1)):0);
    const feeEx=Math.round(day/1.15), km=pl&&pl.km?pl.km:0, mil=Math.round(km*vc.perKm);
    const hours=Math.max(0,((ses.closedAt||ses.openedAt)-ses.openedAt)/3600000), names=[...new Set(S.sales.filter(x=>x.sessionId===ses.id&&x.servedBy).map(x=>x.servedBy))];
    const staff=names.reduce((n,nm)=>{ const r=pay.find(p=>(p.name||'').toLowerCase()===nm.toLowerCase()), rec=(S.clock||[]).find(c=>c.kind==='helper'&&c.session===ses.id&&(c.who||'').toLowerCase()===nm.toLowerCase()); return n+(r?(r.day?r.day:Math.round((r.hourly||0)*(rec?rec.mins/60:hours))):0); },0);
    R.fees+=feeEx; R.mileage+=mil; R.staff+=staff; R.days.add(ses.date);
    const p=w.placeName&&R.byPlace[w.place||w.placeName]; if(p){ p.fees+=feeEx; p.mileage+=mil; p.staff+=staff; p.days++; } }
  for(const c of S.costs){ if(c.kind==='other'&&inRange(c.date||'')&&(chan==='all'||c.place===chan.slice(2))) R.otherCosts+=Math.round((c.cents||0)/(c.gst===false?1:1.15)); }
  R.ex=R.revenue-R.gst; R.gross=R.ex-R.cogs; R.net=R.gross-R.fees-R.mileage-R.staff-R.otherCosts; R.vc=vc;
  return R;
}

/* ---------- the screen ---------- */
SCREENS.reports={
  title:()=>({h:'Reports',s:'Takings, profit and GST'}),
  html(){
    if(role()!=='owner'||tillLock()) return '<div class="card"><p>Reports are for owners.</p></div>';
    const [from,to]=periodRange(repPeriod), R=crunch(from,to,repChan);
    const chOpts=[['all','Everything']].concat(Object.entries(CHANNELS).map(([k,v])=>['c:'+k,v])).concat(placeGroups().map(g=>['g:'+g.id,'· '+g.name])).concat(S.places.filter(p=>!p.gone).map(p=>['p:'+p.id,'·· '+p.name]));
    const tabs=[['summary','📊 Summary'],['places','📍 By place'],['products','🧴 Products'],['when','🕐 When'],['costs','💸 Costs']];
    return `<button class="homesearch profbtn" id="rProf">💰 <span><b>Real profit</b>, an hour of your time, and what to do next</span> ›</button><div class="card"><div class="formrow"><div><label class="note" for="rP">Period</label><select class="txt" id="rP">${Object.entries(PERIODS).map(([k,v])=>`<option value="${k}" ${repPeriod===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div><label class="note" for="rCh">Channel or place</label><select class="txt" id="rCh">${chOpts.map(([k,v])=>`<option value="${k}" ${repChan===k?'selected':''}>${esc(v)}</option>`).join('')}</select></div></div>
        ${repPeriod==='custom'?`<div class="formrow"><div><label class="note" for="rF">From</label><input class="txt" id="rF" type="date" value="${from}"></div><div><label class="note" for="rT">To</label><input class="txt" id="rT" type="date" value="${to}"></div></div>`:`<p class="note">${esc(nzDate(kd(from),{day:'numeric',month:'short',year:'numeric'}))} – ${esc(nzDate(kd(to),{day:'numeric',month:'short',year:'numeric'}))}</p>`}</div>
      <div class="ctabs">${tabs.map(([k,v])=>`<button class="chip big ${repTab===k?'on':''}" data-rtab="${k}">${v}</button>`).join('')}</div>`
      +(repTab==='places'?placesRep(R):repTab==='products'?productsRep(R):repTab==='when'?whenRep(R):repTab==='costs'?costsRep(R):summaryRep(R,from,to));
  },
  wire(){
    if(!$('#rP')) return;
    $('#rP').onchange=e=>{ repPeriod=e.target.value; lsSet('rs.repperiod',repPeriod); if(repPeriod==='custom'&&!repFrom){ const [a,b]=periodRange('month'); repFrom=a; repTo=b; } render(); };
    $('#rCh').onchange=e=>{ repChan=e.target.value; render(); };
    const f=$('#rF'); if(f){ f.onchange=()=>{ repFrom=f.value; render(); }; $('#rT').onchange=e=>{ repTo=e.target.value; render(); }; }
    document.querySelectorAll('[data-rtab]').forEach(b=>b.onclick=()=>{ repTab=b.dataset.rtab; lsSet('rs.reptab',repTab); render(); });
    const x=$('#rCsv'); if(x) x.onclick=exportSales;
    const ac=$('#rAddCost'); if(ac) ac.onclick=addCost;
    document.querySelectorAll('[data-delcost]').forEach(b=>b.onclick=()=>{ const i=S.costs.findIndex(c=>c.id===b.dataset.delcost); if(i>=0){ S.costs.splice(i,1); save(); render(); } });
    const pr=$('#rPay'); if(pr) pr.onclick=editPay; wireHelperHours(); const rpf=$('#rProf'); if(rpf) rpf.onclick=()=>go('profit');
    const vh=$('#rVeh'); if(vh) vh.onclick=()=>go('vehicle');
    const fy=$('#rFy'); if(fy) fy.onchange=()=>{ S.settings.fyStart=+fy.value; save(); render(); };
    const gm=$('#rGm'); if(gm) gm.onchange=()=>{ S.settings.gstMonths=+gm.value; save(); render(); };
  }
};
const neg=v=>v?'−'+c2(v):c2(0);
const stat=(label,v,sub)=>`<div class="rstat"><span>${label}</span><b>${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
function bars(entries,fmt){ const max=Math.max(1,...entries.map(e=>e[1])); return `<div class="rbars">${entries.map(([k,v])=>`<div class="rbar"><span class="rl">${esc(k)}</span><span class="rt"><i style="width:${(v/max*100).toFixed(1)}%"></i></span><span class="rv">${fmt(v)}</span></div>`).join('')}</div>`; }
function summaryRep(R,from,to){
  const days=Object.keys(R.byDay).sort(), long=Math.round((kd(to)-kd(from))/864e5)>62;
  const series=long?Object.entries(days.reduce((m,d)=>{ const k=d.slice(0,7); m[k]=(m[k]||0)+R.byDay[d]; return m; },{})).map(([k,v])=>[nzDate(kd(k+'-01'),{month:'short',year:'2-digit'}),v])
    :days.map(d=>[nzDate(kd(d),{weekday:'short',day:'numeric'}),R.byDay[d]]);
  return `<section class="rgrid">${stat('Takings (incl GST)',c2(R.revenue),R.count+' sale'+(R.count===1?'':'s')+(R.count?' · average '+c2(Math.round(R.revenue/R.count)):''))}${stat('GST collected',c2(R.gst),'Ex GST '+c2(R.ex))}
      ${stat('Gross profit',c2(R.gross),R.ex?Math.round(R.gross/R.ex*100)+'% of sales ex GST':'')}${stat('Net profit',c2(R.net),'After stall fees, mileage, staff and other costs')}</section>
    ${R.unknownCost?`<p class="note">⚠️ ${R.unknownCost} item${R.unknownCost===1?'':'s'} sold have no product cost yet (link their recipe in Setup → Ingredients and recipes), so profit is overstated.</p>`:''}
    <div class="card"><h3>Takings ${long?'by month':'by day'}</h3>${series.length?bars(series,c2):'<p class="note">No sales in this period.</p>'}</div>
    <div class="card"><h3>By channel</h3>${bars(Object.entries(R.byGroup).sort((a,b)=>b[1].total-a[1].total).map(([g,v])=>[(groupChannel(g)==='wholesale'?'Wholesale · ':'Retail · ')+groupName(g),v.total]),c2)}</div>
    <div class="card"><h3>How people paid (till)</h3>${bars([['Cash',R.cash],['EFTPOS',R.eftpos],['Afterpay',R.afterpay],['Other',R.other]].filter(x=>x[1]),c2)}</div>
    <div class="card"><h3>Profit</h3><div class="ptable">
      <span>Sales ex GST</span><b>${c2(R.ex)}</b><span>Product cost</span><b>${neg(R.cogs)}</b><span><b>Gross profit</b></span><b>${c2(R.gross)}</b>
      <span>Stall fees</span><b>${neg(R.fees)}</b><span>Mileage</span><b>${neg(R.mileage)}</b><span>Staff</span><b>${neg(R.staff)}</b><span>Other costs</span><b>${neg(R.otherCosts)}</b>
      <span><b>Net profit</b></span><b class="${R.net<0?'neg':''}">${c2(R.net)}</b></div><p class="note">All ex GST.</p>
      <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="rCsv">⬇️ Download sales (CSV, for the accountant)</button></div></div>`;
}
function placesRep(R){
  const l=Object.values(R.byPlace).sort((a,b)=>b.total-a.total);
  return `<div class="card"><h3>Is each place worth it?</h3><p class="note">Sales ex GST, less product cost, stall fees, mileage and staff for the days you sold there.</p>
    ${l.length?l.map(p=>{ const net=p.ex-p.cogs-p.fees-p.mileage-p.staff; return `<div class="lrow"><div class="grow ltxt"><b>${esc(p.name)}</b><small>${esc(groupName(p.group))} · ${p.days} day${p.days===1?'':'s'} · takings ${c2(p.total)} · fees ${c2(p.fees)} · mileage ${c2(p.mileage)} · staff ${c2(p.staff)}</small></div><span class="pill ${net<0?'bad':'ok'}">${c2(net)}${p.days?' · '+c2(Math.round(net/p.days))+'/day':''}</span></div>`; }).join(''):'<p class="note">No sales at named places in this period.</p>'}</div>`;
}
function productsRep(R){
  const l=Object.entries(R.byProduct).map(([pid,v])=>({p:S.products.find(x=>x.id===pid),...v})).filter(x=>x.p).sort((a,b)=>b.qty-a.qty);
  return `<div class="card"><h3>Best sellers</h3>${l.length?bars(l.slice(0,15).map(x=>[prodName(x.p),x.qty]),v=>v+' sold'):'<p class="note">Nothing sold in this period.</p>'}</div>
    ${l.length>5?`<div class="card"><h3>Slowest</h3>${bars(l.slice(-5).reverse().map(x=>[prodName(x.p),x.qty]),v=>v+' sold')}</div>`:''}
    <div class="card"><h3>Margins now</h3>${S.products.filter(p=>p.active!==false&&unitCost(p)!=null).map(p=>{ const c=unitCost(p), ex=p.price/1.15, m=Math.round((1-c/ex)*100); return `<div class="lrow"><div class="grow ltxt"><b>${esc(prodName(p))}</b><small>Costs ${c2(Math.round(c))} · sells ${c2(Math.round(ex))} ex GST${p.wholesale?' · wholesale '+c2(Math.round(p.wholesale/1.15))+' ex GST':''}</small></div><span class="pill ${m<40?'bad':'ok'}">${m}%</span></div>`; }).join('')||'<p class="note">Link recipes to products to see margins.</p>'}</div>`;
}
function whenRep(R){
  const hrs=R.byHour.map((v,h)=>[h,v]).filter(x=>x[1]);
  return `<div class="card"><h3>Busiest hours (till)</h3>${hrs.length?bars(hrs.map(([h,v])=>[((h%12)||12)+(h<12?' am':' pm'),v]),c2):'<p class="note">No till sales in this period.</p>'}</div>
    <div class="card"><h3>By day of the week</h3>${bars(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>[d,R.byWeekday[i]]).filter(x=>x[1]),c2)||''}</div>`;
}
function costsRep(R){
  const vc=R.vc, other=S.costs.filter(c=>c.kind==='other').sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,30);
  return `<div class="card"><h3>Other costs</h3><p class="note">Anything not tied to a product: a gazebo, signage, a market licence. Typed incl GST.</p>
      ${other.map(c=>`<div class="lrow"><div class="grow ltxt"><b>${esc(c.note||'Cost')}</b><small>${esc(nzDate(kd(c.date),{day:'numeric',month:'short',year:'numeric'}))}${c.place?' · '+esc((S.places.find(p=>p.id===c.place)||{}).name||''):''}</small></div><b>${c2(c.cents)}</b><button class="qb rm" data-delcost="${c.id}">✕</button></div>`).join('')}
      <div class="mact" style="justify-content:flex-start"><button class="btn" id="rAddCost">＋ Add a cost</button></div></div>
    <div class="card"><h3>Mileage</h3><p>${vc.perKm?`About <b>${c2(Math.round(vc.perKm*100)/100)}</b> a km ex GST`:'Not set up yet'}${vc.l100?` · ${Math.round(vc.l100*10)/10} L/100 km`:''}${vc.perL?` · fuel ${c2(Math.round(vc.perL))}/L`:''}${vc.ruc?` · RUC ${c2(vc.ruc)} per 1,000 km`:''}</p>
      <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="rVeh">🚙 Vehicle and fuel</button></div></div>
    <div class="card"><h3>Staff pay</h3><p class="note">Used for staff cost on selling days, matched to the name picked as "who's serving". Only owners see this.</p>
      ${(S.pay||[]).map(p=>`<div class="lrow"><div class="grow ltxt"><b>${esc(p.name)}</b><small>${[p.day?c2(p.day)+' a day':'',p.hourly?c2(p.hourly)+' an hour':''].filter(Boolean).join(' · ')||'no rate'}</small></div></div>`).join('')}
      <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="rPay">Change pay rates</button></div></div>
    ${helperHoursCard()}
    <div class="card"><h3>Years and GST</h3><div class="formrow"><div><label class="note" for="rFy">Financial year starts</label><select class="txt" id="rFy">${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i)=>`<option value="${i+1}" ${fyStartMonth()===i+1?'selected':''}>${m}</option>`).join('')}</select></div>
      <div><label class="note" for="rGm">GST return every</label><select class="txt" id="rGm">${[[1,'month'],[2,'2 months'],[6,'6 months']].map(([n,t])=>`<option value="${n}" ${+(S.settings.gstMonths||2)===n?'selected':''}>${t}</option>`).join('')}</select></div></div></div>`;
}
function addCost(){
  modal((m,close)=>{ m.innerHTML=`<h2>Add a cost</h2><label class="note" for="kN">What</label><textarea class="txt grow" rows="1" id="kN" autocapitalize="sentences" placeholder="e.g. New gazebo"></textarea>
      <div class="formrow"><div><label class="note" for="kA">Amount incl GST ($)</label><input class="txt" id="kA" inputmode="decimal"></div><div><label class="note" for="kD">Date</label><input class="txt" id="kD" type="date" value="${nzDay()}"></div></div>
      <label class="note" for="kP">For a place (optional)</label><select class="txt" id="kP"><option value="">The whole business</option>${S.places.filter(p=>!p.gone).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <div class="mact"><button class="btn alt" id="kC">Cancel</button><button class="btn" id="kOk">Save</button></div>`;
    m.querySelector('#kC').onclick=close;
    m.querySelector('#kOk').onclick=()=>{ const n=m.querySelector('#kN').value.trim(), c=toCents(m.querySelector('#kA').value); if(!n){ toast('Type what it was'); return; } if(!(c>0)){ toast('Type the amount'); return; }
      S.costs.push({id:SYNC.newId('costs'),kind:'other',note:n.slice(0,120),cents:c,date:m.querySelector('#kD').value||nzDay(),place:m.querySelector('#kP').value,by:SYNC.me(),at:Date.now()}); save(); close(); render(); }; });
}
function editPay(){
  const names=[...new Set([...(S.settings.staff||[]),...(S.pay||[]).map(p=>p.name)])];
  modal((m,close)=>{ m.innerHTML=`<h2>Staff pay rates</h2><p class="note">Leave both empty for someone who isn't paid. A day rate is used if both are set.</p>
      ${names.map((n,i)=>{ const r=(S.pay||[]).find(p=>p.name===n)||{}; return `<div class="lrow"><div class="grow ltxt"><b>${esc(n)}</b></div><input class="txt qty" inputmode="decimal" data-pd="${i}" value="${r.day?(r.day/100).toFixed(2):''}" placeholder="$/day"><input class="txt qty" inputmode="decimal" data-ph="${i}" value="${r.hourly?(r.hourly/100).toFixed(2):''}" placeholder="$/hour"></div>`; }).join('')||'<p class="note">Add helpers\' names first (Setup → Helpers\' names).</p>'}
      <div class="mact"><button class="btn alt" id="yC">Cancel</button><button class="btn" id="yOk">Save</button></div>`;
    m.querySelector('#yC').onclick=close;
    m.querySelector('#yOk').onclick=()=>{ names.forEach((n,i)=>{ const d=m.querySelector(`[data-pd="${i}"]`).value.trim(), h=m.querySelector(`[data-ph="${i}"]`).value.trim(), day=d?toCents(d):0, hourly=h?toCents(h):0;
        const ex=S.pay.find(p=>p.name===n); if(!day&&!hourly){ if(ex) S.pay.splice(S.pay.indexOf(ex),1); return; }
        if(ex) Object.assign(ex,{day:day||0,hourly:hourly||0}); else S.pay.push({id:SYNC.newId('pay'),name:n,day:day||0,hourly:hourly||0}); });
      save(); close(); render(); toast('Saved'); }; });
}
function exportSales(){
  const [from,to]=periodRange(repPeriod), R=crunch(from,to,repChan), q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"', rows=[['Date','Time','Receipt','Where','Channel','Product','Qty','Unit price incl GST','Line total incl GST','Sale total incl GST','GST','Paid by','Served by'].map(q).join(',')];
  R.sales.forEach(s=>{ const w=saleWhere(s); (s.lines||[]).forEach((l,i)=>rows.push([s.date,nzTime(s.at),String(s.id).slice(-6).toUpperCase(),w.placeName,groupName(w.group),l.name+(l.size?' '+l.size:''),l.qty,(l.unit/100).toFixed(2),(l.amount/100).toFixed(2),i?'':(s.total/100).toFixed(2),i?'':((s.gst||0)/100).toFixed(2),i?'':s.method,s.servedBy||''].map(q).join(','))); });
  S.orders.filter(o=>o.status!=='cancelled'&&o.date>=from&&o.date<=to).forEach(o=>{ const w=orderWhere(o); (o.lines||[]).forEach((l,i)=>rows.push([o.date,'',o.shopify?o.shopify.name:String(o.id).slice(-6).toUpperCase(),w.placeName,groupName(w.group),l.name,l.qty,(l.unit/100).toFixed(2),(l.qty*l.unit/100).toFixed(2),i?'':((o.total||0)/100).toFixed(2),i?'':((o.gst||0)/100).toFixed(2),i?'':(o.paid?'paid':'not paid'),''].map(q).join(','))); });
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([rows.join('\r\n')],{type:'text/csv'})); a.download=`rata-smudge-sales-${from}-to-${to}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

/* ---------- vehicle and fuel ---------- */
SCREENS.vehicle={
  title:()=>({h:'Vehicle and fuel',s:'Her real cost a kilometre'}),
  html(){ const v=S.settings.vehicle||{}, vc=vehicleCost(), f=S.fuel.slice().sort((a,b)=>b.at-a.at).slice(0,20);
    return `<div class="card"><h3>🚙 ${esc(v.name||'The vehicle')}</h3>
        <label class="note" for="vN">Vehicle</label><textarea class="txt grow" rows="1" id="vN" placeholder="e.g. Jeep (diesel)">${esc(v.name||'')}</textarea>
        <div class="formrow"><div><label class="note" for="vR">Road user charges, $ per 1,000 km</label><input class="txt" id="vR" inputmode="decimal" value="${v.ruc?(v.ruc/100).toFixed(2):''}"></div>
          <div><label class="note" for="vL">Usual L/100 km (until there are fill-ups)</label><input class="txt" id="vL" inputmode="decimal" value="${v.l100||''}"></div></div>
        <p><b>${vc.perKm?c2(Math.round(vc.perKm*100)/100)+' a km ex GST':'Add the numbers above or a fill-up'}</b>${vc.l100?' · '+Math.round(vc.l100*10)/10+' L/100 km'+(vc.fills>=2?' (from fill-ups)':''):''}${vc.perL?' · fuel '+c2(Math.round(vc.perL))+'/L':''}</p></div>
      <div class="card"><h3>⛽ Fill-ups</h3><p class="note">At the pump: litres, the total paid and the odometer. With two or more, the app works out her real fuel use.</p>
        <div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="vAdd">＋ Add a fill-up</button></div>
        ${f.map(x=>`<div class="lrow"><div class="grow ltxt"><b>${esc(nzDate(new Date(x.at),{day:'numeric',month:'short',year:'numeric'}))} · ${x.litres} L · ${c2(x.cents)}</b><small>${c2(Math.round(x.cents/x.litres))}/L${x.odo?' · '+x.odo.toLocaleString('en-NZ')+' km':''}</small></div><button class="qb rm" data-fdel="${x.id}">✕</button></div>`).join('')}</div>`; },
  wire(){ const v=()=>S.settings.vehicle||(S.settings.vehicle={});
    $('#vN').onchange=e=>{ v().name=e.target.value.trim().slice(0,60); save(); };
    $('#vR').onchange=e=>{ const c=toCents(e.target.value||'0'); v().ruc=c>0?c:0; save(); render(); };
    $('#vL').onchange=e=>{ v().l100=Math.max(0,+e.target.value||0); save(); render(); };
    $('#vAdd').onclick=addFuel;
    document.querySelectorAll('[data-fdel]').forEach(b=>b.onclick=()=>{ const i=S.fuel.findIndex(x=>x.id===b.dataset.fdel); if(i>=0){ S.fuel.splice(i,1); save(); render(); } });
  }
};
function addFuel(){
  modal((m,close)=>{ m.innerHTML=`<h2>⛽ Fill-up</h2>${voiceReady()?`<p class="note">Take a photo of the receipt, the pump or the odometer (or pick one from the gallery) and the assistant fills these in for you to check.</p>
      <div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn alt" id="fCam">📷 Take a photo</button><button class="btn alt" id="fGal">🖼️ From the gallery</button></div>`:''}<div class="formrow"><div><label class="note" for="fL">Litres</label><input class="txt" id="fL" inputmode="decimal"></div><div><label class="note" for="fT">Total paid ($)</label><input class="txt" id="fT" inputmode="decimal"></div></div>
      <label class="note" for="fO">Odometer (km)</label><input class="txt" id="fO" inputmode="numeric">
      <p class="note">Fill the tank each time for the most accurate fuel use.</p><div class="mact"><button class="btn alt" id="fC">Cancel</button><button class="btn" id="fOk">Save</button></div>`;
    m.querySelector('#fC').onclick=close;
    // the photo goes to the assistant; what it reads is filled in here (guesses in yellow), nothing is saved until Save
    const fill=n=>{ const d=(n.drafts||[]).find(x=>x.kind==='fuel'); if(!d){ toast('Couldn\'t read a fill-up from that photo. Type it in, or try a clearer photo.'); return; }
      const f=d.fuel, set=(id,v,k)=>{ const el=m.querySelector(id); if(v){ el.value=v; el.classList.toggle('unsure',(d.unsure||[]).includes(k)); } };
      set('#fL',f.litres?String(f.litres):'','litres'); set('#fT',f.cents?(f.cents/100).toFixed(2):'','cents'); set('#fO',f.odometer?String(f.odometer):'','odometer');
      toast('Filled in from the photo: check it, then Save'); };
    const photo=src=>takePhoto({source:src,hint:'Fuel fill-up: a fuel receipt, the pump display or the odometer. Draft one fuel entry with what you can read.',onDrafts:fill});
    const fc=m.querySelector('#fCam'); if(fc){ fc.onclick=()=>photo('camera'); m.querySelector('#fGal').onclick=()=>photo('gallery'); }
    m.querySelector('#fOk').onclick=()=>{ const l=+m.querySelector('#fL').value.replace(/[^0-9.]/g,''), c=toCents(m.querySelector('#fT').value), o=+m.querySelector('#fO').value.replace(/[^0-9]/g,'')||0;
      if(!(l>0)){ toast('Type the litres'); return; } if(!(c>0)){ toast('Type the total paid'); return; }
      S.fuel.push({id:SYNC.newId('fuel'),litres:l,cents:c,odo:o,at:Date.now(),date:nzDay(),by:SYNC.me()}); save(); close(); render(); toast('Saved'); }; });
}
