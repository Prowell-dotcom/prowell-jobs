/* Prowell order watcher: sound, stop refresh, open View, then let the
 * shared acceptance script instantly scroll the selected order details.
 * Take it and confirmations require an explicit per-session opt-in.
 */
(() => {
  'use strict';
  if(window!==window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin))return;
  if(window.__prowellWatcherV515)return;
  window.__prowellWatcherV515=true;

  const VERSION='0.5.15',TAB_MESSAGE='PROWELL_TAB_ID';
  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    soundRunId:'',claim:null,lastResult:'Ready',log:[],autoAcceptEnabled:false,
    autoFlow:null,seenOrderIds:[]};
  let state={...DEFAULTS},tabId=null,opening=false,queued=false,sawFlow=false;
  // Preserve the monitoring session while one order is being viewed.
  // Pause further detection while that order panel is still on screen.
  function detailsOpen(){
    const surfaces=document.querySelectorAll?.(
      '[role="dialog"],dialog,[aria-modal="true"],.modal,.popup,[class*="drawer"]')||[];
    for(const el of surfaces){
      if(el.getClientRects?.().length &&
         /order\s*(?:information|details|requirements|instructions)|take it/i.test(
           String(el.innerText||el.textContent||'')))return true;
    }
    const text=String(document.body?.innerText||'');
    return /order\s*(?:information|details|requirements|instructions)/i.test(text) &&
      [...(document.querySelectorAll?.(
        'button,a,input[type="button"],input[type="submit"],[role="button"]')||[])]
        .some(el=>/^take it$/i.test(String(el.innerText||el.textContent||el.value||'').trim()) &&
          Boolean(el.getClientRects?.().length));
  }
  const flowActive=()=>Boolean(state.autoFlow?.enabled &&
    Date.now()-Number(state.autoFlow.startedAt||0)<90000);
  const active=()=>Boolean(state.armed && state.claimConsentVersion===VERSION &&
    tabId!==null && tabId===state.targetTabId);
  const challenge=()=>/captcha|verify you are human|unusual activity/i.test(
    document.body?.innerText||'')||Boolean(document.querySelector(
    'iframe[src*="captcha"],[class*="g-recaptcha"]'));

  async function detect(){
    if(!active() || opening || flowActive() || detailsOpen() || !document.body || challenge())return;
    const cards=window.__prowellCardDetector?.cards()||[];
    // The first eligible card in page order, regardless of whether it is
    // a new order or a previously assigned processing order.
    const seen=new Set((state.seenOrderIds||[]).map(String));
    const first=cards.find(card=>['available','processing'].includes(card?.type) &&
      !seen.has(String(card.id||'')) &&
      /^\d{5,16}$/.test(String(card.id||'')) &&
      card.view?.isConnected && typeof card.view.click==='function');
    if(!first)return;
    opening=true; // synchronous: prevent all subsequent observer triggers
    window.__prowellCancelRefresh?.(); // stop reload in this same event-loop turn

    // Request the notification sound immediately and independently of View. The background audio
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
    const message='Order #'+first.id+' ('+first.type+') detected; paused refresh and opened View.'+
      (accepts?' Auto acceptance enabled.':' Instant details scroll only.');
    const entry=new Date().toLocaleTimeString()+' '+message;
    // Synchronous, same-task cancellation. Never wait for storage to stop refresh.
    // Keep START and the optional consent active for future orders until STOP.
    // This order is marked seen before View, preventing an endless re-open loop.
    state.seenOrderIds=[...seen,String(first.id)].slice(-150);
    const flow={
      enabled:true,mode:accepts?'accept':'scroll-only',orderId:String(first.id),
      tabId,startedAt:Date.now(),listUrl:location.href,
      stage:'await-view',stageStartedAt:Date.now()
    };
    // Cancel refresh first, then initiate the single persistence write.
    // Click View immediately; do not wait for storage to finish.
    // The acceptance script observes later storage changes if navigation wins.
    try{
      const saving=chrome.storage.local.set({
        autoFlow:flow,seenOrderIds:state.seenOrderIds,
        refreshStatus:'Paused — handling order #'+first.id,
        lastResult:message,log:[...(state.log||[]),entry].slice(-30)
      });
      if(!first.view.isConnected)throw Error('View disappeared before it could be clicked');
      first.view.click();
      await saving;
    }catch(error){
      await chrome.storage.local.set({
        autoFlow:null,
        lastResult:'Could not open View: '+String(error?.message||error)
      }).catch(()=>{});
    }
  }
  function schedule(){
    // Release the single-order handoff after its details close, without
    // requiring another START click. No duplicate trigger for the seen ID.
    if(opening && sawFlow && !flowActive() && !detailsOpen()){
      opening=false;sawFlow=false;
    }
    if(!active()||opening||flowActive()||detailsOpen()||queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;void detect().catch(()=>{});});
  }
  chrome.storage.onChanged.addListener((changed,area)=>{
    if(area!=='local')return;
    for(const key of Object.keys(changed)){
      if(Object.prototype.hasOwnProperty.call(DEFAULTS,key))
        state[key]=changed[key].newValue;
    }
    if(changed.autoFlow?.newValue?.enabled)sawFlow=true;
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
