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

chrome.tabs.onCreated.addListener(tab=>{
 if(!Number.isInteger(tab.openerTabId))return;
 chrome.storage.local.get(['armed','claimConsentVersion','targetTabId'],state=>{
  if(!state.armed||state.claimConsentVersion!=='1.0.0'||state.targetTabId!==tab.openerTabId)return;
  const target=tab.id;
  const watcher=(id,change,current)=>{
    if(id!==target)return;
    const url=current.url||change.url||'';
    if(/^https:\/\/(?:www\.)?good-writers\.com\//i.test(url)){
      chrome.storage.local.set({targetTabId:id});
      chrome.tabs.onUpdated.removeListener(watcher);
    }else if(/^https?:\/\//i.test(url)){
      chrome.tabs.onUpdated.removeListener(watcher);
    }
  };
  chrome.tabs.onUpdated.addListener(watcher);
 });
});
