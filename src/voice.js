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
  if(!voiceReady()){ toast('The assistant is switched off in Setup'); return; }
  if(!canRecord()){ typedNote(opts); return; }
  hush();
  let rec=null, stream=null, parts=[], t0=0, timer=null, cancelled=false;
  modal((m,close)=>{
    const stop=()=>{ clearInterval(timer); try{ rec&&rec.state!=='inactive'&&rec.stop(); }catch(e){} try{ stream&&stream.getTracks().forEach(t=>t.stop()); }catch(e){} };
    m.innerHTML=`<div class="vrec"><div class="vdot" id="vDot">🎙</div><h2 id="vH">Getting the microphone…</h2><p class="note" id="vT">Talk naturally. Say what, when, where and who.</p>
      <button class="btn big vdone" id="vDone" disabled>✓ Done</button><div class="mact"><button class="btn alt" id="vX">Cancel</button><button class="btn alt" id="vType">⌨️ Type instead</button>${opts.parentApi?'':'<button class="btn alt" id="vPic">📷 Photo instead</button>'}</div>
      <p><button class="linkb" id="vHelp">❓ How to use the assistant</button></p></div>`;
    const cancel=()=>{ cancelled=true; stop(); close(); };
    m.querySelector('#vX').onclick=cancel;
    m.querySelector('#vType').onclick=()=>{ cancelled=true; stop(); close(); typedNote(opts); };
    const vp=m.querySelector('#vPic'); if(vp) vp.onclick=()=>{ cancelled=true; stop(); close(); takePhoto(opts); };
    m.querySelector('#vHelp').onclick=assistantHelp;
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
// typing works the same as talking. A plain question ("what's on tomorrow?", "how many lip balms?") is
// answered straight away on the device, with no AI and no waiting.
function typedNote(opts={}){
  modal((m,close)=>{ m.innerHTML=`<h2>⌨️ ${opts.parentApi?'Change something':'Type a note or a question'}</h2><p class="note">${opts.parentApi?'e.g. "make it Sunday", "3 not 13", "take off the beeswax", or "confirm".':'Write it the way you\'d say it, e.g. "Matakana market Saturday 8 till 1, buy beeswax", or ask "what\'s on tomorrow?"'}</p>
      <textarea class="txt" id="vTx" rows="4" autocapitalize="sentences"></textarea><div class="mact"><button class="btn alt" id="vC">Cancel</button><button class="btn" id="vOk">${opts.parentApi?'Send':'Work it out'}</button></div>`;
    m.querySelector('#vC').onclick=close;
    m.querySelector('#vOk').onclick=()=>{ const t=m.querySelector('#vTx').value.trim(); if(!t){ toast('Type the note'); return; } close(); typedText(t,opts); };
    setTimeout(()=>{ if(!m.contains(document.activeElement)) m.querySelector('#vTx').focus(); },50); });
}
function typedText(t,opts={}){
  const cmd=commandOf(t); if(cmd&&opts.parentApi){ opts.parentApi.command(cmd); return; }
  const q=!opts.parentApi&&localQuestion(t); if(q){ showAnswer(t,answerQuestion(q)); return; }
  sendNote({text:t.slice(0,2000)},opts);
}
// a photo (fuel pump, invoice, receipt, recipe card, handwritten list, sign-up sheet): made small on the device first
function takePhoto(opts={}){
  if(!voiceReady()){ toast('The assistant is switched off in Setup'); return; }
  if(opts.source){ pickPhoto(opts); return; }
  modal((m,close)=>{ m.innerHTML=`<h2>📷 ${esc(opts.title||'A photo')}</h2><div class="mact" style="justify-content:stretch"><button class="btn big" id="pcCam" style="flex:1">📷 Take a photo</button><button class="btn big alt" id="pcGal" style="flex:1">🖼️ From the gallery</button></div><div class="mact"><button class="btn alt" id="pcX">Cancel</button></div>`;
    m.querySelector('#pcX').onclick=close;
    m.querySelector('#pcCam').onclick=()=>{ close(); pickPhoto(Object.assign({},opts,{source:'camera'})); };
    m.querySelector('#pcGal').onclick=()=>{ close(); pickPhoto(Object.assign({},opts,{source:'gallery'})); }; });
}
function pickPhoto(opts){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; if(opts.source==='camera') inp.setAttribute('capture','environment');
  inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f) return; const url=URL.createObjectURL(f), img=new Image();
    img.onload=()=>{ const k=Math.min(1,1400/Math.max(img.width,img.height)), c=document.createElement('canvas'); c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
      const data=c.toDataURL('image/jpeg',0.72).split(',')[1];
      if(opts.hint){ sendNote({image:data,mime:'image/jpeg',text:opts.hint},opts); return; }
      modal((m,close)=>{ m.innerHTML=`<h2>📷 What's this photo?</h2><img src="data:image/jpeg;base64,${data}" alt="" style="max-width:100%;max-height:260px;border-radius:14px;display:block;margin:0 auto 10px">
          <div class="pastnames">${['Fuel receipt','Supplier invoice','Stall fee receipt','Recipe card','Shopping list','To-do list','Market sign-up sheet'].map(x=>`<button class="chip big" data-ph="${x}">${x}</button>`).join('')}</div>
          <label class="note" for="phT">Anything to add (optional)</label><input class="txt" id="phT" placeholder="e.g. this was for the Matakana market">
          <div class="mact"><button class="btn alt" id="phC">Cancel</button><button class="btn" id="phOk">Work it out</button></div>`;
        let hint=''; m.querySelectorAll('[data-ph]').forEach(b=>b.onclick=()=>{ hint=b.dataset.ph; m.querySelectorAll('[data-ph]').forEach(x=>x.classList.toggle('on',x===b)); });
        m.querySelector('#phC').onclick=close;
        m.querySelector('#phOk').onclick=()=>{ const t=[hint,m.querySelector('#phT').value.trim()].filter(Boolean).join('. '); close(); sendNote({image:data,mime:'image/jpeg',text:t},opts); }; },{big:true}); };
    img.onerror=()=>toast('That photo couldn\'t be read'); img.src=url; };
  inp.click();
}
// save the note (and its recording or photo, in pieces), then tell the helper so it starts straight away
function sendNote(n,opts={}){
  const id=SYNC.newId('voicenotes'), at=Date.now(), pieces=[], media=n.audio||n.image||'';
  for(let i=0;i*CHUNK<media.length;i++) pieces.push(media.slice(i*CHUNK,(i+1)*CHUNK));
  pieces.forEach((d,i)=>S.voicenotes.push({id:id+'-'+i,kind:'chunk',note:id,i,data:d,by:SYNC.me(),at}));
  S.voicenotes.push(Object.assign({id,kind:'note',by:SYNC.me(),at,status:'new',mime:n.mime||'',secs:n.secs||0,chunks:pieces.length,text:n.text||'',drive:!!opts.drive},
    opts.prev?{prev:opts.prev,parent:opts.parent||''}:{}));
  save(); pingHelper(id);
  waitForNote(id,opts);
}
// Setup → Test the link: the helper notes when it hears the app, so we can show whether the instant link works
function testHelperLink(done){
  const url=S.settings.voiceUrl; if(!url){ toast('Paste the helper web address first'); return; }
  const t0=Date.now(), was=(S.helperSeen||{}).at||0; pingHelper('ping-'+Date.now().toString(36));
  const iv=setInterval(()=>{ const at=(S.helperSeen||{}).at||0;
    if(at>was){ clearInterval(iv); done(true,Math.round((Date.now()-t0)/100)/10,(S.helperSeen||{}).version); }
    else if(Date.now()-t0>25000){ clearInterval(iv); done(false); } },500);
}
function pingHelper(id){
  const url=S.settings.voiceUrl; if(!url||!/^https:\/\/script\.google\.com\//.test(url)) return;
  // the helper reads the note itself from the database; this only says "there's one waiting"
  setTimeout(()=>{ try{ fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({bid:SYNC.businessId(),id})}).catch(()=>{}); }catch(e){} },400);
}

