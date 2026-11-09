/* Prowell order watcher: sound, stop refresh, open View, then let the
 * shared acceptance script instantly scroll the selected order details.
 * Take it and confirmations require an explicit per-session opt-in.
 */
(() => {
  'use strict';
  if(window!==window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin))return;
  if(window.__prowellViewOnlyV057)return;
  window.__prowellViewOnlyV057=true;

  const VERSION='0.5.14',TAB_MESSAGE='PROWELL_TAB_ID';
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
    window.__prowellOrderDetected=true; // cancel refresh in this tab immediately

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
    const message='Order #'+first.id+' ('+first.type+') detected; View + automatic instant scrolling. '+
      'Further acceptance steps depend on the opt-in setting.';
    const entry=new Date().toLocaleTimeString()+' '+message;
    state.armed=false;
    const updated={
      armed:false,targetTabId:null,claim:null,
      refreshStatus:'Stopped — detected order #'+first.id,
      lastResult:message,
      log:[...(state.log||[]),entry].slice(-30)
    };
    try{
      // Acceptance consent was loaded when monitoring began. Do not run a
      // separate storage read and three sequential writes before View.
      const accepts=first.type==='available' && state.autoAcceptEnabled===true;
      const now=Date.now();
      const nextFlow={
        enabled:true,mode:accepts?'accept':'scroll-only',
        orderId:String(first.id),tabId,startedAt:now,listUrl:location.href,
        stage:'await-view',stageStartedAt:now
      };
      // ONE atomic transition: disable refresh, save navigation handoff, and
      // consume single-order consent before opening the site's View control.
      // No timers, polling pauses, or gradual scrolling are introduced.
      await chrome.storage.local.set({
        ...updated,autoFlow:nextFlow,
        ...(accepts?{autoAcceptEnabled:false}:{})
      });
      if(!first.view.isConnected)throw Error('View button disappeared');
      first.view.click();

    }catch(error){
      try{
        await chrome.storage.local.set({
          armed:false,targetTabId:null,
          lastResult:'Stopped; could not open View: '+String(error?.message||error)
        });
      }catch(_){}
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
