/* Prowell View-Only Order Watcher.
 * On the first detected available or processing order:
 *   1. Request an audible alert, 2. stop monitoring and refreshing,
 *   3. click that order's View button, 4. do absolutely nothing else.
 * The user alone scrolls, examines, accepts, and acknowledges orders.
 * This file must not contain automated Take it, OK, or consent actions.
 */
(() => {
  'use strict';
  if(window!==window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin))return;
  if(window.__prowellViewOnlyV057)return;
  window.__prowellViewOnlyV057=true;

  const VERSION='0.5.8',TAB_MESSAGE='PROWELL_TAB_ID';
  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    soundRunId:'',claim:null,lastResult:'Ready',log:[]};
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
    const message='Order #'+first.id+' ('+first.type+') detected: View only. '+
      'Monitoring stopped; scroll and take any further steps manually.';
    const entry=new Date().toLocaleTimeString()+' '+message;
    state.armed=false;
    const updated={
      armed:false,targetTabId:null,claim:null,
      refreshStatus:'Stopped — detected order #'+first.id,
      lastResult:message,
      log:[...(state.log||[]),entry].slice(-30)
    };
    try{
      // An explicit popup opt-in is required for each monitoring session.
      // Never auto-accept already-assigned processing orders.
      const config=await chrome.storage.local.get({autoAcceptEnabled:false});
      if(first.type==='available' && config.autoAcceptEnabled===true){
        await chrome.storage.local.set({autoFlow:{
          enabled:true,orderId:String(first.id),tabId,startedAt:Date.now(),stage:'take',
          stageStartedAt:Date.now()
        }});
      }
      // Persist STOP before the page can navigate. This is the only state
      // change, and it prevents refresh.js from rearming on the detail page.
      await chrome.storage.local.set(updated);
      // Do NOT scroll the list or the opened order-details page.
      // Do NOT click Take it, OK, I understand, or another order.
      if(first.view.isConnected)first.view.click();
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