/* ---------- waiting: each step shown as it happens, with a timer ---------- */
function waitForNote(id,opts={}){
  const t0=Date.now();
  modal((m,close)=>{
    const quit=()=>{ clearInterval(voiceWatch); close(); };
    const draw=()=>{ const n=S.voicenotes.find(x=>x.id===id)||{}, photo=/^image\//.test(n.mime||''), typed=!!n.text&&!n.chunks, off=!navigator.onLine;
      const st=n.status==='working'||n.status==='ready'?n.stage||'thinking':'', secs=Math.round((Date.now()-t0)/1000);
      const steps=[['saved','Saved on this '+deviceLabel(),true],['sent','Picked up by the assistant',!!st,!st&&!off]]
        .concat(photo?[['looking','Reading the photo',st==='thinking'||st==='ready',st==='looking']]:typed?[]:[['listening','Listening to your note',!!n.heard,st==='listening']])
        .concat([['thinking','Working out what to do',st==='ready',st==='thinking'],['ready','Ready to check',n.status==='ready']]);
      m.querySelector('#vH').textContent=off?'Waiting for signal':'Working it out… '+secs+' s';
      m.querySelector('#vS').innerHTML=steps.map(([k,t,done,now])=>`<li class="${done?'done':now?'now':''}">${done?'✓':now?'⏳':'○'} ${esc(t)}</li>`).join('');
      const h=m.querySelector('#vHeard'); if(n.heard&&!photo){ h.hidden=false; h.textContent='“'+n.heard+'”'; }
      m.querySelector('#vW').textContent=off?'📴 You\'re offline. The note is saved on this '+deviceLabel()+' and will be worked out as soon as you\'re back in signal. It\'ll wait under Lists → Voice notes.'
        :n.error&&n.status==='new'?'Still trying… ('+n.error.slice(0,80)+')':secs>20&&n.status==='new'?(S.settings.voiceUrl?'The assistant hasn\'t picked it up yet, so the instant link may not be working (Setup → 🎙 Voice assistant → Test the link). It also checks every 5 minutes, so it will get there.':'There\'s no instant link set up, so the assistant picks notes up on its 5-minute check. Add the helper web address in Setup → 🎙 Voice assistant.'):'';
      return n; };
    m.innerHTML=`<div class="vrec"><div class="vdot work">⏳</div><h2 id="vH">Working it out…</h2><ul class="vsteps" id="vS"></ul><p class="heard" id="vHeard" hidden></p><p class="note" id="vW"></p>
      <div class="mact"><button class="btn alt" id="vL">Carry on, tell me when it's ready</button></div></div>`;
    m.querySelector('#vL').onclick=()=>{ quit(); const x=S.voicenotes.find(y=>y.id===id); if(x){ x.notify=true; save(); } watchNote(id,opts); toast('Carry on. You\'ll be told when it\'s ready (it waits under Lists → Voice notes).'); };
    close.onBack=()=>{ m.querySelector('#vL').click(); return true; };
    clearInterval(voiceWatch); draw();
    voiceWatch=setInterval(()=>{ const n=draw(); if(!n.id) return;
      if(n.status==='ready'){ quit(); noteReady(n,opts); }
      else if(n.status==='failed'){ quit(); say(opts.drive?'Sorry, that didn\'t work. '+(n.error||''):''); modal((m2,c2)=>{ m2.innerHTML=`<h2>That didn't work</h2><p>${esc(n.error||'Something went wrong.')}</p><div class="mact"><button class="btn" id="fOk">OK</button></div>`; m2.querySelector('#fOk').onclick=c2; }); }
    },400);
  },{sticky:true});
}
// a note being worked out in the background: a banner when it's ready
const watching=new Map();
function watchNote(id,opts){ watching.set(id,opts||{}); }
setInterval(()=>{ for(const [id,opts] of watching){ const n=S.voicenotes.find(x=>x.id===id); if(!n||!['new','working'].includes(n.status)){ watching.delete(id);
  if(n&&n.status==='ready'){ const b=document.createElement('button'); b.className='notebanner'; b.textContent='🎙 Your note is ready to check · tap to see it'; b.onclick=()=>{ b.remove(); noteReady(n,opts); }; document.body.appendChild(b); setTimeout(()=>b.remove(),30000); } } } },1500);
