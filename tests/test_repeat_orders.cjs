'use strict';
/* Regression: START keeps listening after the first order, but never reopens
 * the same ID. Sound and View fire once for each newly observed order.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
async function test(slug,host,version,tabMessage){
 const events=[],listeners=[];
 let mutation=()=>{},cards=[];
 const state={armed:true,targetTabId:12,claimConsentVersion:version,
   autoAcceptEnabled:true,seenOrderIds:[],autoFlow:null,
   soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',log:[]};
 const doc={body:{innerText:'Available orders'},querySelector(){return null},
   querySelectorAll(){return[]},addEventListener(){}};
 const store={
   local:{
     async get(defaults){
       const keys=Array.isArray(defaults)?defaults:Object.keys(defaults||{});
       return Object.fromEntries(keys.map(k=>[k,state[k]??defaults?.[k]]));
     },
     async set(delta){
       Object.assign(state,delta);
       const changes=Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,{newValue:v}]));
       for(const fn of listeners)fn(changes,'local');
     }
   },
   onChanged:{addListener(fn){listeners.push(fn);}}
 };
 const window={};window.top=window;
 window.__prowellCancelRefresh=()=>events.push('pause');
 window.__prowellCardDetector={cards:()=>cards,pageKind:()=> 'available'};
 if(slug==='dual-writers')window.__prowellDualStorage=store;
 const chrome={storage:store,runtime:{
   sendMessage(msg,cb){
     if(msg.type===tabMessage)cb({tabId:12});
     else if(msg.type==='PROWELL_ORDER_SOUND')events.push('sound:'+msg.orderId);
   },
   onMessage:{addListener(){}},lastError:null
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',slug,'content.js'),'utf8'),
  {window,document:doc,chrome,location:{origin:'https://'+host,hostname:host,
    href:'https://'+host+'/free_orders'},Date,queueMicrotask,
   MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}});
 for(let k=0;k<5;k++)await Promise.resolve();
 const make=id=>({id,type:'available',view:{isConnected:true,
   click(){events.push('View:'+id);}}});
 cards=[make('1234567890')];
 mutation([]);
 for(let k=0;k<12;k++)await Promise.resolve();
 assert.equal(events.filter(x=>x==='View:1234567890').length,1);
 assert.equal(state.armed,true,'START must remain armed');
 assert.equal(state.autoAcceptEnabled,true,'acceptance opt-in persists until STOP');
 assert.deepEqual(Array.from(state.seenOrderIds),['1234567890']);
 assert.equal(state.autoFlow.orderId,'1234567890');
 await store.local.set({autoFlow:null});
 for(let k=0;k<12;k++)await Promise.resolve();
 mutation([]);
 for(let k=0;k<8;k++)await Promise.resolve();
 assert.equal(events.filter(x=>x==='View:1234567890').length,1,
   'must not reopen the already handled order');
 cards=[make('1234567890'),make('1234567891')];
 mutation([]);
 for(let k=0;k<12;k++)await Promise.resolve();
 assert.equal(events.filter(x=>x==='View:1234567891').length,1,
   'new order should be handled without another START');
 assert.equal(events.filter(x=>x.startsWith('sound:')).length,2,
   'every new order needs its own notification sound');
 await store.local.set({autoFlow:null,armed:false});
 cards.push(make('1234567892'));mutation([]);
 for(let k=0;k<8;k++)await Promise.resolve();
 assert.equal(events.filter(x=>x==='View:1234567892').length,0,'STOP must stop watcher');
 console.log(slug+' '+host+': repeat orders, sound, seen-ID dedupe and STOP: PASS');
}
(async()=>{
 await test('4writers','4writers.net','0.5.16','PROWELL_TAB_ID');
 await test('good-writers','good-writers.com','1.0.16','GW_TAB_ID');
 await test('dual-writers','4writers.net','2.0.4','PROWELL_TAB_ID');
 await test('dual-writers','good-writers.com','2.0.4','GW_TAB_ID');
})().catch(error=>{console.error(error);process.exitCode=1;});
