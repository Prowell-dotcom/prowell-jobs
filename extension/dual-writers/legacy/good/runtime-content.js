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
  // Good-Writers cannot click Take it; the owner does that manually.
  const ACTIONS = 'a,button,input[type="button"],input[type="submit"],[role="button"]';
  let state={...DEFAULTS}, tabId=null, busy=false, pendingScan=false;
  let nextRefresh=null, statusNode=null, lastAction=0;
  // RESTORED original full-auto View/details-scroll mechanism, but STOP
  // immediately after scrolling. Take it/OK/I understand remain manual.
  const POST_VIEW_TARGET_MS=2000; // legacy reporting threshold only
  let scrolling=false;
  function jumpToBottom(el,bottom){
    if(!el||!Number.isFinite(Number(bottom)))return false;
    const start=Number(el.scrollTop)||0;
    const end=Math.max(start,Number(bottom));
    if(end-start<=2)return false;
    try{el.scrollTop=end;}catch(_){return false;}
    return Number(el.scrollTop)>start+1;
  }
  function jumpTargets(nodes){
    const targets=[...new Set(nodes)].filter(el=>el&&el!==document.body &&
      el!==document.documentElement&&el!==document.scrollingElement&&
      Number(el.clientHeight)>40&&
      Number(el.scrollHeight)-Number(el.clientHeight)>10);
    return targets.map(el=>jumpToBottom(el,
      Math.max(0,Number(el.scrollHeight)-Number(el.clientHeight))))
      .some(Boolean);
  }

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
  async function setClaim(id,stage,other={}){
    const claim={id,stage,startedAt:state.claim?.startedAt||Date.now(),
      listUrl:state.claim?.listUrl||location.href,
      viewClickedAt:state.claim?.viewClickedAt||Date.now(),
      kind:state.claim?.kind||'available',...other};
    state.claim=claim;
    await chrome.storage.local.set({claim});
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
  let viewDialogSnapshot=new Map();
  function visibleDetails(){
    return [...document.querySelectorAll(DETAILS_SELECTORS)]
      .filter(el=>el?.isConnected&&el.getClientRects?.().length);
  }
  const detailText=el=>String(el?.innerText||el?.textContent||'');
  function detailIds(text){
    ID_IN_DETAILS.lastIndex=0;
    return [...String(text||'').matchAll(ID_IN_DETAILS)].map(hit=>hit[1]);
  }
  function matchedDetailsPanel(claim){
    if(!claim)return null;
    const panels=visibleDetails();
    // Prefer matching ID, exactly like the earlier working full-auto bot.
    for(const el of panels)
      if(detailIds(detailText(el)).some(id=>sameOrder(id,claim.id)))return el;
    // Some site themes omit order numbers inside a View popup. Accept only
    // a newly displayed/updated order popup since the specific View click;
    // do not mistake the background list or an explicitly DIFFERENT ID.
    for(const el of panels){
      const text=detailText(el);
      if(detailIds(text).length)continue;
      const prior=viewDialogSnapshot.get(el);
      if(prior!==undefined&&prior===text)continue;
      if(/\border\s+information\b/i.test(text))return el;
      if(el.matches?.('dialog[open],[role="dialog"],.modal.show,.modal.in') &&
         !viewDialogSnapshot.has(el))return el;
    }
    return null;
  }
  function captureBeforeView(){
    viewDialogSnapshot=new Map(visibleDetails().map(el=>[el,detailText(el)]));
  }
  async function scrollOpenedOrder(claim){
    if(!active()||!state.claim||!sameOrder(state.claim.id,claim.id))return false;
    const panel=matchedDetailsPanel(claim);
    if(panel){
      // Scroll only inside the verified ORDER INFORMATION popup.
      const descendants=typeof panel.querySelectorAll==='function'
        ?[...panel.querySelectorAll('*')]:[];
      jumpTargets([panel,...descendants]);
      return active() && state.claim && sameOrder(state.claim.id,claim.id);
    }
    // For real full-page View navigation, scroll that details page instead.
    if(location.href!==claim.listUrl){
      const txt=String(document.body?.innerText||'');
      ID_IN_DETAILS.lastIndex=0;
      if([...txt.matchAll(ID_IN_DETAILS)].some(hit=>sameOrder(hit[1],claim.id))){
        const root=document.scrollingElement||document.documentElement;
        const bottom=Math.max(0,Number(root?.scrollHeight||document.body?.scrollHeight||0)
          -Number(root?.clientHeight||window.innerHeight||0));
        if(root)jumpToBottom(root,bottom);
        else try{window.scrollTo(0,bottom);}catch(_){}
        return active()&&state.claim&&sameOrder(state.claim.id,claim.id);
      }
    }
    return false;
  }
  function stopRefresh(){if(nextRefresh){clearTimeout(nextRefresh);nextRefresh=null;}}
  // Refresh scheduling is controlled exclusively by refresh.js.
  function scheduleRefresh(){}
  // One-time manual handoff. Clear the claim and STOP BEFORE any
  // acceptance action, so a website DOM update cannot trigger OK/ack.
  async function stopHandoff(claim,stage,message){
    if(!state.claim||!sameOrder(state.claim.id,claim.id))return false;
    state.armed=false;
    state.claim=null;
    stopRefresh();
    await chrome.storage.local.set({
      armed:false,autoAcceptEnabled:false,claim:null,targetTabId:null,
      lastHandoffOrderId:claim.id,lastHandoffKind:claim.kind||'available',
      lastHandoffStage:stage,lastHandoffAt:Date.now(),lastResult:message
    });
    return true;
  }
  function notifyNewOrder(card){
    try{chrome.runtime.sendMessage({
      type:'PROWELL_ORDER_SOUND',orderId:String(card.id),kind:card.type,
      soundRunId:state.soundRunId
    },()=>void chrome.runtime.lastError);}catch(_){}
  }
  async function scan(){
    if(!active()||busy||scrolling||!document.body)return;
    if(challenge()){
      stopRefresh();
      await report('Paused for website security check',
        {armed:false,claim:null,autoAcceptEnabled:false});return;
    }
    if(state.claim){
      const current=state.claim;
      // Restore the ORIGINAL View→scroll mechanism, then stop before
      // Take it. Never resume older auto-accept stage names.
      if(current.stage!=='good-view-await-scroll'){
        await stopHandoff(current,'view','Old claim paused; manual control.');
        return;
      }
      if(Date.now()-Number(current.startedAt||Date.now())>12000){
        await stopHandoff(current,'view',
          'Order #'+current.id+' details not found; scroll manually.');
        return;
      }
      scrolling=true;
      let opened=false;
      try{opened=await scrollOpenedOrder(current);}
      finally{scrolling=false;}
      if(!active()||!state.claim||!sameOrder(current.id,state.claim.id)||!opened)return;
      await stopHandoff(current,'scroll',
        'Order #'+current.id+': View details scrolled. Take it manually.');
      return;
    }
    const cards=actionableCards();
    const found=cards.find(c=>c.type==='available')||
      cards.find(c=>c.type==='processing');
    if(found){
      handledOnThisPage.set(cardKey(found),cardElement(found));
      stopRefresh();
      notifyNewOrder(found);
      captureBeforeView();
      await setClaim(found.id,'good-view-await-scroll',{
        kind:found.type,listUrl:location.href,
        startedAt:Date.now(),viewClickedAt:Date.now()
      });
      if(!active()||!state.claim)return;
      try{found.view.click();}
      catch(error){await stopHandoff(state.claim,'view',
        'Order View failed: '+error.message);return;}
      // Trigger a scan immediately when View has filled the popup, then
      // retry on the next event loop turn if the site renders later.
      scheduleScan();
      setTimeout(scheduleScan,0);
      return;
    }
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
  // Retry only the View-details-scrolling handoff, never any confirmation.
  setInterval(()=>{if(active()&&state.claim&&!busy)scheduleScan();},150);
  document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();
})();