function noteReady(n,opts={}){
  if(opts.onDrafts){ settleNote(n,'done'); opts.onDrafts(n); return; }
  if(opts.parentApi){ if(n.command){ settleNote(n,'done'); opts.parentApi.command(n.command); } else opts.parentApi.replace(n); return; }
  if(n.command){ settleNote(n,'done'); toast('Nothing on screen to '+n.command); return; }
  reviewNote(n,opts);
}
const settleNote=(n,status)=>{ const x=S.voicenotes.find(y=>y.id===n.id); if(x){ x.status=status; x.settledAt=Date.now(); save(); } };
// "yes", "confirm", "cancel", "later": said or typed in reply to the drafts
function commandOf(t){ t=String(t||'').toLowerCase().replace(/[^a-z ]/g,'').trim();
  if(/^(yes|yep|yeah|ok|okay|confirm|save|save it|save them|save all|thats right|correct|go ahead)( please)?$/.test(t)) return 'confirm';
  if(/^(no|nope|cancel|throw it away|throw them away|discard|delete it|forget it)( please)?$/.test(t)) return 'cancel';
  if(/^(later|sort it later|sort later|save as draft|draft|keep it for later|not now)( please)?$/.test(t)) return 'later';
  return ''; }

/* ---------- questions, answered from the app's own figures (only what this person can see) ---------- */
function periodOf(t){ const k=nzDay(), d=kd(k), mon=monday(d), y=dk(addDays(d,-1)), tm=dk(addDays(d,1));
  if(/yesterday/.test(t)) return [y,y,'yesterday']; if(/tomorrow/.test(t)) return [tm,tm,'tomorrow'];
  if(/last week/.test(t)){ const a=addDays(mon,-7); return [dk(a),dk(addDays(a,6)),'last week']; }
  if(/next week/.test(t)){ const a=addDays(mon,7); return [dk(a),dk(addDays(a,6)),'next week']; }
  if(/this week|the week/.test(t)) return [dk(mon),dk(addDays(mon,6)),'this week'];
  if(/this month|the month/.test(t)) return [k.slice(0,8)+'01',k,'this month'];
  return [k,k,'today']; }
function localQuestion(text){ const t=String(text||'').toLowerCase();
  if(!/\?|^(what|how|whats|show|tell)/.test(t.trim())) return null;
  const [from,to,label]=periodOf(t);
  if(/\bprofit\b/.test(t)) return {ask:'profit',from,to,label};
  if(/\b(sales|takings|take|taken|sold|sell)\b/.test(t)&&!/how many .* (have|got|left|in stock)/.test(t)) return {ask:'sales',from,to,label};
  if(/what.?s on|what is on|on today|on tomorrow|on this week|on next week|what have i got|what do i have on|calendar/.test(t)) return {ask:'whatson',from,to,label};
  const m=t.match(/how (?:many|much) (.+?)(?: (?:have we|do we|have i|do i|are there|is there|we|i)(?: got| have)?)?(?: left| in stock| at home)?\s*\??$/);
  if(m&&m[1]) return {ask:'stock',product:m[1].replace(/^(of )?(the |our )?/,'')};
  return null; }
function bestProduct(name){ let best=null,sc=0; for(const p of S.products){ const v=fuzzyScore(name,p.name+' '+(p.size||'')); if(v>sc){ sc=v; best=p; } } return best; }
function answerQuestion(q){
  const lbl=q.label||(q.from&&q.to?(q.from===q.to?(q.from===nzDay()?'today':nzDate(kd(q.from),{weekday:'long',day:'numeric',month:'long'})):nzDate(kd(q.from),{day:'numeric',month:'short'})+' to '+nzDate(kd(q.to),{day:'numeric',month:'short'})):'today');
  const from=q.from||nzDay(), to=q.to||from;
  if(q.ask==='sales'){ if(!canManage()) return 'Sales totals are for owners and managers.';
    const l=S.sales.filter(s=>!s.voided&&s.date>=from&&s.date<=to), tot=l.reduce((n,s)=>n+s.total,0), by=m=>l.filter(s=>s.method===m).reduce((n,s)=>n+s.total,0);
    return l.length?`Sales ${lbl}: ${c2(tot)} from ${l.length} sale${l.length===1?'':'s'} (cash ${c2(by('cash'))}, EFTPOS ${c2(by('eftpos'))}${by('other')?', other '+c2(by('other')):''}).`:`No sales ${lbl}.`; }
  if(q.ask==='profit'){ if(role()!=='owner') return 'Profit is for owners only.'; const R=crunch(from,to,'all');
    return `${lbl[0].toUpperCase()+lbl.slice(1)}: takings ${c2(R.revenue)} including GST. Gross profit ${c2(R.gross)}, and ${c2(R.net)} after stall fees, mileage, pay and other costs (ex GST).${R.unknownCost?' '+R.unknownCost+' item'+(R.unknownCost===1?' has':'s have')+' no cost yet, so profit looks higher than it is.':''}`; }
  if(q.ask==='whatson'){ const out=[]; let d=kd(from); for(let i=0;i<14&&dk(d)<=to;i++,d=addDays(d,1)){ const k=dk(d), its=calItems(k).map(x=>x.title.replace(/^\S+\s/,'')+(x.sub?' ('+x.sub+')':''));
      if(its.length) out.push((from===to?'':nzDate(d,{weekday:'long'})+': ')+its.join('; ')); }
    return out.length?`${lbl[0].toUpperCase()+lbl.slice(1)}: ${out.join('. ')}.`:`Nothing on ${lbl}.`; }
  if(q.ask==='stock'){ const p=q.product?bestProduct(q.product):null; if(!p) return 'I couldn\'t tell which product. Try its name as it is on the till.';
    const st=stockOf(p.id); return st?`${prodName(p)}: ${st.total} in stock (${st.home} at home${st.out?', '+st.out+' out with you':''}).`:`${prodName(p)}: stock isn't counted yet. Count it under Brew → Stock.`; }
  return 'I can\'t answer that one yet. I can tell you sales, profit, what\'s on, and how many of a product you have.';
}
function showAnswer(question,answer){
  say(answer);
  modal((m,close)=>{ m.innerHTML=`<h2>💬 ${esc(question)}</h2><p class="answer">${esc(answer)}</p><div class="mact"><button class="btn alt" id="aAgain">🔊 Read it again</button><button class="btn" id="aOk">OK</button></div>`;
    m.querySelector('#aAgain').onclick=()=>say(answer); m.querySelector('#aOk').onclick=()=>{ hush(); close(); }; });
}
function assistantHelp(){
  modal((m,close)=>{ m.innerHTML=`<h2>❓ Using the assistant</h2>
      <p>Talk (🎙), type (⌨️) or take a photo (📷). It drafts things for you to check: <b>nothing is saved until you say or tap Save</b>, and you can fix anything by hand. Fields in yellow were a guess.</p>
      <h3>Things to say</h3><ul>
        <li>"Matakana market Saturday 8 till 1, buy 2 kg of beeswax"</li><li>"Remind Sam to label the jars on Friday"</li>
        <li>"Kōwhai Store wants 12 lip balms by Friday" (an order and a to-do)</li><li>"We made 40 lavender oils today" · "Count: 12 balms, 8 calendula"</li>
        <li>"Paid $45 stall fee at Matakana" · "Filled up, 42 litres, $118, 84,210 km"</li><li>"New shop: Jo at Kōwhai Store, 021 123 4567"</li></ul>
      <h3>Ask</h3><ul><li>"How much did we sell today?" · "What's my profit this week?"</li><li>"What's on tomorrow?" · "How many lip balms have we got?"</li></ul>
      <p class="note">Questions are answered from the app's own figures and read aloud. Typed questions are answered at once, with no waiting.</p>
      <h3>Photos</h3><p>Fuel pump or receipt, supplier invoice (updates ingredient prices), stall fee receipt, recipe card, handwritten list, market sign-up sheet.</p>
      <h3>Once the drafts are up</h3><ul><li><b>Change it</b>: say or type "make it Sunday", "3 not 13", "take off the beeswax"</li>
        <li><b>"Yes" / "Confirm"</b> saves everything · <b>"Cancel"</b> throws it away · <b>"Later"</b> keeps it under Lists → Voice notes</li></ul>
      <p class="note">With no signal, notes are kept on the device and worked out when you're back in signal. Tap "Carry on, tell me when it's ready" to keep working while it thinks. It learns from what you change, and owners can see what it has learnt in Setup.</p>
      <div class="mact"><button class="btn" id="hOk">Got it</button></div>`;
    m.querySelector('#hOk').onclick=close; },{big:true});
}

