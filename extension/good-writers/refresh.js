/* Prowell Order Assistant: independent, page-local refresh timer.
 * Operates only on the currently armed 4writers tab. No direct/API polling.
 * Does not restart its countdown when page elements change.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?good-writers\.com$/i.test(location.origin)) return;
  if (window.__goodWritersRefreshLoaded) return;
  window.__goodWritersRefreshLoaded = true;

  let tabId = null;
  let timer = null;
  let stoppedForVisibleOrder = false;
  let count = 0;
  let status = '';
  let local = {armed:false,targetTabId:null,claim:null,claimConsentVersion:'',attemptedIds:[],completed:[],autoFlow:null,seenOrderIds:[]};
  const interval = 1000;
  const isActive = () => !stoppedForVisibleOrder && local.armed && local.claimConsentVersion === '1.0.14' && local.targetTabId === tabId;

  function setStatus(message) {
    if (message === status) return;
    status = message;
    void chrome.storage.local.set({refreshStatus:message});
  }
  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  // Called synchronously from the detection observer before any storage roundtrip.
  window.__prowellCancelRefresh = () => {
    stoppedForVisibleOrder = true;
    cancel();
    status = 'Stopped — opening detected order';
  };
  function orderListVisible(){return window.__prowellCardDetector?.pageKind()==='available';}
  function challengeVisible() {
    const text = document.body?.innerText || '';
    return /captcha|verify you are human|unusual activity/i.test(text) ||
      Boolean(document.querySelector('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  }
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
  function unseenOrderVisible(){
    const cards=window.__prowellCardDetector?.cards()||[];
    const handled=new Set([...(local.attemptedIds||[]),
      ...(local.completed||[]),...(local.seenOrderIds||[])]);
    return cards.some(c=>['processing','available'].includes(c.type)&&!handled.has(String(c.id)));
  }
  function evaluate() {
    if (!isActive()) {
      cancel();
      if(stoppedForVisibleOrder)return;
      setStatus('Stopped — press START WATCHING');
      return;
    }
    if (local.autoFlow?.enabled && Date.now()-Number(local.autoFlow.startedAt||0)<90000) {
      cancel();
      setStatus('Paused — handling order #'+local.autoFlow.orderId);
      return;
    }
    if (detailsOpen()) {
      cancel();
      setStatus('Paused — order details still open');
      return;
    }
    if (local.claim) {
      cancel();
      setStatus('Paused — processing order #' + local.claim.id);
      return;
    }
    if (challengeVisible()) {
      cancel();
      setStatus('Paused — website security check detected');
      return;
    }
    if (unseenOrderVisible()) {
      cancel();
      setStatus('Order card detected — refresh stopped for action');
      return;
    }
    if (!orderListVisible()) {
      cancel();
      setStatus('Waiting — open Available Orders → Writings');
      return;
    }
    if (unseenOrderVisible()) {
      cancel();
      setStatus('Order detected — refresh stopped for manual review');
      return;
    }
    if (timer !== null) return;
    setStatus('Refreshing every 1 second');
    timer = setTimeout(async () => {
      timer = null;
      if (!isActive() || local.claim || detailsOpen() ||
          (local.autoFlow?.enabled && Date.now()-Number(local.autoFlow.startedAt||0)<90000) ||
          challengeVisible() || !orderListVisible() || unseenOrderVisible()) {
        evaluate();
        return;
      }
      count += 1;
      const at = Date.now();
      // Persist the attempt and timestamp before navigation unloads this page.
      await chrome.storage.local.set({
        refreshCount:count,
        lastRefreshAt:at,
        refreshStatus:'Reloading Available Orders'
      });
      if (isActive() && !local.claim && !detailsOpen() && !unseenOrderVisible() &&
          !(local.autoFlow?.enabled && Date.now()-Number(local.autoFlow.startedAt||0)<90000)) location.reload();
    },interval);
  }
  const relevant = new Set(['armed','claimConsentVersion','targetTabId','claim',
    'attemptedIds','completed','autoFlow','seenOrderIds']);
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local') return;
    let touched = false;
    for (const key of relevant) {
      if (changes[key]) {
        local[key]=changes[key].newValue;
        if((key==='armed' && changes[key].newValue===true) ||
           (key==='autoFlow' && !changes[key].newValue)) stoppedForVisibleOrder=false;
        touched=true;
      }
    }
    if (touched) evaluate();
    if (changes.refreshCount) count = Math.max(0,Number(changes.refreshCount.newValue)||0);
  });
  chrome.runtime.sendMessage({type:'GW_TAB_ID'}, async res => {
    tabId = res?.tabId ?? null;
    const stored = await chrome.storage.local.get([
      'armed','claimConsentVersion','targetTabId','claim','attemptedIds',
      'completed','refreshCount','autoFlow','seenOrderIds'
    ]);
    local={...local,...stored};
    count=Number(stored.refreshCount)||0;
    evaluate();
  });
  new MutationObserver(() => {
    // The existing timeout remains intact; no restart on countdown or other DOM changes.
    evaluate();
  }).observe(document,{childList:true,subtree:true,characterData:true});
  document.addEventListener('DOMContentLoaded',evaluate,{once:true});
})();