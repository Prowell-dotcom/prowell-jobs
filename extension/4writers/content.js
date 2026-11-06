/* Prowell browser assistant: detects official 4writers order cards on the current tab.
 * No credential access or direct polling. The owner clicks acceptance controls.
 */
(() => {
 'use strict';
 if (window !== window.top || !/^https:\/\/(?:www\.)?4writers\.net$/i.test(location.origin)) return;
 if (window.__prowellWatcherLoaded) return;
 window.__prowellWatcherLoaded = true;
 let active=false,tabId=null,seen=new Set(),notice=null,scheduled=false;
 const ID=/\b(?:order\s*)?ID\s*[:#]\s*(\d{5,})\b/i;
 function label(el){return String(el?.getAttribute?.('aria-label')||el?.value||el?.innerText||el?.textContent||'').trim().replace(/\s+/g,' ');}
 function visible(el){return !!(el?.isConnected&&el.getClientRects().length&&!el.disabled);}
 function buttons(re){return [...document.querySelectorAll('a,button,input[type=button],input[type=submit],[role=button]')].filter(e=>visible(e)&&re.test(label(e)));}
 function banner(message){
  if(!active)return;
  if(!notice){
    notice=document.createElement('aside');
    notice.style.cssText='position:fixed!important;bottom:12px!important;right:12px!important;z-index:2147483647!important;padding:12px!important;background:#112e58!important;color:white!important;border-radius:10px!important;font:13px system-ui!important;max-width:330px!important;box-shadow:0 4px 18px #3337!important;';
    document.documentElement.appendChild(notice);
  }
  notice.textContent='Prowell Order Assistant · '+message;
 }
 function scan(){
  if(!active||!document.body)return;
  const found=[];
  for(const btn of buttons(/^view(?:\s+order|\s+details)?$/i)){
   let node=btn;
   for(let i=0;i<10&&node&&node!==document.body;i++,node=node.parentElement){
    const txt=node.innerText||node.textContent||'';
    const match=ID.exec(txt);
    if(match&&txt.length<2800){found.push({id:match[1],button:btn});break;}
   }
  }
  for(const item of found){
   if(seen.has(item.id))continue;
   seen.add(item.id);
   banner('New order #'+item.id+' — select View');
   item.button.style.outline='3px solid #00b887';
   item.button.style.outlineOffset='3px';
   void chrome.storage.local.get(['attemptedIds','log'],old=>{
     const ids=[...new Set([...(old.attemptedIds||[]),item.id])].slice(-200);
     const log=[...(old.log||[]),new Date().toISOString()+' · order #'+item.id+' detected'].slice(-30);
     chrome.storage.local.set({attemptedIds:ids,log,lastResult:'Order #'+item.id+' detected'});
   });
  }
  const next=buttons(/^take\s*it!?$/i)[0]||buttons(/^i\s+understand\s+the\s+order[.!]?$/i)[0];
  if(next){next.style.outline='3px solid #00b887';next.style.outlineOffset='3px';banner('Acceptance button located — review and click it');}
 }
 function schedule(){if(!active||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;scan();});}
 chrome.storage.onChanged.addListener((updates,area)=>{
  if(area!=='local')return;
  if(updates.armed||updates.targetTabId){
   void chrome.storage.local.get(['armed','targetTabId'],s=>{
     active=!!(s.armed&&tabId===s.targetTabId);
     if(!active){notice?.remove();notice=null;}
     else schedule();
   });
  }
 });
 chrome.runtime.sendMessage({type:'PROWELL_TAB_ID'},async reply=>{
  tabId=reply?.tabId??null;
  const s=await chrome.storage.local.get(['armed','targetTabId','attemptedIds']);
  active=!!(s.armed&&tabId===s.targetTabId);
  seen=new Set(s.attemptedIds||[]);
  schedule();
 });
 new MutationObserver(schedule).observe(document,{subtree:true,childList:true,characterData:true});
 document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();
