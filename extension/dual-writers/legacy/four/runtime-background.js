/* Original four background module executed through the dual extension's
 * separate Chrome storage namespace. Embedded original is unmodified.
 */
(() => {
  const rawChrome=chrome;
  const storagePrefix='dual_four_';
  const scopedLocal={
    get(request,callback){
      const object=Boolean(request&&!Array.isArray(request)&&typeof request==='object');
      const keys=Array.isArray(request)?request:object?Object.keys(request):
        typeof request==='string'?[request]:[];
      const work=rawChrome.storage.local.get(keys.map(k=>storagePrefix+k)).then(result=>{
        const values={};
        for(const k of keys){
          const qualified=storagePrefix+k;
          if(Object.prototype.hasOwnProperty.call(result,qualified))
            values[k]=result[qualified];
          else if(object)values[k]=request[k];
        }
        return values;
      });
      if(typeof callback==='function'){void work.then(callback);return;}
      return work;
    },
    set(patch,callback){
      const next=Object.fromEntries(Object.entries(patch)
        .map(([k,v])=>[storagePrefix+k,v]));
      const work=rawChrome.storage.local.set(next);
      if(typeof callback==='function'){void work.then(()=>callback());return;}
      return work;
    },
    remove(names,callback){
      const keys=(Array.isArray(names)?names:[names]).map(k=>storagePrefix+k);
      const work=rawChrome.storage.local.remove(keys);
      if(typeof callback==='function'){void work.then(()=>callback());return;}
      return work;
    }
  };
  const chrome={runtime:rawChrome.runtime,tabs:rawChrome.tabs,
    storage:{local:scopedLocal}};
'use strict';
// Identify the current frame's tab without reading account credentials.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message && message.type === 'PROWELL_TAB_ID') reply({tabId: sender.tab ? sender.tab.id : null});
});
// Some official View links open a separate tab; continue monitoring it.
chrome.tabs.onCreated.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;
  chrome.storage.local.get(['armed', 'claimConsentVersion', 'targetTabId'], state => {
    if (!state.armed || state.claimConsentVersion !== '0.5.4' || state.targetTabId !== tab.openerTabId) return;
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
})();
