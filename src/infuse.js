/* ================= Infusions, and the season ahead =================
   An infused oil (e.g. calendula in olive oil) is an ingredient made here, with its own usual infusing time
   (set on each one, as every infusion is different). Product recipes use the infused oil, so the herb amounts
   stay inside its own locked recipe.
   Each jar started is kept as a batch of kind "infusion": how much, where it is, started, ready, cost. Its
   ready date goes on the calendar; on the day, "Strain it" puts what came out into ingredient stock.
   The season ahead works out, month by month for 12 months, what's likely to sell (from the markets on the
   calendar, what usually sells at a market, orders, and any busy months she marks), then for owners the
   infused oil that needs, and when each infusion must be started to be ready in time. All arithmetic on her
   own figures: no assistant, no cost. */
const infusedInputs=()=>S.inputs.filter(i=>i.infuse);
const jars=()=>S.batches.filter(b=>b.kind==='infusion'&&b.status==='infusing').sort((a,b)=>(a.ready||'').localeCompare(b.ready||''));
const infuseWeeks=i=>Math.max(1,+(i&&i.infuse&&i.infuse.weeks)||6);
const daysTo=k=>Math.round((kd(k)-kd(nzDay()))/864e5);

function infuseHtml(){
  const l=jars(), oils=infusedInputs();
  return `<div class="card"><div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn" id="inStart">🌼 Start an infusion</button></div>
      <h3>On the shelf</h3>${l.length?l.map(b=>{ const i=S.inputs.find(x=>x.id===b.input)||{name:'?',unit:''}, d=daysTo(b.ready);
        return `<div class="lrow"><div class="grow ltxt"><b>${esc(i.name)} · ${fmtQty(b.qty,i.unit)}</b><small>📍 ${esc(b.where||'where?')} · started ${nzDate(kd(b.started),{day:'numeric',month:'short'})} · ready ${nzDate(kd(b.ready),{weekday:'short',day:'numeric',month:'short'})}</small></div>
          ${d<=0?`<button class="btn small" data-strain="${b.id}">Strain it</button>`:`<span class="pill">${d} day${d===1?'':'s'} to go</span>`}</div>`; }).join(''):'<p class="note">Nothing infusing.</p>'}</div>
    <div class="card"><h3>Infused oils</h3><p class="note">Each has its own usual time. Add one with ＋ Ingredient and tick “Infused here”.</p>
      ${oils.length?oils.map(i=>{ const st=inputStock(i.id); return `<div class="row"><div class="grow"><b>${esc(i.name)}</b><small>${infuseWeeks(i)} weeks to infuse · ${st==null?'stock not counted':fmtQty(st,i.unit)+' ready to use'}</small></div><button class="btn alt small" data-inwk="${i.id}">Change</button></div>`; }).join(''):'<p class="note">None yet.</p>'}
      <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="inNew">＋ New infused oil</button></div></div>`;
}
function wireInfuse(){
  $('#inStart').onclick=()=>startInfusion();
  $('#inNew').onclick=()=>editInput({cat:'ingredient',unit:'ml',infuse:{weeks:6}},()=>render());
  document.querySelectorAll('[data-strain]').forEach(b=>b.onclick=()=>strainJar(S.batches.find(x=>x.id===b.dataset.strain)));
  document.querySelectorAll('[data-inwk]').forEach(b=>b.onclick=()=>editInput(S.inputs.find(x=>x.id===b.dataset.inwk),()=>render()));
}
function startInfusion(pre){
  const oils=infusedInputs(); if(!oils.length){ toast('Add the infused oil first'); editInput({cat:'ingredient',unit:'ml',infuse:{weeks:6}},()=>startInfusion(pre)); return; }
  const places=[...new Set(S.batches.filter(b=>b.kind==='infusion'&&b.where).map(b=>b.where))];
  modal((m,close)=>{ const draw=id=>{ const i=S.inputs.find(x=>x.id===id)||oils[0];
      m.innerHTML=`<h2>🌼 Start an infusion</h2>
        <label class="note" for="jI">Which</label><select class="txt" id="jI">${oils.map(o=>`<option value="${o.id}" ${o.id===i.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select>
        <div class="formrow"><div><label class="note" for="jQ">How much (${esc(UNIT_WORDS[i.unit]||i.unit)})</label><input class="txt" id="jQ" type="number" min="0" step="any" value="${pre&&pre.qty||''}" placeholder="e.g. 5000"></div>
          <div><label class="note" for="jS">Started</label><input class="txt" id="jS" type="date" value="${nzDay()}"></div></div>
        <div class="formrow"><div><label class="note" for="jW">Weeks to infuse</label><input class="txt" id="jW" type="number" min="1" max="52" value="${infuseWeeks(i)}"></div>
          <div><label class="note" for="jC">Cost of what went in ($, optional)</label><input class="txt" id="jC" inputmode="decimal" placeholder="e.g. 375"></div></div>
        <label class="note" for="jWh">Where it is</label><textarea class="txt grow" rows="1" id="jWh" placeholder="e.g. office, bottom shelf, left">${esc(places[0]||'')}</textarea>
        ${places.length>1?`<div class="pastnames">${places.slice(0,6).map(p=>`<button class="chip" data-jw="${esc(p)}">${esc(p)}</button>`).join('')}</div>`:''}
        <p class="chkline" id="jR"></p>
        <div class="mact"><button class="btn alt" id="jC0">Cancel</button><button class="btn" id="jOk">Start</button></div>`;
      const rd=()=>{ const s=m.querySelector('#jS').value||nzDay(), w=+m.querySelector('#jW').value||infuseWeeks(i); return dk(addDays(kd(s),w*7)); };
      const show=()=>{ m.querySelector('#jR').innerHTML='Ready <b>'+nzDate(kd(rd()),{weekday:'long',day:'numeric',month:'long'})+'</b> (it goes on the calendar)'; };
      ['#jS','#jW'].forEach(s=>m.querySelector(s).oninput=show); show();
      m.querySelector('#jI').onchange=e=>draw(e.target.value);
      m.querySelectorAll('[data-jw]').forEach(b=>b.onclick=()=>{ m.querySelector('#jWh').value=b.dataset.jw; });
      m.querySelector('#jC0').onclick=close;
      m.querySelector('#jOk').onclick=()=>{ const q=+m.querySelector('#jQ').value, cT=m.querySelector('#jC').value.trim(), cost=cT?toCents(cT):0, where=m.querySelector('#jWh').value.trim().slice(0,80);
        if(!(q>0)){ toast('Type how much'); return; } if(cT&&!(cost>=0)){ toast('Type the cost, e.g. 375'); return; } if(!where){ toast('Say where it is, so it isn\'t lost'); return; }
        const ready=rd(), started=m.querySelector('#jS').value||nzDay(), w=+m.querySelector('#jW').value;
        if(w&&w!==infuseWeeks(i)){ i.infuse=Object.assign({},i.infuse,{weeks:w}); }
        const ev={id:SYNC.newId('events'),type:'brew',title:'🌼 Ready to strain: '+i.name,place:'',date:ready,time:'',end:'',days:1,rpt:'',until:'',attendees:[],remind:['day'],note:fmtQty(q,i.unit)+' · '+where,by:SYNC.me(),changed:Date.now()};
        S.events.push(ev);
        S.batches.push({id:SYNC.newId('batches'),kind:'infusion',status:'infusing',input:i.id,name:i.name,qty:q,started,ready,where,cost,eventId:ev.id,by:SYNC.me(),at:Date.now()});
        save(); close(); render(); toast('Started: ready '+nzDate(kd(ready),{day:'numeric',month:'short'})); };
    }; draw(pre&&pre.input); });
}
function strainJar(b){
  if(!b) return; const i=S.inputs.find(x=>x.id===b.input)||{name:b.name,unit:''};
  modal((m,close)=>{ m.innerHTML=`<h2>Strain: ${esc(i.name)}</h2><p class="note">Started with ${fmtQty(b.qty,i.unit)} · ${esc(b.where||'')}</p>
      <label class="note" for="sQ">How much came out (${esc(UNIT_WORDS[i.unit]||i.unit)})</label><input class="txt" id="sQ" type="number" min="0" step="any" value="${b.qty}">
      <div class="mact"><button class="btn alt" id="sC">Not yet</button><button class="btn bigyes" id="sOk">✅ Into stock</button></div>`;
    m.querySelector('#sC').onclick=close;
    m.querySelector('#sOk').onclick=()=>{ const q=+m.querySelector('#sQ').value; if(!(q>0)){ toast('Type how much came out'); return; }
      moveStock({kind:'infused',input:i.id,qty:q,batch:b.id});
      Object.assign(b,{status:'strained',strainedQty:q,strainedAt:Date.now(),strainedBy:SYNC.me()});
      if(b.cost>0&&i.id&&i.pack>0){ const per=Math.round(b.cost/q*i.pack); i.price=per; i.updated=Date.now(); S.prices.push({id:SYNC.newId('prices'),input:i.id,item:i.name,cents:per,pack:i.pack,unit:i.unit,date:nzDay(),at:Date.now(),by:SYNC.me(),from:'infusion'}); }
      save(); close(); render(); toast(fmtQty(q,i.unit)+' of '+i.name+' ready to use'); };
  });
}

/* ---------- the season ahead ---------- */
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let seasonMemo={key:'',v:null};
function seasonAhead(){
  const key=[nzDay(),S.events.length,S.sales.length,S.orders.length,S.sessions.length,S.products.length,JSON.stringify(S.settings.seasonBoost||{}),(S.events[S.events.length-1]||{}).changed].join('|');
  if(seasonMemo.key===key) return seasonMemo.v; seasonMemo={key,v:seasonCalc()}; return seasonMemo.v;
}
function seasonCalc(){
  const t0=kd(nzDay()), months=[];
  for(let k=0;k<12;k++){ const s=new Date(t0.getFullYear(),t0.getMonth()+k,1), e=new Date(s.getFullYear(),s.getMonth()+1,0); months.push({key:dk(s).slice(0,7),m:s.getMonth(),y:s.getFullYear(),start:k?dk(s):nzDay(),end:dk(e),markets:0,need:{}}); }
  // markets on the calendar (repeating ones carried forward), day by day
  months.forEach(mo=>{ for(let d=kd(mo.start);dk(d)<=mo.end;d=addDays(d,1)) mo.markets+=eventsOn(dk(d)).filter(e=>e.type==='market').length; });
  // what sells at a market (the last year of market days) and through orders (the last 6 months, a month)
  const since=Date.now()-365*864e5, md=S.sessions.filter(s=>s.type==='market'&&s.openedAt>=since), ids=new Set(md.map(s=>s.id)), per={}, ord={};
  S.sales.forEach(s=>{ if(s.voided||!ids.has(s.sessionId)) return; (s.lines||[]).forEach(l=>{ if(l.pid) per[l.pid]=(per[l.pid]||0)+l.qty; }); });
  const o6=dk(addDays(t0,-182)); S.orders.forEach(o=>{ if(o.status==='cancelled'||(o.date||'')<o6) return; (o.lines||[]).forEach(l=>{ if(l.pid) ord[l.pid]=(ord[l.pid]||0)+(+l.qty||0); }); });
  const boost=S.settings.seasonBoost||{};
  months.forEach(mo=>{ const b=1+(+boost[mo.m+1]||0)/100, frac=mo.start===nzDay()?(kd(mo.end)-kd(mo.start))/864e5/30:1;
    S.products.filter(p=>p.active!==false).forEach(p=>{ const n=(md.length?(per[p.id]||0)/md.length*mo.markets:0)+(ord[p.id]||0)/6*frac; const u=Math.round(n*b); if(u>0) mo.need[p.id]=u; }); });
  return months;
}
// owners: the infused oil each month needs, and when to start each infusion so it's ready in time
function infusionPlan(months){
  if(role()!=='owner') return [];
  return infusedInputs().map(i=>{
    const use=months.map(mo=>Object.entries(mo.need).reduce((t,[pid,u])=>{ const p=S.products.find(x=>x.id===pid), r=p&&S.recipes.find(x=>x.id===p.recipe); if(!r||!(r.yield>0)||!(p.fill>0)) return t;
      const l=(r.lines||[]).find(x=>x.input===i.id); return l?t+u*l.qty*p.fill/r.yield:t; },0));
    let have=Math.max(0,inputStock(i.id)||0); const coming=jars().filter(b=>b.input===i.id);
    let first=-1, short=0;
    for(let k=0;k<12;k++){ have+=coming.filter(b=>b.ready.slice(0,7)===months[k].key).reduce((t,b)=>t+b.qty,0); have-=use[k]; if(have<0&&first<0) first=k; }
    if(first>=0){ let h=Math.max(0,inputStock(i.id)||0)+coming.reduce((t,b)=>t+b.qty,0); for(let k=0;k<=Math.min(11,first+2);k++) h-=use[k]; short=Math.ceil(Math.max(0,-h)); }
    const startBy=first>=0?dk(addDays(kd(months[first].start),-infuseWeeks(i)*7)):'';
    return {i,use,first,short,startBy};
  }).filter(x=>x.use.some(u=>u>0));
}
function seasonHtml(){
  const months=seasonAhead(), plan=infusionPlan(months), boost=S.settings.seasonBoost||{};
  const top=Object.entries(months.reduce((t,mo)=>{ Object.entries(mo.need).forEach(([p,u])=>t[p]=(t[p]||0)+u); return t; },{})).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  const busiest=Math.max(1,...months.map(mo=>Object.values(mo.need).reduce((a,b)=>a+b,0)));
  return `<div class="card"><h3>📅 The next 12 months</h3><p class="note">From the markets on the calendar (repeating ones carried forward), what usually sells at a market, and orders. Tap a month to mark it busier (Christmas, garden tours…).</p>
      <div class="season">${months.map(mo=>{ const n=Object.values(mo.need).reduce((a,b)=>a+b,0); return `<button class="smonth" data-sm="${mo.m+1}"><b>${MONTHS[mo.m]}</b><i style="height:${Math.round(n/busiest*60)+4}px"></i><small>${n} units</small><small>${mo.markets} mkt${mo.markets===1?'':'s'}</small>${boost[mo.m+1]?`<em>+${boost[mo.m+1]}%</em>`:''}</button>`; }).join('')}</div></div>
    ${plan.length?`<div class="card"><h3>🌼 Infusions to start</h3>${plan.map(x=>x.first<0?`<div class="row"><div class="grow"><b>${esc(x.i.name)}</b><small>Enough for the next 12 months (with what's infusing).</small></div><span class="pill ok">Enough</span></div>`
        :`<div class="row"><div class="grow"><b>Start ${fmtQty(x.short,x.i.unit)} of ${esc(x.i.name)} by ${nzDate(kd(x.startBy),{weekday:'short',day:'numeric',month:'long'})}</b><small>Runs short in ${MONTHS[months[x.first].m]} · ${infuseWeeks(x.i)} weeks to infuse</small></div><button class="btn small" data-sstart="${x.i.id}" data-sq="${x.short}">Start</button></div>`).join('')}</div>`:''}
    <div class="card"><h3>Products, month by month</h3><div class="tablewrap"><table class="stbl"><tr><th></th>${months.map(mo=>`<th>${MONTHS[mo.m]}</th>`).join('')}</tr>
      ${top.map(pid=>{ const p=S.products.find(x=>x.id===pid); return `<tr><td>${esc(prodName(p))}</td>${months.map(mo=>`<td>${mo.need[pid]||''}</td>`).join('')}</tr>`; }).join('')||`<tr><td colspan="13" class="note">Not enough sales yet to forecast.</td></tr>`}</table></div></div>`;
}
function wireSeason(){
  document.querySelectorAll('[data-sm]').forEach(b=>b.onclick=()=>{ const k=b.dataset.sm, cur=(S.settings.seasonBoost||{})[k]||0;
    modal((m,close)=>{ m.innerHTML=`<h2>${MONTHS[k-1]}: busier than usual?</h2><p class="note">Adds to what's expected, for things that aren't markets yet (Christmas orders, garden tours).</p>
        <div class="pastnames">${[0,25,50,100].map(v=>`<button class="chip big ${cur===v?'on':''}" data-bv="${v}">${v?'+'+v+'%':'Normal'}</button>`).join('')}</div><div class="mact"><button class="btn alt" id="bvC">Close</button></div>`;
      m.querySelectorAll('[data-bv]').forEach(x=>x.onclick=()=>{ S.settings.seasonBoost=Object.assign({},S.settings.seasonBoost,{[k]:+x.dataset.bv}); save(); close(); render(); });
      m.querySelector('#bvC').onclick=close; }); });
  document.querySelectorAll('[data-sstart]').forEach(b=>b.onclick=()=>startInfusion({input:b.dataset.sstart,qty:+b.dataset.sq}));
}
// for What to do next: jars to strain, and infusions to start within 4 weeks
function infuseIdeas(){
  if(!canManage()) return [];
  const l=[], ready=jars().filter(b=>b.ready<=nzDay());
  if(ready.length) l.push({score:86,t:'🌼 Strain '+ready.map(b=>b.name).slice(0,2).join(' and ')+(ready.length>2?' and more':''),d:'Ready now · '+ready.map(b=>b.where).filter(Boolean).slice(0,2).join(' · '),lbl:'Strain',go:'brew:infuse',act:()=>strainJar(ready[0])});
  if(role()==='owner'){ const soon=dk(addDays(kd(nzDay()),28)), sa=seasonAhead(); infusionPlan(sa).filter(x=>x.first>=0&&x.startBy<=soon).forEach(x=>l.push({score:x.startBy<=nzDay()?89:70,t:'🌼 Start '+fmtQty(x.short,x.i.unit)+' of '+x.i.name+' by '+nzDate(kd(x.startBy),{day:'numeric',month:'short'}),d:'Otherwise it runs short in '+MONTHS[sa[x.first].m]+'.',lbl:'Start',go:'brew:infuse',act:()=>startInfusion({input:x.i.id,qty:x.short})})); }
  return l;
}
