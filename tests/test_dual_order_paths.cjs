'use strict';
// Dual-platform regression: both order types stop refresh, request sound,
// open View and jump the selected details pane to bottom. Missing Take it on
// processing is a normal successful stop, not a 20-second timeout.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'../extension/dual-writers');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const id='1234567890';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function detect(host,kind){
  const events=[],listeners=[],state={
    armed:true,claimConsentVersion:'2.0.4',targetTabId:7,autoAcceptEnabled:true,
    soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',autoFlow:null,
    seenOrderIds:[],log:[]};
  const store={
    local:{
      async get(d){const keys=Array.isArray(d)?d:Object.keys(d||{});
        return Object.fromEntries(keys.map(k=>[k,state[k]??d?.[k]]));},
      async set(v){Object.assign(state,v);
        const changes=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,{newValue:x}]));
        listeners.forEach(fn=>fn(changes,'local'));}
    },onChanged:{addListener(fn){listeners.push(fn);}}
  };
  let mutation;
  const window={};window.top=window;window.__prowellDualStorage=store;
  window.__prowellCancelRefresh=()=>events.push('STOP REFRESH');
  window.__prowellCardDetector={cards:()=>[{type:kind,id,view:{
    isConnected:true,click(){events.push('VIEW');}}}],pageKind:()=>kind};
  const document={body:{innerText:'Available and processing orders'},
    querySelector(){return null},querySelectorAll(){return[]},addEventListener(){}};
  const chrome={runtime:{
    sendMessage(m,cb){if(m.type===(host==='4writers.net'?'PROWELL_TAB_ID':'GW_TAB_ID'))
      cb({tabId:7});
      else if(m.type==='PROWELL_ORDER_SOUND')events.push('SOUND:'+m.kind);
    },onMessage:{addListener(){}},lastError:null}};
  vm.runInNewContext(read('content.js'),{
    window,document,chrome,Date,queueMicrotask,
    location:{origin:'https://'+host,hostname:host,href:'https://'+host+'/free_orders'},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}
  });
  await tick();mutation([]);await tick();
  assert.deepEqual(events.slice(0,3),['STOP REFRESH','SOUND:'+kind,'VIEW'],
    host+' '+kind+' must stop refresh, alert, and click View in that order');
  assert.equal(state.autoFlow.orderId,id);
  assert.equal(state.autoFlow.mode,kind==='processing'?'processing-preview':'accept');
  assert.equal(state.armed,true,'later orders remain armed');
  assert.deepEqual(Array.from(state.seenOrderIds),[id]);
  console.log(host+' '+kind+': immediate stop + audible alert + View: PASS');
}

