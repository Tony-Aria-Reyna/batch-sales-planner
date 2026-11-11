/* ================= The assistant, worked out on this device =================
   When "Fast assistant" is on in Setup, a note is sent to Gemini straight from this device through Firebase
   (see askGemini in sync.js): one call, two to five seconds, nothing through the Apps Script. The same
   instructions and tidy-up as the helper (helper/shared.js). If the call fails (AI Logic not switched on yet,
   no signal, the model busy), the note goes to the helper as before, so nothing is lost. */
const aiDirectOn=()=>!!(S.settings.aiDirect&&S.settings.voiceOn&&!S.settings.aiPaused);
// what the assistant should know: the names it must match, and the fortnight ahead. Only what this person may see.
function aiContext(){
  const names={}; (S.pins||[]).forEach(p=>{ if(p.name) names[p.id]=p.name; });
  const todayK=nzDay(), soon=dk(addDays(kd(todayK),14));
  const out={people:(SYNC.getMembers?SYNC.getMembers():[]).map(m=>({email:m,name:names[m]||m.split('@')[0]})),
    markets_and_places:S.places.filter(p=>!p.gone).map(p=>({name:p.name,kind:p.group||''})),
    products:S.products.map(p=>p.name+(p.size?' '+p.size:'')+(p.active===false?' (off the till)':'')),
    calendar_next_14_days:S.events.filter(e=>e.date&&e.date<=soon&&(e.date>=todayK||e.rpt)).slice(0,40).map(e=>({type:e.type,title:e.title,date:e.date,time:e.time||'',repeats:e.rpt||''}))};
  if(role()!=='helper') out.ingredients_and_packaging=S.inputs.map(i=>i.name);
  return out;
}
// try the direct route; true if the note was finished here, false to hand it to the helper
async function aiDirect(note,media){
  const isPhoto=/^image\//.test(note.mime||''), now=new Date(), todayK=nzDay(), weekday=nzDate(now,{weekday:'long'}), r=role();
  const allowed=kindsFor(r), ctx=Object.assign({today:todayK,weekday,time:nzDate(now,{hour:'2-digit',minute:'2-digit',hour12:false}),speaker:{email:SYNC.me(),role:r}},aiContext());
  if(Array.isArray(note.helpTopics)) ctx.help_topics=note.helpTopics.slice(0,80).map(x=>str(x,80));
  const parts=[{text:aiInstructions({isPhoto,isAudio:!!(media&&!isPhoto),allowed,todayK,weekday,context:ctx,lessons:String(S.settings.aiLessons||'').slice(0,3000)})}];
  if(note.prev&&note.prev.length) parts.push({text:'This note changes the drafts already on screen. Return the complete new list of drafts with the change made and everything else kept the same. Drafts on screen: '+JSON.stringify(note.prev).slice(0,6000)});
  if(isPhoto) parts.push({inlineData:{mimeType:note.mime,data:media}},{text:'Read the photo. '+(note.text?'They added: '+String(note.text).slice(0,500):'')});
  else if(media) parts.push({inlineData:{mimeType:aiMime(note.mime),data:media}},{text:'The recording is above.'});
  else parts.push({text:'Typed note: '+String(note.text||'').slice(0,4000)});
  const g=await SYNC.askGemini(parts,{json:true,model:S.settings.aiModel||undefined});
  let ans={}; try{ ans=JSON.parse(g.text); }catch(e){ ans={}; }
  const drafts=(Array.isArray(ans.drafts)?ans.drafts:[]).filter(d=>d&&allowed.includes(d.kind)).slice(0,20).map(cleanDraft);
  const command=['confirm','cancel','later'].includes(ans.command)?ans.command:'';
  const heard=isPhoto?String(ans.heard||'').slice(0,2000):media?String(ans.heard||'').trim().slice(0,4000):String(note.text||'').slice(0,4000);
  Object.assign(note,{status:'ready',stage:'ready',heard,say:media&&!isPhoto&&!heard?'I didn\'t hear anything. Try again a bit closer to the iPad.':String(ans.say||'').slice(0,500),command,drafts:heard||isPhoto?drafts:[],doneAt:Date.now(),error:'',direct:true,secsTaken:Math.round((Date.now()-note.at)/100)/10});
  aiCount(g.usage);
  return true;
}
const aiMime=m=>{ m=String(m||'').split(';')[0]; return m==='audio/mp4'||m==='audio/x-m4a'?'audio/m4a':(m||'audio/webm'); };
// the month's usage, kept the same way the helper keeps it, so the limit and Setup's figure stay right
function aiCount(u){
  const month=nzDay().slice(0,7), cur=S.aiUsage&&S.aiUsage.month===month?S.aiUsage:{month,notes:0,inTok:0,outTok:0};
  const i=(cur.inTok||0)+(u.promptTokenCount||0), o=(cur.outTok||0)+(u.candidatesTokenCount||0);
  const nzd=Math.round((i*0.5+o*3)/1e6*1.75*100)/100;
  S.aiUsage={month,notes:(cur.notes||0)+1,inTok:i,outTok:o,nzd}; if(SYNC.saveBusinessField) SYNC.saveBusinessField('aiUsage',S.aiUsage);
}
const aiOverLimit=()=>{ const lim=aiLimit(); const sp=aiSpent(); return lim>0&&sp!=null&&sp>=lim; };
