'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
async function run(){
  let timeoutId=0,reloadCount=0,observer=()=>{},timer=null,oldTimer=null;
  const subscribers=[];
  const state={armed:true,claimConsentVersion:'0.5.8',targetTabId:42,claim:null,refreshCount:0,attemptedIds:[],completed:[]};
  let text='Available Orders Writings';
  const doc={
    body:{get innerText(){return text;}},
    querySelector(){return null;},
    querySelectorAll(){return [];},
    addEventListener(){}
  };
  const chrome={
    storage:{
      local:{
        async get(keys){return Object.fromEntries(keys.map(k=>[k,state[k]]));},
        async set(delta){Object.assign(state,delta);for(const s of subscribers)s(Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,{newValue:v}])), 'local');}
      },
      onChanged:{addListener(fn){subscribers.push(fn);}}
    },
    runtime:{sendMessage(m,cb){cb({tabId:42});}}
  };
  const window={};window.top=window;
  window.__prowellCardDetector={pageKind:()=> 'available',cards:()=>[]};
  const ctx={window,document:doc,chrome,location:{origin:'https://4writers.net',reload(){reloadCount++;}},
    MutationObserver:class{constructor(cb){observer=cb;}observe(){}},
    setTimeout(fn,ms){assert.equal(ms,1000);timer=async()=>{timer=null;return fn();};return ++timeoutId;},
    clearTimeout(id){oldTimer=id;timer=null;},
    Date,Number,Set,RegExp,Boolean};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/4writers/refresh.js'),'utf8'),ctx);
  await new Promise(r=>setImmediate(r));
  assert.equal(typeof timer,'function','refresh timer was not armed');
  const first=timer;
  observer([{target:doc.body}]);
  observer([{target:doc.body}]);
  assert.equal(timer,first,'DOM changes must not reset the refresh timer');
  await timer();
  assert.equal(reloadCount,1);
  assert.equal(state.refreshCount,1);
  assert.equal(state.refreshStatus,'Reloading Available Orders');
  state.claim={id:'6447728953'};
  subscribers.forEach(fn=>fn({claim:{newValue:state.claim}},'local'));
  assert.equal(timer,null,'timer must stop when claiming');
  console.log('Independent refresh: stable 1-second timer, counter, stop on claim: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});