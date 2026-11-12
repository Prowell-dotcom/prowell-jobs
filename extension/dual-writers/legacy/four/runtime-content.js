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
  // Only Take it is automated for available orders; all confirmations are manual.
  const TAKE = /^take\s+it(?:\s+now)?[.!]?$/i;
  const ACTIONS = 'a,button,input[type="button"],input[type="submit"],[role="button"]';
  let state={...DEFAULTS}, tabId=null, busy=false, pendingScan=false;
  let nextRefresh=null, statusNode=null, lastAction=0;
  // 4writers available orders: sound → View → instant scroll to the bottom
  // of the MATCHED order details → Take it → STOP.
  // The human completes OK, I understand and any native confirmations.
  // Processing orders still stop at View without scrolling/acceptance.
  // Never dispatch "prowell-order-confirm-arm"; that would accept the
  // browser's Are you sure? dialog without the owner's confirmation.
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
  // Actual 4writers popups may show "ID: ...", "Order #..." or
  // "Order number: ...". Some display a title but not the order ID at all.
  // The View click records visible dialogs so that a newly opened Order
  // Information popup can be recognized safely without a particular ID label.
  const ID_IN_DETAILS=/(?:\border\s*(?:(?:number|no\.?|#|id)\s*[:#-]?\s*)|\bID\s*[:#]\s*)(\d{5,16})\b/ig;
  const sameOrder=(a,b)=>String(a||'').replace(/^0+/,'')===
    String(b||'').replace(/^0+/,'');
  let beforeViewDialogs=new Map();
  function openDialogs(){
    return [...document.querySelectorAll(DETAILS_SELECTORS)]
      .filter(el=>el?.isConnected && el.getClientRects?.().length);
  }
  function dialogText(el){return String(el?.innerText||el?.textContent||'');}
  function hasMatchingId(text,id){
    ID_IN_DETAILS.lastIndex=0;
    return [...String(text||'').matchAll(ID_IN_DETAILS)]
      .some(hit=>sameOrder(hit[1],id));
  }
  function matchingDetails(claim){
    const panels=openDialogs();
    // Exact order ID remains the strongest evidence.
    for(const el of panels)
      if(hasMatchingId(dialogText(el),claim.id))return el;
    // Fallback: require a fresh or newly populated order-information popup
    // since THIS View click. Never treat the underlying order-list as a popup.
    const changed=panels.filter(el=>{
      const previous=beforeViewDialogs.get(el);
      const now=dialogText(el);
      return previous===undefined || previous!==now;
    }).filter(el=>{
      const text=dialogText(el);
      // If a different order number IS shown, never use the ID-less
      // fallback to click Take it for the wrong order.
      ID_IN_DETAILS.lastIndex=0;
      const ids=[...text.matchAll(ID_IN_DETAILS)].map(hit=>hit[1]);
      return !ids.length && /\border\s+information\b/i.test(text);
    });
    // Nested .modal-content and .modal-body often represent the same popup.
    // Prefer the first suitable parent; don't require every nested panel to
    // repeat the order number.
    return changed.length?changed[0]:null;
  }
  function scrollInside(el){
    if(!el||el===document.body||el===document.documentElement||
       el===document.scrollingElement)return;
    const bottom=Math.max(0,Number(el.scrollHeight)-Number(el.clientHeight));
    if(!Number.isFinite(bottom)||bottom<=Number(el.scrollTop||0)+2)return;
    try{
      if(typeof el.scrollTo==='function')el.scrollTo(0,bottom);
      else el.scrollTop=bottom;
    }catch(_){try{el.scrollTop=bottom;}catch(__){}}
  }
  function openedOrderAndScroll(claim){
    const panel=matchingDetails(claim);
    if(panel){
      // Scroll ONLY inside the verified popup, including custom overflow
      // children whose class does not contain "scroll" or "modal-body".
      const descendants=typeof panel.querySelectorAll==='function'
        ?[...panel.querySelectorAll('*')]:[];
      for(const el of new Set([panel,...descendants]))scrollInside(el);
      return true;
    }
    // A View link can also navigate to an entire details page or new tab.
    // Verify its order number before scrolling the full details page.
    if(location.href!==claim.listUrl &&
       hasMatchingId(String(document.body?.innerText||''),claim.id)){
      const el=document.scrollingElement||document.documentElement;
      if(el){
        const bottom=Math.max(0,Number(el.scrollHeight||document.body?.scrollHeight||0)
          -Number(el.clientHeight||window.innerHeight||0));
        if(Number.isFinite(bottom)&&bottom>Number(el.scrollTop||0)+2)
          try{
            if(typeof el.scrollTo==='function')el.scrollTo(0,bottom);
            else el.scrollTop=bottom;
          }catch(_){try{el.scrollTop=bottom;}catch(__){}}
      }else try{window.scrollTo(0,document.body?.scrollHeight||0);}catch(_){}
      return true;
    }
    return false;
  }
  function stopRefresh(){if(nextRefresh){clearTimeout(nextRefresh);nextRefresh=null;}}
  // Refresh scheduling is controlled exclusively by refresh.js.
  function scheduleRefresh(){}
  // Available-order state persists across a View navigation, but no
  // generic older auto-accept states can resume. Refresh controller pauses
  // because claim is non-null until Take it, STOP, or a timeout.
  const VIEW_STAGE='four-view-await-take';
  async function stopAfterTake(claim,button){
    if(!active()||!state.claim||state.claim.stage!==VIEW_STAGE||
       !sameOrder(claim.id,state.claim.id)||!visible(button)||challenge())return;
    stopRefresh();
    // Disarm BEFORE Take it to ensure nothing can click OK or I understand.
    state.armed=false;
    state.claim=null;
    const message='Order #'+claim.id+': Take it clicked; YOU click OK and I understand.';
    await chrome.storage.local.set({
      armed:false,claim:null,targetTabId:null,autoAcceptEnabled:false,
      lastHandoffOrderId:claim.id,lastHandoffKind:'available',
      lastHandoffStage:'take-it',lastHandoffAt:Date.now(),
      lastResult:message
    });
    // Do NOT dispatch prowell-order-confirm-arm, which would approve the
    // native Are you sure? confirmation automatically.
    try{button.click();}
    catch(err){void chrome.storage.local.set({
      lastResult:'Order #'+claim.id+': Take it could not be clicked: '+err.message
    });}
  }
  async function scanTake(claim){
    if(!active()||!state.claim||state.claim.stage!==VIEW_STAGE||
       !sameOrder(claim.id,state.claim.id))return;
    if(Date.now()-Number(claim.startedAt||Date.now())>12000){
      stopRefresh();state.armed=false;state.claim=null;
      await chrome.storage.local.set({
        armed:false,claim:null,targetTabId:null,autoAcceptEnabled:false,
        lastResult:'Order #'+claim.id+': details or Take it not found. Manually continue.'
      });
      return;
    }
    // Require a matching ID in opened details BEFORE clicking Take it.
    if(!openedOrderAndScroll(claim))return;
    const take=find(TAKE);
    if(take)await stopAfterTake(claim,take);
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
    if(kind==='processing'){
      // Already assigned: View only, then stop; never click Take it.
      state.armed=false;
      await chrome.storage.local.set({
        armed:false,claim:null,targetTabId:null,autoAcceptEnabled:false,
        lastHandoffOrderId:id,lastHandoffKind:kind,lastHandoffStage:'view',
        lastHandoffAt:Date.now(),
        lastResult:'Processing order #'+id+': View opened; manual action only.'
      });
      if(view.isConnected!==false)try{view.click();}catch(_){}
      return;
    }
    // Snapshot visible popups BEFORE clicking View; a newly opened popup
    // may omit the ID, so its new/changed Order Information content matters.
    beforeViewDialogs=new Map(openDialogs().map(el=>[el,dialogText(el)]));
    // Keep armed only for the short View→Take it handoff. Setting claim
    // pauses the separate 4writers refresh controller immediately.
    const claim={id,stage:VIEW_STAGE,startedAt:Date.now(),
      listUrl:location.href,viewClickedAt:Date.now()};
    state.claim=claim;
    await chrome.storage.local.set({
      claim,autoAcceptEnabled:false,
      lastResult:'Order #'+id+': opening View, then Take it; confirmations manual.'
    });
    if(!active()||state.claim?.stage!==VIEW_STAGE)return;
    if(view.isConnected===false){
      state.armed=false;state.claim=null;
      await chrome.storage.local.set({armed:false,claim:null,targetTabId:null,
        lastResult:'Order #'+id+': View disappeared, manual action required.'});
      return;
    }
    try{view.click();}
    catch(error){
      state.armed=false;state.claim=null;
      await chrome.storage.local.set({armed:false,claim:null,targetTabId:null,
        lastResult:'Order #'+id+': View could not open: '+error.message});
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
      if(state.claim.stage===VIEW_STAGE){
        await scanTake(state.claim);return;
      }
      // Do not resume Take it/OK/acknowledgement from an older release.
      stopRefresh();
      await report('Old claim stopped. Manual action required',
        {armed:false,claim:null,autoAcceptEnabled:false});
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
  chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async answer=>{
    tabId=answer?.tabId??null;
    state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
    scheduleScan();
  });
  new MutationObserver(records=>{
    if(records.every(record=>statusNode?.contains(record.target)))return;
    scheduleScan();
  }).observe(document,{childList:true,subtree:true,characterData:true});
  // A View navigation can render details asynchronously; retry only
  // while the selected order is pending, never after clicking Take it.
  setInterval(()=>{if(active()&&state.claim?.stage===VIEW_STAGE)
    scheduleScan();},150);
  document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();
})();
