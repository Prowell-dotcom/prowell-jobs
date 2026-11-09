/* Prowell order watcher: sound, stop refresh, open View, then let the
 * shared acceptance script instantly scroll the selected order details.
 * Take it and confirmations require an explicit per-session opt-in.
 */
(() => {
  'use strict';
  if(window!==window.top || !/^https:\/\/(?:www\.)?good-writers\.com$/i.test(location.origin))return;
  if(window.__prowellWatcherV1014)return;
  window.__prowellWatcherV1014=true;

  const VERSION='1.0.14',TAB_MESSAGE='GW_TAB_ID';
  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    soundRunId:'',claim:null,lastResult:'Ready',log:[],autoAcceptEnabled:false};
  let state={...DEFAULTS},tabId=null,opening=false,queued=false;
  const active=()=>Boolean(state.armed && state.claimConsentVersion===VERSION &&
    tabId!==null && tabId===state.targetTabId);
  const challenge=()=>/captcha|verify you are human|unusual activity/i.test(
    document.body?.innerText||'')||Boolean(document.querySelector(
    'iframe[src*="captcha"],[class*="g-recaptcha"]'));

  async function detect(){
    if(!active() || opening || !document.body || challenge())return;
    const cards=window.__prowellCardDetector?.cards()||[];
    // The first eligible card in page order, regardless of whether it is
    // a new order or a previously assigned processing order.
    const first=cards.find(card=>['available','processing'].includes(card?.type) &&
      /^\d{5,16}$/.test(String(card.id||'')) &&
      card.view?.isConnected && typeof card.view.click==='function');
    if(!first)return;
    opening=true; // synchronous: prevent all subsequent observer triggers

    // Start the sound before stopping the watcher. The background audio
    // handler stays active after the local armed state is cleared.
    if(state.soundRunId){
      try{
        chrome.runtime.sendMessage({
          type:'PROWELL_ORDER_SOUND',orderId:String(first.id),
          kind:first.type,soundRunId:state.soundRunId
        },()=>void chrome.runtime.lastError);
      }catch(_){}
    }
    const accepts=first.type==='available' && state.autoAcceptEnabled===true;
    const message='Order #'+first.id+' ('+first.type+') detected; stopped refresh and opened View.'+
      (accepts?' Auto acceptance enabled.':' Instant details scroll only.');
    const entry=new Date().toLocaleTimeString()+' '+message;
    // Synchronous, same-task cancellation. Never wait for storage to stop refresh.
    state.armed=false;
    state.autoAcceptEnabled=false;
    window.__prowellCancelRefresh?.();
    const flow={
      enabled:true,mode:accepts?'accept':'scroll-only',orderId:String(first.id),
      tabId,startedAt:Date.now(),listUrl:location.href,
      stage:'await-view',stageStartedAt:Date.now()
    };
    // Exactly one atomic storage write protects navigation and new-tab handoff.
    // There is no arbitrary wait before View; storage must persist before unload.
    try{
      await chrome.storage.local.set({
        armed:false,targetTabId:null,claim:null,autoAcceptEnabled:false,
        autoFlow:flow,refreshStatus:'Stopped — detected order #'+first.id,
        lastResult:message,log:[...(state.log||[]),entry].slice(-30)
      });
      if(!first.view.isConnected)throw Error('View disappeared before it could be clicked');
      first.view.click();
    }catch(error){
      await chrome.storage.local.set({
        armed:false,targetTabId:null,autoFlow:null,
        lastResult:'Stopped; could not open View: '+String(error?.message||error)
      }).catch(()=>{});
    }
  }
  function schedule(){
    if(!active()||opening||queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;void detect().catch(()=>{});});
  }
  chrome.storage.onChanged.addListener((changed,area)=>{
    if(area!=='local')return;
    for(const key of Object.keys(changed)){
      if(Object.prototype.hasOwnProperty.call(DEFAULTS,key))
        state[key]=changed[key].newValue;
    }
    schedule();
  });
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type==='PROWELL_SCAN_NOW'){schedule();respond({ok:true});}
  });
  chrome.runtime.sendMessage({type:TAB_MESSAGE},async reply=>{
    tabId=reply?.tabId??null;
    state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
    schedule();
  });
  new MutationObserver(schedule).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();
