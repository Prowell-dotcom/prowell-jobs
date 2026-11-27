'use strict';
// Two 4writers Available Orders sections, no blank-page reload thrashing.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const dir=path.join(__dirname,'../extension/dual-writers');
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'2.1.33');
const four=manifest.content_scripts.find(x=>x.world!=='MAIN'&&
  x.matches.some(m=>m.includes('4writers.net')));
const good=manifest.content_scripts.find(x=>x.world!=='MAIN'&&
  x.matches.some(m=>m.includes('good-writers.com')));
assert.deepEqual(four.js,[
  'scoped-store.js','legacy-bridge.js','legacy/four/order-card.js',
  'four-sections.js','legacy-order-sound.js',
  'legacy/four/runtime-content.js','four-overview-refresh.js',
  'four-order-sort.js']);
assert.deepEqual(good.js,[
  'scoped-store.js','legacy-bridge.js','legacy/good/order-card.js',
  'legacy-order-sound.js','legacy/good/runtime-content.js',
  'good-order-sort.js','legacy/good/runtime-refresh.js']);
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

 await tick();
 assert.equal(window.__prowellCardDetector.pageKind(),'available');
 assert.equal(window.__prowellFourSections.selected(),'writings');
 assert.equal(timeouts.length,0,'4Writers must not schedule a timed refresh');
 assert.equal(history.length,0,'4Writers must not auto-switch Writings/Rewritings');
 // The section adapter still classifies rewritings as available.
 current='rewritings';mutate?.();await tick();
 assert.equal(window.__prowellFourSections.selected(),'rewritings');
 assert.equal(window.__prowellCardDetector.pageKind(),'available');
 cards=[{id:'1234567890',type:'unknown'}];
 assert.equal(window.__prowellCardDetector.cards()[0].type,'available');
 assert.equal(timeouts.length,0);
 assert.equal(history.length,0);
 console.log('Dual 4Writers: section classification retained, no 4-second navigation or reload PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
