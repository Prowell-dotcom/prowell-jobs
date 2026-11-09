'use strict';
importScripts('order-sound-background.js');
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='GW_TAB_ID')reply({tabId:sender.tab?.id??null});
});


const REPORT_URL='https://prowelljobs.com/api/good-writers/report';
const VERIFY_URL='https://prowelljobs.com/api/good-writers/report/verify';
async function sendPairedReport(report,code){
 const res=await fetch(REPORT_URL,{
  method:'POST',
  headers:{Authorization:'Bearer '+code,'Content-Type':'application/json'},
  body:JSON.stringify(report)
 });
 if(!res.ok)throw Error('Dashboard report rejected: HTTP '+res.status);
 return true;
}
async function flushPending(){
 const state=await chrome.storage.local.get(['goodWritersReportCode','goodWritersPending']);
 if(!state.goodWritersReportCode)return {paired:false,pending:(state.goodWritersPending||[]).length};
 const pending=state.goodWritersPending||[];
 const remaining=[];
 for(const event of pending){
  try{await sendPairedReport(event,state.goodWritersReportCode);}
  catch(err){remaining.push(event);}
 }
 await chrome.storage.local.set({goodWritersPending:remaining,
  goodWritersReportStatus:remaining.length?'Some reports could not reach Prowell.':'Connected; results delivered.'});
 return {paired:true,pending:remaining.length};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='GOOD_WRITERS_RESULT'){
  const report=message.payload||{};
  chrome.storage.local.get(['goodWritersResults','goodWritersPending'],state=>{
   const history=Array.isArray(state.goodWritersResults)?state.goodWritersResults:[];
   const pending=Array.isArray(state.goodWritersPending)?state.goodWritersPending:[];
   const nextHistory=[...history.filter(x=>x.eventKey!==report.eventKey),
                      {...report,receivedAt:Date.now()}].slice(-100);
   const nextPending=[...pending.filter(x=>x.eventKey!==report.eventKey),report].slice(-100);
   chrome.storage.local.set({goodWritersResults:nextHistory,goodWritersPending:nextPending},()=>{
    void flushPending();
    reply({ok:true,queued:true});
   });
  });
  return true;
 }
 if(message?.type==='GOOD_WRITERS_VERIFY'){
  (async()=>{
   try{
    const code=String(message.code||'');
    if(code.length<30||code.length>180)throw Error('Invalid pairing code.');
    const res=await fetch(VERIFY_URL,{method:'POST',headers:{Authorization:'Bearer '+code}});
    if(!res.ok)throw Error('Pairing rejected: HTTP '+res.status);
    await chrome.storage.local.set({goodWritersReportCode:code,goodWritersReportStatus:'Connected'});
    const result=await flushPending();
    reply({ok:true,pending:result.pending});
   }catch(e){reply({ok:false,error:e.message});}
  })();
  return true;
 }
 if(message?.type==='GOOD_WRITERS_DISCONNECT'){
  chrome.storage.local.remove('goodWritersReportCode',()=>{
   chrome.storage.local.set({goodWritersReportStatus:'Disconnected'},()=>reply({ok:true}));
  });
  return true;
 }
 if(message?.type==='GOOD_WRITERS_RETRY'){
  flushPending().then(reply).catch(e=>reply({ok:false,error:e.message}));
  return true;
 }
});

chrome.tabs.onCreated.addListener(tab=>{
 if(!Number.isInteger(tab.openerTabId))return;
 chrome.storage.local.get(['armed','claimConsentVersion','targetTabId'],state=>{
  if(!state.armed||state.claimConsentVersion!=='1.0.11'||state.targetTabId!==tab.openerTabId)return;
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
      if(/^https:\/\/(?:www\.)?good-writers\.com\//i.test(url)){
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
