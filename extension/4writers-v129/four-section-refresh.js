/* Standalone 4Writers refresh engine for two Available Orders sections.
 * Uses a fixed uneven cycle of idle waits from 2 to 60 seconds,
 * never invents section URLs, and never refreshes a partly rendered page.
 * Does NOT replace the owner's original View/Take it/confirmation engine.
 */
(() => {
  'use strict';
  if(window!==window.top||!/^(?:www\.)?4writers\.net$/i.test(location.hostname))return;
  if(window.__prowellFourSectionRefreshLoaded)return;
  window.__prowellFourSectionRefreshLoaded=true;
  const store=window.__prowellDualStorage;
  const sections=window.__prowellFourSections;
  if(!store||!sections)return;
  const VERSION='0.5.4';
  // Deterministic mixed-length idle intervals. Brief 2–5s waits occur
  // infrequently; most waits are longer, avoiding sustained high-rate reloads.
  // This is scheduling for normal operation, not site-detection evasion.
  const INTERVALS=Object.freeze([
    60000,8000,40000,5000,50000,12000,30000,3000,45000,10000,
    20000,4000,35000,6000,15000,2000,25000,9000,55000,7000
  ]);
  const nextWait=()=>INTERVALS[count%INTERVALS.length];
  let tabId=null,timer=null,timerMode='',count=0,lastSection='';
  let status='',local={armed:false,claimConsentVersion:'',targetTabId:null,
    claim:null,attemptedIds:[],completed:[],refreshCount:0};
  const active=()=>Boolean(local.armed && local.claimConsentVersion===VERSION &&
    Number.isInteger(tabId) && local.targetTabId===tabId);
  const stopTimer=()=>{if(timer!==null)clearTimeout(timer);timer=null;timerMode='';};
  window.__prowellDualStopRefresh=stopTimer;
  function report(message){
    if(message===status)return;
    status=message;
    void store.local.set({refreshStatus:message});
  }
  const blocked=()=>/captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i.test(
    String(document.body?.innerText||''))||
    Boolean(document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  function listReady(){
    if(!document.body||!sections.available())return false;
    const text=String(document.body.innerText||'');
    const headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .filter(el=>el.getClientRects?.().length)
      .some(el=>/^available\s+(?:orders|writings|rewritings)$/i.test(
        String(el.innerText||el.textContent||'').trim()));
    // The screenshot's ready page has "Available orders", search controls,
    // sorting controls, and may say "None" when the list is empty.
    const controls=/\b(?:order by|search keywords|show all)\b/i.test(text) ||
      Boolean(document.querySelector('input[placeholder*="Search"],[class*="order-list"],[class*="order-table"],table tbody'));
    return headings && (controls||window.__prowellCardDetector?.cards?.().length>0);
  }
  function unseenOrder(){
    // Use the content engine's per-appearance guard, never the persisted
    // attempted/completed ID history. A returning ID must pause refresh and
    // reach View again after it reappears or the page is reloaded.
    const hits=window.__prowellDualActionableCards?.()||
      window.__prowellCardDetector?.cards?.()||[];
    return hits.some(card=>card?.type==='processing'||card?.type==='available');
  }
  function sectionFromPage(){
    const chosen=sections.selected();
    if(chosen==='writings'||chosen==='rewritings')return chosen;
    return lastSection||'writings';
  }
  function findLink(target){
    return sections.links().find(el=>String(el.innerText||el.textContent||'')
      .trim().toLowerCase()===target) || null;
  }
  // The neutral 4writers account screen is a separate orders surface. It
  // has no selected Writings/Rewritings tab, so section switching never
  // refreshes it. Reload THIS SAME SCREEN on the chosen interval while idle.
  async function refreshOverview(){
    timer=null;timerMode='';
    if(!active()||local.claim||blocked()||unseenOrder()||
       !sections.overview()||document.readyState!=='complete'){
      evaluate();return;
    }
    const at=Date.now();
    count+=1;
    await store.local.set({
      refreshCount:count,lastRefreshAt:at,
      fourLastCheckedSection:'overview',fourLastCheckedAt:at,
      fourCycleCount:count,
      refreshStatus:'4writers: refreshing neutral Available Orders screen'
    });
    status='4writers: refreshing neutral Available Orders screen';
    if(!active()||local.claim||blocked()||unseenOrder()||
       !sections.overview())return evaluate();
    location.reload();
  }
  async function cycle(){
    timer=null;timerMode='';
    if(!active()||local.claim||blocked()||unseenOrder()||
       !sections.available()||!listReady()){
      evaluate();return;
    }
    const current=sectionFromPage();
    const target=current==='writings'?'rewritings':'writings';
    const link=findLink(target);
    const time=Date.now();
    count+=1;lastSection=current;
    await store.local.set({
      refreshCount:count,lastRefreshAt:time,
      fourLastCheckedSection:current,
      fourLastCheckedAt:time,
      fourCycleCount:count,
      refreshStatus:'4writers: checked '+current+'; switching to '+target
    });
    status='4writers: checked '+current+'; switching to '+target;
    if(!active()||local.claim||blocked()||unseenOrder()||!listReady()){
      evaluate();return;
    }
    if(!link){
      report('4writers: '+target+' navigation not found; reloading '+current+' only');
      // Do not claim that both sections are monitored when a link is missing.
      location.reload();
      return;
    }
    // Use the site's real link and its own click handler; it may implement
    // AJAX tabs or normal same-origin navigation. No guessed URLs.
    try{
      const href=link.getAttribute?.('href')||'';
      if(href && !href.startsWith('#') && !/^javascript:/i.test(href)){
        const url=new URL(href,location.href);
        if(url.origin!==location.origin)throw Error('Navigation outside 4writers blocked');
      }
      link.click();
      // If the tab is handled with AJAX, the observer will re-evaluate after
      // the content mutation. A small fallback check handles unchanged DOM.
      setTimeout(evaluate,100);
    }catch(error){
      report('4writers: could not switch to '+target+': '+String(error?.message||error));
      // A navigation exception should not silently strand the watcher.
      // The next check is scheduled by the normal bounded interval logic.
      evaluate();
    }
  }
  function evaluate(){
    if(!active()){
      stopTimer();
      report('4writers monitoring stopped — press START');
      return;
    }
    if(local.claim){
      stopTimer();
      report('4writers paused — opening / handling order #'+local.claim.id);
      return;
    }
    if(blocked()){
      stopTimer();
      local.armed=false;local.targetTabId=null;local.claim=null;
      void store.local.set({armed:false,targetTabId:null,claim:null,
        autoAcceptEnabled:false,autoFlow:null,
        lastResult:'4writers: automation/security warning — stopped until manual restart.'});
      report('4writers stopped — website security warning');
      return;
    }
    if(unseenOrder()){
      stopTimer();
      report('4writers order detected — refresh stopped for View');
      return;
    }
    // The blank default orders screen (neither tab selected) is a genuine
    // monitoring surface, not a failed section render. It gets its own idle
    // reload timer and never forces navigation into a Writings/Rewritings tab.
    if(sections.overview()){
      if(document.readyState!=='complete'){
        stopTimer();
        report('4writers: waiting for neutral Available Orders screen to load');
        timerMode='render-wait';
        timer=setTimeout(()=>{timer=null;timerMode='';evaluate();},900);
        return;
      }
      if(timer!==null && timerMode==='render-wait')stopTimer();
      if(timer!==null&&timerMode==='overview')return;
      stopTimer();
      report('4writers: blank dashboard next reload in '+(nextWait()/1000)+' seconds');
      timerMode='overview';
      timer=setTimeout(()=>void refreshOverview(),nextWait());
      return;
    }
    if(!sections.available()){
      stopTimer();
      report('4writers waiting — open Available Orders / Writings or Rewritings');
      return;
    }
    if(!listReady()){
      stopTimer();
      report('4writers waiting for Available Orders to finish loading');
      // A partially rendered list never triggers an unplanned fallback
      // page reload; keep observing until it becomes ready.
      timerMode='render-wait';
      timer=setTimeout(()=>{timer=null;timerMode='';evaluate();},900);
      return;
    }
    if(timer!==null && (timerMode==='render-wait'||timerMode==='overview'))stopTimer();
    if(timer!==null)return;
    report('4writers: Writings/Rewritings next check in '+(nextWait()/1000)+' seconds');
    timerMode='cycle';
    timer=setTimeout(()=>void cycle(),nextWait());
  }
  const relevant=new Set(['armed','claimConsentVersion','targetTabId','claim',
    'attemptedIds','completed']);
  store.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    let changed=false;
    for(const key of relevant)if(changes[key]){
      local[key]=changes[key].newValue;changed=true;
    }
    if(changed)evaluate();
    if(changes.refreshCount)count=Math.max(count,Number(changes.refreshCount.newValue)||0);
    if(changes.fourLastCheckedSection)lastSection=String(changes.fourLastCheckedSection.newValue||'');
  });
  chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async result=>{
    tabId=result?.tabId??null;
    const saved=await store.local.get([
      'armed','claimConsentVersion','targetTabId','claim',
      'attemptedIds','completed','refreshCount','fourLastCheckedSection'
    ]);
    local={...local,...saved};
    count=Number(saved.refreshCount)||0;
    lastSection=String(saved.fourLastCheckedSection||'');
    evaluate();
  });
  new MutationObserver(evaluate).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',evaluate,{once:true});
  window.addEventListener?.('pageshow',evaluate);
})();