// what to call a draft, and whether this person may save it
const DRAFT_ICON={event:'📅',todo:'✅',shopping:'🛒',idea:'💡',order:'📦',question:'💬',made:'🫙',count:'🔢',cost:'💸',fuel:'⛽',contact:'🏪',price:'🧾',recipe:'📖'};
const normName=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const findProduct=n=>S.products.find(p=>normName(prodName(p))===normName(n)||normName(p.name+' '+(p.size||''))===normName(n))||S.products.find(p=>normName(n).includes(normName(p.name))&&normName(p.name).length>3)||(n?bestProduct(n):null);
const findInput=n=>{ const e=S.inputs.find(i=>normName(i.name)===normName(n)); if(e) return e; let best=null,sc=0; for(const i of S.inputs){ const v=fuzzyScore(n,i.name); if(v>sc){ sc=v; best=i; } } return best; };
const draftAllowed=d=>{
  if(d.kind==='question') return true;
  if(role()==='owner') return true;
  if(canManage()) return d.kind!=='recipe';
  return d.kind==='shopping'||d.kind==='made'||d.kind==='count'||(d.kind==='todo'&&(!d.todo.who||d.todo.who===SYNC.me())); };
function draftLine(d){
  const x=d[d.kind]||{};
  if(d.kind==='event'){ const e=x; return `${calType(e).t}: ${e.title||'?'}, ${e.date?nzDate(kd(e.date),{weekday:'short',day:'numeric',month:'short'}):'no date'}${e.time?' '+t12(e.time)+(e.end?'–'+t12(e.end):''):''}`; }
  if(d.kind==='todo') return 'To do: '+x.text+(x.due?', '+nzDate(kd(x.due),{weekday:'short',day:'numeric',month:'short'}):'');
  if(d.kind==='order') return 'Order: '+(x.customer||'?')+', '+(x.lines||[]).map(l=>l.qty+' × '+l.product).join(', ')+(x.due?', send by '+nzDate(kd(x.due),{weekday:'short',day:'numeric',month:'short'}):'');
  if(d.kind==='shopping') return 'Buy: '+[x.qty>1?x.qty+' ×':'',x.item,x.size].filter(Boolean).join(' ');
  if(d.kind==='question') return x.text||'A question';
  if(d.kind==='made') return 'Made: '+x.qty+' × '+(x.product||'?');
  if(d.kind==='count') return 'Stock count: '+(x.lines||[]).map(l=>l.qty+' × '+l.product).join(', ');
  if(d.kind==='cost') return 'Cost: '+(x.what||'?')+', '+c2(x.cents)+(x.place?' ('+x.place+')':'');
  if(d.kind==='fuel') return 'Fill-up: '+x.litres+' L, '+c2(x.cents)+(x.odometer?', '+x.odometer.toLocaleString('en-NZ')+' km':'');
  if(d.kind==='contact') return 'Shop or contact: '+[x.business,x.person].filter(Boolean).join(', ');
  if(d.kind==='price') return 'New price: '+(x.item||'?')+', '+c2(x.cents)+' ex GST for '+x.pack+(x.unit==='each'?'':' '+x.unit);
  if(d.kind==='recipe') return 'Recipe: '+(x.name||'?')+', makes '+x.yield+' '+x.unit;
  return (IDEA_KINDS[x.kind]||'💡 Idea')+': '+x.text;
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
  const drafts=(n.drafts||[]).map(d=>JSON.parse(JSON.stringify(d))), state=drafts.map(d=>d.kind==='question'?'answered':draftAllowed(d)?'open':'blocked');
  const answers=drafts.map(d=>d.kind==='question'?answerQuestion(d.question):'');
  const settle=status=>{ const x=S.voicenotes.find(y=>y.id===n.id); if(!x) return; x.status=status; x.settledAt=Date.now();
    // what was changed before saving: kept so the assistant can learn from it (never costs, prices or recipes)
    if(status==='done'){ const edits=[]; drafts.forEach((d,i)=>{ if(state[i]!=='saved'||['cost','price','recipe','fuel'].includes(d.kind)) return; const o=(n.drafts||[])[i]; if(!o) return;
        const a=JSON.stringify(o[o.kind]), b=JSON.stringify(d[d.kind]); if(a!==b) edits.push({kind:d.kind,before:o[o.kind],after:d[d.kind]}); });
      if(edits.length){ x.edits=JSON.parse(JSON.stringify(edits)).slice(0,10); x.learn='todo'; } }
    save(); };
  const speakAll=()=>{ const clashes=drafts.filter(d=>d.kind==='event').map(d=>clashOf(d.event)).filter(Boolean), asks=answers.filter(Boolean), open=state.filter(s=>s==='open').length;
    say([asks.join(' '),open?(n.say||drafts.filter(d=>d.kind!=='question').map(draftLine).join('. ')):(asks.length?'':'I didn\'t catch anything to add.'),...clashes,open?'Say yes to save, or tell me what to change.':''].filter(Boolean).join(' ')); };
  modal((m,close)=>{
    const field=(d,i,k,label,type='text',extra='')=>`<label class="note" for="d${i}${k}">${label}</label><input class="txt ${(d.unsure||[]).includes(k)?'unsure':''}" id="d${i}${k}" data-di="${i}" data-dk="${k}" type="${type}" ${extra}>`;
    const lineRows=(d,i,key,label)=>d[d.kind].lines.map((l,k)=>{ const p=key==='product'?findProduct(l.product):findInput(l.item); return `<div class="lrow"><input class="txt qty" type="number" min="0" step="any" data-ol="${i}:${k}" value="${l.qty}"><div class="grow ltxt"><b>${esc(p?(key==='product'?prodName(p):p.name):l[key])}</b><small>${p?'':label}</small></div></div>`; }).join('');
    const placeSel=(d,i,k,label,filter)=>`<label class="note" for="d${i}${k}">${label}</label><select class="txt ${(d.unsure||[]).includes(k)?'unsure':''}" id="d${i}${k}" data-di="${i}" data-dk="${k}"><option value="">${k==='place'&&d.kind==='cost'?'The whole business':'Not one of the saved places'}</option>${S.places.filter(p=>!p.gone&&(!filter||filter(p))).map(p=>`<option ${p.name===d[d.kind][k]?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`;
    const card=(d,i)=>{ const blocked=state[i]==='blocked', done=state[i]!=='open';
      let body='';
      if(d.kind==='question') return `<div class="card draft answer"><h3>💬 ${esc(draftLine(d))}</h3><p class="answer">${esc(answers[i])}</p></div>`;
      if(d.kind==='event') body=`<div class="bigseg">${Object.entries(CAL_TYPES).map(([k,v])=>`<button data-ety="${i}:${k}" class="${d.event.type===k?'on':''}">${v.ic} ${v.t}</button>`).join('')}</div>`+field(d,i,'title','What')
        +`<div class="formrow"><div>${field(d,i,'date','Date','date')}</div><div>${field(d,i,'days','Days','number','min="1" max="7"')}</div></div><div class="formrow"><div>${field(d,i,'time','Starts','time')}</div><div>${field(d,i,'end','Finishes','time')}</div></div>`
        +(d.event.type==='market'?placeSel(d,i,'place','Market'):'')+`<p class="note clash" id="d${i}clash">${esc(clashOf(d.event))}</p>`;
      if(d.kind==='todo') body=field(d,i,'text','What')+`<div class="formrow"><div>${field(d,i,'due','Date','date')}</div><div>${field(d,i,'time','Time','time')}</div></div>`
        +(canManage()?`<label class="note" for="d${i}who">Whose</label><select class="txt" id="d${i}who" data-di="${i}" data-dk="who">${[...new Set([SYNC.me(),...SYNC.getMembers()])].map(p=>`<option value="${esc(p)}" ${(d.todo.who||SYNC.me())===p?'selected':''}>${esc(p===SYNC.me()?'Mine':personName(p))}</option>`).join('')}</select>`:'');
      if(d.kind==='shopping') body=field(d,i,'item','What')+`<div class="formrow"><div>${field(d,i,'qty','How many','number','min="1"')}</div><div>${field(d,i,'size','Size')}</div></div>`;
      if(d.kind==='order') body=field(d,i,'customer','Customer')+field(d,i,'due','Send by','date')+lineRows(d,i,'product','Not a till product: it will be kept as typed');
      if(d.kind==='idea') body=`<div class="pastnames">${Object.entries(IDEA_KINDS).map(([k,v])=>`<button class="chip ${d.idea.kind===k?'on':''}" data-ik2="${i}:${k}">${v}</button>`).join('')}</div>`+field(d,i,'text','Note');
      if(d.kind==='made'){ const p=findProduct(d.made.product); body=`<p>${p?esc(prodName(p)):'<span class="bad">⚠️ Which product? "'+esc(d.made.product)+'" isn\'t on the till</span>'}</p>`+field(d,i,'qty','How many','number','min="1"')+(canManage()?'<p class="note">Added to stock at home.</p>':'<p class="note">Sent to the owners to add to stock.</p>'); }
      if(d.kind==='count') body=lineRows(d,i,'product','Not a till product: left out')+(canManage()?'<p class="note">Sets stock at home to these numbers.</p>':'<p class="note">Sent to the owners to check.</p>');
      if(d.kind==='cost') body=field(d,i,'what','What')+`<div class="formrow"><div><label class="note" for="d${i}amt">Amount incl GST ($)</label><input class="txt ${(d.unsure||[]).includes('cents')?'unsure':''}" id="d${i}amt" data-di="${i}" data-dk="cents" data-money="1" inputmode="decimal"></div><div>${field(d,i,'date','Date','date')}</div></div>`+placeSel(d,i,'place','For a place (optional)');
      if(d.kind==='fuel') body=`<div class="formrow"><div>${field(d,i,'litres','Litres','number','step="any" min="0"')}</div><div><label class="note" for="d${i}amt">Total paid ($)</label><input class="txt ${(d.unsure||[]).includes('cents')?'unsure':''}" id="d${i}amt" data-di="${i}" data-dk="cents" data-money="1" inputmode="decimal"></div></div>`+field(d,i,'odometer','Odometer (km)','number','min="0"');
      if(d.kind==='contact') body=field(d,i,'business','Shop or business')+field(d,i,'person','Person')+`<div class="formrow"><div>${field(d,i,'phone','Phone','tel')}</div><div>${field(d,i,'email','Email','email')}</div></div>`+field(d,i,'note','Note')+'<p class="note">Saved as a shop under Markets and places (Wholesale).</p>';
      if(d.kind==='price'){ const inp=findInput(d.price.item); body=`<p>${inp?esc(inp.name)+' · was '+c2(inp.price)+' for '+fmtQty(inp.pack,inp.unit):'<span class="bad">⚠️ "'+esc(d.price.item)+'" isn\'t one of your ingredients: it will be added</span>'}</p><div class="formrow"><div><label class="note" for="d${i}amt">Price for a pack, ex GST ($)</label><input class="txt ${(d.unsure||[]).includes('cents')?'unsure':''}" id="d${i}amt" data-di="${i}" data-dk="cents" data-money="1" inputmode="decimal"></div><div>${field(d,i,'pack','Pack size ('+esc(d.price.unit)+')','number','step="any" min="0"')}</div></div>`+field(d,i,'supplier','Supplier'); }
      if(d.kind==='recipe') body=field(d,i,'name','Recipe name')+`<div class="formrow"><div>${field(d,i,'yield','One batch makes','number','step="any" min="0"')}</div><div><p class="note">${esc(UNIT_WORDS[d.recipe.unit]||d.recipe.unit)}</p></div></div>`+lineRows(d,i,'item','Not one of your ingredients: it will be added with no price (shown in Needs attention)');
      return `<div class="card draft ${done?'settled':''}" id="dc${i}"><h3>${DRAFT_ICON[d.kind]||'•'} ${esc(draftLine(d))}</h3>
        ${blocked?'<p class="note">Only owners and managers can add this. Ask them, or add it to your own to-dos.</p>':state[i]==='saved'?'<p class="note">✓ Saved</p>':state[i]==='dropped'?'<p class="note">Left out</p>':body+`<div class="mact"><button class="btn alt" data-drop="${i}">Leave out</button><button class="btn" data-save1="${i}">✓ Save</button></div>`}</div>`; };
    const draw=()=>{ const open=state.filter(s=>s==='open').length, photo=/^image\//.test(n.mime||'');
      m.innerHTML=`<h2>${photo?'📷 Here\'s what I read':'🎙 Here\'s what I heard'}</h2>${n.heard||n.text?`<p class="heard">“${esc(n.heard||n.text)}”</p>`:''}
        ${drafts.length?'':'<p>Nothing to add from that. You can add things by hand as usual.</p>'}
        ${open?'<p class="note">Check and fix anything by hand. Fields in yellow were a guess. Nothing is saved until you tap Save (or say "yes").</p>':''}
        ${drafts.map(card).join('')}
        ${open&&voiceReady()?`<div class="card vreply"><b>Change something</b><small class="note">Say or type it, e.g. "make it Sunday", "3 not 13". Or say "yes", "cancel" or "later".</small>
          <div class="vrow"><input class="txt" id="rTx" placeholder="Type a change…" enterkeyhint="send"><button class="btn" id="rTxGo">Send</button><button class="btn alt" id="rMic" aria-label="Say a change">🎙</button></div></div>`:''}
        <div class="mact"><button class="btn alt" id="rAgain">🔊 Read it again</button>${open?`<button class="btn alt" id="rLater">Later</button><button class="btn danger" id="rNo">✕ Throw away</button><button class="btn" id="rYes">✓ Save ${open>1?'all '+open:'it'}</button>`:'<button class="btn" id="rDone">Done</button>'}</div>`;
      // fill the fields (values set here, so nothing typed is ever treated as HTML)
      m.querySelectorAll('[data-dk]').forEach(el=>{ const d=drafts[+el.dataset.di], o=d[d.kind], k=el.dataset.dk, money=!!el.dataset.money;
        if(el.tagName!=='SELECT') el.value=o[k]==null?'':money?(o[k]?(o[k]/100).toFixed(2):''):o[k];
        el.oninput=el.onchange=()=>{ o[k]=money?(toCents(el.value)||0):el.type==='number'?Math.max(0,+el.value||0):el.value; el.classList.remove('unsure');
          if(d.kind==='event'){ const c=m.querySelector('#d'+el.dataset.di+'clash'); if(c) c.textContent=clashOf(o); } }; });
      m.querySelectorAll('[data-ol]').forEach(el=>el.onchange=()=>{ const [i,k]=el.dataset.ol.split(':'), d=drafts[+i]; d[d.kind].lines[+k].qty=Math.max(0,+el.value||0); });
      m.querySelectorAll('[data-ety]').forEach(b=>b.onclick=()=>{ const [i,k]=b.dataset.ety.split(':'); drafts[+i].event.type=k; draw(); });
      m.querySelectorAll('[data-ik2]').forEach(b=>b.onclick=()=>{ const [i,k]=b.dataset.ik2.split(':'); drafts[+i].idea.kind=k; draw(); });
      m.querySelectorAll('[data-drop]').forEach(b=>b.onclick=()=>{ state[+b.dataset.drop]='dropped'; draw(); });
      m.querySelectorAll('[data-save1]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.save1, why=saveDraft(drafts[i]); if(why){ toast(why); return; } state[i]='saved'; save(); draw(); });
      m.querySelector('#rAgain').onclick=speakAll;
      const yes=m.querySelector('#rYes'); if(yes) yes.onclick=api.confirm;
      const no=m.querySelector('#rNo'); if(no) no.onclick=api.cancel;
      const lt=m.querySelector('#rLater'); if(lt) lt.onclick=api.later;
      const dn=m.querySelector('#rDone'); if(dn) dn.onclick=()=>{ settle(state.includes('saved')?'done':'discarded'); hush(); close(); if(['calendar','lists'].includes(cur())) rerenderAfterList(); };
      const tx=m.querySelector('#rTx'), send=()=>{ const t=tx.value.trim(); if(!t) return; tx.value=''; typedText(t,{parentApi:api,prev:openDrafts(),parent:n.id,drive:opts.drive}); };
      if(tx){ m.querySelector('#rTxGo').onclick=send; tx.onkeydown=e=>{ if(e.key==='Enter') send(); }; m.querySelector('#rMic').onclick=()=>{ hush(); startVoice({parentApi:api,prev:openDrafts(),parent:n.id,drive:opts.drive}); }; }
    };
    const openDrafts=()=>drafts.filter((d,i)=>state[i]==='open');
    const api={
      confirm(){ for(let i=0;i<drafts.length;i++) if(state[i]==='open'){ const why=saveDraft(drafts[i]); if(why){ toast(why); draw(); return; } state[i]='saved'; }
        save(); settle('done'); hush(); close(); if(opts.drive) say('Saved.'); toast('Saved'); if(['calendar','lists','brew','orders','recipes','vehicle','places'].includes(cur())) render(); },
      cancel(){ settle('discarded'); hush(); close(); if(opts.drive) say('Thrown away.'); toast('Nothing saved'); },
      later(){ hush(); close(); toast('Kept for later, under Lists → Voice notes'); },
      command(c){ (api[c]||api.later)(); },
      // a follow-up came back: its drafts replace the open ones (anything already saved stays saved)
      replace(n2){ settle('replaced'); hush(); close(); reviewNote(n2,opts); }
    };
    draw(); close.onBack=()=>{ hush(); close(); };
    speakAll();
  },{big:true,sticky:true});
}
// turn one checked draft into the real thing; returns a reason if it can't be saved yet
function saveDraft(d){
  if(!draftAllowed(d)) return 'Only owners and managers can add that';
  const me=SYNC.me(), x=d[d.kind]||{};
  // a helper's stock news goes to the owners as a to-do to check (helpers can't change stock directly)
  const toOwners=text=>{ S.todos.push({id:SYNC.newId('todos'),text:text.slice(0,200),who:SYNC.getMainOwner()||SYNC.getOwners()[0]||me,due:nzDay(),time:'',done:false,by:me,at:Date.now(),from:'voice'}); };
  if(d.kind==='event'){ const e=x; if(!e.date) return 'Add the date'; if(!e.title&&!e.place) return 'Add what it is';
    const pl=S.places.find(p=>!p.gone&&p.name===e.place);
    S.events.push({id:SYNC.newId('events'),type:e.type||'other',title:e.title||(pl?pl.name:calType(e).t),date:e.date,time:e.time||'',end:e.end||'',days:Math.max(1,Math.min(7,+e.days||1)),rpt:'',until:'',
      attendees:e.type==='market'?(e.attendees||[]).filter(a=>SYNC.getMembers().includes(a)):[],remind:['day'],note:e.note||'',place:e.type==='market'&&pl?pl.id:'',by:me,changed:Date.now(),from:'voice'}); }
  if(d.kind==='todo'){ const t=x; if(!t.text) return 'Add what to do'; const who=canManage()&&SYNC.getMembers().concat(me).includes(t.who)?t.who:me;
    S.todos.push({id:SYNC.newId('todos'),text:t.text.slice(0,200),who,due:t.due||'',time:t.due?t.time||'':'',done:false,by:me,at:Date.now(),from:'voice'}); }
  if(d.kind==='shopping'){ if(!x.item) return 'Add what to buy'; S.shopping.push({id:SYNC.newId('shopping'),item:x.item.slice(0,120),qty:Math.max(1,+x.qty||1),size:(x.size||'').slice(0,40),done:false,by:me,at:Date.now(),from:'voice'}); }
  if(d.kind==='order'){ if(!x.customer) return 'Add who the order is for'; const lines=x.lines.filter(l=>l.qty>0).map(l=>{ const p=findProduct(l.product); return {pid:p?p.id:'',name:p?prodName(p):l.product,qty:l.qty,unit:p?(p.wholesale||p.price):0}; });
    if(!lines.length) return 'Add what they ordered'; const shop=S.places.find(p=>!p.gone&&groupOf(p).channel==='wholesale'&&normName(p.name)===normName(x.customer));
    const o={id:SYNC.newId('orders'),source:shop?'wholesale':'custom',customer:{name:x.customer,email:'',phone:'',address:''},place:shop?shop.id:'',lines,due:x.due||'',paid:false,note:x.note||'',discount:0,shipping:0,status:'new',at:Date.now(),date:nzDay(),by:me,from:'voice'};
    o.total=orderTotal(o); o.gst=Math.round(o.total*3/23); S.orders.push(o); }
  if(d.kind==='idea'){ if(!x.text) return 'Add the idea'; S.ideas.push({id:SYNC.newId('ideas'),text:x.text.slice(0,200),kind:x.kind||'idea',by:me,at:Date.now(),done:false,from:'voice'}); }
  if(d.kind==='made'){ const p=findProduct(x.product); if(!p) return 'Which product was made? Pick it by hand under Brew'; if(!(x.qty>0)) return 'How many were made?';
    if(canManage()) moveStock({kind:'made',product:p.id,qty:Math.round(x.qty),from:'voice'}); else toOwners(personName(me)+' says: made '+Math.round(x.qty)+' × '+prodName(p)+'. Add to stock under Brew.'); }
  if(d.kind==='count'){ const ls=x.lines.map(l=>({p:findProduct(l.product),qty:l.qty})).filter(l=>l.p); if(!ls.length) return 'None of those are till products';
    if(canManage()) ls.forEach(l=>moveStock({kind:'count',product:l.p.id,qty:Math.max(0,Math.round(l.qty)),from:'voice'}));
    else toOwners(personName(me)+' counted: '+ls.map(l=>Math.round(l.qty)+' × '+prodName(l.p)).join(', ')+'. Check under Brew → Stock.'); }
  if(d.kind==='cost'){ if(!x.what) return 'Add what it was'; if(!(x.cents>0)) return 'Add the amount'; const pl=S.places.find(p=>!p.gone&&p.name===x.place);
    S.costs.push({id:SYNC.newId('costs'),kind:'other',note:x.what.slice(0,120),cents:Math.round(x.cents),date:x.date||nzDay(),place:pl?pl.id:'',by:me,at:Date.now(),from:'voice'}); }
  if(d.kind==='fuel'){ if(!(x.litres>0)) return 'Add the litres'; if(!(x.cents>0)) return 'Add the total paid';
    S.fuel.push({id:SYNC.newId('fuel'),litres:+x.litres,cents:Math.round(x.cents),odo:Math.round(+x.odometer||0),at:Date.now(),date:x.date||nzDay(),by:me,from:'voice'}); }
  if(d.kind==='contact'){ const name=(x.business||x.person||'').trim(); if(!name) return 'Add the shop or person';
    const g=placeGroups().find(g=>g.channel==='wholesale')||{id:'shops'}, note=['Contact: '+[x.person,x.phone,x.email].filter(Boolean).join(', '),x.note].filter(s=>s&&s!=='Contact: ').join('. ');
    const ex=S.places.find(p=>!p.gone&&normName(p.name)===normName(name));
    if(ex) ex.note=[ex.note,note].filter(Boolean).join('\n').slice(0,1000); else S.places.push({id:SYNC.newId('places'),name:name.slice(0,80),group:g.id,channel:'wholesale',address:'',km:'',float:'',note:note.slice(0,1000),by:me,at:Date.now(),from:'voice'}); }
  if(d.kind==='price'){ if(!x.item) return 'Add which item'; if(!(x.cents>0)) return 'Add the price'; if(!(x.pack>0)) return 'Add the pack size';
    let i=findInput(x.item); if(i&&normName(i.name)!==normName(x.item)&&fuzzyScore(x.item,i.name)<3) i=null;
    if(!i){ i={id:SYNC.newId('inputs'),name:x.item.slice(0,80),cat:'ingredient',price:0,pack:x.pack,unit:x.unit||'each',supplier:'',updated:Date.now()}; S.inputs.push(i); }
    Object.assign(i,{price:Math.round(x.cents),pack:+x.pack,unit:x.unit||i.unit,supplier:x.supplier||i.supplier||'',free:false,updated:Date.now()});
    S.prices.push({id:SYNC.newId('prices'),input:i.id,item:i.name,cents:i.price,pack:i.pack,unit:i.unit,date:nzDay(),at:Date.now(),by:me,from:'photo'}); }
  if(d.kind==='recipe'){ if(role()!=='owner') return 'Only owners add recipes'; if(!x.name) return 'Add the recipe name'; if(!(x.yield>0)) return 'Add what one batch makes';
    const lines=x.lines.filter(l=>l.qty>0&&l.item).map(l=>{ let i=findInput(l.item); if(i&&normName(i.name)!==normName(l.item)&&fuzzyScore(l.item,i.name)<3) i=null;
      if(!i){ i={id:SYNC.newId('inputs'),name:l.item.slice(0,80),cat:'ingredient',price:0,pack:1,unit:x.unit==='each'?'g':x.unit,supplier:'',updated:Date.now()}; S.inputs.push(i); }
      return {input:i.id,qty:+l.qty}; });
    S.recipes.push({id:SYNC.newId('recipes'),name:x.name.slice(0,80),yield:+x.yield,unit:x.unit||'ml',lines,updated:Date.now(),from:'photo'}); }
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
  return `<div class="card">${voiceReady()?'<div class="mact" style="margin-top:0"><button class="btn big" id="vNew" style="flex:2">🎙 Talk</button><button class="btn alt" id="vNewT">⌨️ Type</button><button class="btn alt" id="vNewP">📷 Photo</button><button class="btn alt" id="vNewH">❓</button></div>':'<p class="note">The voice assistant is switched off. An owner can switch it on in Setup.</p>'}</div>
    <div class="card"><h3>Waiting for you</h3>${l.length?l.map(n=>`<div class="lrow"><div class="grow ltxt"><b>${esc((n.heard||n.text||'Voice note').slice(0,80))}</b><small>${esc(nzDate(new Date(n.at),{weekday:'short',day:'numeric',month:'short'}))} ${nzTime(n.at)} · ${n.status==='ready'?(n.drafts||[]).length+' draft'+((n.drafts||[]).length===1?'':'s')+' to check':n.status==='failed'?'didn\'t work: '+esc(n.error||''):!navigator.onLine?'waiting for signal':n.stage==='thinking'?'working out what to do…':n.stage==='listening'?'listening…':n.stage==='looking'?'reading the photo…':'waiting for the assistant…'}</small></div>
      ${n.status==='ready'?`<button class="btn small" data-vopen="${n.id}">Check</button>`:''}<button class="qb rm" data-vdel="${n.id}" aria-label="Throw away">✕</button></div>`).join(''):'<p class="note">Nothing waiting.</p>'}</div>`;
}
function wireVoiceList(){
  const nv=$('#vNew'); if(nv) nv.onclick=()=>startVoice(); const nt=$('#vNewT'); if(nt) nt.onclick=()=>typedNote(); const np=$('#vNewP'); if(np) np.onclick=()=>takePhoto(); const nh=$('#vNewH'); if(nh) nh.onclick=assistantHelp;
  document.querySelectorAll('[data-vopen]').forEach(b=>b.onclick=()=>{ const n=S.voicenotes.find(x=>x.id===b.dataset.vopen); if(n) reviewNote(n); });
  document.querySelectorAll('[data-vdel]').forEach(b=>b.onclick=()=>{ const n=S.voicenotes.find(x=>x.id===b.dataset.vdel); if(n){ n.status='discarded'; n.settledAt=Date.now(); save(); render(); } });
}
