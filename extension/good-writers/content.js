/* Good-Writers standalone v1.0.17: sound, immediate STOP, View once.
 * Does not click Take it, OK or I understand; manual order acceptance.
 */
(() => {
  'use strict';
  if(window!==window.top||
    !/^https:\/\/(?:www\.)?good-writers\.com$/i.test(location.origin))return;
  if(window.__prowellGoodSoundViewStop1017)return;
  window.__prowellGoodSoundViewStop1017=true;

  const VERSION='1.0.17';
  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    soundRunId:'',claim:null,lastResult:'Ready',log:[],
    autoAcceptEnabled:false,autoFlow:null,seenOrderIds:[]};
  const WARNING=/captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i;
  let state={...DEFAULTS},tabId=null,stopping=false,scanning=false,
    rescanPending=false;
  const active=()=>state.armed===true&&state.claimConsentVersion===VERSION&&
    Number.isInteger(tabId)&&state.targetTabId===tabId;
  const warned=()=>WARNING.test(String(document.body?.innerText||''))||
    Boolean(document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  function stopNow(){
    // Synchronous cancellation prevents all subsequent scans and refreshes.
    stopping=true;
    state.armed=false;
    state.targetTabId=null;
    state.claim=null;
    state.autoFlow=null;
    state.autoAcceptEnabled=false;
    try{window.__prowellCancelRefresh?.();}catch(_){}
  }
  async function stopForWarning(){
    if(!active()||stopping)return;
    stopNow();
    try{
      await chrome.storage.local.set({armed:false,targetTabId:null,
        claim:null,autoFlow:null,autoAcceptEnabled:false,
        refreshStatus:'Stopped — security warning',
        lastResult:'Good-Writers: website security warning; STOP. Restart manually.'});
    }catch(error){
      console.warn('Good-Writers warning STOP failed:',String(error?.message||error));
    }
  }
  async function handle(card){
    if(!active()||stopping||!card.view?.isConnected||
       typeof card.view.click!=='function')return;
    stopNow();
    // Request sound in the same task as detecting the new order.
    try{
      if(state.soundRunId)chrome.runtime.sendMessage({
        type:'PROWELL_ORDER_SOUND',orderId:String(card.id),kind:card.type,
        soundRunId:String(state.soundRunId)
      },()=>void chrome.runtime.lastError);
    }catch(_){}
    const message='Good-Writers order #'+card.id+' ('+card.type+
      '): sound requested, STOP, View opened once.';
    try{
      // Persist STOP before a View click that could navigate away.
      await chrome.storage.local.set({
        armed:false,targetTabId:null,claim:null,autoFlow:null,
        autoAcceptEnabled:false,seenOrderIds:[String(card.id)],
        lastAlertOrderId:String(card.id),lastAlertKind:card.type,
        lastAlertAt:Date.now(),lastResult:message,
        refreshStatus:'Stopped — order detected',
        log:[...(state.log||[]),new Date().toLocaleTimeString()+' '+message].slice(-30)
      });
      if(warned())return;
      if(!card.view?.isConnected||typeof card.view.click!=='function'){
        await chrome.storage.local.set({lastResult:
          'Good-Writers order #'+card.id+': STOPPED; View unavailable, open manually.'});
        return;
      }
      card.view.click();
    }catch(error){
      console.warn('Good-Writers View failed:',String(error?.message||error));
      try{
        await chrome.storage.local.set({lastResult:
          'Good-Writers: STOPPED but View could not open: '+
          String(error?.message||error)+'. Open manually.'});
      }catch(_){}
    }
  }
  async function scan(){
    if(!active()||stopping||!document.body)return;
    if(warned())return stopForWarning();
    const card=(window.__prowellCardDetector?.cards?.()||[])
      .find(c=>['available','processing'].includes(c?.type)&&
        /^\d{5,16}$/.test(String(c.id||''))&&
        c.view?.isConnected&&typeof c.view.click==='function');
    if(card)await handle(card);
  }
  function schedule(){
    if(!active()||stopping)return;
    if(scanning){rescanPending=true;return;}
    scanning=true;
    void scan().catch(error=>{
      console.warn('Good-Writers scan failed:',String(error?.message||error));
    }).finally(()=>{
      scanning=false;
      // DOM changes while a scan ran must not be lost.
      if(rescanPending){rescanPending=false;schedule();}
    });
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    for(const name of Object.keys(DEFAULTS))
      if(changes[name])state[name]=changes[name].newValue;
    if(changes.armed?.newValue===true&&changes.armed?.oldValue!==true)
      stopping=false; // explicit manual START begins a fresh session
    schedule();
  });
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type==='PROWELL_SCAN_NOW'){
      schedule();reply({ok:true});
    }
  });
  chrome.runtime.sendMessage({type:'GW_TAB_ID'},async reply=>{
    tabId=reply?.tabId??null;
    try{state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};}
    catch(error){
      console.warn('Good-Writers state unavailable:',String(error?.message||error));
      return;
    }
    schedule();
  });
  new MutationObserver(schedule).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();
