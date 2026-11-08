/* Independent order-detection alert observer.
 * This script does not click, scroll, reload or change claim behavior.
 * The dedicated background worker plays the sound when order cards appear.
 */
(() => {
  'use strict';
  if(window!==window.top || window.__prowellOrderSoundWatcher)return;
  window.__prowellOrderSoundWatcher=true;
  let armed=false,targetTabId=null,thisTabId=null;
  let consentVersion='',soundRunId='';
  const notifiedThisPage=new Set();
  const VERSION='1.0.7';
  const TAB_MESSAGE='GW_TAB_ID';
  function active(){
    return armed && consentVersion===VERSION && soundRunId &&
      thisTabId!==null && targetTabId===thisTabId;
  }
  function notify(){
    if(!active())return;
    const detector=window.__prowellCardDetector;
    if(!detector)return;
    const cards=detector.cards();
    const currentlyVisible=new Set(cards.filter(c=>c && ['available','processing'].includes(c.type))
      .map(c=>c.type+':'+c.id));
    // Reappearance on the same page is a new event. Do not treat an order
    // that disappeared and returned as permanently seen.
    for(const seen of notifiedThisPage){
      if(!currentlyVisible.has(seen))notifiedThisPage.delete(seen);
    }
    for(const card of cards){
      if(!card || !['available','processing'].includes(card.type) ||
         !/^\d{5,16}$/.test(String(card.id||'')))continue;
      const key=card.type+':'+card.id;
      if(notifiedThisPage.has(key))continue;
      notifiedThisPage.add(key);
      // Fire-and-forget. The browser service worker handles repeated sightings
      // across refreshes; do not wait or block the existing claim click path.
      try{
        chrome.runtime.sendMessage({
          type:'PROWELL_ORDER_SOUND',orderId:String(card.id),kind:card.type,soundRunId
        },()=>{void chrome.runtime.lastError;});
      }catch(_){}
    }
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.armed)armed=Boolean(changes.armed.newValue);
    if(changes.targetTabId)targetTabId=changes.targetTabId.newValue;
    if(changes.claimConsentVersion)consentVersion=changes.claimConsentVersion.newValue;
    if(changes.soundRunId && changes.soundRunId.newValue!==soundRunId){
      soundRunId=changes.soundRunId.newValue||'';
      notifiedThisPage.clear();
    }
    if(changes.armed||changes.targetTabId||changes.claimConsentVersion||changes.soundRunId)notify();
  });
  chrome.runtime.sendMessage({type:TAB_MESSAGE},async response=>{
    thisTabId=response?.tabId??null;
    const state=await chrome.storage.local.get(['armed','targetTabId','claimConsentVersion','soundRunId']);
    armed=Boolean(state.armed);
    targetTabId=state.targetTabId??null;
    consentVersion=state.claimConsentVersion||'';
    soundRunId=state.soundRunId||'';
    notify();
  });
  const observer=new MutationObserver(notify);
  observer.observe(document,{subtree:true,childList:true,characterData:true});
  document.addEventListener('DOMContentLoaded',notify,{once:true});
})();
