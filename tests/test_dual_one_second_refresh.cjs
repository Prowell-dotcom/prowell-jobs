'use strict';
// Regression test for the active Good-Writers dual 1-second refresh.
const assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../extension/dual-writers');
const code=fs.readFileSync(path.join(root,'legacy/good/runtime-refresh.js'),'utf8');
(async()=>{
  let reloads=0,timers=[],observer;
  const subscribers=[],state={armed:true,claimConsentVersion:'1.0.4',
    targetTabId:42,claim:null,refreshCount:0,attemptedIds:[],completed:[]};
  let cards=[],nextId=1;
  const document={body:{innerText:'Available Orders Writings'},
    querySelector(){return null;},addEventListener(){}};
  const chrome={storage:{local:{
      async get(keys){return Object.fromEntries(keys.map(k=>[k,state[k]]));},
      async set(delta){const changes=Object.fromEntries(Object.entries(delta).map(
        ([k,v])=>[k,{newValue:v,oldValue:state[k]}]));
        Object.assign(state,delta);for(const fn of subscribers)fn(changes,'local');
      }
    },onChanged:{addListener(fn){subscribers.push(fn);}}},
    runtime:{sendMessage(msg,cb){if(msg.type==='GW_TAB_ID')cb({tabId:42});}}};
  const window={__prowellLegacyChrome:chrome,
    __prowellCardDetector:{pageKind:()=>'available',cards:()=>cards},
    __prowellDualActionableCards:()=>cards};window.top=window;
  const context={window,document,location:{
      origin:'https://good-writers.com',hostname:'good-writers.com',
      reload(){reloads++;}
    },Date,Number,Set,RegExp,Boolean,
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}},
    setTimeout(fn,ms){const t={id:nextId++,fn,ms};timers.push(t);return t.id;},
    clearTimeout(id){timers=timers.filter(t=>t.id!==id);}};
  vm.runInNewContext(code,context);
  for(let i=0;i<20;i++)await Promise.resolve();
  const find=()=>timers.find(t=>t.ms===1000);
  assert(find(),'Good-Writers must schedule 1-second refresh');
  assert(!timers.some(t=>t.ms===2000),'No 2-second refresh allowed');
  const first=find();
  observer([{target:document.body}]);observer([{target:document.body}]);
  assert.strictEqual(find(),first,'DOM mutations must not reset the refresh timer');
  timers=timers.filter(t=>t!==first);
  await first.fn();
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(reloads,1);
  assert.equal(state.refreshCount,1);
  assert.equal(state.refreshStatus,'Reloading Available Orders');
  observer([{target:document.body}]);
  assert(find(),'Countdown must rearm on the next loaded page');
  cards=[{id:'12345678',type:'available'}];
  observer([{target:document.body}]);
  assert.equal(find(),undefined,'Detected order must cancel pending refresh');
  assert.equal(reloads,1,'No reload after an order is detected');
  console.log('Dual Good-Writers: 1000 ms timer, stable countdown, refresh on idle, order stop PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
