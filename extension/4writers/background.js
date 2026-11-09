'use strict';
importScripts('order-sound-background.js');
// Identify the current frame's tab without reading account credentials.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message && message.type === 'PROWELL_TAB_ID') reply({tabId: sender.tab ? sender.tab.id : null});
});
// Some official View links open a separate tab; continue monitoring it.
chrome.tabs.onCreated.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;
  chrome.storage.local.get(['armed', 'claimConsentVersion', 'targetTabId'], state => {
    if (!state.armed || state.claimConsentVersion !== '0.5.9' || state.targetTabId !== tab.openerTabId) return;
    const newTab = tab.id;
    const listener = (id, info, current) => {
      if (id !== newTab) return;
      const url = (current && current.url) || info.url || '';
      if (/^https:\/\/(?:www\.)?4writers\.net\//i.test(url)) {
        chrome.storage.local.set({targetTabId: id, status: 'Following official order tab'});
        chrome.tabs.onUpdated.removeListener(listener);
      } else if (/^https?:\/\//i.test(url)) chrome.tabs.onUpdated.removeListener(listener);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
});

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(msg?.type!=='PROWELL_CLAIM_REPORT')return;
 const p=msg.payload||{};
 chrome.storage.local.get(['reportCode'],async state=>{
   if(!state.reportCode){reply({ok:false,reason:'Dashboard pairing code not configured'});return;}
   try{
    const response=await fetch('https://prowelljobs.com/api/extension/claim-report',{
      method:'POST',
      headers:{'Authorization':'Bearer '+state.reportCode,'Content-Type':'application/json'},
      body:JSON.stringify(p)
    });
    reply({ok:response.ok,status:response.status});
   }catch(err){reply({ok:false,reason:'Network unavailable'});}
 });
 return true;
});

// Carry a single explicitly opted-in order workflow into an official View tab.
chrome.tabs.onCreated.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;
  chrome.storage.local.get(['autoFlow'], state => {
    const flow=state.autoFlow;
    if(!flow || flow.enabled!==true || flow.tabId!==tab.openerTabId ||
       Date.now()-flow.startedAt>90000) return;
    const createdId=tab.id;
    const listener=(id,change,current)=>{
      if(id!==createdId) return;
      const url=(current&&current.url)||change.url||'';
      if(/^https:\/\/(?:www\.)?4writers\.net\//i.test(url)){
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.storage.local.get(['autoFlow'], latest=>{
          const currentFlow=latest.autoFlow;
          if(currentFlow && currentFlow.orderId===flow.orderId && currentFlow.tabId===flow.tabId){
            chrome.storage.local.set({autoFlow:{...currentFlow,tabId:createdId}});
          }
        });
      }else if(/^https?:\/\//i.test(url)) chrome.tabs.onUpdated.removeListener(listener);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
});
