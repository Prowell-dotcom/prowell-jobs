'use strict';
// An older bot may leave a saved View/Take it/OK/acknowledgement claim.
// Neither bot may resume old acceptance stages. Only the explicit new
// 4writers 'four-view-await-take' stage may click Take it; no other stages.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'../extension/dual-writers');
const tick=async()=>{for(let i=0;i<28;i++)await Promise.resolve();
 await new Promise(r=>setImmediate(r));};
async function run(site,stage){
 const four=site==='four',host=four?'4writers.net':'good-writers.com';
 const source=fs.readFileSync(path.join(base,'legacy/'+site+'/runtime-content.js'),'utf8');
 assert.match(source,/async function handoffToOwner\(card\)/);
 assert.doesNotMatch(source,/clickStage\(|scrollOpenedOrder\(|scrollAcknowledgment\(/);
 const events=[],listeners=[],id='0192065941';
 let y=0;
 const state={armed:true,targetTabId:17,
   claimConsentVersion:four?'0.5.4':'1.0.4',
   claim:{id,stage,startedAt:Date.now(),listUrl:'https://'+host+'/available_orders'}};
 const buttons=['Take it','OK','I understand','I understand, take the order']
  .map(text=>({isConnected:true,disabled:false,innerText:text,
    textContent:text,getClientRects(){return[{}]},getAttribute(){return null},
    click(){events.push('CLICK '+text);}}));
 const doc={body:{innerText:'ORDER INFORMATION ID: '+id},
   documentElement:{appendChild(){}},
   querySelectorAll(q){return q.startsWith('a,button,input')?buttons:[];},
   querySelector(){return null},addEventListener(){},
   createElement(){return {style:{},textContent:'',remove(){},contains(){return false}};},
   get scrollTop(){return y;},set scrollTop(v){y=v;events.push('SCROLL');}};
 const store={
   async get(defaults){return Object.fromEntries(Object.entries(defaults)
     .map(([k,v])=>[k,Object.hasOwn(state,k)?state[k]:v]));},
   async set(patch){const changes=Object.fromEntries(Object.entries(patch)
       .map(([k,v])=>[k,{oldValue:state[k],newValue:v}]));
     Object.assign(state,patch);
     for(const fn of listeners)fn(changes,'local');
   }
 };
 const chrome={runtime:{lastError:null,onMessage:{addListener(){}},
   sendMessage(msg,cb){if(msg.type===(four?'PROWELL_TAB_ID':'GW_TAB_ID'))
     cb?.({tabId:17});
     else cb?.({ok:true});
   }},storage:{local:store,onChanged:{addListener(fn){listeners.push(fn);}}}};
 const win={__prowellLegacyChrome:chrome,
   __prowellCardDetector:{cards:()=>[],pageKind:()=>'available'},
   scrollTo(){events.push('WINDOW SCROLL');},dispatchEvent(){}};
 win.top=win;
 vm.runInNewContext(source,{window:win,document:doc,chrome,location:{
   origin:'https://'+host,href:'https://'+host+'/available_orders'
  },Date,Promise,Set,Map,Number,URL,Error,Event:class{},queueMicrotask,
   setTimeout(){throw Error('No scheduled auto-accept allowed');},
   clearTimeout(){},setInterval(){return 1;},
   MutationObserver:class{observe(){}}
 });
 await tick();
 assert.equal(state.armed,false,site+' '+stage+': old claim must pause');
 assert.equal(state.claim,null,site+' '+stage+': discard old claim');
 assert.equal(state.autoAcceptEnabled,false);
 assert.deepEqual(events,[],site+' '+stage+': NEVER click or scroll');
 console.log(site+' previous '+stage+': manual-only, no click or scroll PASS');
}
(async()=>{
 for(const site of ['four','good']){
   for(const stage of ['view-clicked','take-clicked','ok-clicked','acknowledged'])
     await run(site,stage);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
