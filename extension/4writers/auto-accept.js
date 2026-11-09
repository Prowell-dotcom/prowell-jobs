/* Prowell opt-in order acceptance. Instant order-panel navigation,
 * no randomized interaction or bot-detection evasion.
 * Works only on the tab and order selected by the Prowell watcher.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?(?:4writers\.net|good-writers\.com)$/i.test(location.origin)) return;
  if (window.__prowellAutoAcceptanceLoaded) return;
  window.__prowellAutoAcceptanceLoaded = true;
  const IS_FOUR = /(?:^|\.)4writers\.net$/i.test(location.hostname);
  const TAB_MESSAGE = IS_FOUR ? 'PROWELL_TAB_ID' : 'GW_TAB_ID';
  const SELECTORS = 'button,a,input[type="button"],input[type="submit"],[role="button"]';
  const RUN_TTL = 90000;
  const STEP_TIMEOUT = 20000;
  let tabId = null, flow = null, busy = false, nativeOk = false;
  let pendingWrites = Promise.resolve();
  const rank = { 'await-view':0, scroll:1, take:1, ok:2, understand:3, verify:4 };
  // The MAIN-world helper reports a native browser confirmation as soon as
  // the site's confirm() returns. The next stage does not wait for a DOM OK.
  window.addEventListener?.('prowell-order-confirm-accepted',()=>{
    if(guarded() && flow.stage==='ok')nativeOk=true;
  });
  function guarded() {
    return Boolean(flow && flow.enabled === true && Number.isInteger(tabId) &&
      flow.tabId === tabId && /^\d{5,16}$/.test(String(flow.orderId || '')) &&
      Date.now() - flow.startedAt < RUN_TTL);
  }
  function checkSecurity() {
    return /captcha|verify you are human|unusual activity/i.test(document.body?.innerText || '') ||
      Boolean(document.querySelector('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  }
  function label(el) {
    return String(el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') ||
      el?.value || el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
  }
  function visible(el) {
    return Boolean(el?.isConnected && el.getClientRects?.().length &&
      !el.disabled && el.getAttribute?.('aria-disabled') !== 'true');
  }
  function matches(stage, txt) {
    if (stage === 'take') return /^take it$/i.test(txt);
    if (stage === 'ok') return /^ok$/i.test(txt);
    return /^i understand(?: the order)?$/i.test(txt);
  }
  function find(stage) {
    const hits = [...document.querySelectorAll(SELECTORS)].filter(el => visible(el) && matches(stage, label(el)));
    if (hits.length > 1) throw Error('Ambiguous ' + stage + ' controls');
    return hits[0] || null;
  }
  function inViewport(el) {
    const r = el.getBoundingClientRect?.();
    return Boolean(r && r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.top < (window.innerHeight || 850));
  }
  // Order details can be a foreground dialog OR the left-side main content
  // in the writer dashboard. Never confuse the sidebar or hidden background
  // with the content that contains the order instructions.
  const DIALOGS='[role="dialog"],dialog,[aria-modal="true"],.modal,.modal-body,.popup,[class*="modal"],[class*="dialog"],[class*="popup"],[class*="drawer"],[class*="lightbox"]';
  const DETAILS='main,[role="main"],#content,#main,.main,.main-content,.content-body,.order-info,.order-details,[class*="order-info"],[class*="order-detail"],[class*="instructions"],[class*="description"]';
  function rendered(el) {
    if(!visible(el) || el.hidden || el.getAttribute?.('aria-hidden')==='true')return false;
    const st=getComputedStyle(el);
    if(st?.display==='none'||st?.visibility==='hidden')return false;
    const r=el.getBoundingClientRect?.();
    if(r && !(r.width>0&&r.height>0))return false;
    return true;
  }
  function orderText(el) {
    const text=String(el?.innerText||el?.textContent||'');
    const id=String(flow?.orderId||'');
    return (Boolean(id)&&text.includes(id)) ||
      /order\s*(?:information|details|instructions|requirements)|acknowledg/i.test(text);
  }
  function foregroundSurfaces(button) {
    // Never scan every element on the page: that delayed View and recognition
    // on complex writer dashboards. Use real dialogs and the button's ancestors.
    const possible=[...document.querySelectorAll(DIALOGS)];
    for(let node=button?.parentElement,depth=0;node&&depth<14;node=node.parentElement,depth++){
      if(node===document.body)break;
      possible.push(node);
    }
    const hits=[...new Set(possible)].filter(el=>{
      if(!rendered(el))return false;
      const style=getComputedStyle(el),r=el.getBoundingClientRect?.();
      const overlay=el.getAttribute?.('role')==='dialog' ||
        el.getAttribute?.('aria-modal')==='true' ||
        /modal|dialog|popup|drawer|lightbox/i.test(String(el.className||'')) ||
        (/fixed|absolute/i.test(String(style?.position||'')) &&
          Boolean(r && r.width>=180 && r.height>=120));
      return overlay && (el.contains?.(button) || orderText(el));
    });
    hits.sort((a,b)=>{
      const score=el=>{
        let n=0;
        if(button && el.contains?.(button))n+=100;
        if(el.getAttribute?.('aria-modal')==='true')n+=80;
        if(el.getAttribute?.('role')==='dialog')n+=60;
        if(orderText(el))n+=30;
        const z=parseInt(getComputedStyle(el)?.zIndex,10)||0;
        n+=Math.max(0,Math.min(10000,z))/100;
        return n;
      };
      return score(b)-score(a);
    });
    return hits.length?[hits[0]]:[];
  }
  function detailsPage(button) {
    const id=String(flow?.orderId||'');
    const text=document.body?.innerText||'';
    if(!id || !(text+' '+location.href).includes(id))return false;
    const changed=Boolean(flow?.listUrl && flow.listUrl!==location.href);
    const detailsLabel=/order\s*(?:information|details|instructions|requirements)|assignment\s*details/i.test(text);
    // View may replace the listing *in place* without changing the URL.
    // A real Take it button plus selected order details is sufficient proof.
    return changed || Boolean(button && rendered(button) && detailsLabel);
  }
  function inlineOrderDetails(button) {
    // A same-URL inline panel is allowed only if it contains the selected ID,
    // an order-detail heading and (when available) the Take it control.
    const id=String(flow?.orderId||'');
    if(!id)return null;
    const candidates=[...document.querySelectorAll(DETAILS)].filter(el=>{
      if(!rendered(el))return false;
      const t=String(el.innerText||el.textContent||'');
      return t.includes(id) &&
        /order\s*(?:information|details|instructions|requirements)/i.test(t) &&
        (!button||el.contains?.(button));
    });
    // Frameworks sometimes use unlabelled wrappers. Walk up from Take it
    // to find the selected order panel without ever reaching body/sidebar.
    if(button)for(let p=button.parentElement;p&&p!==document.body;p=p.parentElement){
      if(!rendered(p))continue;
      const t=String(p.innerText||p.textContent||'');
      if(t.length>50000)break;
      if(t.includes(id) && /order\s*(?:information|details|instructions|requirements)/i.test(t))
        candidates.push(p);
    }
    candidates.sort((a,b)=>String(a.innerText||'').length-String(b.innerText||'').length);
    return candidates[0]||null;
  }
  function scrollCandidates(stage,button) {
    const overlays=foregroundSurfaces(button);
    const set=new Set();
    const overlay=overlays[0]||null;
    if(overlay){
      set.add(overlay);
      for(const el of overlay.querySelectorAll?.('*')||[])set.add(el);
      for(let p=button?.parentElement;p&&p!==document.body;p=p.parentElement){
        if(overlay===p||overlay.contains?.(p))set.add(p);
      }
    }else if(inlineOrderDetails(button)||detailsPage(button)){
      // Never scroll the site's background to reveal the red/blue Take it
      // button inside a separately scrollable order-description panel.
      const main=inlineOrderDetails(button);
      const content=main?[main]:[...document.querySelectorAll(DETAILS)].filter(el=>
        rendered(el) && (orderText(el)||el.contains?.(button)));
      for(const el of content){
        set.add(el);
        for(const child of el.querySelectorAll?.('*')||[])set.add(child);
      }
      // Only a separately navigated, verified full order page may use the
      // document root when no actual content pane has its own scrollbar.
      const hasPane=[...set].some(el=>el!==document.scrollingElement &&
        el!==document.documentElement && Number(el.scrollHeight)>Number(el.clientHeight)+45 &&
        /auto|scroll|overlay|hidden/i.test(String(getComputedStyle(el)?.overflowY||'')));
      if(!hasPane && flow?.listUrl!==location.href && detailsPage(button))
        set.add(document.scrollingElement||document.documentElement);
    }else return [];
    const candidates=[...set].filter(el=>{
      if(!el||!Number.isFinite(el.scrollHeight)||!Number.isFinite(el.clientHeight))return false;
      if(el.clientHeight<60||el.scrollHeight-el.clientHeight<=45)return false;
      // Allow an actual descendant of the order overlay, even if a test or
      // embedded document exposes it as the scrolling element. Never scroll
      // document roots outside the verified foreground overlay.
      if(overlay && (el===document.body ||
        ((el===document.documentElement || el===document.scrollingElement) &&
         !overlay.contains?.(el))))return false;
      if(!rendered(el)&&el!==document.scrollingElement&&el!==document.documentElement)return false;
      const st=getComputedStyle(el),overflow=String(st?.overflowY||'');
      return /auto|scroll|overlay|hidden/i.test(overflow) ||
        Boolean(overlay && el===overlay) ||
        el===document.scrollingElement||el===document.documentElement;
    });
    const score=el=>{
      const st=getComputedStyle(el),cl=String(el.className||'');
      let n=0;
      if(overlay)n+=120;
      if(/auto|scroll|overlay/i.test(String(st?.overflowY||'')))n+=60;
      if(/body|details|instructions|description|content|scroll/i.test(cl))n+=50;
      if(orderText(el))n+=20;
      if(button&&el.contains?.(button))n+=12;
      if(el===overlay)n-=10;
      if(!overlay&&(el===document.scrollingElement||el===document.documentElement))n-=70;
      return n;
    };
    candidates.sort((a,b)=>score(b)-score(a));
    return candidates;
  }
  function waitUntil(getValue, labelText) {
    // No artificial delay: evaluate immediately and then react to DOM changes.
    return new Promise((resolve,reject)=>{
      let observer=null, watchdog=null, settled=false;
      const finish=(err,value)=>{
        if(settled)return;
        settled=true;
        if(observer)observer.disconnect();
        if(watchdog!==null)clearTimeout(watchdog);
        if(err)reject(err);else resolve(value);
      };
      const inspect=()=>{
        if(settled)return;
        try {
          if(!guarded())return finish(Error('Order workflow stopped or expired'));
          if(checkSecurity())return finish(Error('Security challenge detected'));
          const result=getValue();
          if(result)return finish(null,result);
        }catch(e){finish(e);}
      };
      inspect();
      if(settled)return;
      if(typeof MutationObserver!=='function'){
        return finish(Error('Cannot observe the website while waiting for '+labelText));
      }
      observer=new MutationObserver(inspect);
      observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true});
      watchdog=setTimeout(()=>finish(Error('Timed out waiting for '+labelText)),STEP_TIMEOUT);
      inspect();
    });
  }
  async function waitForOrderDetails() {
    await waitUntil(()=>{
      const text=(document.body?.innerText||'')+' '+location.href;
      if(!text.includes(String(flow.orderId)))return null;
      // Only the foreground order panel or confirmed full-page order details.
      return foregroundSurfaces(find('take')).length>0 ||
        inlineOrderDetails(find('take')) || detailsPage(find('take')) ? true : null;
    },'the selected order details after View');
  }
  // Request an immediate scroll, never CSS smooth scrolling or timed steps.
  function instantScroll(root, bottom) {
    if (typeof root.scrollTo === 'function') {
      try { root.scrollTo({top: bottom, behavior: 'instant'}); } catch (_) {}
    }
    if (Math.abs((Number(root.scrollTop) || 0) - bottom) > 3) root.scrollTop = bottom;
  }
  async function jumpToBottom(stage) {
    const roots=scrollCandidates(stage,find(stage));
    if(!roots.length){
      const overlays=foregroundSurfaces(find(stage));
      const genuinelyShort=overlays.length>0 && overlays.every(el=>
        Number.isFinite(el.scrollHeight)&&Number.isFinite(el.clientHeight) &&
        el.scrollHeight-el.clientHeight<=45);
      if(genuinelyShort || inlineOrderDetails(find(stage)) ||
          (find(stage) && detailsPage(find(stage))))return;
      throw Error('Order-details scroll panel not found; background was not scrolled');
    }
    let alreadyAtEnd=0;
    for(const root of roots){
      if(!guarded())throw Error('Order workflow stopped');
      if(checkSecurity())throw Error('Security challenge detected');
      const before=Number(root.scrollTop)||0;
      const bottom=Math.max(0,(root.scrollHeight||0)-(root.clientHeight||0));
      if(bottom-before<=3){alreadyAtEnd++;continue;}
      // Set the actual foreground pane to its bottom in one synchronous step.
      // No smooth scrolling, artificial pauses or background-page fallback.
      instantScroll(root,bottom);
      const after=Number(root.scrollTop)||0;
      if(after>=bottom-5 && after>before+1){
        void chrome.storage.local.set({lastScrollStage:stage,lastScrollSteps:1,
          lastScrollResult:'instant-bottom',lastScrollAt:Date.now(),
          lastScrollContainer:String(root.className||root.tagName||'order-panel').slice(0,100)});
        return;
      }
    }
    if(alreadyAtEnd===roots.length)return;
    throw Error('Could not jump to the bottom of the order-details panel');
  }
  async function locate(stage, scrollAllowed) {
    let el=find(stage);
    if(!el)el=await waitUntil(()=>find(stage),stage+' button');
    if(!guarded())throw Error('Workflow stopped before '+stage);
    if(!el?.isConnected||!visible(el))throw Error(stage+' button disappeared');
    if(!inViewport(el) && scrollAllowed){
      await jumpToBottom(stage);
      el=find(stage);
    }
    // A programmatic click works on a connected button inside an overflow
    // pane even when its viewport rectangle is out of date after a jump.
    if(!el || !visible(el))throw Error(stage+' control is not ready');
    return el;
  }
  function updateStage(stage) {
    if (!guarded()) throw Error('Workflow stopped');
    flow={...flow,stage,stageStartedAt:Date.now()};
    const next=flow;
    // Initiate persistence *before* the click, but do not artificially delay
    // any click for a storage callback. Changes are tracked for finalization.
    const write=chrome.storage.local.set({autoFlow:next});
    pendingWrites=Promise.allSettled([pendingWrites,write]);
  }
  async function end(message, outcome) {
    await pendingWrites;
    const current = await chrome.storage.local.get({log: [], attemptedIds: []});
    const entry = new Date().toLocaleTimeString() + ' ' + message;
    const attemptedIds = [...new Set([...(current.attemptedIds || []), String(flow?.orderId || '')])].filter(Boolean).slice(-100);
    await chrome.storage.local.set({
      autoFlow: null,
      lastResult: message,
      refreshStatus: message,
      log: [...(current.log || []), entry].slice(-30),
      attemptedIds,
      lastAcceptanceOutcome: outcome
    });
    flow = null;
  }
  async function execute() {
    if (busy || !guarded() || !document.body || flow.stage === 'await-view') return;
    busy = true;
    try {
      while (guarded()) {
        if (flow.stage === 'await-view') break;
        if (checkSecurity()) throw Error('Security challenge detected');
        if (flow.stage === 'scroll') {
          await waitForOrderDetails();
          await jumpToBottom('take');
          const details=await chrome.storage.local.get({log:[]});
          const message='Order #'+flow.orderId+': instant order-details scrolling completed; review and accept manually.';
          await chrome.storage.local.set({
            autoFlow:null,lastResult:message,refreshStatus:message,
            log:[...(details.log||[]),new Date().toLocaleTimeString()+' '+message].slice(-30)
          });
          flow=null;
        } else if (flow.stage === 'take') {
          await waitForOrderDetails();
          await jumpToBottom('take');
          const el = await locate('take', true);
          const page = (document.body?.innerText || '') + ' ' + location.href;
          if (!page.includes(flow.orderId)) throw Error('Selected order ID not found in details');
          nativeOk=false;
          updateStage('ok');
          if (!guarded() || !el.isConnected) throw Error('Details changed before Take it');
          if(typeof Event==='function' && typeof window.dispatchEvent==='function')
            window.dispatchEvent(new Event('prowell-order-confirm-arm'));
          el.click();
        } else if (flow.stage === 'ok') {
          if(nativeOk){
            nativeOk=false;
            updateStage('understand');
            continue;
          }
          const el = await locate('ok', true);
          updateStage('understand');
          if (!guarded() || !el.isConnected) throw Error('Confirmation changed before OK');
          el.click();
        } else if (flow.stage === 'understand') {
          const el = await locate('understand', true);
          // Only scroll the acknowledgment if the button actually requires it.
          updateStage('verify');
          if (!guarded() || !el.isConnected) throw Error('Acknowledgment changed before I understand');
          el.click();
        } else if (flow.stage === 'verify') {
          if (!guarded()) throw Error('Workflow stopped before verification');
          await end('Order #' + flow.orderId + ': confirmation steps submitted. Verify assignment on the website.', 'submitted-unverified');
        } else {
          throw Error('Unknown acceptance step');
        }
      }
    } catch (e) {
      if (flow && flow.mode==='scroll-only') {
        const message='Order #'+flow.orderId+': scrolling failed — '+String(e?.message||e);
        await chrome.storage.local.set({autoFlow:null,lastResult:message,refreshStatus:message,
          lastScrollResult:'failed'});
        flow=null;
      } else if(flow) await end('Order #' + flow.orderId + ': stopped — ' + String(e?.message || e), 'stopped');
    } finally {
      busy = false;
    }
  }
  // View may navigate away before the original page's delayed handoff runs.
  // Resume pending work only after verifying a distinct order-details view.
  let viewRecoveryRunning=false;
  async function resumeAfterView(){
    if(viewRecoveryRunning || !guarded() || flow.stage!=='await-view')return;
    viewRecoveryRunning=true;
    try{
      await waitUntil(()=>{
        const text=(document.body?.innerText||'')+' '+location.href;
        if(!text.includes(String(flow.orderId)))return null;
        const overlayReady=foregroundSurfaces(find('take')).length>0;
        const fullDetail=inlineOrderDetails(find('take'))||detailsPage(find('take'));
        return overlayReady||fullDetail ? true : null;
      },'the opened order panel');
      if(!guarded()||flow.stage!=='await-view')return;
      updateStage(flow.mode==='scroll-only'?'scroll':'take');
      void execute();
    }catch(error){
      await chrome.storage.local.set({lastResult:'View handoff failed: '+
        String(error?.message||error)});
    }finally{viewRecoveryRunning=false;}
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoFlow) return;
    const next=changes.autoFlow.newValue || null;
    if(next && flow && next.orderId===flow.orderId &&
      next.startedAt===flow.startedAt && rank[next.stage]<rank[flow.stage])return;
    flow=next;
    if (flow?.stage==='await-view') void resumeAfterView();
    else if (flow) void execute();
  });
  // Safe diagnostic: scroll the currently open order-details pane only.
  // This never clicks order-taking or confirmation controls.
  async function testScrollOnly() {
    if(checkSecurity())return {ok:false,reason:'Security challenge present'};
    if(!document.body)return {ok:false,reason:'Document not ready'};
    const pageText=document.body.innerText||'';
    if(!find('take')&&!/order information|order details|order requirements/i.test(pageText)){
      return {ok:false,reason:'Open View on an order-details page first'};
    }
    const roots=scrollCandidates('take',find('take'));
    // The diagnostic must never move the page behind a foreground order dialog.
    for(const root of roots){
      if(checkSecurity())return {ok:false,reason:'Security challenge appeared'};
      const before=Number(root.scrollTop)||0;
      const bottom=Math.max(0,root.scrollHeight-root.clientHeight);
      instantScroll(root,bottom);
      const after=Number(root.scrollTop)||0;
      if(after>=bottom-3){
        const steps=after>before+1?1:0;
        const result={ok:true,steps,container:String(root.className||root.tagName||'order-panel').slice(0,100)};
        await chrome.storage.local.set({
          lastScrollStage:'manual-test',lastScrollResult:steps?'instant-bottom':'already-at-bottom',
          lastScrollSteps:steps,lastScrollContainer:result.container,lastScrollAt:Date.now()
        });
        return result;
      }
    }
    const error={ok:false,reason:roots.length?'Foreground order panel found, but could not jump to bottom':'Foreground order details not located; background page was not scrolled'};
    await chrome.storage.local.set({lastScrollStage:'manual-test',lastScrollResult:'failed',
      lastScrollSteps:0,lastScrollAt:Date.now()});
    return error;
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=='PROWELL_SCROLL_TEST')return;
    void testScrollOnly().then(respond).catch(error=>respond({ok:false,reason:String(error?.message||error)}));
    return true;
  });
  chrome.runtime.sendMessage({type: TAB_MESSAGE}, async response => {
    tabId = response?.tabId ?? null;
    const stored = await chrome.storage.local.get(['autoFlow']);
    flow = stored.autoFlow || null;
    if(flow?.stage==='await-view')void resumeAfterView();
    else void execute();
  });
  document.addEventListener('DOMContentLoaded', () => {
    if(flow?.stage==='await-view')void resumeAfterView();
    else void execute();
  }, {once:true});
})();