'use strict';
/* A single MV3 service worker serving two isolated site workflows. */
importScripts('order-sound-background.js');
const SITES={
  four:{host:/^https:\/\/(?:www\.)?4writers\.net\//i,prefix:'dual_four_'},
  good:{host:/^https:\/\/(?:www\.)?good-writers\.com\//i,prefix:'dual_good_'}
};
const siteOf=url=>Object.keys(SITES).find(site=>SITES[site].host.test(url||''))||null;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type==='PROWELL_TAB_ID'||message?.type==='GW_TAB_ID')
    reply({tabId:sender.tab?.id??null});
});
chrome.tabs.onCreated.addListener(async tab => {
  if(!Number.isInteger(tab.openerTabId)||!Number.isInteger(tab.id))return;
  let opener;
  try{opener=await chrome.tabs.get(tab.openerTabId)}catch(_){return;}
  const site=siteOf(opener?.url||opener?.pendingUrl);
  if(!site)return;
  const key=SITES[site].prefix+'autoFlow';
  const matches=url=>siteOf(url)===site;
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
