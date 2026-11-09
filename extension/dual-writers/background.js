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
// Preserve the selected order when the official View link opens a new tab.
chrome.tabs.onCreated.addListener(async tab=>{
  if(!Number.isInteger(tab.openerTabId))return;
  let opener;
  try{opener=await chrome.tabs.get(tab.openerTabId);}catch(_){return;}
  const site=siteOf(opener?.url||opener?.pendingUrl);
  if(!site)return;
  const key=SITES[site].prefix+'autoFlow';
  const saved=await chrome.storage.local.get(key);
  const flow=saved[key];
  if(!flow||flow.enabled!==true||flow.tabId!==tab.openerTabId||
     Date.now()-flow.startedAt>=90000)return;
  const onUpdate=async(id,changed,current)=>{
    if(id!==tab.id)return;
    const url=current?.url||changed.url||'';
    if(siteOf(url)===site){
      chrome.tabs.onUpdated.removeListener(onUpdate);
      const latest=(await chrome.storage.local.get(key))[key];
      if(latest?.enabled===true&&latest.orderId===flow.orderId&&
         latest.tabId===tab.openerTabId){
        await chrome.storage.local.set({[key]:{...latest,tabId:tab.id}});
      }
    }else if(/^https?:\/\//i.test(url))chrome.tabs.onUpdated.removeListener(onUpdate);
  };
  chrome.tabs.onUpdated.addListener(onUpdate);
  if(siteOf(tab.url||tab.pendingUrl)===site)void onUpdate(tab.id,{},tab);
});
