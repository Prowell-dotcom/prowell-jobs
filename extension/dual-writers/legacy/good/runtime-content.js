/* Runs the user's unchanged legacy source in the dual extension's
 * per-site storage adapter. Only this wrapper is new; the embedded source is
 * copied byte-for-byte from legacy/good/content.js.
 */
(() => {
  const chrome=window.__prowellLegacyChrome;
  if(!chrome?.storage?.local)return;
/* Prowell Order Assistant. Runs only inside the signed-in 4writers browser tab.
 * Uses the page's normal user interface; never reads passwords or bypasses challenges.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?good-writers\.com$/i.test(location.origin)) return;
  if (window.__prowellGoodWritersV1) return;
  window.__prowellGoodWritersV1 = true;

  const DEFAULTS = {armed:false,claimConsentVersion:'',targetTabId:null,refreshMs:2000,claim:null,
    attemptedIds:[],completed:[],processingPreviewedIds:[],lastResult:'Ready',log:[],returnToList:true,soundRunId:''};
  const ID = /\b(?:order\s*)?ID\s*[:#]\s*(\d{5,})\b/i;
  const VIEW = /^view(?:\s+(?:order|details))?$/i;
  // Intentionally NO Take it / OK / I understand click selectors in this bot.
  const ACTIONS = 'a,button,input[type="button"],input[type="submit"],[role="button"]';
  let state={...DEFAULTS}, tabId=null, busy=false, pendingScan=false;
  let nextRefresh=null, statusNode=null, lastAction=0;
  // Good-Writers: alert → View → instantly scroll ONLY the opened order
  // details → STOP. The human clicks Take it, OK and I understand.
  const sendResult = (payload) => chrome.runtime.sendMessage({type:'GOOD_WRITERS_RESULT',payload},()=>void chrome.runtime.lastError);

  const label = el => (el?.getAttribute?.('aria-label') || el?.value ||
    el?.innerText || el?.textContent || '').trim().replace(/\s+/g,' ');
  const visible = el => Boolean(el && el.isConnected && el.getClientRects().length &&
    !el.disabled && el.getAttribute('aria-disabled')!=='true');
  const find = pattern => [...document.querySelectorAll(ACTIONS)]
    .find(el => visible(el) && pattern.test(label(el)));
  const active = () => Boolean(state.armed && state.claimConsentVersion==='1.0.4' && tabId === state.targetTabId);
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
  const ID_IN_DETAILS=/(?:\border\s*(?:(?:number|no\.?|#|id)\s*[:#-]?\s*)|\bID\s*[:#]\s*)(\d{5,16})\b/ig;
  const sameOrder=(a,b)=>String(a||'').replace(/^0+/,'')===
    String(b||'').replace(/^0+/,'');
  const SCROLL_STAGE='good-view-await-scroll';
  let beforeViewDialogs=new Map();
  function dialogs(){
    return [...document.querySelectorAll(DETAILS_SELECTORS)]
      .filter(el=>el?.isConnected && el.getClientRects?.().length);
  }
  const dialogText=el=>String(el?.innerText||el?.textContent||'');
  function matchedId(text,id){
    ID_IN_DETAILS.lastIndex=0;
    return [...String(text||'').matchAll(ID_IN_DETAILS)]
      .some(hit=>sameOrder(hit[1],id));
  }
  function openedDetails(claim){
    const panels=dialogs();
    for(const el of panels)if(matchedId(dialogText(el),claim.id))return el;
    // A newly opened or updated ORDER INFORMATION popup is valid even when
    // the website omits the number, but never if it shows a different ID.
    return panels.find(el=>{
      const text=dialogText(el);
      if(!/\border\s+information\b/i.test(text))return false;
      ID_IN_DETAILS.lastIndex=0;
      if([...text.matchAll(ID_IN_DETAILS)].length)return false;
      const before=beforeViewDialogs.get(el);
      // A reload/new tab can lose this snapshot; require a matching ID there.
      return before!==undefined?before!==text:beforeViewDialogs.size===0||
        !beforeViewDialogs.has(el);
    })||null;
  }
  function instantScroll(el){
    if(!el||el===document.body||el===document.documentElement||
       el===document.scrollingElement)return;
    const bottom=Math.max(0,Number(el.scrollHeight)-Number(el.clientHeight));
    if(!Number.isFinite(bottom)||bottom<=Number(el.scrollTop||0)+2)return;
    try{
      if(typeof el.scrollTo==='function')el.scrollTo(0,bottom);
      else el.scrollTop=bottom;
    }catch(_){try{el.scrollTop=bottom;}catch(__){}}
  }
  function scrollOpenedDetails(claim){
    const popup=openedDetails(claim);
    if(popup){
      // Scroll the popup and ALL its overflow children directly to bottom,
      // without any animation steps or pauses. Never move the order list.
      const children=typeof popup.querySelectorAll==='function'
        ?[...popup.querySelectorAll('*')]:[];
      for(const el of new Set([popup,...children]))instantScroll(el);
      return true;
    }
    if(location.href!==claim.listUrl&&matchedId(pageText(),claim.id)){
      const root=document.scrollingElement||document.documentElement;
      if(root){
        const bottom=Math.max(0,Number(root.scrollHeight||document.body?.scrollHeight||0)
          -Number(root.clientHeight||window.innerHeight||0));
        if(Number.isFinite(bottom)&&bottom>Number(root.scrollTop||0)+2)
          try{
            if(typeof root.scrollTo==='function')root.scrollTo(0,bottom);
            else root.scrollTop=bottom;
          }catch(_){try{root.scrollTop=bottom;}catch(__){}}
      }else try{window.scrollTo(0,document.body?.scrollHeight||0);}catch(_){}
      return true;
    }
    return false;
  }
  function stopRefresh(){if(nextRefresh){clearTimeout(nextRefresh);nextRefresh=null;}}
  // Refresh scheduling is controlled exclusively by refresh.js.
  function scheduleRefresh(){}
  // Keep refreshing paused while the View details load, then disarm as soon
  // as the matching popup/page is scrolled. Never click acceptance controls.
  async function finishScroll(claim,found){
    if(!active()||!state.claim||state.claim.stage!==SCROLL_STAGE||
       !sameOrder(state.claim.id,claim.id))return;
    stopRefresh();
    state.armed=false;state.claim=null;
    await chrome.storage.local.set({
      armed:false,autoAcceptEnabled:false,claim:null,targetTabId:null,
      lastHandoffOrderId:claim.id,lastHandoffKind:claim.kind,
      lastHandoffStage:found?'scroll':'view',lastHandoffAt:Date.now(),
      lastResult:found
        ?'Order #'+claim.id+': View opened and scrolled to bottom. Click Take it manually.'
        :'Order #'+claim.id+': details not found; View opened. Continue manually.'
    });
  }
  async function handoffToOwner(card){
    const view=card?.view;
    if(!active()||!view||typeof view.click!=='function')return;
    const id=String(card.id||'').trim(),kind=card.type;
    if(!/^[0-9]{5,16}$/.test(id)||
       !['available','processing'].includes(kind))return;
    handledOnThisPage.set(cardKey(card),cardElement(card));
    stopRefresh();
    try{
      chrome.runtime.sendMessage({
        type:'PROWELL_ORDER_SOUND',orderId:id,kind,
        soundRunId:state.soundRunId
      },()=>void chrome.runtime.lastError);
    }catch(_){}
    beforeViewDialogs=new Map(dialogs().map(el=>[el,dialogText(el)]));
    // Persist pending handoff before View; it survives same-site navigation.
    const claim={id,kind,stage:SCROLL_STAGE,startedAt:Date.now(),
      listUrl:location.href,viewClickedAt:Date.now()};
    state.claim=claim;
    await chrome.storage.local.set({
      claim,autoAcceptEnabled:false,
      lastResult:'Order #'+id+': opening View and scrolling; acceptance manual.'
    });
    if(!active()||state.claim?.stage!==SCROLL_STAGE)return;
    if(view.isConnected===false){
      await finishScroll(claim,false);return;
    }
    try{view.click();}
    catch(error){
      await finishScroll(claim,false);
      void chrome.storage.local.set({
        lastResult:'Order #'+id+': View could not open: '+error.message
      });
      return;
    }
    scheduleScan();
  }
  async function scan(){
    if(!active()||busy||!document.body)return;
    if(challenge()){
      stopRefresh();
      await report('Paused: website security challenge',
        {armed:false,claim:null,autoAcceptEnabled:false});return;
    }
    if(state.claim){
      const current=state.claim;
      if(current.stage!==SCROLL_STAGE){
        // Never resume an older Take it / OK / acknowledgement stage.
        stopRefresh();
        await report('Paused old claim; manual action only',
          {armed:false,claim:null,autoAcceptEnabled:false});
        return;
      }
      if(scrollOpenedDetails(current)){
        await finishScroll(current,true);return;
      }
      if(Date.now()-Number(current.startedAt||Date.now())>12000)
        await finishScroll(current,false);
      return;
    }
    const cards=actionableCards();
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
  chrome.runtime.sendMessage({type:'GW_TAB_ID'},async answer=>{
    tabId=answer?.tabId??null;
    state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
    scheduleScan();
  });
  new MutationObserver(records=>{
    if(records.every(record=>statusNode?.contains(record.target)))return;
    scheduleScan();
  }).observe(document,{childList:true,subtree:true,characterData:true});
  // Retry only while waiting for a View popup; never after the scroll or
  // after STOP. Browser timer throttling may delay rendering but cannot
  // cause an automatic Take it, OK or acknowledgement click.
  setInterval(()=>{if(active()&&state.claim?.stage===SCROLL_STAGE)
    scheduleScan();},150);
  document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();
})();
