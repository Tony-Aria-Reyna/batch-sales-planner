/* ================= Check-ins: a minute at the end of a market, and after a brew day =================
   Everything is prefilled (times from the calendar entry, the weather, the stall fee), so it's mostly
   "looks right, Save". It's how the Profit screen knows the real hours and what each market really cost.
   Each can be switched off in Setup → Check-ins. Helpers never see the stall fee. */
const checkinOn=k=>(S.settings.checkins||{})[k]!==false;
const BUSY=[['quiet','😴 Quiet'],['steady','🙂 Steady'],['busy','😀 Busy'],['flat','🤩 Flat out']];
const WEATHER=[['sun','☀️ Sunny'],['cloud','☁️ Cloudy'],['showers','🌦️ Showers'],['rain','🌧️ Rain'],['wind','💨 Windy'],['hot','🥵 Hot'],['cold','🥶 Cold']];
// the weather chips that match a forecast
function wxChips(w){ if(!w) return []; const c=w.code, out=[];
  out.push(c<=1?'sun':c<=3||c===45||c===48?'cloud':c>=80||(c>=51&&c<=61)?'showers':'rain');
  if(w.wind>=35) out.push('wind'); if(w.hi>=27) out.push('hot'); if(w.hi<=12) out.push('cold'); return out; }
const minsIn=v=>{ const n=Math.round(+String(v||'').replace(/[^0-9.]/g,'')); return n>=0&&n<1000?n:0; };
const chipRow=(list,on,attr)=>`<div class="pastnames">${list.map(([k,t])=>`<button class="chip big ${on.includes(k)?'on':''}" data-${attr}="${k}">${t}</button>`).join('')}</div>`;

/* ---------- the end of a market (straight after Close the day) ---------- */
function marketCheckin(ses,done){
  done=done||(()=>{});
  if(!ses||!checkinOn('market')||ses.checkin) return done();
  const ev=S.events.find(e=>e.id===ses.eventId), pl=S.places.find(p=>p.id===ses.placeId);
  const plan=ev?marketPlan(ev):Object.assign(planDefaults(ses.placeId),{ok:false});
  const c={busy:'',weather:[],soldOut:[],note:'',times:{there:plan.there,setup:plan.setup,pack:plan.pack,home:plan.home,unpack:+S.settings.unpackMins||15}};
  const fee=seesCosts()&&pl?feeOf(pl.id):null, feeDay=fee&&fee.cents?Math.round(fee.cents/Math.max(1,fee.days||1)):null;
  const sold=[...new Set(daySales(ses).filter(s=>!s.voided).flatMap(s=>(s.lines||[]).map(l=>l.pid)).filter(Boolean))].map(id=>S.products.find(p=>p.id===id)).filter(Boolean);
  const zero=sold.filter(p=>{ const n=stockOf(p.id); return n!=null&&n<=0; }).map(p=>p.id); c.soldOut=zero.slice();
  modal((m,close)=>{
    const left=()=>{ const t=c.times, mins=t.pack+t.home+t.unpack, at=new Date(Date.now()+mins*60e3); return `Still to do: ${hmTxt(mins)} · all done about <b>${esc(nzTime(at))}</b>`; };
    m.innerHTML=`<h2>📝 How did ${esc(ses.name||'the market')} go?</h2><p class="note">A minute now makes the profit figures right. Everything's filled in already: change anything that's wrong.</p>
      <p class="note" style="margin-bottom:0"><b>How busy was it?</b></p>${chipRow(BUSY,[c.busy],'cbusy')}
      <p class="note" style="margin-bottom:0"><b>The weather</b> <span id="cWx"></span></p>${chipRow(WEATHER,c.weather,'cwx')}
      ${feeDay!=null||seesCosts()?`<label class="note" for="cFee"><b>Stall fee paid today ($)</b>${fee&&fee.days>1?' · your usual share of '+c2(fee.cents)+' for '+fee.days+' days':''}</label><input class="txt" id="cFee" inputmode="decimal" value="${feeDay!=null?(feeDay/100).toFixed(2):''}" placeholder="0 if none">`:''}
      <p class="note" style="margin-bottom:0"><b>Your time (minutes)</b></p>
      <div class="formrow four">${[['there','Travel there'],['setup','Set up']].map(([k,t])=>`<div><label class="note" for="cT_${k}">${t}</label><input class="txt" id="cT_${k}" inputmode="numeric" value="${c.times[k]}"></div>`).join('')}</div>
      <div class="formrow four">${[['pack','Pack up'],['home','Drive home'],['unpack','Unpack the car']].map(([k,t])=>`<div><label class="note" for="cT_${k}">${t}</label><input class="txt" id="cT_${k}" inputmode="numeric" value="${c.times[k]}"></div>`).join('')}</div>
      <p class="note" id="cLeft">${left()}</p>
      ${sold.length?`<p class="note" style="margin-bottom:0"><b>Sold out of anything?</b> (tap to mark)</p><div class="pastnames">${sold.map(p=>`<button class="chip ${c.soldOut.includes(p.id)?'on':''}" data-csold="${p.id}">${esc(prodName(p))}</button>`).join('')}</div>`:''}
      <label class="note" for="cNote"><b>Anything to remember?</b> Type it, or tap 🎤 on the keyboard and say it.</label>
      <textarea class="txt" id="cNote" rows="3" placeholder="e.g. lots asked for lavender soap, the corner spot was better, bring more change"></textarea>
      <div class="mact"><button class="btn alt" id="cSkip">Skip</button><button class="btn" id="cOk">Save</button></div>`;
    weatherFor(ses.placeId,ses.date,w=>{ if(!w) return; const x=m.querySelector('#cWx'); if(x) x.textContent='· forecast: '+wxShort(w);
      if(!c.weather.length){ c.weather=wxChips(w); m.querySelectorAll('[data-cwx]').forEach(b=>b.classList.toggle('on',c.weather.includes(b.dataset.cwx))); } c.wx=w; });
    m.querySelectorAll('[data-cbusy]').forEach(b=>b.onclick=()=>{ c.busy=b.dataset.cbusy; m.querySelectorAll('[data-cbusy]').forEach(x=>x.classList.toggle('on',x===b)); });
    const tog=(attr,arr)=>m.querySelectorAll('[data-'+attr+']').forEach(b=>b.onclick=()=>{ const k=b.dataset[attr], i=arr.indexOf(k); if(i<0) arr.push(k); else arr.splice(i,1); b.classList.toggle('on',i<0); });
    tog('cwx',c.weather); tog('csold',c.soldOut);
    m.querySelectorAll('[id^="cT_"]').forEach(x=>x.oninput=()=>{ c.times[x.id.slice(3)]=minsIn(x.value); m.querySelector('#cLeft').innerHTML=left(); });
    const finish=()=>{ close(); done(); };
    m.querySelector('#cSkip').onclick=()=>{ ses.checkin={skipped:true,by:SYNC.me(),at:Date.now()}; save(); finish(); };
    m.querySelector('#cOk').onclick=()=>{
      const f=m.querySelector('#cFee'); let feeC=null; if(f&&f.value.trim()){ feeC=toCents(f.value); if(!(feeC>=0)){ toast('Type the fee, e.g. 45'); return; } } else if(f) feeC=0;
      ses.checkin={busy:c.busy,weather:c.weather.slice(),wx:c.wx||null,times:Object.assign({},c.times),soldOut:c.soldOut.slice(),note:m.querySelector('#cNote').value.trim().slice(0,1000),by:SYNC.me(),at:Date.now()};
      if(feeC!=null){ const id='dayfee-'+ses.id, x=S.costs.find(y=>y.id===id); if(x) x.cents=feeC; else S.costs.push({id,kind:'dayfee',session:ses.id,place:ses.placeId||'',date:ses.date,cents:feeC}); }
      save(); toast('Thanks · saved'); finish(); };
  });
}

