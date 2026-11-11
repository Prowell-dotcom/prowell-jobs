'use strict';
// Two 4writers Available Orders sections, no blank-page reload thrashing.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const dir=path.join(__dirname,'../extension/dual-writers');
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'2.1.13');
const four=manifest.content_scripts.find(x=>x.world!=='MAIN'&&
  x.matches.some(m=>m.includes('4writers.net')));
const good=manifest.content_scripts.find(x=>x.world!=='MAIN'&&
  x.matches.some(m=>m.includes('good-writers.com')));
assert.deepEqual(four.js,[
  'scoped-store.js','legacy-bridge.js','legacy/four/order-card.js',
  'four-sections.js','legacy-order-sound.js',
  'legacy/four/runtime-content.js','four-section-refresh.js']);
assert.deepEqual(good.js,[
  'scoped-store.js','legacy-bridge.js','legacy/good/order-card.js',
  'legacy-order-sound.js','legacy/good/runtime-content.js',
  'legacy/good/runtime-refresh.js']);
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
(async()=>{
 let current='writings',ready=true,cards=[],mutate;
 const history=[],listeners=[],timeouts=[];let timerId=0;
 const state={armed:true,claimConsentVersion:'0.5.4',targetTabId:7,
   claim:null,attemptedIds:[],completed:[],refreshCount:0,fourLastCheckedSection:''};
 const store={local:{
   async get(input){
     const keys=Array.isArray(input)?input:Object.keys(input||{});
     return Object.fromEntries(keys.map(k=>[k,
       Object.hasOwn(state,k)?state[k]:(Array.isArray(input)?undefined:input[k])]));
   },
   async set(data){
     Object.assign(state,data);
     const change=Object.fromEntries(Object.entries(data)
       .map(([k,v])=>[k,{newValue:v}]));
     for(const fn of listeners)fn(change,'local');
   }
 },onChanged:{addListener(fn){listeners.push(fn);}}};
 const location={hostname:'4writers.net',origin:'https://4writers.net',
   href:'https://4writers.net/available/writings',
   pathname:'/available/writings',search:''};
 const nav={className:'nav-tabs'};
 const links=['writings','rewritings'].map(section=>({
   textContent:section[0].toUpperCase()+section.slice(1),
   get innerText(){return this.textContent},
   isConnected:true,get className(){return section===current?'active':'tab'},
   get parentElement(){return {className:'nav-tabs'}},
   closest(){return nav},getClientRects(){return [{}]},
   getAttribute(key){
     if(key==='href')return 'https://4writers.net/available/'+section;
     if(key==='aria-selected')return String(current===section);
     return null;
   },
   click(){
     history.push('CLICK '+section);current=section;
     location.pathname='/available/'+section;
     location.href='https://4writers.net'+location.pathname;
   }
 }));
 const heading={get innerText(){
   return ready?(current==='writings'?'Available orders':'Available rewritings'):'';
 },get textContent(){return this.innerText},isConnected:true,
 getClientRects(){return ready?[{}]:[]}};
 const document={readyState:'complete',
   body:{get innerText(){
     return ready
       ?(current==='writings'?'Available orders':'Available rewritings')+
        ' Order by Date added None Available orders'
       :'Available orders My current orders';
   }},
   querySelectorAll(sel){
     if(sel==='a,button,[role="tab"]')return links;
     if(sel==='h1,h2,h3,[role="heading"]')return ready?[heading]:[];
     return [];
   },
   querySelector(sel){
     if(sel.startsWith('input[placeholder*="Search"]'))return ready?{}:null;
     return null;
   },
   addEventListener(){}
 };
 const window={__prowellDualStorage:store,
   __prowellCardDetector:{
     pageKind:()=>current==='writings'?'available':'unknown',
     cards:()=>cards
   }};window.top=window;
 const context={window,document,location,URL,Date,console,Promise,Set,Number,Error,
   setTimeout(fn,ms){const id=++timerId;timeouts.push({id,fn,ms});return id;},
   clearTimeout(id){
     const i=timeouts.findIndex(x=>x.id===id);if(i>=0)timeouts.splice(i,1);
   },
   chrome:{runtime:{sendMessage(message,callback){
     if(message.type==='PROWELL_TAB_ID')callback({tabId:7});
   }}},
   MutationObserver:class{constructor(fn){mutate=fn;}observe(){}}
 };
 vm.runInNewContext(read('four-sections.js'),context);
 vm.runInNewContext(read('four-section-refresh.js'),context);
 await tick();
 const timerWith=ms=>timeouts.find(t=>t.ms===ms);
 async function fire(ms){
   const timer=timerWith(ms);assert(timer,'Missing '+ms+'ms timer');
   timeouts.splice(timeouts.indexOf(timer),1);
   await timer.fn();await tick();
 }
 assert.equal(window.__prowellCardDetector.pageKind(),'available');
 assert(timerWith(2000),'Writings should be scheduled');
 await fire(2000);
 assert.deepEqual(history,['CLICK rewritings']);
 assert.equal(state.fourLastCheckedSection,'writings');
 mutate();await tick();
 assert.equal(window.__prowellCardDetector.pageKind(),'available',
   'Rewritings must count as an available order list');
 assert(timerWith(2000),'Rewritings should be scheduled');
 await fire(2000);
 assert.deepEqual(history,['CLICK rewritings','CLICK writings']);
 assert.equal(state.fourLastCheckedSection,'rewritings');
 // The screenshot's transient blank page must not trigger a 2-second reload.
 ready=false;mutate();await tick();
 assert.equal(Boolean(timerWith(2000)),false);
 assert(timerWith(900),'Incomplete page should enter a guarded render-wait');
 const before=history.length;
 await fire(900);
 assert.equal(history.length,before,'Do not switch from incomplete lists');
 ready=true;mutate();await tick();
 assert(timerWith(2000),'Resume section switching once loaded');
 cards=[{type:'available',id:'1234567890'}];mutate();await tick();
 assert.equal(Boolean(timerWith(2000)),false,'Order must cancel section switching');
 cards=[];mutate();await tick();
 assert(timerWith(2000));
 await store.local.set({claim:{id:'1234567890',stage:'take-clicked'}});
 assert.equal(Boolean(timerWith(2000)),false,'No tab switch during acceptance');
 await store.local.set({claim:null});
 assert(timerWith(2000));
 await store.local.set({armed:false});
 assert.equal(Boolean(timerWith(2000)),false,'STOP cancels section switching');
 console.log('Dual 4writers: Writings/Rewritings cycle, blank-page guard and claim pausing PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
