/* Prowell opt-in order acceptance. Fixed waits and incremental navigation,
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
  const STEP_PX = 140;
  const STEP_DELAY = 100;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let tabId = null, flow = null, busy = false;
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
  // Detect the actual foreground order popup. Never fall back to the webpage
  // behind a visible popup, even when the background itself is scrollable.
  const DIALOGS='[role="dialog"],dialog,[aria-modal="true"],.modal,.modal-body,.popup,[class*="modal"],[class*="dialog"],[class*="popup"],[class*="drawer"],[class*="lightbox"],[class*="order-info"],[class*="order-detail"]';
  function rendered(el) {
    if(!visible(el) || el.hidden || el.getAttribute?.('aria-hidden')==='true')return false;
    const style=getComputedStyle(el);
    if(style?.display==='none' || style?.visibility==='hidden')return false;
    const rect=el.getBoundingClientRect?.();
    if(rect && rect.width===0 && rect.height===0)return false;
    return true;
  }
  function foregroundSurfaces(button) {
    const orderId=String(flow?.orderId||'');
    const all=[...document.querySelectorAll(DIALOGS)].filter(rendered);
    const relevant=all.filter(el=>{
      const t=String(el.innerText||el.textContent||'');
      return Boolean(button&&el.contains?.(button))||
        (orderId&&t.includes(orderId))||
        /order information|order details|order instructions|order requirements|acknowledg/i.test(t);
    });
    // Some pages hide the order ID in the modal header. A single visible
    // dialog still outranks every scrollable element in the background.
    const selected=relevant.length?relevant:all.length===1?all:[];
    selected.sort((a,b)=>{
      const score=el=>{
        const text=String(el.innerText||el.textContent||'');
        const style=getComputedStyle(el);
        let value=0;
        if(button&&el.contains?.(button))value+=60;
        if(orderId&&text.includes(orderId))value+=25;
        if(el.getAttribute?.('role')==='dialog'||el.getAttribute?.('aria-modal')==='true')value+=45;
        if(/modal|dialog|popup|drawer/i.test(String(el.className||'')))value+=30;
        value+=Math.min(100,parseInt(style?.zIndex,10)||0)/10;
        return value;
      };
      return score(b)-score(a);
    });
    // If a real dialog is present, discard background order cards entirely.
    const dialogs=selected.filter(el=>el.getAttribute?.('role')==='dialog' ||
      el.getAttribute?.('aria-modal')==='true' ||
      /(?:^|[\\s_-])(modal|dialog|popup|drawer)(?:$|[\\s_-])/i.test(String(el.className||'')));
    if(dialogs.length){
      dialogs.sort((a,b)=>{
        const sa=getComputedStyle(a),sb=getComputedStyle(b);
        return (parseInt(sb?.zIndex,10)||0)-(parseInt(sa?.zIndex,10)||0);
      });
      return [dialogs[0]];
    }
    return selected.length?[selected[0]]:[];
  }
  function dedicatedDetailsPage() {
    const kind=window.__prowellCardDetector?.pageKind?.();
    if(['available','overview','processing'].includes(kind))return false;
    const current=String(location.href||'');
    const changed=Boolean(flow?.listUrl&&flow.listUrl!==current);
    const path=String(location.pathname||current);
    const detailPath=/\/(?:order|view|detail|info)[/_-]/i.test(path);
    const identified=Boolean(flow?.orderId && ((document.body?.innerText||'')+' '+current).includes(String(flow.orderId)));
    return Boolean(identified&&(changed||detailPath)&&find('take'));
  }
  function scrollCandidates(stage,button) {
    const surfaces=foregroundSurfaces(button);
    const set=new Set(), isOverlay=surfaces.length>0;
    if(isOverlay){
      for(const surface of surfaces){
        set.add(surface);
        for(const node of surface.querySelectorAll?.('*')||[])set.add(node);
      }
      for(let p=button?.parentElement;p&&p!==document.body;p=p.parentElement){
        if(surfaces.some(surface=>surface===p||surface.contains?.(p)))set.add(p);
      }
    }else if(dedicatedDetailsPage()){
      // A genuine full-page order detail can scroll its own document.
      // Listing pages and pages behind a modal are never eligible.
      for(const node of document.querySelectorAll('body *'))set.add(node);
      set.add(document.scrollingElement||document.documentElement);
    }else return [];
    const candidates=[...set].filter(el=>{
      if(!el||!Number.isFinite(el.scrollHeight)||!Number.isFinite(el.clientHeight))return false;
      if(el.clientHeight<60 || el.scrollHeight-el.clientHeight<=45)return false;
      if(isOverlay&&(el===document.body||el===document.documentElement||
        el===document.scrollingElement))return false;
      if(!rendered(el) && el!==document.scrollingElement)return false;
      const style=getComputedStyle(el);
      const overflow=String(style?.overflowY||'');
      return /auto|scroll|hidden|overlay/i.test(overflow)||isOverlay;
    });
    function score(el){
      const style=getComputedStyle(el);
      const txt=String(el.innerText||el.textContent||'');
      const cl=String(el.className||'');
      let value=0;
      if(isOverlay)value+=120;
      if(/auto|scroll|overlay/i.test(String(style?.overflowY||'')))value+=55;
      if(/body|scroll|instructions|description|content|details/i.test(cl))value+=45;
      if(stage==='take'&&/instructions|description|order information|order details/i.test(txt))value+=20;
      if(stage==='understand'&&/understand|acknowledg|terms/i.test(txt))value+=20;
      if(button&&el.contains?.(button))value+=12;
      if(surfaces.includes(el))value-=8;
      if(el===document.scrollingElement||el===document.documentElement)value-=60;
      return value;
    }
    candidates.sort((a,b)=>score(b)-score(a));
    return candidates;
  }
  async function waitForOrderDetails() {
    const started=Date.now();
    while(Date.now()-started<STEP_TIMEOUT){
      if(!guarded())throw Error('Order workflow expired while opening View');
      if(checkSecurity())throw Error('Security challenge detected');
      const page=(document.body?.innerText||'')+' '+location.href;
      const detailsReady=find('take')||
        /order information|order details|instructions|requirements/i.test(document.body?.innerText||'');
      if(page.includes(String(flow.orderId))&&detailsReady)return;
      await sleep(150);
    }
    throw Error('Order details did not appear after View');
  }
  async function readThrough(stage){
    // The details can be inside a nested modal, an ordinary page, or a
    // late-rendered pane. Inspect all visible scrollable descendants rather
    // than assuming the first matching class is the scrolling container.
    const deadline=Date.now()+STEP_TIMEOUT;
    const tried=new Set();
    let moved=0,foundOverflow=false,rootLabel='none';
    while(Date.now()<deadline){
      if(!guarded())throw Error('Order workflow stopped');
      if(checkSecurity())throw Error('Security challenge detected');
      const roots=scrollCandidates(stage,find(stage));
      // Deliberately no background-page fallback when an order dialog is open.
      // A missing foreground scroll root is an actionable diagnostic failure.
      if(roots.length){
        foundOverflow=true;
        for(const root of roots){
          if(!root || tried.has(root))continue;
          const distance=(root.scrollHeight||0)-(root.clientHeight||0)-(root.scrollTop||0);
          if(distance<=3){tried.add(root);continue;}
          const initial=root.scrollTop||0;
          let steps=0;
          while(steps<160 && Date.now()<deadline){
            if(!guarded()||checkSecurity())throw Error('Scrolling interrupted');
            if((root.scrollHeight||0)-(root.clientHeight||0)-(root.scrollTop||0)<=3)break;
            if(!await move(root,1))break;
            steps++;moved++;
          }
          rootLabel=String(root.className||root.tagName||'page').slice(0,100);
          const remaining=(root.scrollHeight||0)-(root.clientHeight||0)-(root.scrollTop||0);
          if(remaining<=5 && (root.scrollTop||0)>initial){
            await chrome.storage.local.set({lastScrollStage:stage,lastScrollSteps:steps,
              lastScrollResult:'verified-movement',lastScrollContainer:rootLabel,
              lastScrollAt:Date.now()});
            return;
          }
          tried.add(root);
        }
      }
      if(moved>0) break;
      // If the details genuinely fit and the action is already rendered,
      // do not wait the full timeout to confirm the absence of overflow.
      if(!foundOverflow && find(stage) && Date.now() > deadline-STEP_TIMEOUT+1200)break;
      await sleep(200);
    }
    if(!foundOverflow){
      const surfaces=foregroundSurfaces(find(stage));
      const hasIframe=surfaces.some(el=>Boolean(el.querySelector?.('iframe')));
      // Short content inside a verified popup may not need scrolling.
      const short=surfaces.length>0 && !hasIframe &&
        surfaces.every(el=>!Number.isFinite(el.scrollHeight)||
          el.scrollHeight<=el.clientHeight+45);
      if(short && find(stage)){
        await chrome.storage.local.set({lastScrollStage:stage,lastScrollSteps:0,
          lastScrollResult:'verified-short-order-popup',lastScrollAt:Date.now()});
        return;
      }
      await chrome.storage.local.set({lastScrollStage:stage,lastScrollSteps:0,
        lastScrollResult:'foreground-scroll-pane-not-found',lastScrollAt:Date.now()});
      throw Error(hasIframe?'Order details appear inside an iframe; inspect that frame':
        'Foreground order-details pane not found — background page was left untouched');
    }
    await chrome.storage.local.set({lastScrollStage:stage,lastScrollSteps:moved,
      lastScrollResult:'failed',lastScrollContainer:rootLabel,lastScrollAt:Date.now()});
    throw Error('Could not verify order-details scrolling; check extension popup diagnostics');
  }
  async function move(root, direction) {
    if (!root || !guarded() || checkSecurity()) return false;
    const initial = root.scrollTop || 0;
    const limit = Math.max(0, (root.scrollHeight || 0) - (root.clientHeight || 0));
    const next = Math.max(0, Math.min(limit, initial + direction * STEP_PX));
    if (Math.abs(next - initial) < 1) return false;
    root.scrollTop = next;
    await sleep(STEP_DELAY);
    return Math.abs((root.scrollTop || 0) - initial) >= 2;
  }
  async function locate(stage, scrollAllowed) {
    const start = Date.now();
    let steps = 0;
    while (Date.now() - start < STEP_TIMEOUT) {
      if (!guarded()) throw Error('Order workflow was stopped or expired');
      if (checkSecurity()) throw Error('Security challenge detected');
      const el = find(stage);
      if (el) {
        if (inViewport(el)) return el;
        if (!scrollAllowed) throw Error(stage + ' control is not visible; no automatic scrolling allowed');
        const rect = el.getBoundingClientRect();
        const direction = rect.top >= (window.innerHeight || 850) ? 1 : -1;
        if (steps < 90 && await move(scrollCandidates(stage,el)[0], direction)) {
          steps++;
          continue;
        }
      } else if (scrollAllowed && steps < 90) {
        if (await move(scrollCandidates(stage,null)[0], 1)) {
          steps++;
          continue;
        }
      }
      await sleep(150);
    }
    throw Error('Timed out waiting for ' + stage + ' control');
  }
  async function updateStage(stage) {
    if (!guarded()) throw Error('Workflow stopped');
    flow = {...flow, stage, stageStartedAt: Date.now()};
    await chrome.storage.local.set({autoFlow: flow});
  }
  async function end(message, outcome) {
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
          await readThrough('take');
          const details=await chrome.storage.local.get({log:[]});
          const message='Order #'+flow.orderId+': gradual details scrolling completed; review and accept manually.';
          await chrome.storage.local.set({
            autoFlow:null,lastResult:message,refreshStatus:message,
            log:[...(details.log||[]),new Date().toLocaleTimeString()+' '+message].slice(-30)
          });
          flow=null;
        } else if (flow.stage === 'take') {
          await waitForOrderDetails();
          await readThrough('take');
          const el = await locate('take', true);
          const page = (document.body?.innerText || '') + ' ' + location.href;
          if (!page.includes(flow.orderId)) throw Error('Selected order ID not found in details');
          await updateStage('ok');
          if (!guarded() || !el.isConnected) throw Error('Details changed before Take it');
          el.click();
        } else if (flow.stage === 'ok') {
          const elapsed = Date.now() - (flow.stageStartedAt || Date.now());
          if (elapsed < 500) await sleep(500 - elapsed);
          const el = await locate('ok', false);
          await updateStage('understand');
          if (!guarded() || !el.isConnected) throw Error('Confirmation changed before OK');
          el.click();
        } else if (flow.stage === 'understand') {
          if (IS_FOUR) await readThrough('understand');
          const el = await locate('understand', IS_FOUR);
          await updateStage('verify');
          if (!guarded() || !el.isConnected) throw Error('Acknowledgment changed before I understand');
          el.click();
        } else if (flow.stage === 'verify') {
          await sleep(850);
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
      const deadline=Date.now()+STEP_TIMEOUT;
      while(guarded()&&flow.stage==='await-view'&&Date.now()<deadline){
        if(checkSecurity())throw Error('Security challenge detected after View');
        const text=document.body?.innerText||'';
        const idPresent=(text+' '+location.href).includes(String(flow.orderId));
        const listPage=['available','overview','processing'].includes(
          window.__prowellCardDetector?.pageKind?.());
        const viewChanged=Boolean(flow.listUrl && location.href!==flow.listUrl);
        const hasOrderDialog=[...document.querySelectorAll(DIALOGS)].some(el=>
          visible(el) && ((el.innerText||el.textContent||'').includes(String(flow.orderId))||
          Boolean(find('take') && el.contains?.(find('take')))));
        if(idPresent && (hasOrderDialog ||
          (Boolean(find('take')) && (viewChanged || !listPage)) ||
          (viewChanged && !listPage))){
          const next={...flow,stage:flow.mode==='scroll-only'?'scroll':'take',stageStartedAt:Date.now()};
          await chrome.storage.local.set({autoFlow:next});
          flow=next;
          break;
        }
        await sleep(150);
      }
    }catch(error){
      await chrome.storage.local.set({lastResult:'Pending order View handoff failed: '+
        String(error?.message||error)});
    }finally{viewRecoveryRunning=false;}
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoFlow) return;
    flow = changes.autoFlow.newValue || null;
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
    const direct=scrollCandidates('take',find('take'));
    const roots=[...direct];
    // Never test-scroll the background when foreground order details are open.
    for(const root of roots){
      let steps=0;
      const initial=root.scrollTop||0;
      for(let n=0;n<100;n++){
        if(checkSecurity())return {ok:false,reason:'Security challenge appeared'};
        const before=root.scrollTop||0;
        const limit=Math.max(0,root.scrollHeight-root.clientHeight);
        if(before>=limit-3)break;
        root.scrollTop=Math.min(limit,before+140);
        await sleep(100);
        if(Math.abs((root.scrollTop||0)-before)<2)break;
        steps++;
      }
      if(steps>0){
        const result={ok:true,steps,container:String(root.className||root.tagName||'page').slice(0,100)};
        await chrome.storage.local.set({lastScrollStage:'manual-test',lastScrollResult:'verified-movement',
          lastScrollSteps:steps,lastScrollContainer:result.container,lastScrollAt:Date.now()});
        return result;
      }
    }
    const error={ok:false,reason:roots.length?'Foreground order panel found, but it did not move':'Foreground order details not located; background page was not scrolled'};
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
  document.addEventListener('DOMContentLoaded', () => void execute(), {once: true});
})();