/* ---------- after a brew day ("✓ Made it"): how long did it take? ---------- */
function brewCheckin(batchId,done){
  done=done||(()=>{});
  const b=S.batches.find(x=>x.id===batchId); if(!b||!checkinOn('brew')||b.mins!=null) return done();
  const clocked=typeof clockMinsFor==='function'?clockMinsFor('brewing',b.date):0;
  if(clocked>0){ b.mins=clocked; b.minsFrom='clock'; save(); return done(); }     // the time clock already has it: no double counting
  const last=S.batches.filter(x=>x.recipe===b.recipe&&x.mins>0&&x.id!==b.id).sort((a,c)=>(c.madeAt||0)-(a.madeAt||0))[0];
  const guess=last?Math.round(last.mins/(last.mult||1)*(b.mult||1)):120;
  modal((m,close)=>{ m.innerHTML=`<h2>⏱️ How long did it take?</h2><p class="note">${esc(b.recipeName||'This batch')} ×${b.mult}. Include making, filling and labelling, and cleaning up.${last?' Last time: '+hmTxt(last.mins)+' for ×'+last.mult+'.':''}</p>
      <div class="formrow"><div><label class="note" for="bcH">Hours</label><input class="txt" id="bcH" inputmode="numeric" value="${Math.floor(guess/60)}"></div><div><label class="note" for="bcM">Minutes</label><input class="txt" id="bcM" inputmode="numeric" value="${guess%60}"></div></div>
      <div class="mact"><button class="btn alt" id="bcSk">Skip</button><button class="btn" id="bcOk">Save</button></div>`;
    m.querySelector('#bcSk').onclick=()=>{ close(); done(); };
    m.querySelector('#bcOk').onclick=()=>{ const n=minsIn(m.querySelector('#bcH').value)*60+minsIn(m.querySelector('#bcM').value); if(!(n>0)){ toast('Type how long it took'); return; }
      b.mins=n; b.minsFrom='checkin'; save(); close(); toast('Saved'); done(); };
  });
}

/* ---------- Setup → Check-ins ---------- */
function checkinsCard(){
  const on=S.settings.checkins||{};
  return `<div class="card"><h3>📝 Check-ins</h3><p class="note">A minute's questions, all prefilled, so the profit figures use your real hours and costs.</p>
    ${[['market','End of a market','After Close the day: how busy, the weather, the stall fee, your time packing up and driving home, anything sold out, notes'],
       ['brew','After a brew day','After ✓ Made it: how long it took (skipped when the time clock was running)']].map(([k,t,d])=>`<div class="row"><div class="grow"><b>${t}</b><small>${d}</small></div><button class="switch ${on[k]!==false?'on':''}" data-chk="${k}" role="switch" aria-checked="${on[k]!==false}" aria-label="${t}"><i></i></button></div>`).join('')}
    <label class="note" for="unpackMin">Usual unpacking the car (min)</label><input class="txt" id="unpackMin" inputmode="numeric" value="${+S.settings.unpackMins||15}" style="max-width:160px"></div>`;
}
function wireCheckins(){
  document.querySelectorAll('[data-chk]').forEach(b=>b.onclick=()=>{ const k=b.dataset.chk; S.settings.checkins=Object.assign({},S.settings.checkins||{},{[k]:!checkinOn(k)}); save(); render(); });
  const u=$('#unpackMin'); if(u) u.onchange=()=>{ const v=Math.round(+u.value); if(!(v>=0&&v<600)){ toast('Type the minutes, e.g. 15'); return; } S.settings.unpackMins=v; save(); toast('Saved'); };
}
