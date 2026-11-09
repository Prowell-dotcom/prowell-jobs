'use strict';
// Boot the real combined MV3 service worker in a simulated Chrome runtime.
// Static --check cannot catch TDZ shadowing: const rawChrome=chrome with a
// later const chrome inside the same wrapper throws at importScripts time.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const base=path.join(__dirname,'../extension/dual-writers');
const events={messages:[],tabsCreated:[],tabsUpdated:[],tabsRemoved:[],storage:[]};
const state={};
const mkEvent=name=>({
 addListener(fn){events[name].push(fn);},
 removeListener(fn){const i=events[name].indexOf(fn);if(i>=0)events[name].splice(i,1);}
});
const chrome={
 runtime:{
   onMessage:mkEvent('messages'),
   getURL(p){return 'chrome-extension://test/'+p}
 },
 offscreen:{
   async hasDocument(){return true},
   async createDocument(){return true}
 },
 tabs:{
   onCreated:mkEvent('tabsCreated'),
   onUpdated:mkEvent('tabsUpdated'),
   onRemoved:mkEvent('tabsRemoved'),
   async get(id){return {id,url:'https://4writers.net/available_orders'}}
 },
 storage:{
   onChanged:mkEvent('storage'),
   local:{
     get(keys,callback){
       const selected=Array.isArray(keys)?keys:
         typeof keys==='string'?[keys]:
         keys&&typeof keys==='object'?Object.keys(keys):[];
       const result=Object.fromEntries(selected.filter(k=>Object.hasOwn(state,k))
         .map(k=>[k,state[k]]));
       if(typeof callback==='function'){callback(result);return;}
       return Promise.resolve(result);
     },
     set(patch,callback){
       Object.assign(state,patch);
       if(typeof callback==='function'){callback();}
       return Promise.resolve();
     },
     remove(keys,callback){
       for(const k of Array.isArray(keys)?keys:[keys])delete state[k];
       if(typeof callback==='function'){callback();}
       return Promise.resolve();
     }
   },
   session:{
     async get(){return {}},
     async set(){return}
   }
 }
};
const context=vm.createContext({chrome,Date,console,Promise,setTimeout,clearTimeout,
  fetch:async()=>({ok:true,status:200})});
context.importScripts=(...files)=>{
 for(const file of files){
   const abs=path.resolve(base,file);
   assert(abs.startsWith(base+path.sep));
   vm.runInContext(fs.readFileSync(abs,'utf8'),context,{filename:file});
 }
};
const worker=fs.readFileSync(path.join(base,'background.js'),'utf8');
assert(!/\bimportScripts\s*\(/.test(worker),
  'Dual worker must have no importScripts dependencies that break registration');
for(const file of ['order-sound-background.js',
  'legacy/four/runtime-background.js','legacy/good/runtime-background.js']){
 assert(worker.includes(fs.readFileSync(path.join(base,file),'utf8')),
   file+' must be embedded unchanged in the startup script');
}
vm.runInContext(worker,context,{filename:'background.js'});
assert(events.messages.length>=6,'Both original background modules and sound must register');
assert(events.tabsCreated.length>=3,'Both original new-tab handlers must register');
function check(type){
 let found=false;
 for(const fn of events.messages){
   const response=fn({type},{tab:{id:42},url:'https://4writers.net/available_orders'},
     value=>{if(value?.tabId===42)found=true;});
 }
 assert(found,type+' must resolve the current tab after worker boots');
}
check('PROWELL_TAB_ID');
check('GW_TAB_ID');
console.log('Dual worker bootstrap: imports sound + BOTH original background engines with no startup ReferenceError PASS');
