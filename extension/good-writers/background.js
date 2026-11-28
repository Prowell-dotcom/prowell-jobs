'use strict';
// Standalone Good-Writers v1.0.17: sound and tab-ID service only.
// The previous automatic acceptance and tab-to-tab handoff are disabled.
importScripts('order-sound-background.js');
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type==='GW_TAB_ID')reply({tabId:sender.tab?.id??null});
});
