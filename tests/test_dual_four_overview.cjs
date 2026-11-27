'use strict';
// Regression for actual screenshot: 4writers header + Writings/Rewritings
// nav + sidebar, blank middle, no selected tab. This is a watchable orders
// overview, NOT a failed Writings page. Reload only this neutral view at 4s.
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../extension/dual-writers');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
(async()=>{
 const timers=[],listeners=[],events=[];
 let nextId=0,card=null,currentKind='unknown',activeTab=false;
 const state={armed:true,targetTabId:23,claimConsentVersion:'0.5.4',
   claim:null,attemptedIds:[],completed:[],refreshCount:0};
 const store={local:{
   async get(arg){
     const names=Array.isArray(arg)?arg:Object.keys(arg||{});
     return Object.fromEntries(names.map(k=>[k,Object.hasOwn(state,k)?state[k]:
       (Array.isArray(arg)?undefined:arg[k])]));
   },
   async set(values){
     Object.assign(state,values);
     const ch=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{newValue:v}]));
     for(const fn of listeners)fn(ch,'local');
   }
 },onChanged:{addListener(fn){listeners.push(fn);}}};
 const link=label=>({
   innerText:label,textContent:label,className:'nav-item',
   parentElement:{className:'nav-tabs'},
   isConnected:true,getClientRects(){return [{}]},
   getAttribute(key){return key==='aria-selected'?'false':
     key==='href'?'/orders/'+label.toLowerCase():null;},
   closest(){return null},
   click(){events.push('unexpected section click '+label)}
 });
 const links=[link('Writings'),link('Rewritings')];
 let reloads=0;
 const location={hostname:'4writers.net',pathname:'/writer/dashboard',
   search:'',href:'https://4writers.net/writer/dashboard',
   origin:'https://4writers.net',
   reload(){reloads++;events.push('overview reloaded');}};
 let ready='complete';
 const document={
   get readyState(){return ready},
   body:{innerText:'Writings Rewritings News Writer guide Available orders Writings Rewritings My current orders Processing orders Late orders My messages'},
   querySelectorAll(sel){
     if(sel==='a,button,[role="tab"]')return links;
     if(sel==='h1,h2,h3,[role="heading"]')return [];
     return [];
   },
   querySelector(){return null},addEventListener(){}
 };
 const win={__prowellDualStorage:store,
   __prowellCardDetector:{
     pageKind:()=>currentKind,
     cards:()=>card?[card]:[]
   }};
 win.top=win;
 let mutation;
 const ctx={window:win,document,location,URL,Date,Set,Number,Promise,
   console,Error,
   setTimeout(fn,ms){const x={id:++nextId,fn,ms};timers.push(x);return x.id;},
   clearTimeout(id){const idx=timers.findIndex(x=>x.id===id);if(idx>=0)timers.splice(idx,1)},
   MutationObserver:class{constructor(fn){mutation=fn}observe(){}},
   chrome:{runtime:{sendMessage(m,cb){if(m.type==='PROWELL_TAB_ID')cb({tabId:23});}}}
 };
 vm.runInNewContext(read('four-sections.js'),ctx,{filename:'four-sections.js'});
 vm.runInNewContext(read('four-order-sort.js'),ctx,{filename:'four-order-sort.js'});
 vm.runInNewContext(read('four-overview-refresh.js'),ctx,{filename:'four-overview-refresh.js'});
 await settle();
 const timer=ms=>timers.find(x=>x.ms===ms);
 async function fire(ms){
   const t=timer(ms);assert(t,'Missing '+ms+' ms timer');
   timers.splice(timers.indexOf(t),1);
   await t.fn();await settle();
 }
 assert.equal(win.__prowellFourSections.overview(),true,
   'Screenshot-style neutral available-orders page must be identified');
 assert.equal(win.__prowellCardDetector.pageKind(),'available',
   'The neutral overview must let original order action engine inspect cards');


 assert(timer(4000),'Blank central dashboard should schedule 4-second reload');
 assert.equal(timer(800),undefined,'No sort-heading clicks on blank dashboard');
 await fire(4000);
 assert.equal(reloads,1,'4-second timer reloads the SAME neutral URL');
 assert.equal(state.fourLastCheckedSection,'overview');
 assert.equal(events.some(x=>x.includes('section click')),false,
   'Do not click Writings/Rewritings links on blank dashboard');
 // An order is rendered while the page is still armed.
 card={id:'12345678',type:'unknown'};mutation();await settle();
 assert.equal(win.__prowellCardDetector.cards()[0].type,'available');
 assert.equal(Boolean(timer(4000)),false,'New order cancels dashboard refresh immediately');
 card=null;mutation();await settle();
 assert(timer(4000),'Resume 4-second overview refresh if order disappears');
 await store.local.set({claim:{id:'12345678',stage:'view-clicked'}});
 assert.equal(Boolean(timer(4000)),false,'An active taking workflow cancels reload');
 await store.local.set({claim:null});
 assert(timer(4000));
 ready='loading';mutation();await settle();
 assert.equal(Boolean(timer(4000)),false,'Never reload a partial dashboard');
 ready='complete';mutation();await settle();
 assert(timer(4000),'Resume once dashboard fully loaded');
 await store.local.set({armed:false});
 assert.equal(Boolean(timer(4000)),false,'STOP cancels the 4-second reload');
 assert.equal(reloads,1,'No further reload after STOP');
 console.log('4Writers blank dashboard: guarded 4s reload, stops on order, claim, loading, STOP PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
