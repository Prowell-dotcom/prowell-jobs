/* Optional Good-Writers sort clicking. Act only on real sortable headings
 * found in a fully rendered empty Available Orders list. If Good-Writers
 * uses a different layout, the existing 4-second refresh remains active.
 */
(() => {
 'use strict';
 if(window!==window.top||!/^(?:www\.)?good-writers\.com$/i.test(location.hostname))return;
 if(window.__prowellGoodSortLoaded)return;
 window.__prowellGoodSortLoaded=true;
 const store=window.__prowellDualStorage;
 if(!store)return;
 const VERSION='1.0.4',SORT_MS=800;
 const HEADINGS=['date added','time remaining','pages','total price'];
 const SELECTOR='a,button,span,th,[role="button"],[role="columnheader"],[data-sort],[ng-click],[onclick]';
 const WARNING=/captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i;
 let tabId=null,timer=null,next=0,clicking=false,disabled=false,handedOff='';
 let state={armed:false,claimConsentVersion:'',targetTabId:null,claim:null,goodSortIndex:0};
 const active=()=>state.armed===true&&state.claimConsentVersion===VERSION&&
   Number.isInteger(tabId)&&state.targetTabId===tabId;
 const visible=el=>Boolean(el&&el.isConnected!==false&&!el.disabled&&
   el.getAttribute?.('aria-disabled')!=='true'&&
   (typeof el.getClientRects!=='function'||el.getClientRects().length));
 const text=el=>String(el?.innerText||el?.textContent||
   el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||'');
 const normalize=el=>text(el).toLowerCase().replace(/[↑↓↕⇅▲▼△▽▴▾]/g,'')
   .replace(/\s+/g,' ').trim().replace(/^(?:sort by |order by )/,'')
   .replace(/ (?:ascending|descending)$/,'').replace(/[:|]+$/,'').trim();
 const cards=()=>window.__prowellDualActionableCards?.()||
   window.__prowellCardDetector?.cards?.()||[];
 const hasOrder=()=>cards().some(c=>['available','processing'].includes(c?.type));
 function controls(){
   const matched=new Map();
   for(const el of document.querySelectorAll?.(SELECTOR)||[]){
     if(!visible(el))continue;
     const name=normalize(el);
     if(!HEADINGS.includes(name)||matched.has(name))continue;
     const control=el.closest?.('a,button,[role="button"],[role="columnheader"],th,[data-sort],[ng-click],[onclick]')||el;
     if(!visible(control)||typeof control.click!=='function')continue;
     const href=control.getAttribute?.('href')||'';
     if(href&&!href.startsWith('#')){
       try{if(new URL(href,location.href).origin!==location.origin)continue;}
       catch(_){continue;}
     }
     matched.set(name,control);
   }
   return matched;
 }
 function eligible(){
   if(!active()||clicking||disabled||state.claim||hasOrder()||
      document.readyState!=='complete'||
      window.__prowellCardDetector?.pageKind?.()!=='available')return false;
   const page=String(document.body?.innerText||document.body?.textContent||'');
   if(WARNING.test(page)||
      document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'))return false;
   if(!/\b(?:none|no (?:available )?orders|nothing found)\b/i.test(page))return false;
   return controls().size>=2;
 }
 window.__prowellDualGoodSortEnabled=eligible;
 function cancel(){if(timer!==null)clearTimeout(timer);timer=null;}
 function evaluate(){
   if(active()&&!state.claim&&hasOrder()){
     cancel();
     const card=cards().find(c=>['available','processing'].includes(c.type));
     const key=card.type+':'+String(card.id);
     if(handedOff!==key){
       handedOff=key;
       try{window.__prowellDualPrioritizeOrder?.();}
       catch(error){console.warn('Good-Writers order handoff:',String(error?.message||error));}
     }
     return;
   }
   if(!hasOrder())handedOff='';
   if(!eligible()){cancel();return;}
   // The Good-Writers fallback refresh never competes with sorting.
   window.__prowellDualStopRefresh?.();
   if(timer!==null)return;
   timer=setTimeout(()=>{timer=null;void rotate();},SORT_MS);
 }
 async function rotate(){
   if(!eligible())return evaluate();
   clicking=true;
   const available=controls();
   const options=HEADINGS.filter(name=>available.has(name));
   const name=options[next%options.length];
   const index=(next+1)%options.length;
   try{
     await store.local.set({goodSortIndex:index,goodSortLastHeading:name,
       goodSortLastAt:Date.now()});
     next=index;clicking=false;
     if(!eligible())return evaluate();
     const fresh=controls();
     if(!fresh.has(name))return evaluate();
     if(hasOrder())return evaluate();
     fresh.get(name).click();
   }catch(error){
     clicking=false;disabled=true;
     console.warn('Good-Writers heading sort stopped:',String(error?.message||error));
   }
   evaluate();
 }
 store.onChanged.addListener((changes,area)=>{
   if(area!=='local')return;
   for(const key of ['armed','claimConsentVersion','targetTabId','claim','goodSortIndex'])
     if(changes[key])state[key]=changes[key].newValue;
   if(changes.goodSortIndex)next=Math.max(0,Number(changes.goodSortIndex.newValue)||0);
   if(changes.armed?.newValue===true&&changes.armed?.oldValue!==true){
     disabled=false;handedOff='';next=0;
   }
   evaluate();
 });
 chrome.runtime.sendMessage({type:'GW_TAB_ID'},async res=>{
   tabId=res?.tabId??null;
   try{
     state={...state,...await store.local.get([
       'armed','claimConsentVersion','targetTabId','claim','goodSortIndex'
     ])};
     next=Math.max(0,Number(state.goodSortIndex)||0);
   }catch(_){return;}
   evaluate();
 });
 new MutationObserver(evaluate).observe(document,{
   childList:true,subtree:true,characterData:true
 });
 document.addEventListener('DOMContentLoaded',evaluate,{once:true});
})();