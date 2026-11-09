'use strict';
/* Simulate the actual page monitor, asserting NO scroll or claim interactions. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function run(slug,kind){
  const site=slug==='4writers'?'4writers.net':'good-writers.com';
  const version=slug==='4writers'?'0.5.15':'1.0.15';
  const tabType=slug==='4writers'?'PROWELL_TAB_ID':'GW_TAB_ID';
  const runId='8a8b7c6d-4e5f-4a29-9012-123456789abc';
  const chronology=[],subscribers=[],clicks=[];
  let observer=()=>{};
  const state={armed:true,claimConsentVersion:version,targetTabId:7,
    soundRunId:runId,claim:null,lastResult:'Ready',log:[]};
  const body={innerText:'Available Orders and Writings'};
  const controls={
    view:{isConnected:true,click(){
      clicks.push('View');chronology.push('View clicked');
      body.innerText='ORDER INFORMATION Order #1234567890 Take it OK I understand';
      // A real modal rerenders the DOM after clicking View.
      observer([{target:body}]);
    }},
    take:{click(){clicks.push('Take it');}},
    ok:{click(){clicks.push('OK');}},
    understand:{click(){clicks.push('I understand');}}
  };
  let orderCards=[];
  const window={};window.top=window;window.__prowellCancelRefresh=()=>chronology.push('refresh cancelled');
  window.__prowellCardDetector={cards:()=>orderCards,pageKind:()=>kind};
  const document={body,
    querySelector:()=>null,
    addEventListener(){},
    scrollingElement:{scrollTo(){chronology.push('scroll');}},
  };
  window.scrollTo=()=>chronology.push('scroll');
  const chrome={
    runtime:{sendMessage(message,cb){
      if(message.type===tabType){cb({tabId:7});return;}
      chronology.push(message.type==='PROWELL_ORDER_SOUND'?'sound requested':message.type);
      cb?.({ok:true});
    },onMessage:{addListener(){}} ,lastError:null},
    storage:{local:{
      get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:Object.keys(keys)).map(k=>[k,state[k]])),
      async set(delta){
        chronology.push('watcher state stored');
        Object.assign(state,delta);
        const changes=Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,{newValue:v}]));
        for(const fn of subscribers)fn(changes,'local');
      },
    },onChanged:{addListener(fn){subscribers.push(fn);}}}
  };
  const location={origin:'https://'+site,href:'https://'+site+'/free_orders/'};
  const context={window,document,chrome,location,Date,URL,
    queueMicrotask,console,
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}}
  };
  const src=fs.readFileSync(path.join(__dirname,'../extension',slug,'content.js'),'utf8');
  assert.doesNotMatch(src,/\.scrollTo\s*\(|\.scrollIntoView\s*\(|find\s*\(\s*TAKE\s*\)|\.click\s*\(\s*\)\s*;.*OK/);
  vm.runInNewContext(src,context);
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(clicks.length,0,'No order => no action');
  orderCards=[{id:'1234567890',type:kind,view:controls.view}];
  observer([{target:body}]);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(clicks,['View'],slug+' '+kind+' must click ONLY View');
  assert.equal(state.armed,true,'Watcher must remain armed for the next order');
  assert.equal(state.targetTabId,7,'Monitoring must remain bound to the original tab');
  assert.equal(state.claim,null,'No claim state should be persisted');
  assert.equal(state.autoFlow?.orderId,'1234567890','View handoff must target the selected order');
  assert(Array.from(state.seenOrderIds||[]).includes('1234567890'),'Handled order ID must be remembered');
  assert.equal(chronology[0],'sound requested');
  assert.equal(chronology[1],'refresh cancelled');
  assert(chronology.indexOf('watcher state stored')>0);
  assert(chronology.indexOf('watcher state stored')<chronology.indexOf('View clicked'),
    'Must pause refreshing before opening View');
  assert.equal(chronology.filter(x=>x==='sound requested').length,1);
  assert.equal(chronology.includes('scroll'),false,'Bot must not scroll any page');
  observer([{target:body}]);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(clicks,['View'],'No additional clicks after opening View');
  assert.equal(chronology.filter(x=>x==='sound requested').length,1,'No repeated alert after stop');
  console.log(slug+' '+kind+': sound → stop → View only; NO scroll/acceptance: PASS');
}

(async()=>{for(const slug of ['4writers','good-writers']){
  await run(slug,'available');
  await run(slug,'processing');
}})().catch(e=>{console.error(e);process.exitCode=1;});
