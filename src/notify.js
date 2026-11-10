/* ================= Notifications =================
   The business helper (Google Apps Script, every 5 minutes) sends web push through Firebase Cloud
   Messaging. Each person chooses what they get; their phones' addresses are kept in their own document
   (devices/{email}), which only they can read or change (the helper reads it with its own access).
   On the iPad, notifications only work once the app is on the Home Screen (iPadOS 16.4 or later), and only
   after tapping the button here to allow them. */
const NOTE_KINDS=()=>[
  ['reminders','📅 Calendar reminders',canManage()?'Markets and other entries, at the times set on each one':'Markets you\'re rostered on'],
  ['todos','✅ Morning list','At 7:30 am: today\'s markets and your to-dos'],
  ['tills','💵 Till still open','When a till is left open well after the market finished']]
  .concat(canManage()?[['asks','🙋 A helper asks to open a till','Straight away, so they\'re not left waiting'],['orders','📦 New orders','When a Shopify order or an order email comes in'],['lowstock','🧺 Low stock before a market','The evening before, anything that has run out']]:[])
  .concat(role()==='owner'?[['report','📧 Market report email','When the last till at a market closes, a one-page summary by email']]:[]);
let myDevices=null;
const deviceLabel=()=>{ const u=navigator.userAgent; return /iPad/.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1)?'iPad':/iPhone/.test(u)?'iPhone':/Android/.test(u)?'Android phone':'This computer'; };
const hashStr=s=>{ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0; return 'd'+(h>>>0).toString(36); };
const pushOnHere=()=>!!(myDevices&&myDevices.tokens&&myDevices.tokens[lsGet('rs.pushHash','')]);

SCREENS.notify={
  title:()=>({h:'Notifications',s:'Choose what you get, on this device'}),
  html(){
    const vk=S.settings.vapidKey, prefs=(myDevices&&myDevices.prefs)||{}, devs=Object.entries((myDevices&&myDevices.tokens)||{});
    const ios=SYNC.isIOS();
    return `<div class="card"><h3>🔔 This ${esc(deviceLabel())}</h3>
        ${!vk?`<p class="note">${role()==='owner'?'Notifications need the web push key from Firebase first (below).':'An owner needs to finish setting up notifications first.'}</p>`
        :ios&&!isStandalone()?'<p>On the iPad, notifications only work from the Home Screen app. Open Rata &amp; Smudge from its Home Screen icon, then come back here.</p>'
        :pushOnHere()?'<p>✓ Notifications are on for this device.</p><div class="mact" style="justify-content:flex-start"><button class="btn alt" id="nTest">Send a test</button><button class="btn alt" id="nOff">Turn off on this device</button></div>'
        :'<div class="mact" style="justify-content:flex-start;margin-top:0"><button class="btn big" id="nOn">🔔 Turn on notifications</button></div>'}
        ${devs.length?`<p class="note">On: ${devs.map(([,d])=>esc(d.label||'device')).join(', ')}</p>`:''}</div>
      <div class="card"><h3>What you get</h3>${NOTE_KINDS().map(([k,t,d])=>`<div class="row"><div class="grow"><b>${t}</b><small>${d}</small></div><div class="seg"><button data-np="${k}:1" class="${prefs[k]!==false?'on':''}">On</button><button data-np="${k}:0" class="${prefs[k]===false?'on':''}">Off</button></div></div>`).join('')}</div>
      ${role()==='owner'?`<div class="card"><h3>Setting up (owners, once)</h3><p class="note">Firebase console → ⚙️ Project settings → Cloud Messaging → Web configuration → Web Push certificates → Generate key pair. Copy the key and paste it here.</p>
        <label class="note" for="nVk">Web push key</label><input class="txt" id="nVk" autocapitalize="none" value="${esc(vk||'')}" placeholder="B…">
        <p class="note">The business helper also needs permission to send (see the setup steps), and the latest helper code.</p></div>`:''}`;
  },
  wire(){
    if(!myDevices) SYNC.getMyDevices().then(d=>{ myDevices=d||{tokens:{},prefs:{}}; if(cur()==='notify') render(); }).catch(()=>{ myDevices={tokens:{},prefs:{}}; });
    const on=$('#nOn'); if(on) on.onclick=()=>turnOnPush().then(ok=>{ if(ok){ toast('Notifications on'); render(); } });
    const off=$('#nOff'); if(off) off.onclick=async()=>{ const h=lsGet('rs.pushHash',''); if(myDevices.tokens) delete myDevices.tokens[h]; await SYNC.saveMyDevices(myDevices); lsSet('rs.pushHash',''); render(); toast('Off on this device'); };
    const t=$('#nTest'); if(t) t.onclick=async()=>{ myDevices.test=Date.now(); await SYNC.saveMyDevices(myDevices); toast('A test will arrive within 5 minutes'); };
    document.querySelectorAll('[data-np]').forEach(b=>b.onclick=async()=>{ const [k,v]=b.dataset.np.split(':'); myDevices=myDevices||{tokens:{},prefs:{}}; myDevices.prefs=Object.assign({},myDevices.prefs,{[k]:v==='1'}); render(); try{ await SYNC.saveMyDevices(myDevices); }catch(e){ toast('Couldn\'t save. Try again when online.'); } });
    const vk=$('#nVk'); if(vk) vk.onchange=()=>{ const v=vk.value.trim(); if(v&&!/^[A-Za-z0-9_-]{80,100}$/.test(v)){ toast('That doesn\'t look like the web push key'); vk.value=S.settings.vapidKey||''; return; } S.settings.vapidKey=v; save(); render(); toast('Saved'); };
  }
};
const swReady=()=>Promise.race([navigator.serviceWorker?navigator.serviceWorker.ready:Promise.resolve(undefined),new Promise(r=>setTimeout(()=>r(undefined),4000))]);
async function turnOnPush(){
  try{
    if(!(await SYNC.pushSupported())){ toast(SYNC.isIOS()?'Open the app from its Home Screen icon first':'Notifications aren\'t supported in this browser'); return false; }
    const perm=await Notification.requestPermission(); if(perm!=='granted'){ toast('Notifications were blocked. Allow them in the device settings for this app.'); return false; }
    const reg=await swReady(), token=await SYNC.pushToken(S.settings.vapidKey,reg), hash=hashStr(token);
    myDevices=myDevices||await SYNC.getMyDevices();
    const old=lsGet('rs.pushHash',''); myDevices.tokens=Object.assign({},myDevices.tokens); if(old&&old!==hash) delete myDevices.tokens[old];
    myDevices.tokens[hash]={token,label:deviceLabel(),at:Date.now()}; myDevices.prefs=myDevices.prefs||{};
    await SYNC.saveMyDevices(myDevices); lsSet('rs.pushHash',hash); return true;
  }catch(e){ console.error(e); toast('Couldn\'t turn on notifications: '+(e.message||e)); return false; }
}
// keep this device's address up to date (they change now and then)
async function refreshPush(){
  try{ const old=lsGet('rs.pushHash',''); if(!old||!S.settings.vapidKey||Notification.permission!=='granted') return;
    const reg=await swReady(), token=await SYNC.pushToken(S.settings.vapidKey,reg), hash=hashStr(token); if(hash===old) return;
    myDevices=await SYNC.getMyDevices(); const d=(myDevices.tokens||{})[old]||{label:deviceLabel()}; delete myDevices.tokens[old]; myDevices.tokens[hash]=Object.assign({},d,{token,at:Date.now()});
    await SYNC.saveMyDevices(myDevices); lsSet('rs.pushHash',hash); }catch(e){}
}
