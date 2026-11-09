/* Prowell order watcher: sound, stop refresh, open View, then let the
 * shared acceptance script instantly scroll the selected order details.
 * Take it and confirmations require an explicit per-session opt-in.
 */
(() => {
  'use strict';
  if(window!==window.top || !/^https:\/\/(?:www\.)?(?:4writers\.net|good-writers\.com)$/i.test(location.origin))return;
  if(window.__prowellDualWatcherV205)return;
  window.__prowellDualWatcherV205=true;

  const VERSION='2.0.5';
  const IS_FOUR=/(?:^|\.)4writers\.net$/i.test(location.hostname);
  const TAB_MESSAGE=IS_FOUR?'PROWELL_TAB_ID':'GW_TAB_ID';
  const store=window.__prowellDualStorage;
  if(!store)return;
  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    soundRunId:'',claim:null,lastResult:'Ready',log:[],autoAcceptEnabled:false,
    autoFlow:null,seenOrderIds:[]};
  let state={...DEFAULTS},tabId=null,opening=false,queued=false;
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
    // Same-page processing details have no Take it. Keep the watcher paused
    // until their selected order-details panel closes.
    for(const panel of document.querySelectorAll?.(
      '.order-info,.order-details,[class*="order-info"],[class*="order-detail"]')||[]){
      if(panel.getClientRects?.().length &&
        /order\s*(?:information|details|requirements|instructions)/i.test(
          String(panel.innerText||panel.textContent||'')) &&
        /(?:\border\s*(?:id|#)|\bid\s*[:#])\s*\d{5,16}/i.test(
          String(panel.innerText||panel.textContent||'')))return true;
    }
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
    // Processing: Files + Messages + View. Available: Files + View.
    // The detector verifies these card controls; never mistake an existing
    // processing order for a new order that could be accepted again.
    const first=cards.find(card=>['available','processing'].includes(card?.type) &&
      !seen.has(String(card.id||'')) &&
      /^\d{5,16}$/.test(String(card.id||'')) &&
      card.view?.isConnected && typeof card.view.click==='function');
    if(!first)return;
    opening=true; // synchronous: prevent all subsequent observer triggers
    // Stop this monitoring session immediately. Only a fresh owner START may
    // arm it again; finishing the selected order must never restart refresh.
    state.armed=false;
    state.targetTabId=null;
    window.__prowellCancelRefresh?.(); // cancel the live refresh timer now

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
    const processing=first.type==='processing';
    const accepts=!processing && state.autoAcceptEnabled===true;
    const message='Order #'+first.id+' ('+first.type+') detected; monitoring stopped until START is pressed again; opened View.'+
      (processing?' Processing-order scroll test; Take it is not expected.':
       accepts?' Full automatic acceptance enabled.':' Preview-only scrolling.');
    const entry=new Date().toLocaleTimeString()+' '+message;
    // Synchronous, same-task cancellation. Never wait for storage to stop refresh.
    // Keep the selected order flow active, but leave watching OFF. Its
    // acceptance permission is captured in flow.mode before stopping.
    // Remember this ID to avoid duplicate View/sound actions.
    state.seenOrderIds=[...seen,String(first.id)].slice(-150);
    const flow={
      enabled:true,mode:processing?'processing-preview':accepts?'accept':'scroll-only',
      orderKind:first.type,orderId:String(first.id),
      tabId,startedAt:Date.now(),listUrl:location.href,
      stage:'await-view',stageStartedAt:Date.now()
    };
    // Cancel refresh first, then initiate the single persistence write.
    // Click View immediately; do not wait for storage to finish.
    // The acceptance script observes later storage changes if navigation wins.
    try{
      const saving=store.local.set({
        armed:false,targetTabId:null,autoFlow:flow,seenOrderIds:state.seenOrderIds,
        refreshStatus:'Stopped after order #'+first.id+' — press START to monitor again',
        lastResult:message,log:[...(state.log||[]),entry].slice(-30)
      });
      if(!first.view.isConnected)throw Error('View disappeared before it could be clicked');
      first.view.click();
      await saving;
    }catch(error){
      await store.local.set({
        autoFlow:null,
        lastResult:'Could not open View: '+String(error?.message||error)
      }).catch(()=>{});
    }
  }
  function schedule(){
    // This is a one-shot START session. Never re-arm after View, scrolling,
    // confirmations, storage changes or closing the order details.
    if(!active()||opening||flowActive()||detailsOpen()||queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;void detect().catch(()=>{});});
  }
  store.onChanged.addListener((changed,area)=>{
    if(area!=='local')return;
    for(const key of Object.keys(changed)){
      if(Object.prototype.hasOwnProperty.call(DEFAULTS,key))
        state[key]=changed[key].newValue;
    }
    // Pressing START begins an entirely new one-shot session. Without this
    // reset, the same page's prior View handoff would block a new START.
    if(changed.armed?.newValue===true)opening=false;
    schedule();
  });
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type==='PROWELL_SCAN_NOW'){schedule();respond({ok:true});}
  });
  chrome.runtime.sendMessage({type:TAB_MESSAGE},async reply=>{
    tabId=reply?.tabId??null;
    state={...DEFAULTS,...await store.local.get(DEFAULTS)};
    schedule();
  });
  new MutationObserver(schedule).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();
