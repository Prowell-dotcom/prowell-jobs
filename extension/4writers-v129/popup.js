'use strict';
/* Standalone 4Writers extension forked from v2.1.29.
 * No Good-Writers access or controls. One targeted browser tab per START.
 */
const PREFIX='four_v129_',CONSENT='0.5.4',VERSION='2.1.29.3';
const URL_PATTERN=/^https:\/\/(?:www\.)?4writers\.net\//i;
const byId=id=>document.getElementById(id);
const key=name=>PREFIX+name;
const storageGet=names=>chrome.storage.local.get(names.map(key));
const storageSet=values=>chrome.storage.local.set(
  Object.fromEntries(Object.entries(values).map(([name,value])=>[key(name),value])));
function notice(message){byId('notice').textContent=message;}
async function tab(){
 const matches=(await chrome.tabs.query({})).filter(t=>
   URL_PATTERN.test(t.url||t.pendingUrl||''));
 return matches.find(t=>t.active)||matches[0]||null;
}
async function render(){
 const [t,record]=await Promise.all([
   tab(),storageGet(['armed','claimConsentVersion','targetTabId'])
 ]);
 const armed=record[key('armed')]===true&&record[key('claimConsentVersion')]===CONSENT;
 byId('start').disabled=!t||armed;
 byId('stop').disabled=!armed;
 if(!armed)notice(t?'Stopped — press START WATCH.':'Open 4writers.net in Chrome to begin.');
 else notice('Watching 4writers.net — press STOP to cancel.');
}
async function start(){
 const selected=await tab();
 if(!selected){notice('Open 4writers.net first.');return;}
 await storageSet({
   armed:true,claimConsentVersion:CONSENT,targetTabId:selected.id,
   claim:null,autoFlow:null,autoAcceptEnabled:false,processingScroll:null,
   manualAckScroll:null,attemptedIds:[],completed:[],seenOrderIds:[],
   fourLastCheckedSection:'',fourLastCheckedAt:null,fourCycleCount:0,
   refreshCount:0,lastRefreshAt:null,soundRunId:crypto.randomUUID(),
   lastResult:'Watching 4writers.net with 2–60-second mixed idle checks'
 });
 // Sound preparation must not hold up order scans or View.
 try{void chrome.runtime.sendMessage({type:'PROWELL_PREPARE_ORDER_SOUND'}).catch(()=>{});}
 catch(_){}
 await render();
}
async function stop(){
 await storageSet({armed:false,targetTabId:null,claim:null,autoFlow:null,
   autoAcceptEnabled:false,processingScroll:null,manualAckScroll:null,
   lastResult:'Stopped by user'});
 await render();
}
byId('start').addEventListener('click',()=>void start().catch(e=>notice('START failed: '+e.message)));
byId('stop').addEventListener('click',()=>void stop().catch(e=>notice('STOP failed: '+e.message)));
chrome.storage.onChanged.addListener((updates,area)=>{
 if(area==='local'&&Object.keys(updates).some(k=>k.startsWith(PREFIX)))
   void render().catch(e=>notice(String(e)));
});
void render().catch(e=>notice(String(e)));
