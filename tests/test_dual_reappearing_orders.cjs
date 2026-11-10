'use strict';
// Regression: returning same ID must not be blocked by historical ID arrays.
// A new View DOM button (or disappearance/reappearance) is actionable again.
// Identical still-visible View elements must not be clicked repeatedly.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../extension/dual-writers');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const settle=async()=>{for(let i=0;i<28;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
async function clicks(site,kind){
 const four=site==='four',host=four?'4writers.net':'good-writers.com';
 const id='0192065941',history=[],listeners=[];let cards=[],mutation;
 const state={armed:true,targetTabId:7,claimConsentVersion:four?'0.5.4':'1.0.4',
   claim:null,attemptedIds:[id],completed:[id],processingPreviewedIds:[id]};
 const store={
   async get(defaults){return Object.fromEntries(Object.entries(defaults).map(
     ([k,v])=>[k,Object.hasOwn(state,k)?state[k]:v]));},
   async set(patch){
     const changed=Object.fromEntries(Object.entries(patch).map(([k,v])=>
       [k,{oldValue:state[k],newValue:v}]));
     Object.assign(state,patch);
     for(const fn of listeners)fn(changed,'local');
   }
 };
 const chrome={runtime:{lastError:null,onMessage:{addListener(){}},
   sendMessage(message,cb){
     if(message.type===(four?'PROWELL_TAB_ID':'GW_TAB_ID'))cb?.({tabId:7});
     else cb?.({ok:true});
   }},storage:{local:store,onChanged:{addListener(fn){listeners.push(fn);}}}};
 const document={
   body:{innerText:'Available orders'},
   documentElement:{appendChild(){}},
   createElement(){return{id:'',style:{},textContent:'',contains(){return false},remove(){}}},
   querySelector(){return null},querySelectorAll(){return[]},addEventListener(){}
 };
 const window={__prowellLegacyChrome:chrome,
   __prowellCardDetector:{pageKind:()=>kind==='available'?'available':'processing',
     cards:()=>cards},dispatchEvent(){}};
 window.top=window;
 const context={window,chrome,document,location:{
   origin:'https://'+host,href:'https://'+host+'/available_orders'},Date,
   Promise,Set,Map,Number,URL,Event:class{},Error,
   queueMicrotask,setTimeout(fn,ms){if(ms===0)queueMicrotask(fn);return 1;},
   clearTimeout(){},setInterval(){return 1},
   MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}
 };
 const card=()=>{const view={click(){history.push('View '+id)}};return{
   type:kind,id,view,hasFiles:true,hasMessages:kind==='processing'};};
 cards=[card()];
 vm.runInNewContext(source('legacy/'+site+'/runtime-content.js'),context);
 await settle();
 assert.equal(history.length,1,site+' '+kind+' first View, despite historical ID');
 assert.equal(state.claim?.stage,
   kind==='processing'?'processing-view-clicked':'view-clicked');
 await store.set({claim:null});
 await settle();
 assert.equal(history.length,1,'Unchanged card must not be clicked again');
 cards=[card()];
 mutation([{target:document.body}]);await settle();
 assert.equal(history.length,2,site+' '+kind+' same ID, replacement card requires View');
 await store.set({claim:null});await settle();
 assert.equal(history.length,2,'Second same card must not double-click');
 cards=[];mutation([{target:document.body}]);await settle();
 cards=[card()];mutation([{target:document.body}]);await settle();
 assert.equal(history.length,3,site+' '+kind+' after disappearance must trigger View');
 await store.set({claim:null});await settle();
 await store.set({armed:false});await settle();
 await store.set({armed:true});await settle();
 assert.equal(history.length,4,site+' '+kind+' manual restart must rearm same visible ID');
 assert.equal(state.attemptedIds[0],id);
 assert.equal(state.completed[0],id);
 assert.equal(state.processingPreviewedIds[0],id);
 console.log(site+' '+kind+' returning same ID: 4 View actions, no duplicate unchanged card PASS');
}
async function sound(site){
 const host=site==='four'?'4writers.net':'good-writers.com';
 const version=site==='four'?'0.5.4':'1.0.4';
 const id='0192065941',events=[],listeners=[];let cards=[],mutation;
 const state={armed:true,claimConsentVersion:version,targetTabId:7,
   soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};
 const store={local:{async get(defaults){return {...defaults,...state}}},
   onChanged:{addListener(fn){listeners.push(fn)}}};
 const make=()=>({id,type:'available',view:{}});
 cards=[make()];
 const window={__prowellDualStorage:store,
   __prowellCardDetector:{cards:()=>cards}};
 window.top=window;
 const chrome={runtime:{lastError:null,sendMessage(message,cb){
   if(message.type==='PROWELL_TAB_ID'||message.type==='GW_TAB_ID')cb?.({tabId:7});
   if(message.type==='PROWELL_ORDER_SOUND'){events.push(message);cb?.({ok:true});}
 }}};
 const context={window,chrome,document:{body:{},addEventListener(){}},
   location:{hostname:host},Date,Promise,Set,Map,queueMicrotask,
   MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}
 };
 vm.runInNewContext(source('legacy-order-sound.js'),context);await settle();
 assert.equal(events.length,1);
 mutation();await settle();assert.equal(events.length,1,'No repeat sound for same View');
 cards=[make()];mutation();await settle();
 assert.equal(events.length,2,'Reappeared ID with replaced View must alert again');
 cards=[];mutation();await settle();
 cards=[make()];mutation();await settle();
 assert.equal(events.length,3,'Reappeared ID after absence must alert again');
 console.log(site+' repeated-ID sound: once per appearance PASS');
}
(async()=>{
 for(const site of ['four','good']){
   await clicks(site,'available');
   await clicks(site,'processing');
   await sound(site);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
