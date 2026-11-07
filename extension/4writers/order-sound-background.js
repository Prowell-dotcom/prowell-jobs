/* Dedicated order notification sound. Imported by background.js.
 * Never changes refreshing, clicks, or claim state.
 */
'use strict';
const OFFICIAL_ORDER_SOUND_DOMAIN=/^https:\/\/(?:www\.)?4writers\.net\//i;
const ORDER_SOUND_SEEN='prowellOrderSoundHistory';
let orderSoundQueue=Promise.resolve();
let offscreenCreating=null;
const SOUND_COOLDOWN_MS=12*60*60*1000;

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
  return chrome.runtime.sendMessage({
    type:'PROWELL_PLAY_ORDER_SOUND',
    target:'prowell-offscreen-audio',
    kind
  });
}
async function notifyOrderOnce(orderId,kind){
  const key=kind+':'+orderId,now=Date.now();
  const stored=await chrome.storage.session.get(ORDER_SOUND_SEEN);
  const history=(stored[ORDER_SOUND_SEEN]&&typeof stored[ORDER_SOUND_SEEN]==='object')
    ?stored[ORDER_SOUND_SEEN]:{};
  if(Number(history[key])>now-SOUND_COOLDOWN_MS)return false;
  const recent=Object.fromEntries(Object.entries(history)
    .filter(([,at])=>Number(at)>now-SOUND_COOLDOWN_MS).slice(-180));
  recent[key]=now;
  await chrome.storage.session.set({[ORDER_SOUND_SEEN]:recent});
  try{await playOrderSound(kind);}catch(error){
    // Sound failure must NEVER interrupt or delay the separate claim process.
    console.warn('Prowell order sound unavailable:',String(error?.message||error));
  }
  return true;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='PROWELL_ORDER_SOUND'){
    const id=String(message.orderId||'').trim();
    const kind=message.kind;
    const source=String(sender.url||sender.tab?.url||'');
    // Trust only official order pages. Test events are handled separately.
    if(!/^\d{5,16}$/.test(id) || !['available','processing'].includes(kind) ||
        !OFFICIAL_ORDER_SOUND_DOMAIN.test(source) || !sender.tab){
      respond({ok:false});return;
    }
    orderSoundQueue=orderSoundQueue.then(()=>notifyOrderOnce(id,kind)).catch(error=>{
      console.warn('Prowell order sound queue:',String(error?.message||error));
      return false;
    });
    orderSoundQueue.then(played=>respond({ok:true,played}));
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
