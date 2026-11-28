'use strict';
// Standalone v2.1.29.1: directly embedded 4Writers sound + tab/background
// handlers, no Good-Writers monitoring, imports, or host permissions.
/* Dedicated order notification sound. Imported by background.js.
 * Never changes refreshing, clicks, or claim state.
 */
'use strict';
const OFFICIAL_ORDER_SOUND_DOMAIN=/^https:\/\/(?:www\.)?4writers\.net\//i;
const ORDER_SOUND_SEEN='prowellOrderSoundHistory';
// Do not serialize independent order alerts: both platforms can detect in
// the same moment, and every newly detected order must request its own chime.
const pendingSounds=new Set();
let offscreenCreating=null;
// Suppress rapid duplicate DOM events, not later monitoring sessions.
const SOUND_COOLDOWN_MS=1200;

async function ensureOrderSoundDocument(){
  if(!chrome.offscreen)throw Error('Offscreen audio unsupported by this Chrome version.');
  if(await chrome.offscreen.hasDocument())return;
  if(!offscreenCreating){
    offscreenCreating=chrome.offscreen.createDocument({
      url:'order-sound.html',
      reasons:['AUDIO_PLAYBACK'],
      justification:'Play a short audible notification when an available or processing order appears.'
    }).finally(()=>{offscreenCreating=null;});
  }
  await offscreenCreating;
}
async function playOrderSound(kind){
  await ensureOrderSoundDocument();
  const request={
    type:'PROWELL_PLAY_ORDER_SOUND',
    target:'prowell-offscreen-audio',kind
  };
  // A newly opened offscreen document may need a moment to register its
  // message listener. Retry once if the first attempt cannot play.
  try{
    const result=await chrome.runtime.sendMessage(request);
    if(result?.ok===true)return result;
  }catch(_){}
  await new Promise(resolve=>setTimeout(resolve,160));
  return chrome.runtime.sendMessage(request);
}
async function notifyOrderOnce(orderId,kind,runId){
  // An explicit START generates a fresh run ID, so the same processing order
  // can alert again immediately when the owner restarts the bot.
  const key=runId+':'+kind+':'+orderId,now=Date.now();
  const stored=await chrome.storage.session.get(ORDER_SOUND_SEEN);
  const history=(stored[ORDER_SOUND_SEEN]&&typeof stored[ORDER_SOUND_SEEN]==='object')
    ?stored[ORDER_SOUND_SEEN]:{};
  if(Number(history[key])>now-SOUND_COOLDOWN_MS)return false;
  const recent=Object.fromEntries(Object.entries(history)
    .filter(([,at])=>Number(at)>now-SOUND_COOLDOWN_MS).slice(-180));
  try{
    const result=await playOrderSound(kind);
    if(result?.ok!==true)return false;
    recent[key]=now;
    await chrome.storage.session.set({[ORDER_SOUND_SEEN]:recent});
    return true;
  }catch(error){
    // Sound failures must NEVER interrupt or delay the separate claim process.
    console.warn('Prowell order sound unavailable:',String(error?.message||error));
    return false;
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='PROWELL_ORDER_SOUND'){
    const id=String(message.orderId||'').trim();
    const kind=message.kind;
    const runId=String(message.soundRunId||'');
    const source=String(sender.url||sender.tab?.url||'');
    // Trust only official order pages. Test events are handled separately.
    if(!/^\d{5,16}$/.test(id) || !['available','processing'].includes(kind) ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(runId) ||
        !OFFICIAL_ORDER_SOUND_DOMAIN.test(source) || !sender.tab){
      respond({ok:false});return;
    }
    const alertKey=runId+':'+kind+':'+id;
    if(pendingSounds.has(alertKey)){
      respond({ok:true,played:false,duplicate:true});return;
    }
    pendingSounds.add(alertKey);
    // Launch sound playback immediately without queuing behind another order.
    // View/scroll/taking never awaits or depends on sound playback.
    void notifyOrderOnce(id,kind,runId)
      .then(played=>respond({ok:true,played}))
      .catch(error=>{
        console.warn('Prowell order sound:',String(error?.message||error));
        respond({ok:false,played:false});
      }).finally(()=>pendingSounds.delete(alertKey));
    return true;
  }
  if(message?.type==='PROWELL_PREPARE_ORDER_SOUND'){
    // Prepare the Chrome offscreen audio document when START is pressed, so
    // the first real order can chime without waiting for cold initialization.
    const source=String(sender.url||'');
    if(!source.startsWith(chrome.runtime.getURL(''))){respond({ok:false});return;}
    void ensureOrderSoundDocument()
      .then(()=>respond({ok:true}))
      .catch(error=>respond({ok:false,reason:String(error?.message||error)}));
    return true;
  }
  if(message?.type==='PROWELL_TEST_ORDER_SOUND'){
    const source=String(sender.url||'');
    if(!source.startsWith(chrome.runtime.getURL(''))){
      respond({ok:false});return;
    }
    playOrderSound('available')
      .then(result=>respond({ok:result?.ok===true}))
      .catch(error=>respond({ok:false,reason:String(error?.message||error)}));
    return true;
  }
});

