'use strict';
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='GW_TAB_ID')reply({tabId:sender.tab?.id??null});
});
