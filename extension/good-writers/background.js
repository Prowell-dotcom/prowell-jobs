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
  if(!state.armed||state.claimConsentVersion!=='1.0.12'||state.targetTabId!==tab.openerTabId)return;
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

chrome.tabs.onCreated.addListener(tab => {
  if(!Number.isInteger(tab.openerTabId)||!Number.isInteger(tab.id))return;
  const key='autoFlow';
  const matches=url=>/^https:\/\/(?:www\.)?good-writers\.com\//i.test(url||'');
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
