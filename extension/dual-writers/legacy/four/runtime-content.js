/* Prowell dual-site, alert-only runtime: never click website controls. */
(() => {
  'use strict';
  const chrome=window.__prowellLegacyChrome;
  if(!chrome?.storage?.local)return;
  const SITE='four';
  const HOST=/^(?:www\.)?4writers\.net$/i;
  const VERSION='0.5.4';
  const TAB_MESSAGE='PROWELL_TAB_ID';
  const FLAG='__prowellDualFourAlertOnly';
  if(window!==window.top||!HOST.test(location.hostname))return;
  if(window[FLAG])return;
  window[FLAG]=true;
  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    claim:null,soundRunId:'',autoAcceptEnabled:false};
  let state={...DEFAULTS},tabId=null,pending=false,stopping=false;
  const active=()=>state.armed===true&&state.claimConsentVersion===VERSION&&
    Number.isInteger(tabId)&&state.targetTabId===tabId;
  const warned=()=>{
    const text=String(document.body?.innerText||document.body?.textContent||'');
    return /captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i.test(text)||
      Boolean(document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  };
  const cards=()=> (window.__prowellCardDetector?.cards?.()||[])
    .filter(c=>['available','processing'].includes(c?.type)&&
      /^\d{5,16}$/.test(String(c.id||'')));
  function stop(reason,card=null){
    if(!active()||stopping)return;
    stopping=true;
    state.armed=false;state.targetTabId=null;state.claim=null;
    try{window.__prowellDualStopRefresh?.();}catch(_){}
    // Send the notification before waiting for any storage write.
    if(card)try{chrome.runtime.sendMessage({
      type:'PROWELL_ORDER_SOUND',orderId:String(card.id),
      kind:card.type,soundRunId:String(state.soundRunId||'')
    },()=>void chrome.runtime.lastError);}catch(_){}
    void chrome.storage.local.set({
      armed:false,targetTabId:null,claim:null,autoFlow:null,
      autoAcceptEnabled:false,lastAlertOrderId:card?String(card.id):null,
      lastAlertKind:card?.type||null,lastAlertAt:card?Date.now():null,
      lastResult:reason
    }).catch(error=>console.warn('Prowell STOP persistence failed:',
      String(error?.message||error))).finally(()=>{stopping=false;});
  }
  function scan(){
    if(!active()||stopping||!document.body)return;
    if(warned()){stop(SITE+': security/automation warning — stopped until manually restarted.');return;}
    // Ignore and clear stale claims from older automatic-accept releases.
    if(state.claim){stop(SITE+': old claim cleared; restart manually.');return;}
    const card=cards()[0];
    if(card)stop(SITE+': '+card.type+' order #'+card.id+
      ' detected; sound requested and monitoring stopped. Open manually.',card);
  }
  function schedule(){
    if(pending||!active())return;
    pending=true;
    queueMicrotask(()=>{pending=false;scan();});
  }
  window.__prowellDualActionableCards=cards;
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    for(const key of Object.keys(DEFAULTS))if(changes[key])
      state[key]=changes[key].newValue;
    if(changes.armed?.newValue===true)stopping=false;
    schedule();
  });
  chrome.runtime.sendMessage({type:TAB_MESSAGE},async result=>{
    tabId=result?.tabId??null;
    try{state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};}
    catch(error){console.warn('Prowell monitor state unavailable:',
      String(error?.message||error));return;}
    schedule();
  });
  new MutationObserver(schedule).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();