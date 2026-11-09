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
    if (!state.armed || state.claimConsentVersion !== '0.5.12' || state.targetTabId !== tab.openerTabId) return;
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

chrome.tabs.onCreated.addListener(tab => {
  if(!Number.isInteger(tab.openerTabId)||!Number.isInteger(tab.id))return;
  const key='autoFlow';
  const matches=url=>/^https:\/\/(?:www\.)?4writers\.net\//i.test(url||'');
  const newId=tab.id,openerId=tab.openerTabId;
  let finished=false,transferring=false,rerunRequested=false;
  let expiry=null;
  const cleanup=()=>{
    if(finished)return;
    finished=true;
    if(expiry!==null)clearTimeout(expiry);
    chrome.storage.onChanged.removeListener(onStorage);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
  };
  const maybeTransfer=async()=>{
    if(finished)return;
    if(transferring){rerunRequested=true;return;}
    transferring=true;
    try{
      const flow=(await chrome.storage.local.get(key))[key];
      if(!flow||flow.enabled!==true||flow.tabId!==openerId||
          Date.now()-flow.startedAt>=90000)return;
      let opened;
      try{opened=await chrome.tabs.get(newId)}catch(_){cleanup();return;}
      if(!matches(opened?.url||opened?.pendingUrl))return;
      const latest=(await chrome.storage.local.get(key))[key];
      if(!latest||latest.orderId!==flow.orderId||latest.tabId!==openerId)return;
      await chrome.storage.local.set({[key]:{...latest,tabId:newId}});
      cleanup();
    }catch(_){
      // Keep the short-lived observer for the next official tab or storage update.
    }finally{
      transferring=false;
      if(rerunRequested&&!finished){rerunRequested=false;void maybeTransfer();}
    }
  };
  const onStorage=(changes,area)=>{
    if(area==='local'&&changes[key])void maybeTransfer();
  };
  const onUpdated=(id)=>{if(id===newId)void maybeTransfer();};
  const onRemoved=(id)=>{if(id===newId)cleanup();};
  chrome.storage.onChanged.addListener(onStorage);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  // Cleanup timer never delays a click. It only releases unused listeners.
  expiry=setTimeout(cleanup,30000);
  void maybeTransfer();
});
