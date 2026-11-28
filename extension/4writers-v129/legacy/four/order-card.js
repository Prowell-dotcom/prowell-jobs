/* A shared detector inside each independent Chrome extension.
 * Real order cards require an order ID and the Files + View controls.
 * A Messages control identifies an already-assigned processing order.
 */
(() => {
 'use strict';
 if (window.__prowellCardDetector) return;
 const ACTIONS='a,button,input[type="button"],input[type="submit"],[role="button"]';
 const ID=/\b(?:order\s*)?ID\s*[:#]?\s*(\d{5,16})\b/i;
 const VIEW=/^view(?:\s+(?:order|details))?$/i;
 const FILES=/^files?$/i;
 const MESSAGES=/^messages?$/i;
 const label=el=>String(el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||
   el?.value||el?.innerText||el?.textContent||'').trim().replace(/\s+/g,' ');
 const visible=el=>Boolean(el?.isConnected && typeof el.getClientRects==='function' &&
   el.getClientRects().length && !el.disabled && el.getAttribute?.('aria-disabled')!=='true');
 function pageKind(){
   const path=(location.pathname||new URL(location.href).pathname).toLowerCase();
   // The sidebar contains links for both page types, so only use URL + heading.
   if(/\/(?:processing[_-]?orders?|current[_-]?orders?|my[_-]?orders?|late[_-]?orders?)(?:\/|$)/.test(path))return 'processing';
   const headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(label);
   if(headings.some(t=>/^(?:processing|current|my current|late) orders?$/i.test(t)))return 'processing';
   if(headings.some(t=>/^available orders?$/i.test(t)))return 'available';
   if(/\/(?:free[_-]?orders?|available[_-]?orders?)(?:\/|$)/.test(path))return 'available';
   return 'unknown';
 }
 function cards(){
   const buttons=[...document.querySelectorAll(ACTIONS)].filter(visible);
   const hits=[],visited=new Set();
   const page=pageKind();
   for(const view of buttons){
     if(!VIEW.test(label(view)))continue;
     let current=view,match=null;
     // Choose the smallest ancestor containing ID and the relevant card buttons.
     for(let i=0;i<14 && current && current!==document.body;i++,current=current.parentElement){
       const text=current.innerText||current.textContent||'';
       if(text.length>6000)break;
       const found=ID.exec(text);
       if(!found)continue;
       const controls=buttons.filter(b=>current===b ||
         (typeof current.contains==='function' ? current.contains(b) :
         (()=>{let p=b;while(p){if(p===current)return true;p=p.parentElement;}return false;})()));
       if(!controls.some(b=>FILES.test(label(b))))continue;
       const hasMessages=controls.some(b=>MESSAGES.test(label(b)));
       match={id:found[1],view,hasMessages,hasFiles:true,
         type:hasMessages||page==='processing'?'processing':page==='available'?'available':'unknown',
         container:current};
       break;
     }
     if(match&&!visited.has(match.id)){hits.push(match);visited.add(match.id);}
   }
   return hits;
 }
 window.__prowellCardDetector={pageKind,cards,visible,label};
})();