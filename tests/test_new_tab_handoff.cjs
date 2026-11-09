'use strict';
// View can open a new tab before the flow write reaches Chrome storage.
// The worker must transfer that flow once storage arrives, without polling.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function run(slug,host,key){
 const store={},events={created:[],updated:[],removed:[],storage:[],messages:[]};
 const handler=n=>({
   addListener(fn){events[n].push(fn);},
   removeListener(fn){const i=events[n].indexOf(fn);if(i>=0)events[n].splice(i,1);}
 });
 const tabs={5:{id:5,url:'https://'+host+'/free_orders'},
   7:{id:7,url:'https://'+host+'/order/1234567890',openerTabId:5}};
 const chrome={
   storage:{local:{
     get(keys,cb){
       const names=Array.isArray(keys)?keys:typeof keys==='string'?[keys]:Object.keys(keys||{});
       const value=Object.fromEntries(names.filter(k=>k in store).map(k=>[k,store[k]]));
       if(cb)cb(value);
       return Promise.resolve(value);
     },
     async set(delta){
       Object.assign(store,delta);
       const changed=Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,{newValue:v}]));
       for(const fn of [...events.storage])fn(changed,'local');
     }
   },onChanged:handler('storage')},
   tabs:{onCreated:handler('created'),onUpdated:handler('updated'),onRemoved:handler('removed'),
     async get(id){if(!tabs[id])throw Error('tab unavailable');return tabs[id];}},
   runtime:{onMessage:handler('messages'),lastError:null}
 };
 const script=fs.readFileSync(path.join(__dirname,'../extension',slug,'background.js'),'utf8');
 vm.runInNewContext(script,{chrome,importScripts(){},
   setTimeout(){return 1;},clearTimeout(){},Date,fetch:async()=>({ok:true})});
 // Fire tab creation BEFORE the accepted order is stored.
 await Promise.all([...events.created].map(listener=>listener(tabs[7])));
 assert.equal(store[key],undefined);
 await chrome.storage.local.set({[key]:{enabled:true,orderId:'1234567890',
   tabId:5,startedAt:Date.now(),stage:'await-view'}});
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(store[key].tabId,7,slug+' must transfer the selected order into the opened tab');
 console.log(slug+' '+host+': new-tab handoff after delayed storage: PASS');
}
(async()=>{
 await run('4writers','4writers.net','autoFlow');
 await run('good-writers','good-writers.com','autoFlow');
 await run('dual-writers','4writers.net','dual_four_autoFlow');
 await run('dual-writers','good-writers.com','dual_good_autoFlow');
})().catch(e=>{console.error(e);process.exitCode=1;});
