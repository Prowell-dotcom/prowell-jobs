/* Prowell Order Assistant. Runs only inside the signed-in 4writers browser tab.
 * Uses the page's normal user interface; never reads passwords or bypasses challenges.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?good-writers\.com$/i.test(location.origin)) return;
  if (window.__prowellGoodWritersV1) return;
  window.__prowellGoodWritersV1 = true;

  const DEFAULTS = {armed:false,claimConsentVersion:'',targetTabId:null,refreshMs:2000,claim:null,
    attemptedIds:[],completed:[],processingPreviewedIds:[],lastResult:'Ready',log:[],returnToList:true};
  const ID = /\b(?:order\s*)?ID\s*[:#]\s*(\d{5,})\b/i;
  const VIEW = /^view(?:\s+(?:order|details))?$/i;
  const TAKE = /^take\s*it(?:\s*now)?[.!]?$/i;
  const ACCEPT = /^i\s+understand\s+the\s+order[.!]?$/i;
  const OK = /^(?:ok|okay|confirm|yes)$/i;
  const ACTIONS = 'a,button,input[type="button"],input[type="submit"],[role="button"]';
  let state={...DEFAULTS}, tabId=null, busy=false, pendingScan=false;
  let nextRefresh=null, statusNode=null, lastAction=0;
  const sendResult = (payload) => chrome.runtime.sendMessage({type:'GOOD_WRITERS_RESULT',payload},()=>void chrome.runtime.lastError);

  const label = el => (el?.getAttribute?.('aria-label') || el?.value ||
    el?.innerText || el?.textContent || '').trim().replace(/\s+/g,' ');
  const visible = el => Boolean(el && el.isConnected && el.getClientRects().length &&
    !el.disabled && el.getAttribute('aria-disabled')!=='true');
  const find = pattern => [...document.querySelectorAll(ACTIONS)]
    .find(el => visible(el) && pattern.test(label(el)));
  const active = () => Boolean(state.armed && state.claimConsentVersion==='1.0.5' && tabId === state.targetTabId);
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
    const claim={id,stage,startedAt:state.claim?.startedAt||Date.now(),listUrl:state.claim?.listUrl||location.href,...other};
    state.claim=claim;
    await chrome.storage.local.set({claim});
  }
  function orderCards(){return window.__prowellCardDetector?.cards()||[];}
  // The View button may open an ORDER INFORMATION modal on the same URL.
  // Never scroll the available-orders list: only scroll after matching the
  // opened details to the order whose View was clicked.
  const DETAILS_SELECTORS='dialog[open],[role="dialog"],.modal.show,.modal.in,.modal-content,.modal-dialog,.modal-body,[class*="order-info"],[class*="orderInfo"],[id*="modal"],[data-order-details]';
  const ID_IN_DETAILS=/\border\s*(?:#|id\s*[:#]?)\s*(\d{5,16})\b/ig;
  function sameOrder(a,b){
    return String(a||'').replace(/^0+/,'')===String(b||'').replace(/^0+/,'');
  }
  function matchedDetailsPanel(claim){
    if(!claim)return null;
    const panels=[...document.querySelectorAll(DETAILS_SELECTORS)];
    for(const el of panels){
      if(!el?.isConnected || !el.getClientRects?.().length)continue;
      const txt=String(el.innerText||el.textContent||'');
      ID_IN_DETAILS.lastIndex=0;
      const ids=[...txt.matchAll(ID_IN_DETAILS)].map(hit=>hit[1]);
      if(ids.some(id=>sameOrder(id,claim.id)))return el;
    }
    return null;
  }
  function scrollOpenedOrder(claim){
    if(!active() || !state.claim || !sameOrder(state.claim.id,claim.id))return false;
    const panel=matchedDetailsPanel(claim);
    if(panel){
      // Scroll inside the visible order popup, *not* the page behind it.
      const descendants=typeof panel.querySelectorAll==='function'
        ? [...panel.querySelectorAll('.modal-body,.modal-content,[class*="scroll"],[style*="overflow"],[data-order-details]')]
        : [];
      for(const el of [...new Set([panel,...descendants])]){
        try{
          if(typeof el.scrollTo==='function')el.scrollTo(0,el.scrollHeight||0);
          else el.scrollTop=el.scrollHeight||0;
        }catch(_){try{el.scrollTop=el.scrollHeight||0;}catch(__){}}
      }
      return true;
    }
    // Some View links navigate to an entire details page instead of a modal.
    // A changed URL alone is insufficient; verify the order ID is displayed.
    if(location.href!==claim.listUrl){
      const txt=String(document.body?.innerText||'');
      ID_IN_DETAILS.lastIndex=0;
      if([...txt.matchAll(ID_IN_DETAILS)].some(hit=>sameOrder(hit[1],claim.id))){
        const bottom=Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0);
        try{window.scrollTo(0,bottom);}catch(_){}
        try{document.scrollingElement?.scrollTo(0,bottom);}catch(_){}
        return true;
      }
    }
    return false;
  }
  function scrollAcknowledgment(button){
    if(!active()||!state.claim||!visible(button))return;
    // This is the acknowledgement screen AFTER confirmation, not the order list.
    try{button.scrollIntoView?.({behavior:'instant',block:'end'});}catch(_){}
    const bottom=Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0);
    try{window.scrollTo(0,bottom);}catch(_){}
    try{document.scrollingElement?.scrollTo(0,bottom);}catch(_){}
  }
  function stopRefresh(){if(nextRefresh){clearTimeout(nextRefresh);nextRefresh=null;}}
  // Refresh scheduling is controlled exclusively by refresh.js.
  function scheduleRefresh(){}
  async function clickStage(el,stage,message){
    if(!visible(el) || busy || !active())return;
    busy=true;stopRefresh();
    try{
      await setClaim(state.claim.id,stage);
      lastAction=Date.now();
      if(stage==='take-clicked'){
        // Only the Take it action may arm a short-lived Are-you-sure confirmation.
        try{window.dispatchEvent(new Event('prowell-order-confirm-arm'));}catch(_){}
      }
      el.click();
      await report(message);
    }catch(err){await report('Could not click: '+err.message);}
    finally{busy=false;}
    setTimeout(scheduleScan,0);
  }
  async function finished(ok,message,stage='result'){
    const current=state.claim;
    if(current){
      const elapsedMs=Math.max(0,Date.now()-current.startedAt);
      sendResult({eventKey:'claim_'+current.id+'_'+current.startedAt,orderId:current.id,outcome:ok?'success':'failure',stage,elapsedMs,detail:message+(ok?(elapsedMs<=2500?' · Fast target reached.':elapsedMs<=5000?' · Within 5-second target; optimize loading.':' · Slower than target; investigate network and page rendering.'):' · Check whether another writer took the order or the order expired.')});
    }
    const claim=state.claim;if(!claim)return;
    const array=ok?'completed':'attemptedIds';
    const ids=[...new Set([...(state[array]||[]),claim.id])].slice(-200);
    state[array]=ids;state.claim=null;
    await report(message,{[array]:ids,claim:null});
    if(state.returnToList && claim.listUrl &&
      new URL(claim.listUrl).origin===location.origin && location.href!==claim.listUrl){
      location.assign(claim.listUrl);
    }else scheduleRefresh();
  }
  async function scan(){
    if(!active()||busy||!document.body)return;
    if(challenge()){
      stopRefresh();
      if(state.claim)sendResult({eventKey:'security_'+state.claim.id+'_'+state.claim.startedAt,orderId:state.claim.id,outcome:'uncertain',stage:'security',elapsedMs:Date.now()-state.claim.startedAt,detail:'Security challenge appeared; automation paused.'});
      await report('Paused: website security challenge', {armed:false});return;
    }
    if(state.claim){
      const current=state.claim;
      if(current.stage==='processing-view-clicked'){
        // Processing orders: View -> detail-popup scroll -> stop, no acceptance.
        const opened=scrollOpenedOrder(current);
        if(!opened && Date.now()-current.startedAt<5500)return;
        const seen=[...new Set([...(state.processingPreviewedIds||[]),current.id])].slice(-200);
        await report(opened
            ? 'Processing test: clicked View, scrolled order #'+current.id+' details; no acceptance.'
            : 'Processing test: View clicked but order #'+current.id+' details were not found; stopped.',
          {armed:false,claim:null,processingPreviewedIds:seen});
        return;
      }
      if((current.stage==='confirmed'||current.stage==='acknowledged') && success())return finished(true,'Order #'+current.id+': Now you can write the order');
      if(failure()){const reason=/taken/i.test(pageText())?'claimed by another writer':/not available|unavailable/i.test(pageText())?'no longer available':'claim rejected by the website';return finished(false,'Order #'+current.id+': '+reason);}
      if(Date.now()-current.startedAt>25000){
        stopRefresh();sendResult({eventKey:'timeout_'+current.id+'_'+current.startedAt,orderId:current.id,outcome:'uncertain',stage:'timeout',elapsedMs:Date.now()-current.startedAt,detail:'No confirmation within 25 seconds; inspect Processing orders before retrying.'});await report('Claim status unclear; stopped to prevent duplicate acceptance',{armed:false});return;
      }
      if(current.stage==='take-clicked' && find(OK))
        return clickStage(find(OK),'ok-clicked','Confirmed OK for #'+current.id);
      if((current.stage==='ok-clicked'||current.stage==='take-clicked') && find(ACCEPT)){
        return clickStage(find(ACCEPT),'acknowledged','Acknowledged order #'+current.id);
      }
      if((current.stage==='view-clicked'||current.stage==='take-waiting')){
        // Do not click or scroll until View has shown THIS order's information.
        if(!scrollOpenedOrder(current))return;
        const take=find(TAKE);
        if(take)return clickStage(take,'take-clicked','Clicked Take it for #'+current.id);
      }
      return;
    }
    const cards=orderCards();
    if(cards.length){
      const processing=cards.find(c=>c.type==='processing' && !(state.processingPreviewedIds||[]).includes(c.id));
      if(processing){
        // Commit the stage BEFORE triggering navigation, so it survives reload.
        await setClaim(processing.id,'processing-view-clicked',{listUrl:location.href,startedAt:Date.now()});
        processing.view.click();
        // No scroll here: wait for matching Order Information details to render.
        await report('Processing test: clicked View; waiting for #'+processing.id+' details');
        setTimeout(scheduleScan,0);
        return;
      }
      const fresh=cards.find(c=>c.type==='available' && !(state.attemptedIds||[]).includes(c.id) &&
        !(state.completed||[]).includes(c.id));
      if(fresh){
        stopRefresh();
        await setClaim(fresh.id,'view-clicked',{listUrl:location.href,startedAt:Date.now()});
        lastAction=Date.now();fresh.view.click();
        await report('Opening order #'+fresh.id);
        setTimeout(scheduleScan,0);
        return;
      }
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
  // Keep checking for confirmation after a click even if the website makes no further DOM changes.
  setInterval(()=>{if(active() && state.claim && !busy)scheduleScan();},150);
  document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();