/* Original four background module executed through the dual extension's
 * separate Chrome storage namespace. Embedded original is unmodified.
 */
(() => {
  // Resolve the actual Chrome API explicitly: the `const chrome`
  // below shadows the global name and must not be accessed before init.
  const rawChrome=globalThis.chrome;
  const storagePrefix='four_v129_';
  const scopedLocal={
    get(request,callback){
      const object=Boolean(request&&!Array.isArray(request)&&typeof request==='object');
      const keys=Array.isArray(request)?request:object?Object.keys(request):
        typeof request==='string'?[request]:[];
      const work=rawChrome.storage.local.get(keys.map(k=>storagePrefix+k)).then(result=>{
        const values={};
        for(const k of keys){
          const qualified=storagePrefix+k;
          if(Object.prototype.hasOwnProperty.call(result,qualified))
            values[k]=result[qualified];
          else if(object)values[k]=request[k];
        }
        return values;
      });
      if(typeof callback==='function'){void work.then(callback);return;}
      return work;
    },
    set(patch,callback){
      const next=Object.fromEntries(Object.entries(patch)
        .map(([k,v])=>[storagePrefix+k,v]));
      const work=rawChrome.storage.local.set(next);
      if(typeof callback==='function'){void work.then(()=>callback());return;}
      return work;
    },
    remove(names,callback){
      const keys=(Array.isArray(names)?names:[names]).map(k=>storagePrefix+k);
      const work=rawChrome.storage.local.remove(keys);
      if(typeof callback==='function'){void work.then(()=>callback());return;}
      return work;
    }
  };
  const chrome={runtime:rawChrome.runtime,tabs:rawChrome.tabs,
    storage:{local:scopedLocal}};
'use strict';
// Identify the current frame's tab without reading account credentials.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message && message.type === 'PROWELL_TAB_ID') reply({tabId: sender.tab ? sender.tab.id : null});
});
// Some official View links open a separate tab; continue monitoring it.
chrome.tabs.onCreated.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;
  chrome.storage.local.get(['armed', 'claimConsentVersion', 'targetTabId'], state => {
    if (!state.armed || state.claimConsentVersion !== '0.5.4' || state.targetTabId !== tab.openerTabId) return;
    const newTab = tab.id;
    const listener = (id, info, current) => {
      if (id !== newTab) return;
      const url = (current && current.url) || info.url || '';
      if (/^https:\/\/(?:www\.)?4writers\.net\//i.test(url)) {
        chrome.storage.local.set({targetTabId: id, status: 'Following official order tab'});
        chrome.tabs.onUpdated.removeListener(listener);
      } else if (/^https?:\/\//i.test(url)) chrome.tabs.onUpdated.removeListener(listener);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
});

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(msg?.type!=='PROWELL_CLAIM_REPORT')return;
 const p=msg.payload||{};
 chrome.storage.local.get(['reportCode'],async state=>{
   if(!state.reportCode){reply({ok:false,reason:'Dashboard pairing code not configured'});return;}
   try{
    const response=await fetch('https://prowelljobs.com/api/extension/claim-report',{
      method:'POST',
      headers:{'Authorization':'Bearer '+state.reportCode,'Content-Type':'application/json'},
      body:JSON.stringify(p)
    });
    reply({ok:response.ok,status:response.status});
   }catch(err){reply({ok:false,reason:'Network unavailable'});}
 });
 return true;
});
})();

