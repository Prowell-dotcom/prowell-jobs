/* 4Writers neutral dashboard refresher: only the blank central overview
 * shown with Writings/Rewritings navigation and no sortable order headers.
 * The four sort headings remain the ONLY refresh mechanism on order lists.
 */
(() => {
 'use strict';
 if(window!==window.top||!/^(?:www\.)?4writers\.net$/i.test(location.hostname))return;
 if(window.__prowellFourOverviewReloadLoaded)return;
 window.__prowellFourOverviewReloadLoaded=true;
 const store=window.__prowellDualStorage,sections=window.__prowellFourSections;
 if(!store||!sections)return;
 const INTERVAL=4000,VERSION='0.5.4';
 const WARNING=/captcha|verify you are human|unusual activity|using automated site parsers is prohibited|automated (?:access|activity|parsing) (?:is )?prohibited|your account will be banned|automation warning/i;
 let tabId=null,timer=null,busy=false,count=0;
 let state={armed:false,claimConsentVersion:'',targetTabId:null,claim:null};
 const active=()=>state.armed===true&&state.claimConsentVersion===VERSION&&
   Number.isInteger(tabId)&&state.targetTabId===tabId;
 const cards=()=>window.__prowellDualActionableCards?.()||
   window.__prowellCardDetector?.cards?.()||[];
 const blocked=()=>WARNING.test(String(document.body?.innerText||''))||
   Boolean(document.querySelector?.('iframe[src*="captcha"],[class*="g-recaptcha"]'));
 const eligible=()=>active()&&!busy&&!state.claim&&!blocked()&&
   !cards().some(card=>['available','processing'].includes(card?.type))&&
   document.readyState==='complete'&&sections.overview?.()===true;
 function cancel(){
   if(timer!==null)clearTimeout(timer);
   timer=null;
 }
 // The current order runtime stops the active site refresh through this hook.
 window.__prowellDualStopRefresh=cancel;
 async function reload(){
   timer=null;
   if(!eligible())return evaluate();
   busy=true;
   try{
     const at=Date.now();
     await store.local.set({
       refreshCount:++count,lastRefreshAt:at,
       fourLastCheckedSection:'overview',fourLastCheckedAt:at,
       refreshStatus:'4writers: reloading blank dashboard after 4 seconds'
     });
   }catch(error){
     console.warn('4Writers overview refresh state:',String(error?.message||error));
     busy=false;evaluate();return;
   }
   busy=false;
   if(!eligible())return evaluate();
   location.reload();
 }
 function evaluate(){
   if(!eligible()){
     cancel();
     return;
   }
   if(timer!==null)return;
   timer=setTimeout(()=>void reload(),INTERVAL);
 }
 store.onChanged.addListener((changes,area)=>{
   if(area!=='local')return;
   let touched=false;
   for(const key of ['armed','claimConsentVersion','targetTabId','claim'])
     if(changes[key]){state[key]=changes[key].newValue;touched=true;}
   if(changes.refreshCount)count=Math.max(count,Number(changes.refreshCount.newValue)||0);
   if(touched)evaluate();
 });
 chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async result=>{
   tabId=result?.tabId??null;
   try{
     state={...state,...await store.local.get([
       'armed','claimConsentVersion','targetTabId','claim'
     ])};
   }catch(_){return;}
   evaluate();
 });
 new MutationObserver(evaluate).observe(document,{
   childList:true,subtree:true,characterData:true
 });
 document.addEventListener('DOMContentLoaded',evaluate,{once:true});
})();