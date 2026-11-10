/* Audible notification sidecar for BOTH unchanged legacy order engines.
 * Does not click, scroll, cancel timers or modify any order workflow.
 */
(() => {
  'use strict';
  const host=location.hostname.toLowerCase();
  const isFour=/^(?:www\.)?4writers\.net$/.test(host);
  const isGood=/^(?:www\.)?good-writers\.com$/.test(host);
  if((!isFour&&!isGood)||window!==window.top)return;
  if(window.__prowellDualLegacyNotification)return;
  window.__prowellDualLegacyNotification=true;
  const store=window.__prowellDualStorage;
  if(!store)return;
  const version=isFour?'0.5.4':'1.0.4';
  const tabMessage=isFour?'PROWELL_TAB_ID':'GW_TAB_ID';
  let tabId=null,settings={},queued=false,runKey='',seen=new Set();
  const active=()=>settings.armed===true &&
    settings.claimConsentVersion===version &&
    Number.isInteger(tabId)&&settings.targetTabId===tabId &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      String(settings.soundRunId||''));
  function scan(){
    if(!active()||!document.body)return;
    const cards=window.__prowellCardDetector?.cards?.()||[];
    // Only remember IDs still present in this page's current order list.
    // A returning ID after disappearing can alert again, even without a
    // manual START. A new page load also begins with an empty seen set.
    const present=new Set(cards.map(c=>String(c?.type||'')+':'+String(c?.id||'')));
    for(const key of seen)if(!present.has(key))seen.delete(key);
    // Both available and processing appearances can trigger the sound.
    // Avoid repeated sound while an unchanged card stays on screen.
    for(const card of cards){
      if(!['available','processing'].includes(card?.type) ||
          !/^\d{5,16}$/.test(String(card.id||'')))continue;
      const key=card.type+':'+String(card.id);
      if(seen.has(key))continue;
      seen.add(key);
      try{
        chrome.runtime.sendMessage({
          type:'PROWELL_ORDER_SOUND',
          orderId:String(card.id),kind:card.type,
          soundRunId:settings.soundRunId
        },()=>void chrome.runtime.lastError);
      }catch(_){}
      // The legacy bot handles this row independently; no other action here.
      // Limit to the first unseen order per turn to avoid a wall of chimes.
      break;
    }
  }
  function schedule(){
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;scan();});
  }
  store.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    for(const name of ['armed','claimConsentVersion','targetTabId','soundRunId'])
      if(changes[name])settings[name]=changes[name].newValue;
    if(changes.soundRunId && settings.soundRunId!==runKey){
      runKey=settings.soundRunId;seen=new Set();
    }
    schedule();
  });
  chrome.runtime.sendMessage({type:tabMessage},async result=>{
    tabId=result?.tabId??null;
    settings=await store.local.get({
      armed:false,claimConsentVersion:'',targetTabId:null,soundRunId:''
    });
    runKey=settings.soundRunId||'';
    schedule();
  });
  new MutationObserver(schedule).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();
