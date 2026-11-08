/* ================= Voice notes =================
   Tap 🎙, talk, tap Done. The recording is saved to the business's database in small pieces, the business
   helper is told straight away, and it asks Gemini (on the business's own key) to turn the note into draft
   calendar entries, to-dos, shopping and ideas. The drafts come back as normal, editable forms:
   nothing is saved until you tap Save (or Yes in Drive mode), and any field can be fixed by hand first.
   The recording is deleted by the helper as soon as it has been understood (and never kept past a day).
   Helpers can only make their own to-dos and shopping. "What's on today" is read aloud by the iPad itself:
   no AI and no cost. */
const VOICE_MAX_SECS=120, CHUNK=600000;   // two minutes at most; pieces stay well under the database's 1 MB a document
const voiceReady=()=>!!(S.settings.voiceUrl||S.settings.voiceOn)&&!S.settings.aiPaused&&!(typeof practice!=='undefined'&&practice);   // off while viewing as someone
const canRecord=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
let voiceWatch=null;

// speak with the iPad's own voice (free, works offline); prefers a New Zealand or Australian English voice
function say(text,done){
  try{ const ss=window.speechSynthesis; if(!ss||!text){ done&&done(); return; } ss.cancel();
    const u=new SpeechSynthesisUtterance(text), vs=ss.getVoices();
    u.voice=vs.find(v=>/en-NZ/i.test(v.lang))||vs.find(v=>/en-AU/i.test(v.lang))||vs.find(v=>/en-GB/i.test(v.lang))||null;
    u.lang=(u.voice&&u.voice.lang)||'en-NZ'; u.rate=1; if(done) u.onend=()=>done(); ss.speak(u);
  }catch(e){ done&&done(); }
}
const hush=()=>{ try{ speechSynthesis.cancel(); }catch(e){} };