async function detailFlow(host,kind){
  const processing=kind==='processing',events=[],listeners=[];
  const state={autoFlow:{enabled:true,
    mode:processing?'processing-preview':'accept',orderKind:kind,orderId:id,
    tabId:8,startedAt:Date.now(),stage:'await-view',
    stageStartedAt:Date.now(),listUrl:'https://'+host+'/free_orders'},
    log:[],processingPreviewedIds:[],attemptedIds:[]};
  const store={
    local:{
      async get(d){const keys=Array.isArray(d)?d:Object.keys(d||{});
        return Object.fromEntries(keys.map(k=>[k,state[k]??d?.[k]]));},
      async set(v){Object.assign(state,v);
        const changes=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,{newValue:x}]));
        listeners.forEach(fn=>fn(changes,'local'));}
    },onChanged:{addListener(fn){listeners.push(fn);}}
  };
  const window={innerHeight:850,__prowellDualStorage:store};window.top=window;
  window.addEventListener=()=>{};window.dispatchEvent=()=>{};
  const rect=()=>({top:90,bottom:110,width:450,height:390});
  let step='take',top=0,backgroundY=0;
  const pane={
    isConnected:true,hidden:false,className:'order-detail-scroll-content',innerText:'ORDER INFORMATION Order ID '+id+' instructions',
    clientHeight:390,scrollHeight:1300,
    getClientRects(){return[1]},getBoundingClientRect:rect,
    getAttribute(){return null},querySelectorAll(){return[]},
    contains(){return true},parentElement:null
  };
  Object.defineProperty(pane,'scrollTop',{get(){return top},set(n){
    top=n;events.push('DETAILS SCROLL:'+n);
  }});
  const modal={
    isConnected:true,hidden:false,className:'modal order-details',innerText:'ORDER DETAILS ID '+id,
    clientHeight:480,scrollHeight:480,contains(){return true},
    getClientRects(){return[1]},getBoundingClientRect:rect,
    getAttribute(k){return k==='role'?'dialog':null},
    querySelectorAll(){return processing?[pane]:[pane,button()]}
  };
  function button(){
    return {
      isConnected:true,disabled:false,parentElement:pane,
      innerText:step==='take'?'Take it':step==='ok'?'OK':'I understand',
      getClientRects(){return[1]},getBoundingClientRect(){return{top:130,bottom:160,width:80,height:30}},
      getAttribute(){return null},click(){
        events.push('CLICK '+step);
        step=step==='take'?'ok':step==='ok'?'understand':'done';
      }
    };
  }
  const document={
    body:{innerText:'ORDER INFORMATION Order ID '+id+' instructions'},
    scrollingElement:{scrollHeight:2600,clientHeight:800,
      get scrollTop(){return backgroundY;},set scrollTop(v){backgroundY=v;}},
    documentElement:null,querySelector(){return null},addEventListener(){},
    querySelectorAll(q){
      if(q.startsWith('button,a,input'))return processing||step==='done'?[]:[button()];
      if(q.startsWith('[role="dialog"]'))return[modal];
      if(q.startsWith('main,'))return[pane];
      return[];
    }
  };
  document.documentElement=document.scrollingElement;
  pane.parentElement=modal;
  const chrome={runtime:{
    sendMessage(m,cb){if(m.type===(host==='4writers.net'?'PROWELL_TAB_ID':'GW_TAB_ID'))
      cb({tabId:8});},
    onMessage:{addListener(){}}
  }};
  const started=Date.now();
  vm.runInNewContext(read('auto-accept.js'),{
    window,document,chrome,Date,Number,Set,Promise,Error,
    setTimeout,clearTimeout,Event:class{constructor(type){this.type=type}},
    location:{origin:'https://'+host,hostname:host,href:'https://'+host+'/order/'+id},
    getComputedStyle(el){return{display:'block',visibility:'visible',
      position:el===modal?'fixed':'static',zIndex:el===modal?'1000':'1',
      overflowY:el===pane?'auto':'visible'};}
  });
  for(let tries=0;tries<100&&state.autoFlow;tries++)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(state.autoFlow,null,host+' '+kind+' must complete without waiting for missing Take it');
  assert.equal(backgroundY,0,'never scroll the page behind the selected order');
  assert.equal(top,910,'jump to bottom in one instant scroll');
  assert.equal(events.filter(e=>e.startsWith('DETAILS SCROLL:')).length,1,
    'must jump exactly once, without incremental scrolling');
  if(processing){
    assert.equal(state.lastProcessingPreview?.result,'scroll-passed');
    assert(Array.from(state.processingPreviewedIds).includes(id));
    assert.equal(events.filter(e=>e.startsWith('CLICK')).length,0,
      'processing without Take it must stop before OK and I understand');
  }else{
    assert.deepEqual(events.filter(e=>e.startsWith('CLICK')),
      ['CLICK take','CLICK ok','CLICK understand']);
    assert.equal(state.lastAcceptanceOutcome,'submitted-unverified');
    assert(events.indexOf('DETAILS SCROLL:910')<events.indexOf('CLICK take'));
  }
  assert(Date.now()-started<1500,'simulated event-driven path should finish without added waits');
  console.log(host+' '+kind+': '+events.join(' → ')+'; STOP at correct step: PASS');
}
(async()=>{
  for(const host of ['4writers.net','good-writers.com']){
    await detect(host,'available');await detect(host,'processing');
    await detailFlow(host,'available');await detailFlow(host,'processing');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
