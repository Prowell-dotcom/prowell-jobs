'use strict';
// Clicking View must not wait for Chrome storage or the refresh timer.
// This test deliberately holds the storage write unresolved.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function simulate(slug,host,version,tabMessage,dual=false){
 const events=[],listeners=[];
 let finishSaving,staged;
 const state={armed:true,claimConsentVersion:version,targetTabId:19,
   autoAcceptEnabled:true,log:[],soundRunId:'test-session'};
 const storage={
   local:{
     async get(request){
       const keys=Array.isArray(request)?request:Object.keys(request||{});
       const result={};
       for(const name of keys)if(Object.prototype.hasOwnProperty.call(state,name))result[name]=state[name];
       return result;
     },
     set(patch){
       if(patch.autoFlow){
         staged=patch;
         events.push('save-start');
         return new Promise(resolve=>{finishSaving=()=>{
           Object.assign(state,patch);
           events.push('save-complete');
           resolve();
         };});
       }
       Object.assign(state,patch);
       return Promise.resolve();
     }
   },
   onChanged:{addListener(fn){listeners.push(fn);}}
 };
 const view={isConnected:true,click(){events.push('View');}};
 const window={};window.top=window;
 window.__prowellCancelRefresh=()=>events.push('refresh-cancelled');
 window.__prowellCardDetector={cards:()=>[{id:'1234567890',type:'available',view}]};
 if(dual)window.__prowellDualStorage=storage;
 const document={body:{innerText:'Available orders'},
   querySelector:()=>null,addEventListener(){}};
 const chrome={storage,runtime:{
   sendMessage(msg,reply){
     if(msg.type===tabMessage)reply({tabId:19});
     else if(msg.type==='PROWELL_ORDER_SOUND')events.push('sound');
   },
   onMessage:{addListener(){}},lastError:null
 }};
 const context={window,document,chrome,location:{origin:'https://'+host,
   hostname:host,href:'https://'+host+'/free_orders'},
   Date,queueMicrotask,MutationObserver:class{observe(){}},Promise};
 const source=fs.readFileSync(path.join(__dirname,'../extension',slug,'content.js'),'utf8');
 vm.runInNewContext(source,context);
 for(let i=0;i<12;i++)await Promise.resolve();
 assert(events.includes('refresh-cancelled'),'refresh must stop in the detection callback');
 assert(events.includes('save-start'),'order state must be written');
 assert(events.includes('View'),'View must be clicked without a pending storage write completing');
 assert(!events.includes('save-complete'),'View waited for storage; unexpected delay');
 assert(events.indexOf('refresh-cancelled')<events.indexOf('View'));
 assert(events.indexOf('save-start')<events.indexOf('View'));
 assert.equal(staged.autoFlow.stage,'await-view');
 assert.equal(staged.autoFlow.mode,'accept');
 assert.equal(staged.armed,undefined,'Continuous watcher must not turn off START');
 assert.deepEqual(Array.from(staged.seenOrderIds),['1234567890']);
 finishSaving();
 await Promise.resolve();
 assert.equal(state.armed,true,'Keep watching for the next order');
 console.log(slug+' '+host+': immediate refresh cancel and View before storage completion: PASS');
}
(async()=>{
 await simulate('4writers','4writers.net','0.5.14','PROWELL_TAB_ID');
 await simulate('good-writers','good-writers.com','1.0.14','GW_TAB_ID');
 await simulate('dual-writers','4writers.net','2.0.1','PROWELL_TAB_ID',true);
 await simulate('dual-writers','good-writers.com','2.0.1','GW_TAB_ID',true);
})().catch(e=>{console.error(e);process.exitCode=1;});
