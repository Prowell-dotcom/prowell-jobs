'use strict';
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='GW_TAB_ID')reply({tabId:sender.tab?.id??null});
});

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type!=='GOOD_WRITERS_RESULT')return;
 const event=message.payload||{};
 chrome.storage.local.get(['goodWritersResults'],state=>{
   const results=Array.isArray(state.goodWritersResults)?state.goodWritersResults:[];
   const unique=results.filter(item=>item.eventKey!==event.eventKey);
   const next=[...unique,{...event,receivedAt:Date.now()}].slice(-100);
   chrome.storage.local.set({goodWritersResults:next},()=>reply({ok:true}));
 });
 return true;
});
