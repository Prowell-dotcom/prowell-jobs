/* Prowell dual monitor: alert, View, Take it, OK, then STOP.
 * The final "I understand" acknowledgement is ALWAYS manual.
 * Does not bypass security challenges or automatically restart.
 */
(() => {
  'use strict';
  const chrome=window.__prowellLegacyChrome;
  if(!chrome?.storage?.local)return;
  const SITE='good';
  const HOST=/^(?:www\.)?good-writers\.com$/i;
  const VERSION='1.0.4';
  const TAB_MESSAGE='GW_TAB_ID';
  const FLAG='__prowellDualGoodThroughOk';
  if(window!==window.top||!HOST.test(location.hostname)||window[FLAG])return;
  window[FLAG]=true;

  const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
    claim:null,soundRunId:'',autoAcceptEnabled:false,processingScroll:null};
  const ACTIONS='a,button,input[type="button"],input[type="submit"],[role="button"]';
  const DETAILS='dialog[open],[role="dialog"],.modal.show,.modal.in,.modal-content,.modal-dialog,.modal-body,[class*="order-info"],[class*="orderInfo"],[data-order-details]';
  const MODALS='dialog[open],[role="dialog"],.modal.show,.modal.in,.swal2-popup,.sweet-alert,.modal-content';
  const ID_IN_DETAILS=/\border\s*(?:#|id\s*[:#]?)\s*(\d{5,16})\b/ig;
  const TAKE=/^take\s*it(?:\s*now)?[.!]?$/i;
  const OK=/^(?:ok|okay)$/i;
  const WARNING=/captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i;
  const MAX_FLOW_MS=25000;
  let state={...DEFAULTS},tabId=null,queued=false,busy=false,finishing=false,
    pollTimer=null,processingTimer=null,processingQueued=false,processingBusy=false;

  const active=()=>state.armed===true&&state.claimConsentVersion===VERSION&&
    Number.isInteger(tabId)&&state.targetTabId===tabId;
  const visible=el=>Boolean(el&&el.isConnected!==false&&!el.disabled&&
    el.getAttribute?.('aria-disabled')!=='true'&&
    (typeof el.getClientRects!=='function'||el.getClientRects().length));
  const label=el=>String(el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||
    el?.value||el?.innerText||el?.textContent||'').trim().replace(/\s+/g,' ');
  const textOf=el=>String(el?.innerText||el?.textContent||'');
  const sameId=(a,b)=>String(a||'').replace(/^0+/,'')===
    String(b||'').replace(/^0+/,'');
  const matchesId=(text,id)=>{
    ID_IN_DETAILS.lastIndex=0;
    return [...String(text||'').matchAll(ID_IN_DETAILS)]
      .some(match=>sameId(match[1],id));
  };
  const warned=()=>WARNING.test(textOf(document.body))||
    Boolean(document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  const cards=()=> (window.__prowellCardDetector?.cards?.()||[])
    .filter(card=>['available','processing'].includes(card?.type)&&
      /^\d{5,16}$/.test(String(card.id||'')));
  window.__prowellDualActionableCards=cards;
  function cancel(){
    if(pollTimer!==null)clearTimeout(pollTimer);
    pollTimer=null;
    try{window.__prowellDualStopRefresh?.();}catch(_){}
  }
  function schedule(){
    if(!active()||queued||busy||finishing)return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;
      if(!active()||busy||finishing)return;
      void scan().catch(error=>{
        console.warn('Prowell order scan failed:',String(error?.message||error));
        void stop('Scan failed; restart manually after checking the order.');
      });
    });
  }
  function followUp(){
    if(!active()||!state.claim||pollTimer!==null||finishing)return;
    pollTimer=setTimeout(()=>{pollTimer=null;schedule();},350);
  }
  async function stop(reason,extra={}){
    if(finishing)return;
    finishing=true;
    state.armed=false;state.targetTabId=null;state.claim=null;
    state.processingScroll=extra.processingScroll||null;
    if(!state.processingScroll&&processingTimer!==null){clearTimeout(processingTimer);processingTimer=null;}
    cancel();
    try{
      await chrome.storage.local.set({
        armed:false,targetTabId:null,claim:null,autoFlow:null,
        autoAcceptEnabled:false,processingScroll:null,
        lastResult:SITE+': '+reason,...extra
      });
    }catch(error){
      console.warn('Prowell STOP persistence failed:',String(error?.message||error));
    }finally{finishing=false;}
  }
  function alert(card){
    try{chrome.runtime.sendMessage({
      type:'PROWELL_ORDER_SOUND',orderId:String(card.id),kind:card.type,
      soundRunId:String(state.soundRunId||'')
    },()=>void chrome.runtime.lastError);}catch(_){}
  }
  const actions=parent=>[...(parent?.querySelectorAll?.(ACTIONS)||[])]
    .filter(visible);
  function detailScope(claim){
    const panels=[...(document.querySelectorAll?.(DETAILS)||[])];
    for(const panel of panels){
      if(visible(panel)&&matchesId(textOf(panel),claim.id))return panel;
    }
    // Some View controls navigate to a whole order detail page.
    if(location.href!==claim.listUrl &&
       matchesId(textOf(document.body),claim.id))return document;
    return null;
  }
  function takeButton(claim){
    const panel=detailScope(claim);
    if(!panel)return null;
    // Only move the verified order-details panel, never the order list.
    if(panel!==document){
      const descendants=[panel,...(panel.querySelectorAll?.(
        '.modal-body,.modal-content,[class*="scroll"],[style*="overflow"]')||[])];
      for(const el of descendants)try{
        if(typeof el.scrollTo==='function')el.scrollTo(0,el.scrollHeight||0);
        else if('scrollTop' in el)el.scrollTop=el.scrollHeight||0;
      }catch(_){}
    }
    return actions(panel).find(el=>TAKE.test(label(el)))||null;
  }
  function okButton(){
    // Site OK buttons must appear in a visible order/confirmation dialog.
    // A unique page-wide OK is a fallback only after the Take it click.
    const dialogs=[...(document.querySelectorAll?.(MODALS)||[])].filter(visible);
    for(const dialog of dialogs){
      if(!/(?:order|confirm|success|sure|taken|assign)/i.test(textOf(dialog)))
        continue;
      const button=actions(dialog).find(el=>OK.test(label(el)));
      if(button)return button;
    }
    const candidates=actions(document).filter(el=>OK.test(label(el)));
    return candidates.length===1 && /(?:order|confirm|success|sure)/i.test(
      textOf(document.body))?candidates[0]:null;
  }
  // A processing order is VIEW-ONLY: after monitoring STOPs, inspect the
  // single opened order details panel and scroll its content to the bottom.
  // This short-lived handoff can survive a same-tab page navigation. It never
  // scans for new orders or clicks any button after View.
  function scheduleProcessingScroll(){
    if(!state.processingScroll||processingQueued||processingBusy)return;
    processingQueued=true;
    queueMicrotask(()=>{
      processingQueued=false;
      void inspectProcessingScroll().catch(error=>
        console.warn('Prowell processing scroll:',String(error?.message||error)));
    });
  }
  function processingRetry(){
    if(processingTimer!==null||!state.processingScroll)return;
    processingTimer=setTimeout(()=>{
      processingTimer=null;scheduleProcessingScroll();
    },300);
  }
  async function clearProcessingScroll(reason){
    if(processingTimer!==null){clearTimeout(processingTimer);processingTimer=null;}
    state.processingScroll=null;
    await chrome.storage.local.set({processingScroll:null,
      lastResult:SITE+': '+reason});
  }
  async function inspectProcessingScroll(){
    const preview=state.processingScroll;
    if(!preview||processingBusy||!Number.isInteger(tabId)||
       preview.tabId!==tabId||!document.body)return;
    processingBusy=true;
    try{
      if(warned()){
        await clearProcessingScroll('Processing details: security warning; no scroll.');
        return;
      }
      if(!/^[0-9]{5,16}$/.test(String(preview.id||''))||
         Date.now()-Number(preview.startedAt||0)>12000){
        await clearProcessingScroll('Processing details were not verified; stopped.');
        return;
      }
      const panel=detailScope(preview);
      if(!panel){processingRetry();return;}
      if(panel===document){
        // Only a navigated details page for the exact order can use page scroll.
        const root=document.scrollingElement||document.documentElement||document.body;
        const bottom=Math.max(Number(root?.scrollHeight)||0,
          Number(document.body?.scrollHeight)||0);
        try{root?.scrollTo?.(0,bottom);}catch(_){}
        try{window.scrollTo?.(0,bottom);}catch(_){}
      }else{
        // Scroll the verified modal and its scrollable descendants. Never
        // scroll the background list or another order's detail modal.
        const inner=[...(panel.querySelectorAll?.(
          '.modal-body,.modal-content,[class*="scroll"],[style*="overflow"]')||[])];
        for(const el of [...new Set([panel,...inner])]){
          if(!visible(el))continue;
          const bottom=Number(el.scrollHeight)||0;
          try{
            if(typeof el.scrollTo==='function')el.scrollTo(0,bottom);
            else if('scrollTop' in el)el.scrollTop=bottom;
          }catch(_){
            try{if('scrollTop' in el)el.scrollTop=bottom;}catch(__){}
          }
        }
      }
      await clearProcessingScroll('Processing order #'+preview.id+
        ': View opened; verified details scrolled to the bottom; stopped.');
    }finally{processingBusy=false;}
  }
  async function processingView(card){
    // Never take an already assigned / processing order.
    if(!active()||busy)return;
    busy=true;
    cancel();
    alert(card);
    const preview={id:String(card.id),startedAt:Date.now(),tabId,
      listUrl:location.href};
    // Refresh and order monitoring remain STOPPED during the one-time scroll.
    await stop('Processing order #'+card.id+
      ' detected; sound requested, View opens once; scroll pending.',
      {lastAlertOrderId:String(card.id),lastAlertKind:card.type,
        lastAlertAt:Date.now(),processingScroll:preview});
    try{
      if(!warned()&&visible(card.view)&&typeof card.view.click==='function')
        card.view.click();
      else await clearProcessingScroll('Processing View unavailable; stopped.');
    }catch(error){
      console.warn('Prowell processing View failed:',String(error?.message||error));
      await clearProcessingScroll('Processing View failed; stopped.');
    }finally{busy=false;}
    scheduleProcessingScroll();
  }
  async function begin(card){
    if(!active()||busy||!visible(card.view)||
       typeof card.view.click!=='function')return;
    busy=true;
    cancel();
    alert(card);
    const claim={id:String(card.id),kind:'available',stage:'view-clicked',
      startedAt:Date.now(),listUrl:location.href};
    state.claim=claim;
    try{
      await chrome.storage.local.set({
        claim,autoAcceptEnabled:false,lastAlertOrderId:claim.id,
        lastAlertKind:'available',lastAlertAt:Date.now(),
        lastResult:SITE+': order #'+claim.id+
          ' detected; sound requested, refresh stopped; opening View.'
      });
      if(active()&&!warned()&&visible(card.view))card.view.click();
      else if(active())await stop('View unavailable or security warning; stopped.');
    }catch(error){
      await stop('Could not open View for order #'+claim.id+': '+
        String(error?.message||error));
    }finally{busy=false;}
    followUp();
  }
  async function takeStage(claim,button){
    if(!active()||busy||!visible(button))return;
    busy=true;
    cancel();
    const next={...claim,stage:'take-clicked',stageAt:Date.now()};
    state.claim=next;
    try{
      await chrome.storage.local.set({claim:next,
        lastResult:SITE+': verified order #'+claim.id+'; clicking Take it.'});
      if(active()&&!warned()&&visible(button)){
        // The existing MAIN-world helper handles only the site's own
        // immediate "Are you sure?" native order confirmation.
        try{window.dispatchEvent?.(new Event('prowell-order-confirm-arm'));}catch(_){}
        button.click();
      }else if(active())await stop('Take it unavailable or security warning; stopped.');
    }catch(error){
      await stop('Take it failed for order #'+claim.id+': '+
        String(error?.message||error));
    }finally{busy=false;}
    followUp();
  }
  async function okStage(claim,button){
    if(!active()||busy||!visible(button))return;
    busy=true;
    // STOP is saved BEFORE the final automated OK action, so the extension
    // never proceeds into "I understand" even after a navigation.
    await stop('Order #'+claim.id+
      ': OK pressed; final I understand acknowledgement is manual.',
      {lastOkOrderId:claim.id,lastOkAt:Date.now()});
    try{if(visible(button))button.click();}
    catch(error){
      console.warn('Prowell OK button failed:',String(error?.message||error));
      try{await chrome.storage.local.set({
        lastResult:SITE+': order #'+claim.id+
          ' stopped, but OK could not be clicked. Complete manually.'
      });}catch(_){}
    }finally{busy=false;}
  }
  async function scan(){
    if(!active()||busy||finishing||!document.body)return;
    if(warned()){
      await stop('Website security or automation warning; manual restart required.');
      return;
    }
    const claim=state.claim;
    if(claim){
      if(!/^[0-9]{5,16}$/.test(String(claim.id||'')) ||
         !['view-clicked','take-clicked'].includes(claim.stage)){
        await stop('Unrecognized or old claim; restart manually.');
        return;
      }
      if(Date.now()-Number(claim.startedAt||0)>MAX_FLOW_MS){
        await stop('Order #'+claim.id+
          ' did not reach OK in 25 seconds; inspect it before restarting.');
        return;
      }
      if(claim.stage==='view-clicked'){
        const button=takeButton(claim);
        if(button){await takeStage(claim,button);return;}
      }else if(claim.stage==='take-clicked'){
        const button=okButton();
        if(button){await okStage(claim,button);return;}
      }
      followUp();
      return;
    }
    const found=cards();
    const first=found.find(card=>card.type==='available')||
      found.find(card=>card.type==='processing');
    if(first){
      if(first.type==='available')await begin(first);
      else await processingView(first);
    }
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    for(const key of Object.keys(DEFAULTS))if(changes[key])
      state[key]=changes[key].newValue;
    if(!active())cancel();
    if(changes.processingScroll)scheduleProcessingScroll();
    schedule();
  });
  chrome.runtime.sendMessage({type:TAB_MESSAGE},async result=>{
    tabId=result?.tabId??null;
    try{state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};}
    catch(error){
      console.warn('Prowell monitor state unavailable:',String(error?.message||error));
      return;
    }
    schedule();
    scheduleProcessingScroll();
  });
  new MutationObserver(()=>{schedule();scheduleProcessingScroll();}).observe(document,{
    childList:true,subtree:true,characterData:true
  });
  document.addEventListener('DOMContentLoaded',()=>{
    schedule();scheduleProcessingScroll();
  },{once:true});
})();