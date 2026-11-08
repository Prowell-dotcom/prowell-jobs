/* Prowell Order Assistant: independent, page-local refresh timer.
 * Operates only on the currently armed 4writers tab. No direct/API polling.
 * Does not restart its countdown when page elements change.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin)) return;
  if (window.__prowellRefreshLoaded) return;
  window.__prowellRefreshLoaded = true;

  let tabId = null;
  let timer = null;
  let count = 0;
  let status = '';
  let local = {armed:false,targetTabId:null,claim:null,claimConsentVersion:'',attemptedIds:[],completed:[]};
  const interval = 2000;
  const isActive = () => local.armed && local.claimConsentVersion === '0.5.7' && local.targetTabId === tabId;

  function setStatus(message) {
    if (message === status) return;
    status = message;
    void chrome.storage.local.set({refreshStatus:message});
  }
  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function orderListVisible(){return window.__prowellCardDetector?.pageKind()==='available';}
  function challengeVisible() {
    const text = document.body?.innerText || '';
    return /captcha|verify you are human|unusual activity/i.test(text) ||
      Boolean(document.querySelector('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  }
  function unseenOrderVisible(){
    const cards=window.__prowellCardDetector?.cards()||[];
    const handled=new Set([...(local.attemptedIds||[]),...(local.completed||[])]);
    return cards.some(c=>c.type==='processing'||(c.type==='available'&&!handled.has(c.id)));
  }
  function evaluate() {
    if (!isActive()) {
      cancel();
      setStatus('Stopped — press START WATCHING');
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
    setStatus('Refreshing every 2 seconds');
    timer = setTimeout(async () => {
      timer = null;
      if (!isActive() || local.claim || challengeVisible() || !orderListVisible() || unseenOrderVisible()) {
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
      if (isActive() && !local.claim && !unseenOrderVisible()) location.reload();
    },interval);
  }
  const relevant = new Set(['armed','claimConsentVersion','targetTabId','claim','attemptedIds','completed']);
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local') return;
    let touched = false;
    for (const key of relevant) {
      if (changes[key]) {local[key]=changes[key].newValue; touched=true;}
    }
    if (touched) evaluate();
    if (changes.refreshCount) count = Math.max(0,Number(changes.refreshCount.newValue)||0);
  });
  chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'}, async res => {
    tabId = res?.tabId ?? null;
    const stored = await chrome.storage.local.get([
      'armed','claimConsentVersion','targetTabId','claim','attemptedIds',
      'completed','refreshCount'
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