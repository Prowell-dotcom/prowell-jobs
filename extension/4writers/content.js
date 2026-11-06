/* Prowell Order Assistant. Runs only inside the signed-in 4writers browser tab.
 * Uses the page's normal user interface; never reads passwords or bypasses challenges.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin)) return;
  if (window.__prowellAssistantV5) return;
  window.__prowellAssistantV5 = true;

  const DEFAULTS = {armed:false,targetTabId:null,refreshMs:2000,claim:null,
    attemptedIds:[],completed:[],lastResult:'Ready',log:[],returnToList:true};
  const ID = /\b(?:order\s*)?ID\s*[:#]\s*(\d{5,})\b/i;
  const VIEW = /^view(?:\s+(?:order|details))?$/i;
  const TAKE = /^take\s*it(?:\s*now)?[.!]?$/i;
  const ACCEPT = /^i\s+understand\s+the\s+order[.!]?$/i;
  const ACTIONS = 'a,button,input[type="button"],input[type="submit"],[role="button"]';
  let state={...DEFAULTS}, tabId=null, busy=false, pendingScan=false;
  let nextRefresh=null, statusNode=null, lastAction=0;

  const label = el => (el?.getAttribute?.('aria-label') || el?.value ||
    el?.innerText || el?.textContent || '').trim().replace(/\s+/g,' ');
  const visible = el => Boolean(el && el.isConnected && el.getClientRects().length &&
    !el.disabled && el.getAttribute('aria-disabled')!=='true');
  const find = pattern => [...document.querySelectorAll(ACTIONS)]
    .find(el => visible(el) && pattern.test(label(el)));
  const active = () => Boolean(state.armed && tabId === state.targetTabId);
  const pageText = () => document.body?.innerText || '';
  const orderList = () => /available orders/i.test(pageText()) &&
    /\bwritings\b/i.test(pageText()) && !/please log in/i.test(pageText());
  const challenge = () => /captcha|verify you are human|unusual activity/i.test(pageText()) ||
    Boolean(document.querySelector('iframe[src*="captcha"], [class*="g-recaptcha"]'));
  const success = () => /now you can write the order|you (?:can|may) start writing|order (?:has been )?(?:assigned to you|taken successfully)/i.test(pageText());
  const failure = () => /order (?:has been )?(?:taken by another|no longer available)|this order is unavailable|failed to take (?:the )?order/i.test(pageText());
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
  function orderCards(){
    const hits=[];
    for(const button of document.querySelectorAll(ACTIONS)){
      if(!visible(button) || !VIEW.test(label(button)))continue;
      let node=button,order=null;
      for(let i=0;i<9&&node&&node!==document.body;i++,node=node.parentElement){
        const text=node.innerText||node.textContent||'';
        const match=ID.exec(text);
        if(match&&text.length<3300){order={id:match[1],button};break;}
      }
      if(order)hits.push(order);
    }
    return hits;
  }
  function stopRefresh(){if(nextRefresh){clearTimeout(nextRefresh);nextRefresh=null;}}
  function scheduleRefresh(){
    stopRefresh();
    if(!active()||state.claim||!orderList())return;
    nextRefresh=setTimeout(()=>{
      nextRefresh=null;
      if(active()&&!state.claim&&orderList()&&!challenge())location.reload();
    },Math.max(2000,Number(state.refreshMs)||2000));
  }
  async function clickStage(el,stage,message){
    if(!visible(el) || busy || !active())return;
    busy=true;stopRefresh();
    try{
      await setClaim(state.claim.id,stage);
      lastAction=Date.now();
      el.click();
      await report(message);
    }catch(err){await report('Could not click: '+err.message);}
    finally{busy=false;}
    setTimeout(scheduleScan,0);
  }
  async function finished(ok,message){
    const claim=state.claim;if(!claim)return;
    const array=ok?'completed':'attemptedIds';
    const ids=[...new Set([...(state[array]||[]),claim.id])].slice(-200);
    state[array]=ids;state.claim=null;
    await report(message,{[array]:ids,claim:null});
    if(ok && state.returnToList && claim.listUrl &&
      new URL(claim.listUrl).origin===location.origin && location.href!==claim.listUrl){
      location.assign(claim.listUrl);
    }else scheduleRefresh();
  }
  async function scan(){
    if(!active()||busy||!document.body)return;
    if(challenge()){
      stopRefresh();await report('Paused: website security challenge', {armed:false});return;
    }
    if(state.claim){
      const current=state.claim;
      if(current.stage==='confirmed' && success())return finished(true,'Order #'+current.id+' successfully claimed');
      if(failure())return finished(false,'Order #'+current.id+' unavailable');
      if(Date.now()-current.startedAt>25000){
        stopRefresh();await report('Claim status unclear; stopped to prevent duplicate acceptance',{armed:false});return;
      }
      if(current.stage==='take-clicked' && find(ACCEPT))
        return clickStage(find(ACCEPT),'confirmed','Acknowledged order #'+current.id);
      if((current.stage==='view-clicked'||current.stage==='take-waiting') && find(TAKE))
        return clickStage(find(TAKE),'take-clicked','Clicked Take it for #'+current.id);
      return;
    }
    const cards=orderCards();
    if(cards.length){
      const fresh=cards.find(c=>!(state.attemptedIds||[]).includes(c.id) &&
        !(state.completed||[]).includes(c.id));
      if(fresh){
        stopRefresh();
        await setClaim(fresh.id,'view-clicked',{listUrl:location.href,startedAt:Date.now()});
        lastAction=Date.now();fresh.button.click();
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
  chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async answer=>{
    tabId=answer?.tabId??null;
    state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
    scheduleScan();
  });
  new MutationObserver(records=>{
    if(records.every(record=>statusNode?.contains(record.target)))return;
    scheduleScan();
  }).observe(document,{childList:true,subtree:true,characterData:true});
  document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();