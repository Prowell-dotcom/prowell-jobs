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
  const store=window.__prowellDualStorage;
  if(!store)return;
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
  const DIALOGS='[role="dialog"],dialog,[aria-modal="true"],.modal,.modal-body,.popup,[class*="modal"],[class*="dialog"],[class*="popup"],[class*="drawer"],[class*="lightbox"],[class*="order-detail"],[class*="order-info"],[class*="assignment-detail"],[class*="order-window"],[class*="scroll-pane"]';
  const DETAILS='main,[role="main"],#content,#main,.main,.main-content,.content-body,.order-info,.order-details,[class*="order-info"],[class*="order-detail"],[class*="assignment-detail"],[class*="instructions"],[class*="description"]';
  function rendered(el) {
    if(!visible(el) || el.hidden || el.getAttribute?.('aria-hidden')==='true')return false;
    const st=getComputedStyle(el);
    if(st?.display==='none'||st?.visibility==='hidden')return false;
    const r=el.getBoundingClientRect?.();
    if(r && !(r.width>0&&r.height>0))return false;
    return true;
  }
  const DETAILS_HEADING=/order\s*(?:information|info|details?|instructions?|requirements?)|assignment\s*(?:details?|information)|order\s*description/i;
  function orderText(el) {
    const text=String(el?.innerText||el?.textContent||'');
    const id=String(flow?.orderId||'');
    // The order ID is still visible on the listing *behind* View.
    // Never treat that ID alone as proof that the opened details loaded.
    return Boolean(DETAILS_HEADING.test(text) &&
      (text.includes(id) || /subject|deadline|instructions|description|files/i.test(text)));
  }
  function foregroundSurfaces(button) {
    // Never scan every element on the page: that delayed View and recognition
    // on complex writer dashboards. Use real dialogs and the button's ancestors.
    const possible=[...document.querySelectorAll(DIALOGS)];
    // The details popup can use different wrapper names on different orders.
    // Look for visible foreground content if the standard dialog selector
    // has no selected order details. Do not scan the entire DOM as a first step.
    if(!possible.some(el=>rendered(el) && orderText(el))){
      const extras=document.querySelectorAll?.(
        '[class*="assignment"],[class*="detail"],[class*="overlay"],' +
        '[class*="window"],[class*="order"],[style*="position"],' +
        '[style*="overflow"],[role="main"],main')||[];
      for(const el of [...extras].slice(0,1500))possible.push(el);
    }
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
          Boolean(r && r.width>=180 && r.height>=120)) ||
        (/assignment-detail|order-detail|order-info|details-window|scroll-pane/i.test(
            String(el.className||'')+' '+String(el.id||'')) &&
          Boolean(r && r.width>=180 && r.height>=120));
      const hasButton=Boolean(button && el.contains?.(button));
      // A visible dialog with the selected order-details heading is enough.
      // Unrelated order-list cards, menus, and page backgrounds are excluded.
      return overlay && (hasButton || orderText(el));
    });
    hits.sort((a,b)=>{
      const score=el=>{
        let n=0;
        if(button && el.contains?.(button))n+=100;
        if(el.getAttribute?.('aria-modal')==='true')n+=80;
        if(el.getAttribute?.('role')==='dialog')n+=60;
        if(orderText(el))n+=80;
        if(/modal|popup|dialog|order-detail|order-info|assignment-detail/i.test(
          String(el.className||'')))n+=25;
        const z=parseInt(getComputedStyle(el)?.zIndex,10)||0;
        n+=Math.max(0,Math.min(10000,z))/100;
        return n;
      };
      return score(b)-score(a);
    });
    if(hits.length)return hits.slice(0,16);
    // Screenshot-style ORDER INFORMATION windows sometimes have no dialog
    // role or recognizable popup class. Search only after View has opened,
    // anchoring the search to the exact order ID and visible heading.
    const candidates=[...document.querySelectorAll?.(
      '[id*="order"],[id*="modal"],[id*="info"],' +
      '[class*="content"],[class*="information"],[class*="container"],' +
      '[style*="position"],[style*="overflow"]')||[]];
    const fallback=candidates.filter(el=>{
      if(!rendered(el)||el===document.body||el===document.documentElement)return false;
      const t=String(el.innerText||el.textContent||'');
      if(!DETAILS_HEADING.test(t)||!t.includes(String(flow?.orderId||'')))return false;
      const rect=el.getBoundingClientRect?.();
      if(!rect||rect.width<200||rect.height<180)return false;
      const st=getComputedStyle(el);
      const positioned=/fixed|absolute/i.test(String(st?.position||''));
      const named=/modal|popup|detail|order|information|assignment|container/i.test(
        String(el.className||'')+' '+String(el.id||''));
      return positioned||named;
    });
    // Choose the smallest matching container, to avoid selecting the main
    // dashboard wrapper that contains the popup *and* background controls.
    fallback.sort((a,b)=>String(a.innerText||'').length-String(b.innerText||'').length);
    return fallback.slice(0,12);
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
    // A same-URL inline panel is allowed only with selected ID and a
    // real order-details heading; it must not be a listing card.
    const id=String(flow?.orderId||'');
    if(!id)return null;
    const candidates=[...document.querySelectorAll(DETAILS)].filter(el=>{
      if(!rendered(el))return false;
      const t=String(el.innerText||el.textContent||'');
      return t.includes(id) && DETAILS_HEADING.test(t) &&
        (!button||el.contains?.(button));
    });
    // Frameworks sometimes use unlabelled wrappers. Walk up from Take it
    // to find the selected order panel without ever reaching body/sidebar.
    if(button)for(let p=button.parentElement;p&&p!==document.body;p=p.parentElement){
      if(!rendered(p))continue;
      const t=String(p.innerText||p.textContent||'');
      if(t.length>50000)break;
      if(t.includes(id) && DETAILS_HEADING.test(t))
        candidates.push(p);
    }
    candidates.sort((a,b)=>String(a.innerText||'').length-String(b.innerText||'').length);
    return candidates[0]||null;
  }
  // IMPORTANT: the fixed ORDER INFORMATION window may have an inner scroll
  // node OR its scrollbar may belong to an ANCESTOR of the element carrying
  // the heading. Previous versions considered only one popup subtree, so a
  // perfectly visible popup could remain completely unscrolled.
  function scrollCandidates(stage,button) {
    const foreground=foregroundSurfaces(button);
    const items=new Set();
    const add=el=>{if(el)items.add(el);};
    if(foreground.length){
      for(const root of foreground){
        add(root);
        // Descendant scroll panes such as modal-body/scroll-content.
        for(const child of root.querySelectorAll?.('*')||[])add(child);
        // Ancestor scroll panes such as dialog/window/modal-container when
        // the order heading is inside a small fixed header.
        for(let p=root.parentElement,depth=0;
            p && p!==document.body && depth<8;p=p.parentElement,depth++){
          if(p===document.documentElement || p===document.scrollingElement)break;
          if(rendered(p) &&
            (orderText(p) || /modal|dialog|popup|order|window|detail/i.test(
              String(p.className||'')+' '+String(p.id||''))))add(p);
        }
      }
    }else{
      const inline=inlineOrderDetails(button);
      const full=detailsPage(button);
      if(!inline&&!full)return [];
      // The site sometimes uses an entire details page instead of a dialog.
      const mains=inline?[inline]:[...document.querySelectorAll(DETAILS)]
        .filter(el=>rendered(el) && (orderText(el) ||
          (button && el.contains?.(button))));
      for(const main of mains){
        add(main);
        for(const child of main.querySelectorAll?.('*')||[])add(child);
      }
      const hasInner=[...items].some(el=>el!==document.scrollingElement &&
        Number(el.scrollHeight)-Number(el.clientHeight)>40);
      if(!hasInner && flow?.listUrl!==location.href && full)
        add(document.scrollingElement||document.documentElement);
    }
    const pageRoot=document.scrollingElement||document.documentElement;
    const verified=[...items].filter(el=>{
      if(!el || el===document.body)return false;
      if(foreground.length &&
        (el===pageRoot || el===document.documentElement))return false;
      if(el!==pageRoot && !rendered(el))return false;
      const range=Number(el.scrollHeight)-Number(el.clientHeight);
      if(!Number.isFinite(range)||range<=30||Number(el.clientHeight)<50)return false;
      // Candidate must be inside or enclosing a confirmed foreground order
      // popup, or belong to a verified standalone full details page.
      if(foreground.length &&
        !foreground.some(root=>root===el ||
          root.contains?.(el) || el.contains?.(root)))return false;
      return true;
    });
    const score=el=>{
      const st=getComputedStyle(el);
      const cl=String(el.className||'')+' '+String(el.id||'');
      let n=0;
      if(/auto|scroll|overlay/i.test(String(st?.overflowY||'')))n+=120;
      if(/body|detail|description|instruction|scroll|content|window/i.test(cl))n+=75;
      if(button && el.contains?.(button))n+=20;
      if(orderText(el))n+=8;
      if(el===pageRoot)n-=160;
      // Prefer the nearest inner scrolling pane over an outer wrapper, but
      // probe all verified scroll nodes in one task, without delays.
      n-=Math.min(80,(Number(el.clientHeight)||0)/20);
      return n;
    };
    verified.sort((a,b)=>score(b)-score(a));
    return verified;
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
  // A processing order is already assigned. Its Files + Messages + View
  // details do not have Take it. Never depend on a Take it control to identify
  // or scroll that panel.
  const previewingProcessing=()=>flow?.orderKind==='processing' ||
    flow?.mode==='processing-preview';
  const detailButton=()=>previewingProcessing()?null:find('take');
  async function waitForOrderDetails() {
    await waitUntil(()=>{
      const text=(document.body?.innerText||'')+' '+location.href;
      if(!text.includes(String(flow.orderId)))return null;
      const button=detailButton();
      return foregroundSurfaces(button).length>0 ||
        inlineOrderDetails(button) || detailsPage(button) ? true : null;
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
    const button=previewingProcessing()?null:find(stage);
    const roots=scrollCandidates(stage,button);
    if(!roots.length){
      // Never report PASS from a modal shell alone. The fixed shell can fit
      // the viewport while the long description inside is still at the top.
      const target=button;
      if(target && inViewport(target) &&
          (foregroundSurfaces(target).length ||
           inlineOrderDetails(target)||detailsPage(target))){
        void store.local.set({lastScrollStage:stage,lastScrollResult:'button-visible',
          lastScrollSteps:0,lastScrollAt:Date.now(),lastScrollContainer:'visible Take it'});
        return {result:'button-visible',pixels:0,container:'visible Take it'};
      }
      throw Error('ORDER INFORMATION appeared, but its actual scrolling container was not found');
    }
    let moved=0,foundAtBottom=0,firstName='';
    // Jump *all* scrollable surfaces belonging to the verified foreground
    // popup, including its scrollable ancestors. This is synchronous: no
    // smooth animation, scroll steps, or delayed probing.
    for(const root of roots){
      if(!guarded())throw Error('Order workflow stopped');
      if(checkSecurity())throw Error('Security challenge detected');
      const before=Number(root.scrollTop)||0;
      const bottom=Math.max(0,Number(root.scrollHeight)-Number(root.clientHeight));
      if(bottom-before<=3){foundAtBottom++;continue;}
      instantScroll(root,bottom);
      const after=Number(root.scrollTop)||0;
      if(after>=bottom-5 && after>before+1){
        moved+=after-before;
        if(!firstName)firstName=String(root.className||root.tagName||'order-panel').slice(0,100);
      }
    }
    if(moved>1){
      void store.local.set({lastScrollStage:stage,lastScrollSteps:1,
        lastScrollResult:'instant-bottom',lastScrollAt:Date.now(),
        lastScrollContainer:firstName,lastScrollPixels:moved});
      return {result:'instant-bottom',pixels:moved,container:firstName};
    }
    if(foundAtBottom===roots.length){
      const name=String(roots[0]?.className||roots[0]?.tagName||'order-panel').slice(0,100);
      void store.local.set({lastScrollStage:stage,lastScrollSteps:0,
        lastScrollResult:'already-at-bottom',lastScrollAt:Date.now(),
        lastScrollContainer:name,lastScrollPixels:0});
      return {result:'already-at-bottom',pixels:0,container:name};
    }
    throw Error('ORDER INFORMATION popup detected, but scrollTop did not change');
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
    const write=store.local.set({autoFlow:next});
    pendingWrites=Promise.allSettled([pendingWrites,write]);
  }
  async function end(message, outcome) {
    await pendingWrites;
    const current = await store.local.get({log: [], attemptedIds: []});
    const entry = new Date().toLocaleTimeString() + ' ' + message;
    const attemptedIds = [...new Set([...(current.attemptedIds || []), String(flow?.orderId || '')])].filter(Boolean).slice(-100);
    await store.local.set({
      autoFlow: null,
      lastResult: message,
      refreshStatus: message,
      log: [...(current.log || []), entry].slice(-30),
      attemptedIds,
      lastAcceptanceOutcome: outcome
    });
    flow = null;
  }
  // The Take it action occurs directly after the successful scroll. This
  // avoids a second panel search/scroll between those consecutive actions.
  async function clickTakeNow(){
    const el=await locate('take',true);
    const page=(document.body?.innerText||'')+' '+location.href;
    if(!page.includes(flow.orderId))throw Error('Selected order ID not found in details');
    nativeOk=false;
    updateStage('ok'); // persisted without awaiting the storage roundtrip
    if(!guarded()||!el.isConnected)throw Error('Details changed before Take it');
    if(typeof Event==='function' && typeof window.dispatchEvent==='function')
      window.dispatchEvent(new Event('prowell-order-confirm-arm'));
    el.click();
  }
  async function execute() {
    if (busy || !guarded() || !document.body || flow.stage === 'await-view') return;
    busy = true;
    try {
      while (guarded()) {
        if (flow.stage === 'await-view') break;
        if (checkSecurity()) throw Error('Security challenge detected');
        if (flow.stage === 'scroll') {
          // Common fast path for both new and processing orders. Process only
          // once the selected details panel is visible, then instant jump.
          await waitForOrderDetails();
          const scroll=await jumpToBottom('take');
          if(flow.mode==='accept' && !previewingProcessing()){
            await clickTakeNow();
            continue; // OK and I understand fire on readiness, no fixed delay
          }
          const id=String(flow.orderId);
          const processing=previewingProcessing();
          const details=await store.local.get({log:[],processingPreviewedIds:[]});
          const moved=scroll.result==='instant-bottom';
          const message=processing
            ? 'Processing order #'+id+': View opened; '+(moved
              ? 'scrolled '+scroll.pixels+'px inside '+scroll.container
              : 'scroll result: '+scroll.result+' ('+scroll.container+')')+
              '. No Take it expected; processing test ended.'
            : 'Order #'+id+': details scroll result: '+scroll.result+'; review and accept manually.';
          await store.local.set({
            autoFlow:null,lastResult:message,refreshStatus:message,
            ...(processing?{
              processingPreviewedIds:[...new Set([...(details.processingPreviewedIds||[]),id])].slice(-150),
              lastProcessingPreview:{orderId:id,result:moved?'scroll-passed':scroll.result,
                container:scroll.container,pixels:scroll.pixels,at:Date.now()}
            }:{}),
            log:[...(details.log||[]),new Date().toLocaleTimeString()+' '+message].slice(-30)
          });
          flow=null;
        } else if (flow.stage === 'take') {
          // Resume in-progress workflows created by an earlier extension.
          await waitForOrderDetails();
          await jumpToBottom('take');
          await clickTakeNow();
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
      if (flow && (flow.mode==='scroll-only'||previewingProcessing())) {
        const processing=previewingProcessing();
        const id=String(flow.orderId);
        const message=(processing?'Processing-order preview test #':'Order #')+id+
          ': scrolling failed — '+String(e?.message||e);
        await store.local.set({autoFlow:null,lastResult:message,refreshStatus:message,
          ...(processing?{lastProcessingPreview:{orderId:id,result:'scroll-failed',at:Date.now()}}:{}),
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
        const button=detailButton();
        const overlayReady=foregroundSurfaces(button).length>0;
        const fullDetail=inlineOrderDetails(button)||detailsPage(button);
        return overlayReady||fullDetail ? true : null;
      },'the opened order panel');
      if(!guarded()||flow.stage!=='await-view')return;
      // Scroll comes first for every type, even when Take it is absent.
      updateStage('scroll');
      void execute();
    }catch(error){
      // A missing details wrapper must not leave autoFlow active for 90s,
      // silently blocking another processing-order test.
      const id=String(flow?.orderId||'');
      const reason='View handoff failed: '+String(error?.message||error);
      const processing=previewingProcessing();
      await store.local.set({autoFlow:null,lastResult:reason,
        refreshStatus:reason,
        ...(processing?{lastProcessingPreview:{orderId:id,
          result:'scroll-failed',reason,at:Date.now()}}:{})});
      flow=null;
    }finally{viewRecoveryRunning=false;}
  }
  store.onChanged.addListener((changes, area) => {
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
        await store.local.set({
          lastScrollStage:'manual-test',lastScrollResult:steps?'instant-bottom':'already-at-bottom',
          lastScrollSteps:steps,lastScrollContainer:result.container,lastScrollAt:Date.now()
        });
        return result;
      }
    }
    const error={ok:false,reason:roots.length?'Foreground order panel found, but could not jump to bottom':'Foreground order details not located; background page was not scrolled'};
    await store.local.set({lastScrollStage:'manual-test',lastScrollResult:'failed',
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
    const stored = await store.local.get(['autoFlow']);
    flow = stored.autoFlow || null;
    if(flow?.stage==='await-view')void resumeAfterView();
    else void execute();
  });
  document.addEventListener('DOMContentLoaded', () => {
    if(flow?.stage==='await-view')void resumeAfterView();
    else void execute();
  }, {once:true});
})();