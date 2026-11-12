'use strict';
// Two different handoffs:
// 4writers AVAILABLE: sound → View → verified details scroll → Take it → STOP.
// 4writers PROCESSING: sound → View → STOP, no scroll/Take it.
// Good-Writers: sound → View → instant scroll → STOP, no Take it.
// All OK / I understand / native confirmation must remain MANUAL.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const dir=path.join(__dirname,'../extension/dual-writers');
const settle=async()=>{for(let i=0;i<45;i++)await Promise.resolve();
 await new Promise(resolve=>setImmediate(resolve));};
async function run(site,kind,range,delayed=false,variant='orderId',scrollHost='panel'){
 const four=site==='four',host=four?'4writers.net':'good-writers.com';
 const source=fs.readFileSync(path.join(dir,'legacy/'+site+'/runtime-content.js'),'utf8');
 const height={short:600,medium:1200,long:2200}[range];
 const events=[],listeners=[],id='0192065941';
 const descriptions={
   orderId:'ORDER INFORMATION Order ID: '+id,
   plainId:'ORDER INFORMATION ID: '+id,
   number:'ORDER INFORMATION Order number: '+id,
   noId:'ORDER INFORMATION Subject, Description, Instructions',
   wrongId:'ORDER INFORMATION ID: 55555123456'
 };
 const popupText=descriptions[variant];assert(popupText);
 const state={armed:true,claimConsentVersion:four?'0.5.4':'1.0.4',
   targetTabId:17,claim:null,soundRunId:'11111111-2222-3333-4444-555555555555'};
 let opened=false,scrollY=0,outerY=0,pageY=0,mutation;
 let takeReady=!delayed;
 const view={isConnected:true,click(){events.push('VIEW');
   if(!delayed)opened=true;}};
 const cards=[{id,type:kind,view}];
 const take={isConnected:true,disabled:false,innerText:'Take it',
   textContent:'Take it',getClientRects(){return[{}]},
   getAttribute(){return null},click(){
     assert.equal(state.armed,false,'STOP persisted before Take it');
     assert.equal(state.claim,null,'No claim left after Take it');
     events.push('TAKE IT');
   }};
 const ok={isConnected:true,disabled:false,innerText:'OK',textContent:'OK',
   getClientRects(){return[{}]},getAttribute(){return null},
   click(){events.push('OK');}};
 const accept={isConnected:true,disabled:false,innerText:'I understand',
   textContent:'I understand',getClientRects(){return[{}]},
   getAttribute(){return null},click(){events.push('I understand');}};
 const panel={isConnected:true,clientHeight:400,scrollHeight:scrollHost==='ancestor'?400:height,
   innerText:popupText,
   textContent:popupText,
   get scrollTop(){return scrollY;},
   set scrollTop(v){if(scrollHost!=='blocked'){
     scrollY=v;events.push('SCROLL '+Math.round(v));}},
   getClientRects(){return[{}]},querySelectorAll(){return[]}};
 const outer={isConnected:true,className:'modal outer-scroll',clientHeight:400,
   scrollHeight:height,getClientRects(){return[{}]},
   get scrollTop(){return outerY;},
   set scrollTop(v){outerY=v;events.push('OUTER SCROLL '+Math.round(v));}};
 panel.parentElement=scrollHost==='ancestor'?outer:null;
 const pageRoot={clientHeight:800,scrollHeight:2300,
   get scrollTop(){return pageY;},
   set scrollTop(v){pageY=v;events.push('PAGE SCROLL');},
   appendChild(){}};
 const document={body:{innerText:'Available orders',scrollHeight:2300},
   documentElement:pageRoot,scrollingElement:pageRoot,
   querySelectorAll(selector){
     if(selector.startsWith('a,button,input'))return [takeReady?take:null,ok,accept].filter(Boolean);
     if(selector.includes('dialog[open]'))return opened?[panel]:[];
     return[];
   },querySelector(){return null},addEventListener(){},
   createElement(){return{style:{},textContent:'',remove(){},
     contains(){return false}};}
 };
 const store={
   async get(defaults){return Object.fromEntries(Object.entries(defaults)
     .map(([k,v])=>[k,Object.hasOwn(state,k)?state[k]:v]));},
   async set(patch){
     const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
       [k,{oldValue:state[k],newValue:v}]));
     Object.assign(state,patch);
     for(const fn of listeners)fn(changes,'local');
   }
 };
 const chrome={runtime:{lastError:null,onMessage:{addListener(){}},
   sendMessage(msg,cb){
     if(msg.type===(four?'PROWELL_TAB_ID':'GW_TAB_ID')){cb?.({tabId:17});return;}
     if(msg.type==='PROWELL_ORDER_SOUND')events.push('SOUND '+msg.kind);
     else events.push('OTHER MSG '+msg.type);
     cb?.({ok:true});
   }},storage:{local:store,onChanged:{addListener(fn){listeners.push(fn);}}}};
 const win={__prowellLegacyChrome:chrome,
   __prowellCardDetector:{cards:()=>cards,pageKind:()=>'available'},
   dispatchEvent(ev){events.push('DISPATCH '+ev.type);},
   scrollTo(){events.push('WINDOW SCROLL');}};
 win.top=win;
 const context={window:win,chrome,document,location:{
   origin:'https://'+host,href:'https://'+host+'/available_orders'},Date,
   Promise,Set,Map,Number,URL,Event:class{constructor(type){this.type=type;}},
   Error,queueMicrotask,setTimeout(){return 1;},
   clearTimeout(){},setInterval(){return 1;},
   MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}
 };
 vm.runInNewContext(source,context,{filename:site+'/runtime-content.js'});
 await settle();
 assert.deepEqual(events.slice(0,2),['SOUND '+kind,'VIEW'],
   'Sound must be requested before View on '+site);
 if(scrollHost==='blocked'){
   assert.deepEqual(events,['SOUND '+kind,'VIEW'],
     'Unmovable scroll pane must NOT trigger Take it or claim success');
   assert.equal(state.armed,true,'Keep monitoring the pending popup');
   assert.equal(state.claim?.stage,four?'four-view-await-take':'good-view-await-scroll');
   console.log(site+' unavailable scrollbar: no false scrolling or Take it PASS');
   return;
 }
 const expectedScroll=(scrollHost==='ancestor'?'OUTER SCROLL ':'SCROLL ')+(height-400);
 if(four&&kind==='available'){
   if(variant==='wrongId'){
     assert.equal(state.claim?.stage,'four-view-await-take');
     assert.equal(state.armed,true,'Wrong-ID popup must not complete acceptance');
     assert.deepEqual(events,['SOUND available','VIEW'],
       'Different order ID: no scroll, no Take it');
     console.log('four available wrong ID: refused to scroll or take PASS');
     return;
   }
   assert.equal(state.claim?.stage,delayed?'four-view-await-take':undefined,
     'Only a still-waiting order can keep the pending View stage');
   if(delayed){
     assert.equal(state.armed,true,'Must still be waiting for the correct details');
     assert(!events.includes('TAKE IT'),'No click before order details exist');
     opened=true;mutation([{target:document.body}]);await settle();
     // The button may still appear after the order details have rendered.
     assert(!events.includes('TAKE IT'),'No click while Take it is absent');
     takeReady=true;mutation([{target:document.body}]);await settle();
   }
   assert.deepEqual(events,['SOUND available','VIEW',expectedScroll,'TAKE IT']);
   assert.equal(scrollHost==='ancestor'?outerY:scrollY,height-400);
   assert.equal(state.lastHandoffStage,'take-it');
 }else if(!four){
   if(variant==='wrongId'){
     assert.equal(state.claim?.stage,'good-view-await-scroll');
     assert.equal(state.armed,true,'Wrong-ID Good-Writers popup must not be scrolled');
     assert.deepEqual(events,['SOUND '+kind,'VIEW']);
     console.log('good '+kind+' wrong ID: refused to scroll PASS');
     return;
   }
   if(delayed){
     assert.equal(state.claim?.stage,'good-view-await-scroll');
     assert.equal(state.armed,true,'Good-Writers waits for real details');
     assert.deepEqual(events,['SOUND '+kind,'VIEW'],
       'Good-Writers cannot scroll before View popup opens');
     opened=true;mutation([{target:document.body}]);await settle();
   }
   assert.deepEqual(events,['SOUND '+kind,'VIEW',expectedScroll],
     'Good-Writers must scroll exactly once, but never click Take it');
   assert.equal(scrollHost==='ancestor'?outerY:scrollY,height-400);
   assert.equal(state.lastHandoffStage,'scroll');
 }else{
   assert.deepEqual(events,['SOUND '+kind,'VIEW'],
     '4writers processing orders must only open View');
   assert.equal(scrollY,0,'Never scroll an existing processing order on 4writers');
   assert.equal(state.lastHandoffStage,'view');
 }
 assert.equal(pageY,0,'Never scroll the background orders list');
 assert.equal(state.armed,false,'Stop monitoring at correct handoff');
 assert.equal(state.claim,null,'No pending automatic actions remain');
 assert.equal(state.targetTabId,null,'Other tabs must not auto-resume');
 assert.equal(state.autoAcceptEnabled,false,'No automatic confirmations');
 assert.equal(state.lastHandoffOrderId,id);
 assert.equal(state.lastHandoffKind,kind);
 mutation([{target:document.body}]);await settle();
 assert(!events.some(e=>['OK','I understand'].includes(e)||e.startsWith('DISPATCH')),
   'OK, I understand and native confirmation must remain manual');
 console.log(site+' '+kind+' '+range+' '+variant+(delayed?' delayed':'')+
   ': correct handoff, no automated confirmation PASS');
}
(async()=>{
 for(const site of ['four','good']){
   for(const kind of ['available','processing']){
     for(const range of ['short','medium','long'])
       await run(site,kind,range);
   }
 }
 await run('four','available','long',true);
 for(const variant of ['plainId','number','noId'])
   await run('four','available','long',false,variant);
 await run('four','available','long',false,'wrongId');
 for(const variant of ['plainId','number','noId'])
   await run('good','available','long',false,variant);
 await run('good','available','long',false,'wrongId');
 await run('good','available','long',true);
 await run('good','processing','long',true);
 await run('four','available','long',false,'orderId','ancestor');
 await run('good','available','long',false,'orderId','ancestor');
 await run('four','available','long',false,'orderId','blocked');
 await run('good','available','long',false,'orderId','blocked');
})().catch(error=>{console.error(error);process.exitCode=1;});