/* ---------- recording ---------- */
function startVoice(opts={}){
  if(!voiceReady()){ toast('The voice assistant is switched off in Setup'); return; }
  if(!canRecord()){ typedNote(opts); return; }
  hush();
  let rec=null, stream=null, parts=[], t0=0, timer=null, cancelled=false;
  modal((m,close)=>{
    const stop=()=>{ clearInterval(timer); try{ rec&&rec.state!=='inactive'&&rec.stop(); }catch(e){} try{ stream&&stream.getTracks().forEach(t=>t.stop()); }catch(e){} };
    m.innerHTML=`<div class="vrec"><div class="vdot" id="vDot">🎙</div><h2 id="vH">Getting the microphone…</h2><p class="note" id="vT">Talk naturally. Say what, when, where and who.</p>
      <button class="btn big vdone" id="vDone" disabled>✓ Done</button><div class="mact"><button class="btn alt" id="vX">Cancel</button><button class="btn alt" id="vType">⌨️ Type instead</button></div></div>`;
    const cancel=()=>{ cancelled=true; stop(); close(); };
    m.querySelector('#vX').onclick=cancel;
    m.querySelector('#vType').onclick=()=>{ cancelled=true; stop(); close(); typedNote(opts); };
    close.onBack=cancel;
    navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}).then(s=>{
      if(cancelled){ s.getTracks().forEach(t=>t.stop()); return; }
      stream=s; const types=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/aac'], type=types.find(t=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t))||'';
      try{ rec=new MediaRecorder(s,Object.assign({audioBitsPerSecond:32000},type?{mimeType:type}:{})); }catch(e){ rec=new MediaRecorder(s); }
      rec.ondataavailable=e=>{ if(e.data&&e.data.size) parts.push(e.data); };
      rec.onstop=()=>{ if(cancelled) return; const secs=Math.round((Date.now()-t0)/1000);
        if(secs<1||!parts.length){ close(); toast('That was too short'); return; }
        const blob=new Blob(parts,{type:rec.mimeType||type||'audio/mp4'});
        const fr=new FileReader(); fr.onload=()=>{ close(); sendNote({audio:String(fr.result).split(',')[1],mime:blob.type,secs},opts); }; fr.readAsDataURL(blob); };
      rec.start(1000); t0=Date.now();
      m.querySelector('#vH').textContent='Listening…'; m.querySelector('#vDot').classList.add('on'); m.querySelector('#vDone').disabled=false;
      timer=setInterval(()=>{ const s2=Math.round((Date.now()-t0)/1000); m.querySelector('#vT').textContent=`${Math.floor(s2/60)}:${String(s2%60).padStart(2,'0')} · up to 2 minutes`; if(s2>=VOICE_MAX_SECS) stop(); },500);
      m.querySelector('#vDone').onclick=stop;
    }).catch(()=>{ if(cancelled) return; m.querySelector('#vH').textContent='The microphone is blocked';
      m.querySelector('#vT').innerHTML='Allow the microphone for this app (iPad: Settings → Safari → Microphone), or type the note instead.'; });
  },{big:true,sticky:true});
}
function typedNote(opts){
  modal((m,close)=>{ m.innerHTML=`<h2>⌨️ Type a note</h2><p class="note">Write it the way you'd say it, e.g. "Matakana market Saturday 8 till 1, buy beeswax".</p>
      <textarea class="txt" id="vTx" rows="4" autocapitalize="sentences"></textarea><div class="mact"><button class="btn alt" id="vC">Cancel</button><button class="btn" id="vOk">Work it out</button></div>`;
    m.querySelector('#vC').onclick=close;
    m.querySelector('#vOk').onclick=()=>{ const t=m.querySelector('#vTx').value.trim(); if(!t){ toast('Type the note'); return; } close(); sendNote({text:t.slice(0,2000)},opts); };
    setTimeout(()=>{ if(!m.contains(document.activeElement)) m.querySelector('#vTx').focus(); },50); });
}
// save the note (and its recording, in pieces), then tell the helper so it starts straight away
function sendNote(n,opts){
  const id=SYNC.newId('voicenotes'), at=Date.now(), pieces=[];
  if(n.audio) for(let i=0;i*CHUNK<n.audio.length;i++) pieces.push(n.audio.slice(i*CHUNK,(i+1)*CHUNK));
  pieces.forEach((d,i)=>S.voicenotes.push({id:id+'-'+i,kind:'chunk',note:id,i,data:d,by:SYNC.me(),at}));
  S.voicenotes.push({id,kind:'note',by:SYNC.me(),at,status:'new',mime:n.mime||'',secs:n.secs||0,chunks:pieces.length,text:n.text||'',drive:!!opts.drive});
  save(); pingHelper(id);
  waitForNote(id,opts);
}
function pingHelper(id){
  const url=S.settings.voiceUrl; if(!url||!/^https:\/\/script\.google\.com\//.test(url)) return;
  // the helper reads the note itself from the database; this only says "there's one waiting"
  setTimeout(()=>{ try{ fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({bid:SYNC.businessId(),id})}).catch(()=>{}); }catch(e){} },400);
}

