/* Runs the user's unchanged legacy source in the dual extension's
 * per-site storage adapter. Only this wrapper is new; the embedded source is
 * copied byte-for-byte from legacy/four/content.js.
 */
(() => {
  const chrome=window.__prowellLegacyChrome;
  if(!chrome?.storage?.local)return;
/* Prowell Order Assistant. Runs only inside the signed-in 4writers browser tab.
 * Uses the page's normal user interface; never reads passwords or bypasses challenges.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin)) return;
  if (window.__prowellAssistantV5) return;
  window.__prowellAssistantV5 = true;

  const DEFAULTS = {armed:false,claimConsentVersion:'',targetTabId:null,refreshMs:2000,claim:null,
    attemptedIds:[],completed:[],processingPreviewedIds:[],lastResult:'Ready',log:[],returnToList:true,soundRunId:''};
  const ID = /\b(?:order\s*)?ID\s*[:#]\s*(\d{5,})\b/i;
  const VIEW = /^view(?:\s+(?:order|details))?$/i;
  // Intentionally NO Take it / OK / I understand click selectors in this bot.
  const ACTIONS = 'a,button,input[type="button"],input[type="submit"],[role="button"]';
  let state={...DEFAULTS}, tabId=null, busy=false, pendingScan=false;
  let nextRefresh=null, statusNode=null, lastAction=0;
  // Rapid visual scrolling, not slow multi-second pacing. Only the verified
  // order details and (4writers only) acknowledgement popup may scroll;
  // never the available-orders background list.
  // VIEW-ONLY HANDOFF. No scrolling, no Take it, no OK, and no
  // acknowledgement are ever automated by this active dual engine.
  const sendResult = (payload) => chrome.runtime.sendMessage({type:'PROWELL_CLAIM_REPORT',payload},()=>void chrome.runtime.lastError);

  const label = el => (el?.getAttribute?.('aria-label') || el?.value ||
    el?.innerText || el?.textContent || '').trim().replace(/\s+/g,' ');
  const visible = el => Boolean(el && el.isConnected && el.getClientRects().length &&
    !el.disabled && el.getAttribute('aria-disabled')!=='true');
  const find = pattern => [...document.querySelectorAll(ACTIONS)]
    .find(el => visible(el) && pattern.test(label(el)));
  const active = () => Boolean(state.armed && state.claimConsentVersion==='0.5.4' && tabId === state.targetTabId);
  const pageText = () => document.body?.innerText || '';
  const orderList = () => window.__prowellCardDetector?.pageKind()==='available';
  const challenge = () => /captcha|verify you are human|unusual activity/i.test(pageText()) ||
    Boolean(document.querySelector('iframe[src*="captcha"], [class*="g-recaptcha"]'));
  const success = () => /now you can write the order|you (?:can|may) start writing|order (?:has been )?(?:assigned to you|taken successfully)/i.test(pageText());
  const failure = () => /(?:the )?order (?:has been )?(?:taken(?: by another)?|no longer available)|not available|this order is unavailable|failed to take (?:the )?order/i.test(pageText());
  function banner(message){
    if(!active()) return;
    if(!statusNode){
      statusNode=document.createElement('aside');statusNode.id='prowell-status';
      statusNode.style.cssText='position:fixed!important;bottom:12px!important;right:12px!important;z-index:2147483647!important;background:#102d51!important;color:#fff!important;padding:12px 15px!important;border-radius:11px!important;font:13px system-ui!important;max-width:300px!important;box-shadow:0 3px 20px #0004!important;';
      document.documentElement.appendChild(statusNode);
    }
    if(statusNode.textContent!==message) statusNode.textContent=message;
  }
  async function report(message,update={}){
    const entry=new Date().toLocaleTimeString()+' '+message;
    state={...state,...update,lastResult:message,log:[...(state.log||[]),entry].slice(-30)};
    await chrome.storage.local.set({ ...update,lastResult:message,log:state.log});
    banner('Prowell · '+message);
  }
  function orderCards(){return window.__prowellCardDetector?.cards()||[];}
  // The persisted attempted/completed/previewed ID lists are history only.
  // They must never permanently block an order that returns. Prevent only
  // duplicate View clicks for the same continuously displayed card; the
  // same ID is eligible again after disappearing/reappearing, a real page
  // reload, or a fresh owner START session.
  const handledOnThisPage=new Map();
  const cardKey=card=>String(card?.type||'')+':'+
    String(card?.id||'').replace(/^0+/,'');
  const cardElement=card=>card?.view||card?.container||null;
  function actionableCards(){
    const cards=orderCards();
    const present=new Set(cards.map(cardKey));
    for(const key of handledOnThisPage.keys())if(!present.has(key))
      handledOnThisPage.delete(key);
    // When the site renders a NEW View button for the same ID, it is a
    // fresh appearance and must be handled. Do not deduplicate by order ID.
    // The SAME View button stays protected against repeated observer scans.
    return cards.filter(card=>['available','processing'].includes(card?.type)
      && (!handledOnThisPage.has(cardKey(card)) ||
        (cardElement(card) && handledOnThisPage.get(cardKey(card))!==cardElement(card))));
  }
  // Refresh controllers share the same present-card guard. Historical IDs
  // never prevent either automatic View handling or pausing refresh.
  window.__prowellDualActionableCards=actionableCards;
  // The View button may open an ORDER INFORMATION modal on the same URL.
  // Never scroll the available-orders list: only scroll after matching the
  // opened details to the order whose View was clicked.
  const DETAILS_SELECTORS='dialog[open],[role="dialog"],.modal.show,.modal.in,.modal-content,.modal-dialog,.modal-body,[class*="order-info"],[class*="orderInfo"],[id*="modal"],[data-order-details]';
  const ID_IN_DETAILS=/\border\s*(?:#|id\s*[:#]?)\s*(\d{5,16})\b/ig;
  function stopRefresh(){if(nextRefresh){clearTimeout(nextRefresh);nextRefresh=null;}}
  // Refresh scheduling is controlled exclusively by refresh.js.
  function scheduleRefresh(){}
  // An available or processing order is treated as a one-time handoff.
  // Disarm BEFORE clicking View so a full-page navigation or new tab cannot
  // restart refreshing or any auto-accept workflow.
  async function handoffToOwner(card){
    const view=card?.view;
    if(!active()||!view||typeof view.click!=='function')return;
    const id=String(card.id||'').trim();
    const kind=card.type;
    if(!/^[0-9]{5,16}$/.test(id)||
       !['available','processing'].includes(kind))return;
    handledOnThisPage.set(cardKey(card),cardElement(card));
    stopRefresh();
    // Sound alerts are requested directly here BEFORE monitoring is
    // disarmed; the independent sidecar may also request the same alert,
    // but background sound cooldown prevents rapid duplicate chimes.
    try{
      chrome.runtime.sendMessage({
        type:'PROWELL_ORDER_SOUND',orderId:id,kind,
        soundRunId:state.soundRunId
      },()=>void chrome.runtime.lastError);
    }catch(_){}
    // Disable refresh/monitoring persistently before clicking View. No
    // claim remains for this engine to resume after a website navigation.
    state.armed=false;
    const message='Order #'+id+' detected. View only — manually take and confirm.';
    await chrome.storage.local.set({
      armed:false,autoAcceptEnabled:false,claim:null,targetTabId:null,
      lastHandoffOrderId:id,lastHandoffKind:kind,lastHandoffAt:Date.now(),
      lastResult:message
    });
    // Leave the site on the official View screen for the human. Never
    // scroll, click Take it, OK, or I understand, even on Processing.
    if(view.isConnected===false)return;
    try{view.click();}
    catch(error){void chrome.storage.local.set({
      lastResult:'Order #'+id+' found, but View could not open: '+error.message
    });}
  }
  async function scan(){
    if(!active()||busy||!document.body)return;
    if(challenge()){
      stopRefresh();
      await report('Paused: website security challenge',{armed:false,claim:null});
      return;
    }
    // An older installed version may leave an unfinished claim. Never
    // resume its Take it / OK / I understand state in view-only mode.
    if(state.claim){
      stopRefresh();
      await report('Paused previous claim; manual action only',
        {armed:false,claim:null,autoAcceptEnabled:false});
      return;
    }
    const cards=actionableCards();
    // If both kinds exist, prioritize available orders for immediate review.
    const found=cards.find(c=>c.type==='available')||
      cards.find(c=>c.type==='processing');
    if(found){await handoffToOwner(found);return;}
    scheduleRefresh();
  }
  function scheduleScan(){
    if(!active()||pendingScan)return;
    pendingScan=true;
    queueMicrotask(()=>{pendingScan=false;void scan().catch(err=>report('Scan error: '+err.message));});
  }
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(msg?.type==='PROWELL_SCAN_NOW'){scheduleScan();respond({ok:true});}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    // Explicit owner re-START must make a returning ID actionable even if
    // its original card is still present. No reset during routine DOM events.
    if(changes.armed?.newValue===true &&
       changes.armed?.oldValue!==true)handledOnThisPage.clear();
    for(const key of Object.keys(changes))if(key in DEFAULTS)state[key]=changes[key].newValue;
    if(!active()){stopRefresh();statusNode?.remove();statusNode=null;return;}
    scheduleScan();
  });
  chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async answer=>{
    tabId=answer?.tabId??null;
    state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
    scheduleScan();
  });
  new MutationObserver(records=>{
    if(records.every(record=>statusNode?.contains(record.target)))return;
    scheduleScan();
  }).observe(document,{childList:true,subtree:true,characterData:true});
  document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();
})();
