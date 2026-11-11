'use strict';
// Exercise the active dual engine for both View paths. The 4writers and
// Order-details popup uses a fast 64ms gradual scroll in the foreground
// and jumps instantly when hidden. Take it waits for scrolling to finish.
// Processing orders preview only, never Take it.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const dir=path.join(__dirname,'../extension/dual-writers');
const tick=async()=>{for(let i=0;i<24;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
async function run(site,kind,range,visibility='visible'){
 const four=site==='four',host=four?'4writers.net':'good-writers.com';
 const source=fs.readFileSync(path.join(dir,'legacy/'+site+'/runtime-content.js'),'utf8');
 assert.match(source,/function rapidScroll\(el,bottom\)/);
 assert.match(source,/function rapidTargets\(nodes\)/);
 assert.match(source,/FAST_SCROLL_POSITIONS=5, FAST_SCROLL_FRAME_MS=16/);
 assert.doesNotMatch(source,/STAGE_FRACTIONS|COMPLETION_TARGETS/,
   'No 3/4/5-second full-order pacing');
 const options={near:{height:600,ms:300},medium:{height:1200,ms:500},
   long:{height:2200,ms:700}};
 const expected=options[range];assert(expected);
 const id='0192065941',events=[],listeners=[],waits=[];
 const stage=kind==='available'?'view-clicked':'processing-view-clicked';
 const state={
   armed:true,claimConsentVersion:four?'0.5.4':'1.0.4',targetTabId:17,
   attemptedIds:[],completed:[],processingPreviewedIds:[],
   claim:{id,stage,startedAt:Date.now(),viewClickedAt:Date.now()-10000,
     listUrl:'https://'+host+'/available_orders'}
 };
 let pos=0,backgroundPos=0;
 const panel={
   isConnected:true,clientHeight:400,scrollHeight:expected.height,
   innerText:'ORDER INFORMATION Order #'+id+' Subject Description',
   textContent:'ORDER INFORMATION Order #'+id,
   get scrollTop(){return pos},
   set scrollTop(v){pos=v;events.push('SCROLL '+Math.round(v))},
   getClientRects(){return[{}]},
   querySelectorAll(){return[]}
 };
 const button={
   innerText:'Take it',textContent:'Take it',value:'',isConnected:true,disabled:false,
   getClientRects(){return[{}]},getAttribute(){return null},
   click(){events.push('TAKE IT')}
 };
 const root={scrollHeight:2500,clientHeight:800,
   get scrollTop(){return backgroundPos},
   set scrollTop(v){backgroundPos=v;events.push('BACKGROUND '+v)},
   appendChild(){}
 };
 const document={visibilityState:visibility,documentElement:root,scrollingElement:root,
   body:{innerText:'Order #'+id,scrollHeight:2500},
   querySelectorAll(selector){
     if(selector.startsWith('dialog[open]'))return[panel];
     if(selector.startsWith('a,button,input'))return kind==='available'?[button]:[];
     return[];
   },
   querySelector(){return null},addEventListener(){},
   createElement(){return {style:{},textContent:'',remove(){}}}
 };
 const store={
   async get(arg){return Object.fromEntries(Object.keys(arg).map(k=>
     [k,Object.hasOwn(state,k)?state[k]:arg[k]]));},
   async set(values){
     Object.assign(state,values);
     const changed=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{newValue:v}]));
     for(const fn of listeners)fn(changed,'local');
   }
 };
 const chrome={runtime:{lastError:null,onMessage:{addListener(){}},sendMessage(msg,cb){
   if(msg.type===(four?'PROWELL_TAB_ID':'GW_TAB_ID'))cb({tabId:17});
   else cb?.({ok:true});
 }},storage:{local:store,onChanged:{addListener(fn){listeners.push(fn)}}}};
 const win={};win.top=win;win.__prowellLegacyChrome=chrome;
 win.dispatchEvent=()=>{};
 const context={window:win,document,location:{origin:'https://'+host,
   href:'https://'+host+'/available_orders'},chrome,
   MutationObserver:class{observe(){}},URL,Event:class{},Date,Promise,Set,Error,
   queueMicrotask,setTimeout(fn,ms){if(ms===16){waits.push(ms);queueMicrotask(fn);}return 1;},
   clearTimeout(){},setInterval(){return 1}};
 vm.runInNewContext(source,context);
 await tick();
 const scrolled=events.filter(x=>x.startsWith('SCROLL '));
 assert.equal(scrolled.length,visibility==='hidden'?1:5,
   site+' '+kind+': correct scroll positions');
 assert.equal(pos,expected.height-400);
 assert.equal(backgroundPos,0,'Background page must not scroll');
 assert.equal(waits.length,visibility==='hidden'?0:4,
   '64ms gradual scroll in foreground; zero timers when hidden');
 assert.equal(waits.reduce((a,b)=>a+b,0),visibility==='hidden'?0:64);
 if(kind==='available')
   assert.equal(events.at(-2),'SCROLL '+Math.round(expected.height-400),
     'Take it only after reaching bottom');
 if(kind==='available'){
   assert.equal(events.at(-1),'TAKE IT','Take it only after rapid scroll');
   assert.equal(state.claim?.stage,'take-clicked');
 }else{
   assert(!events.includes('TAKE IT'),'Processing previews must not claim orders');
   assert.equal(state.armed,false,'Processing preview stops after scroll');
   assert.equal(state.claim,null);
 }
 console.log(site+' '+kind+' '+range+' '+visibility+': rapid scroll and correct action PASS');
}
(async()=>{
 for(const site of ['four','good']){
   for(const range of ['near','medium','long']){
     await run(site,'available',range);
     await run(site,'processing',range);
   }
   await run(site,'available','long','hidden');
   await run(site,'processing','long','hidden');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
