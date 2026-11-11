'use strict';
// VIEW-ONLY MODE: detect → request sound → persist STOP → click View.
// No scrollTop change or automatic acceptance for available/processing orders.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const dir=path.join(__dirname,'../extension/dual-writers');
const settle=async()=>{for(let i=0;i<36;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
async function run(site,kind){
 const four=site==='four',host=four?'4writers.net':'good-writers.com';
 const source=fs.readFileSync(path.join(dir,'legacy/'+site+'/runtime-content.js'),'utf8');
 assert.doesNotMatch(source,/rapidTargets\(|rapidScroll\(|scrollAcknowledgment\(|clickStage\(|function finished\(/,
  'No scroll or acceptance code may exist in active runtime');
 const id='0192065941',events=[],listeners=[];
 const state={armed:true,claimConsentVersion:four?'0.5.4':'1.0.4',
   targetTabId:17,claim:null,soundRunId:'11111111-2222-3333-4444-555555555555'};
 const view={isConnected:true,click(){events.push('VIEW');}};
 const cards=[{id,type:kind,view}];
 let scrollTop=0,pageScroll=0,mutation;
 const panel={isConnected:true,clientHeight:400,scrollHeight:2400,
   innerText:'ORDER INFORMATION ID: '+id,
   get scrollTop(){return scrollTop;},
   set scrollTop(v){scrollTop=v;events.push('POPUP SCROLL');},
   getClientRects(){return[{}]},querySelectorAll(){return[]}};
 const action=label=>({isConnected:true,disabled:false,textContent:label,
   innerText:label,getClientRects(){return[{}]},getAttribute(){return null},
   click(){events.push(label);}});
 const buttons=[action('Take it'),action('OK'),action('I understand')];
 const document={body:{innerText:'Available orders',scrollTop:0},
   documentElement:{appendChild(){},get scrollTop(){return pageScroll;},
     set scrollTop(v){pageScroll=v;events.push('PAGE SCROLL');}},
   querySelectorAll(q){
     if(q.startsWith('a,button,input'))return buttons;
     if(q.startsWith('dialog[open]'))return[panel];
     return[];
   },querySelector(){return null},
   createElement(){return{style:{},textContent:'',remove(){},contains(){return false}};},
   addEventListener(){}};
 const store={async get(defaults){return Object.fromEntries(Object.entries(defaults).map(
     ([k,v])=>[k,Object.hasOwn(state,k)?state[k]:v]));},
   async set(patch){
     const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
       [k,{oldValue:state[k],newValue:v}]));
     Object.assign(state,patch);
     for(const listener of listeners)listener(changes,'local');
   }};
 const chrome={runtime:{lastError:null,onMessage:{addListener(){}},
   sendMessage(msg,cb){if(msg.type===(four?'PROWELL_TAB_ID':'GW_TAB_ID')){
       cb?.({tabId:17});return;
     }
     if(msg.type==='PROWELL_ORDER_SOUND')events.push('SOUND '+msg.kind);
     else events.push('OTHER MESSAGE '+msg.type);
     cb?.({ok:true});
   }},storage:{local:store,onChanged:{addListener(fn){listeners.push(fn);}}}};
 const win={__prowellLegacyChrome:chrome,
   __prowellCardDetector:{cards:()=>cards,pageKind:()=>'available'},
   dispatchEvent(){},scrollTo(){events.push('WINDOW SCROLL');}};
 win.top=win;
 const context={window:win,chrome,document,location:{
   origin:'https://'+host,href:'https://'+host+'/available_orders'},Date,
   Promise,Set,Map,Number,URL,Event:class{},Error,queueMicrotask,
   setTimeout(fn,ms){if(ms===0)queueMicrotask(fn);return 1;},
   clearTimeout(){},setInterval(){throw Error('No acceptance polling allowed');},
   MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}
 };
 vm.runInNewContext(source,context);
 await settle();
 assert.deepEqual(events,['SOUND '+kind,'VIEW'],
   site+' '+kind+': notification must precede View, with no other actions');
 assert.equal(state.armed,false,site+' '+kind+': monitoring stopped');
 assert.equal(state.claim,null,'No claim can survive View handoff');
 assert.equal(state.autoAcceptEnabled,false,'Acceptance must stay disabled');
 assert.equal(state.targetTabId,null,'Stop target tab to block auto rearming');
 assert.equal(state.lastHandoffOrderId,id);
 assert.equal(state.lastHandoffKind,kind);
 assert.equal(scrollTop,0,'Order details popup must never scroll');
 assert.equal(pageScroll,0,'Page must never scroll');
 mutation([{target:document.body}]);await settle();
 assert.deepEqual(events,['SOUND '+kind,'VIEW'],
   'No repeat actions after STOP');
 console.log(site+' '+kind+': sound, STOP, View; zero scrolling/acceptance PASS');
}
(async()=>{
 for(const site of ['four','good']){
   await run(site,'available');await run(site,'processing');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
