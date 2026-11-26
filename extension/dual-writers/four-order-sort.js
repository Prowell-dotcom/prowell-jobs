/* Dual-only 4Writers idle sorting: rotate the four real sort headings
 * 800 ms after each fully loaded, EMPTY Available Orders page becomes ready.
 * Never clicks order/claim buttons, bypasses challenges, or changes page
 * navigation. The existing 4-second refresh and order-taking engines own
 * those separate workflows.
 */
(() => {
  'use strict';
  if(window!==window.top||!/^(?:www\.)?4writers\.net$/i.test(location.hostname))return;
  if(window.__prowellFourSortLoaded)return;
  window.__prowellFourSortLoaded=true;

  const store=window.__prowellDualStorage;
  const sections=window.__prowellFourSections;
  if(!store||!sections)return;

  const VERSION='0.5.4',SORT_MS=800;
  const HEADINGS=['date added','time remaining','pages','total price'];
  const CONTROLS='a,button,span,th,[role="button"],[role="columnheader"],[data-sort],[ng-click],[onclick]';
  const WARNING=/captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i;
  let tabId=null,timer=null,next=0,disabled=false,clicking=false,
    handedOffKey='';
  let state={armed:false,claimConsentVersion:'',targetTabId:null,claim:null,
    fourSortIndex:0};

  const active=()=>state.armed===true &&
    state.claimConsentVersion===VERSION &&
    Number.isInteger(tabId)&&state.targetTabId===tabId;
  const visible=el=>Boolean(el&&el.isConnected!==false&&!el.disabled&&
    el.getAttribute?.('aria-disabled')!=='true'&&
    (typeof el.getClientRects!=='function'||el.getClientRects().length));
  const text=el=>String(el?.innerText||el?.textContent||
    el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||'');
  const normalized=el=>text(el).toLowerCase()
    .replace(/[↑↓↕⇅▲▼△▽▴▾]/g,'')
    .replace(/\s+/g,' ').replace(/\s*[:|]+\s*$/,'').trim()
    .replace(/^(?:sort by |order by )/,'')
    .replace(/ (?:ascending|descending)$/,'').trim();

  function stopTimer(){
    if(timer!==null)clearTimeout(timer);
    timer=null;
  }
  const orderVisible=()=>{
    const cards=window.__prowellDualActionableCards?.()||
      window.__prowellCardDetector?.cards?.()||[];
    return cards.some(card=>
      ['available','processing'].includes(card?.type));
  };
  function findSortControls(){
    const nodes=[...(document.querySelectorAll?.(CONTROLS)||[])];
    const matched=new Map();
    for(const el of nodes){
      if(!visible(el))continue;
      const label=normalized(el);
      if(!HEADINGS.includes(label)||matched.has(label))continue;
      const parent=el.closest?.(
        'a,button,[role="button"],[role="columnheader"],th,[data-sort],[ng-click],[onclick]')||el;
      if(!visible(parent)||typeof parent.click!=='function')continue;
      const href=parent.getAttribute?.('href')||'';
      if(href&&!href.startsWith('#')){
        try{if(new URL(href,location.href).origin!==location.origin)continue;}
        catch(_){continue;}
      }
      matched.set(label,parent);
    }
    return matched;
  }
  function emptySortScreen(){
    if(!active()||disabled||clicking||state.claim||orderVisible()||
       document.readyState!=='complete'||!sections.available?.()||
       sections.overview?.())return false;
    const page=String(document.body?.innerText||document.body?.textContent||'');
    if(!/\bavailable\s+orders\b/i.test(page)||
       !/\border\s+by\b/i.test(page)||
       !/\bnone\b/i.test(page)||
       WARNING.test(page)||
       document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'))
      return false;
    return true;
  }
  function evaluate(){
    // An order revealed by a sort-triggered AJAX update takes priority NOW.
    // The direct call avoids waiting for another timer or microtask before
    // the existing View / Take it / OK flow begins.
    if(active()&&!state.claim){
      const found=window.__prowellDualActionableCards?.()||
        window.__prowellCardDetector?.cards?.()||[];
      const first=found.find(card=>
        ['available','processing'].includes(card?.type));
      if(first){
        stopTimer();
        // DOM/storage observers can fire repeatedly for the same card.
        // Hand off only once per appearance and let the order runtime own it.
        const key=String(first.type)+':'+String(first.id);
        if(handedOffKey!==key){
          handedOffKey=key;
          try{window.__prowellDualPrioritizeOrder?.();}
          catch(error){console.warn('Prowell order priority:',String(error?.message||error));}
        }
        return;
      }
      handedOffKey='';
    }
    if(!emptySortScreen()){
      stopTimer();
      return;
    }
    if(timer!==null)return;
    const controls=findSortControls();
    // All four headings must be present. An unrelated list or partial render
    // is never treated as the intended screenshot-style sorting toolbar.
    if(HEADINGS.some(name=>!controls.has(name)))return;
    timer=setTimeout(()=>{
      timer=null;
      if(!emptySortScreen())return;
      void rotateOnce();
    },SORT_MS);
  }
  async function rotateOnce(){
    if(!emptySortScreen())return;
    clicking=true;
    const name=HEADINGS[next%HEADINGS.length];
    const nextIndex=(next+1)%HEADINGS.length;
    try{
      // Sorting on 4Writers may cause a FULL PAGE RELOAD. Persist the next
      // heading BEFORE clicking, so a new document resumes the rotation
      // rather than always starting from "Date added".
      await store.local.set({
        fourSortIndex:nextIndex,fourSortLastAt:Date.now(),
        fourSortLastHeading:name
      });
      next=nextIndex;
      clicking=false;
      // Order detection wins immediately after the storage round-trip too.
      // Re-acquire the live control (do not click a stale detached element).
      if(!emptySortScreen()){evaluate();return;}
      const controls=findSortControls();
      if(HEADINGS.some(heading=>!controls.has(heading)))return;
      if(!emptySortScreen()){evaluate();return;}
      controls.get(name).click();
    }catch(error){
      clicking=false;
      disabled=true;
      console.warn('Prowell 4writers sort stopped:',
        String(error?.message||error));
      return;
    }
    // For AJAX sorting, keep rotating on the same screen. If the click
    // navigates, Chrome destroys this timer and the next page loads the
    // stored fourSortIndex before scheduling another 800-ms click.
    evaluate();
  }
  store.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    for(const key of ['armed','claimConsentVersion','targetTabId','claim',
      'fourSortIndex'])
      if(changes[key])state[key]=changes[key].newValue;
    if(changes.armed?.newValue===true&&changes.armed?.oldValue!==true){
      disabled=false;handedOffKey='';
    }
    if(changes.fourSortIndex)next=Math.max(0,
      Number(changes.fourSortIndex.newValue)||0)%HEADINGS.length;
    evaluate();
  });
  chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async result=>{
    tabId=result?.tabId??null;
    try{
      state={...state,...await store.local.get([
        'armed','claimConsentVersion','targetTabId','claim','fourSortIndex'
      ])};
      next=Math.max(0,Number(state.fourSortIndex)||0)%HEADINGS.length;
    }catch(error){
      console.warn('Prowell 4writers sort state unavailable:',
        String(error?.message||error));return;
    }
    evaluate();
  });
  new MutationObserver(evaluate).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',evaluate,{once:true});
})();