/* ---------- waiting, then the drafts ---------- */
function waitForNote(id,opts){
  modal((m,close)=>{
    m.innerHTML=`<div class="vrec"><div class="vdot work">⏳</div><h2>Working it out…</h2><p class="note" id="vW">${navigator.onLine?'This usually takes a few seconds.':'You\'re offline. The note is saved and will be worked out when you\'re back online.'}</p>
      <div class="mact"><button class="btn alt" id="vL">Leave it with me</button></div></div>`;
    const quit=()=>{ clearInterval(voiceWatch); close(); };
    m.querySelector('#vL').onclick=()=>{ quit(); toast('The drafts will be under Lists → Voice notes'); };
    close.onBack=quit;
    clearInterval(voiceWatch);
    voiceWatch=setInterval(()=>{ const n=S.voicenotes.find(x=>x.id===id); if(!n) return;
      if(n.status==='ready'){ quit(); reviewNote(n,opts); }
      else if(n.status==='failed'){ quit(); say(opts.drive?'Sorry, that didn\'t work. '+(n.error||''):''); modal((m2,c2)=>{ m2.innerHTML=`<h2>That didn't work</h2><p>${esc(n.error||'Something went wrong.')}</p><div class="mact"><button class="btn" id="fOk">OK</button></div>`; m2.querySelector('#fOk').onclick=c2; }); }
      else if(n.error&&n.status==='new') m.querySelector('#vW').textContent='Still trying… ('+n.error.slice(0,80)+')';
    },400);
  },{sticky:true});
}
// what to call a draft, and whether this person may save it
const DRAFT_ICON={event:'📅',todo:'✅',shopping:'🛒',idea:'💡',order:'📦'};
const normName=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const findProduct=n=>S.products.find(p=>normName(prodName(p))===normName(n)||normName(p.name+' '+(p.size||''))===normName(n))||S.products.find(p=>normName(n).includes(normName(p.name))&&normName(p.name).length>3);
const draftAllowed=d=>canManage()?true:d.kind==='order'?false:(d.kind==='shopping'||(d.kind==='todo'&&(!d.todo.who||d.todo.who===SYNC.me())));
function draftLine(d){
  if(d.kind==='event'){ const e=d.event; return `${calType(e).t}: ${e.title||'?'}, ${e.date?nzDate(kd(e.date),{weekday:'short',day:'numeric',month:'short'}):'no date'}${e.time?' '+t12(e.time)+(e.end?'–'+t12(e.end):''):''}`; }
  if(d.kind==='todo') return 'To do: '+d.todo.text+(d.todo.due?', '+nzDate(kd(d.todo.due),{weekday:'short',day:'numeric',month:'short'}):'');
  if(d.kind==='order') return 'Order: '+(d.order.customer||'?')+', '+d.order.lines.map(l=>l.qty+' × '+l.product).join(', ')+(d.order.due?', send by '+nzDate(kd(d.order.due),{weekday:'short',day:'numeric',month:'short'}):'');
  if(d.kind==='shopping') return 'Buy: '+[d.shopping.qty>1?d.shopping.qty+' ×':'',d.shopping.item,d.shopping.size].filter(Boolean).join(' ');
  return (IDEA_KINDS[d.idea.kind]||'💡 Idea')+': '+d.idea.text;
}
// a calendar clash: another entry that day whose times overlap (or either has no time)
function clashOf(e){
  if(!e.date) return '';
  const others=eventsOn(e.date).filter(x=>x.id!==e.id); if(!others.length) return '';
  const mins=t=>t?(+t.slice(0,2))*60+(+t.slice(3)):null, s=mins(e.time), en=mins(e.end)||(s!=null?s+60:null);
  const hit=others.find(x=>{ const xs=mins(x.time), xe=mins(x.end)||(xs!=null?xs+60:null); return s==null||xs==null||(s<xe&&xs<en); });
  return hit?`You already have ${hit.title} that day${hit.time?' at '+t12(hit.time):''}.`:'';
}
function reviewNote(n,opts={}){
  const drafts=(n.drafts||[]).map(d=>JSON.parse(JSON.stringify(d))), state=drafts.map(d=>draftAllowed(d)?'open':'blocked');
  const settle=status=>{ const x=S.voicenotes.find(y=>y.id===n.id); if(x){ x.status=status; x.settledAt=Date.now(); save(); } };
  const speakAll=()=>{ const clashes=drafts.filter(d=>d.kind==='event').map(d=>clashOf(d.event)).filter(Boolean);
    say([n.say||(drafts.length?drafts.map(draftLine).join('. '):'I didn\'t catch anything to add.'),...clashes,drafts.length?(opts.drive?'Say yes, or tap Yes to save, or No to throw it away.':''):''].filter(Boolean).join(' ')); };
  modal((m,close)=>{
    const field=(d,i,k,label,type='text',extra='')=>`<label class="note" for="d${i}${k}">${label}</label><input class="txt ${(d.unsure||[]).includes(k)?'unsure':''}" id="d${i}${k}" data-di="${i}" data-dk="${k}" type="${type}" ${extra}>`;
    const card=(d,i)=>{ const blocked=state[i]==='blocked', done=state[i]!=='open';
      let body='';
      if(d.kind==='event') body=`<div class="bigseg">${Object.entries(CAL_TYPES).map(([k,v])=>`<button data-ety="${i}:${k}" class="${d.event.type===k?'on':''}">${v.ic} ${v.t}</button>`).join('')}</div>`+field(d,i,'title','What')
        +`<div class="formrow"><div>${field(d,i,'date','Date','date')}</div><div>${field(d,i,'days','Days','number','min="1" max="7"')}</div></div><div class="formrow"><div>${field(d,i,'time','Starts','time')}</div><div>${field(d,i,'end','Finishes','time')}</div></div>`
        +(d.event.type==='market'?`<label class="note" for="d${i}place">Market</label><select class="txt ${(d.unsure||[]).includes('place')?'unsure':''}" id="d${i}place" data-di="${i}" data-dk="place"><option value="">Not one of the saved markets</option>${S.places.filter(p=>!p.gone).map(p=>`<option ${p.name===d.event.place?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`:'')
        +`<p class="note clash" id="d${i}clash">${esc(clashOf(d.event))}</p>`;
      if(d.kind==='todo') body=field(d,i,'text','What')+`<div class="formrow"><div>${field(d,i,'due','Date','date')}</div><div>${field(d,i,'time','Time','time')}</div></div>`
        +(canManage()?`<label class="note" for="d${i}who">Whose</label><select class="txt" id="d${i}who" data-di="${i}" data-dk="who">${[...new Set([SYNC.me(),...SYNC.getMembers()])].map(p=>`<option value="${esc(p)}" ${(d.todo.who||SYNC.me())===p?'selected':''}>${esc(p===SYNC.me()?'Mine':personName(p))}</option>`).join('')}</select>`:'');
      if(d.kind==='shopping') body=field(d,i,'item','What')+`<div class="formrow"><div>${field(d,i,'qty','How many','number','min="1"')}</div><div>${field(d,i,'size','Size')}</div></div>`;
      if(d.kind==='order') body=field(d,i,'customer','Customer')+field(d,i,'due','Send by','date')
        +d.order.lines.map((l,k)=>{ const p=findProduct(l.product); return `<div class="lrow"><input class="txt qty" type="number" min="0" data-ol="${i}:${k}" value="${l.qty}"><div class="grow ltxt"><b>${esc(p?prodName(p):l.product)}</b><small>${p?'':'Not a till product: it will be kept as typed'}</small></div></div>`; }).join('');
      if(d.kind==='idea') body=`<div class="pastnames">${Object.entries(IDEA_KINDS).map(([k,v])=>`<button class="chip ${d.idea.kind===k?'on':''}" data-ik2="${i}:${k}">${v}</button>`).join('')}</div>`+field(d,i,'text','Note');
      return `<div class="card draft ${done?'settled':''}" id="dc${i}"><h3>${DRAFT_ICON[d.kind]} ${esc(draftLine(d))}</h3>
        ${blocked?'<p class="note">Only owners and managers can add this. Ask them, or add it to your own to-dos.</p>':state[i]==='saved'?'<p class="note">✓ Saved</p>':state[i]==='dropped'?'<p class="note">Left out</p>':body+`<div class="mact"><button class="btn alt" data-drop="${i}">Leave out</button><button class="btn" data-save1="${i}">✓ Save</button></div>`}</div>`; };
    const draw=()=>{ const open=state.filter(s=>s==='open').length;
      m.innerHTML=`<h2>🎙 Here's what I heard</h2>${n.heard||n.text?`<p class="heard">“${esc(n.heard||n.text)}”</p>`:''}
        ${drafts.length?'':'<p>Nothing to add from that note. You can add things by hand as usual.</p>'}
        <p class="note">Check and fix anything by hand. Fields in yellow were a guess. Nothing is saved until you tap Save.</p>
        ${drafts.map(card).join('')}
        <div class="mact"><button class="btn alt" id="rAgain">🔊 Read it again</button>${open?`<button class="btn danger" id="rNo">✕ Throw away</button><button class="btn" id="rYes">✓ Save ${open>1?'all '+open:'it'}</button>`:'<button class="btn" id="rDone">Done</button>'}</div>`;
      // fill the fields (values set here, so nothing typed is ever treated as HTML)
      m.querySelectorAll('[data-dk]').forEach(el=>{ const d=drafts[+el.dataset.di], o=d[d.kind], k=el.dataset.dk; if(el.tagName!=='SELECT') el.value=o[k]==null?'':o[k];
        el.oninput=el.onchange=()=>{ o[k]=el.type==='number'?Math.max(1,+el.value||1):el.value; el.classList.remove('unsure');
          if(d.kind==='event'){ const c=m.querySelector('#d'+el.dataset.di+'clash'); if(c) c.textContent=clashOf(o); } }; });
      m.querySelectorAll('[data-ol]').forEach(el=>el.onchange=()=>{ const [i,k]=el.dataset.ol.split(':'); drafts[+i].order.lines[+k].qty=Math.max(0,Math.floor(+el.value||0)); });
      m.querySelectorAll('[data-ety]').forEach(b=>b.onclick=()=>{ const [i,k]=b.dataset.ety.split(':'); drafts[+i].event.type=k; draw(); });
      m.querySelectorAll('[data-ik2]').forEach(b=>b.onclick=()=>{ const [i,k]=b.dataset.ik2.split(':'); drafts[+i].idea.kind=k; draw(); });
      m.querySelectorAll('[data-drop]').forEach(b=>b.onclick=()=>{ state[+b.dataset.drop]='dropped'; draw(); });
      m.querySelectorAll('[data-save1]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.save1, why=saveDraft(drafts[i]); if(why){ toast(why); return; } state[i]='saved'; save(); draw(); });
      m.querySelector('#rAgain').onclick=speakAll;
      const yes=m.querySelector('#rYes'); if(yes) yes.onclick=()=>{ for(let i=0;i<drafts.length;i++) if(state[i]==='open'){ const why=saveDraft(drafts[i]); if(why){ toast(why); draw(); return; } state[i]='saved'; }
        save(); settle('done'); hush(); close(); if(opts.drive) say('Saved.'); toast('Saved'); if(['calendar','lists'].includes(cur())) rerenderAfterList(); };
      const no=m.querySelector('#rNo'); if(no) no.onclick=()=>{ settle('discarded'); hush(); close(); if(opts.drive) say('Thrown away.'); toast('Nothing saved'); };
      const dn=m.querySelector('#rDone'); if(dn) dn.onclick=()=>{ settle(state.includes('saved')?'done':'discarded'); hush(); close(); if(['calendar','lists'].includes(cur())) rerenderAfterList(); };
    };
    draw(); close.onBack=()=>{ hush(); close(); };
    speakAll();
  },{big:true,sticky:true});
}
// turn one checked draft into the real thing; returns a reason if it can't be saved yet
function saveDraft(d){
  if(!draftAllowed(d)) return 'Only owners and managers can add that';
  const me=SYNC.me();
  if(d.kind==='event'){ const e=d.event; if(!e.date) return 'Add the date'; if(!e.title&&!e.place) return 'Add what it is';
    const pl=S.places.find(p=>!p.gone&&p.name===e.place);
    S.events.push({id:SYNC.newId('events'),type:e.type||'other',title:e.title||(pl?pl.name:calType(e).t),date:e.date,time:e.time||'',end:e.end||'',days:Math.max(1,Math.min(7,+e.days||1)),rpt:'',until:'',
      attendees:e.type==='market'?(e.attendees||[]).filter(a=>SYNC.getMembers().includes(a)):[],remind:['day'],note:e.note||'',place:e.type==='market'&&pl?pl.id:'',by:me,changed:Date.now(),from:'voice'}); }
  if(d.kind==='todo'){ const t=d.todo; if(!t.text) return 'Add what to do'; const who=canManage()&&SYNC.getMembers().concat(me).includes(t.who)?t.who:me;
    S.todos.push({id:SYNC.newId('todos'),text:t.text.slice(0,200),who,due:t.due||'',time:t.due?t.time||'':'',done:false,by:me,at:Date.now(),from:'voice'}); }
  if(d.kind==='shopping'){ const x=d.shopping; if(!x.item) return 'Add what to buy'; S.shopping.push({id:SYNC.newId('shopping'),item:x.item.slice(0,120),qty:Math.max(1,+x.qty||1),size:(x.size||'').slice(0,40),done:false,by:me,at:Date.now(),from:'voice'}); }
  if(d.kind==='order'){ const x=d.order; if(!x.customer) return 'Add who the order is for'; const lines=x.lines.filter(l=>l.qty>0).map(l=>{ const p=findProduct(l.product); return {pid:p?p.id:'',name:p?prodName(p):l.product,qty:l.qty,unit:p?(p.wholesale||p.price):0}; });
    if(!lines.length) return 'Add what they ordered'; const shop=S.places.find(p=>!p.gone&&p.channel==='wholesale'&&normName(p.name)===normName(x.customer));
    const o={id:SYNC.newId('orders'),source:shop?'wholesale':'custom',customer:{name:x.customer,email:'',phone:'',address:''},place:shop?shop.id:'',lines,due:x.due||'',paid:false,note:x.note||'',discount:0,shipping:0,status:'new',at:Date.now(),date:nzDay(),by:me,from:'voice'};
    o.total=orderTotal(o); o.gst=Math.round(o.total*3/23); S.orders.push(o); }
  if(d.kind==='idea'){ const x=d.idea; if(!x.text) return 'Add the idea'; S.ideas.push({id:SYNC.newId('ideas'),text:x.text.slice(0,200),kind:x.kind||'idea',by:me,at:Date.now(),done:false,from:'voice'}); }
  return '';
}

/* ---------- Drive mode: a few huge buttons, everything read aloud ---------- */
let driveQ=null, driveI=0;
SCREENS.drive={
  title:()=>({h:'Drive mode',s:'Big buttons, read aloud'}),
  html(){ const item=driveQ&&driveQ[driveI];
    return `<div class="drive">${item?`<div class="dnow"><small>${driveI+1} of ${driveQ.length}</small><b>${esc(item.title)}</b><span>${esc(item.sub||'')}</span></div>
        <button class="dbtn next" id="dNext">▶ Next</button>${item.todo?'<button class="dbtn yes" id="dDone">✓ Done</button>':''}${item.todo&&canManage()||item.todo&&item.mine?'<button class="dbtn later" id="dTmw">↪ Tomorrow</button>':''}<button class="dbtn stop" id="dStop">■ Stop</button>`
      :`${voiceReady()?'<button class="dbtn talk" id="dTalk">🎙 Talk</button>':''}<button class="dbtn today" id="dToday">📅 What's on today</button>`}</div>`; },
  wire(){
    const t=$('#dTalk'); if(t) t.onclick=()=>startVoice({drive:true});
    const td=$('#dToday'); if(td) td.onclick=()=>{ driveQ=todayQueue(); driveI=0; if(!driveQ.length){ driveQ=null; say('Nothing on today.'); return; } render(); readDrive(); };
    const nx=$('#dNext'); if(nx) nx.onclick=()=>{ driveI++; if(driveI>=driveQ.length){ driveQ=null; say('That\'s everything for today.'); render(); return; } render(); readDrive(); };
    const dn=$('#dDone'); if(dn) dn.onclick=()=>{ const it=driveQ[driveI], x=S.todos.find(y=>y.id===it.todo); if(x){ x.done=true; x.doneAt=Date.now(); x.doneBy=SYNC.me(); save(); } say('Done.'); $('#dNext').click(); };
    const tm=$('#dTmw'); if(tm) tm.onclick=()=>{ const it=driveQ[driveI], x=S.todos.find(y=>y.id===it.todo); if(x){ x.due=dk(addDays(kd(nzDay()),1)); save(); } say('Moved to tomorrow.'); $('#dNext').click(); };
    const sp=$('#dStop'); if(sp) sp.onclick=()=>{ hush(); driveQ=null; render(); };
  }
};
const readDrive=()=>{ const it=driveQ&&driveQ[driveI]; if(it) say(it.speak); };
function todayQueue(){
  const k=nzDay(), out=[];
  calItems(k).forEach(it=>{ if(it.kind==='ev'){ const e=S.events.find(x=>it.attr.includes('"'+x.id+'"')); if(!e) return;
      out.push({title:it.title.replace(/^\S+ /,''),sub:it.sub,speak:`${calType(e).t}: ${e.title}${e.time?', at '+t12(e.time):''}${e.end?', until '+t12(e.end):''}.`}); } });
  S.todos.filter(t=>!t.done&&t.due&&t.due<=k&&(t.who===SYNC.me()||canManage()&&!t.who)).forEach(t=>out.push({title:t.text,sub:t.due<k?'Overdue':'To do today',todo:t.id,mine:t.who===SYNC.me(),speak:(t.due<k?'Overdue: ':'To do: ')+t.text+'. Tap Done, Tomorrow or Next.'}));
  return out;
}

/* ---------- voice notes still waiting to be checked (Lists → Voice notes) ---------- */
function pendingNotes(){ return S.voicenotes.filter(n=>n.kind!=='chunk'&&n.by===SYNC.me()&&['new','working','ready','failed'].includes(n.status)).sort((a,b)=>b.at-a.at); }
function voiceListHtml(){
  const l=pendingNotes();
  return `<div class="card">${voiceReady()?'<button class="btn big" id="vNew" style="width:100%">🎙 Talk</button>':'<p class="note">The voice assistant is switched off. An owner can switch it on in Setup.</p>'}</div>
    <div class="card"><h3>Waiting for you</h3>${l.length?l.map(n=>`<div class="lrow"><div class="grow ltxt"><b>${esc((n.heard||n.text||'Voice note').slice(0,80))}</b><small>${esc(nzDate(new Date(n.at),{weekday:'short',day:'numeric',month:'short'}))} ${nzTime(n.at)} · ${n.status==='ready'?(n.drafts||[]).length+' draft'+((n.drafts||[]).length===1?'':'s')+' to check':n.status==='failed'?'didn\'t work: '+esc(n.error||''):'being worked out…'}</small></div>
      ${n.status==='ready'?`<button class="btn small" data-vopen="${n.id}">Check</button>`:''}<button class="qb rm" data-vdel="${n.id}" aria-label="Throw away">✕</button></div>`).join(''):'<p class="note">Nothing waiting.</p>'}</div>`;
}
function wireVoiceList(){
  const nv=$('#vNew'); if(nv) nv.onclick=()=>startVoice();
  document.querySelectorAll('[data-vopen]').forEach(b=>b.onclick=()=>{ const n=S.voicenotes.find(x=>x.id===b.dataset.vopen); if(n) reviewNote(n); });
  document.querySelectorAll('[data-vdel]').forEach(b=>b.onclick=()=>{ const n=S.voicenotes.find(x=>x.id===b.dataset.vdel); if(n){ n.status='discarded'; n.settledAt=Date.now(); save(); render(); } });
}
