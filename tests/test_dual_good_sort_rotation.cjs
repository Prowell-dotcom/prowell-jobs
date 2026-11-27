'use strict';
// Good-Writers: use genuine sorting headings if present; order takes priority.
// No heading controls means the existing 4-second fallback stays available.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'../extension/dual-writers');
const code=fs.readFileSync(path.join(base,'good-order-sort.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
assert.equal(manifest.version,'2.1.33');
const good=manifest.content_scripts.find(x=>x.world!=='MAIN'&&
  x.matches.some(h=>h.includes('good-writers.com')));
assert(good.js.includes('good-order-sort.js'));
assert(good.js.includes('legacy/good/runtime-refresh.js'));
assert(good.js.indexOf('good-order-sort.js')<
  good.js.indexOf('legacy/good/runtime-refresh.js'));
const labels=['Date added','Time remaining','Pages','Total price'],clicks=[],handoffs=[];
const state={armed:true,targetTabId:71,claimConsentVersion:'1.0.4',
  goodSortIndex:0,claim:null};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
function page({headings=labels,order=false,warning=false,ready=true}={}){
 let loaded=ready,cards=order?[{id:'1234567890',type:'available'}]:[];
 const listeners=[],timers=[],mutations=[];
 let id=0,stops=0;
 const controls=headings.map(name=>({
   isConnected:true,disabled:false,innerText:name,textContent:name,
   getClientRects(){return [{}];},
   getAttribute(k){return k==='href'?'#sort':null;},
   closest(){return this;},
   click(){clicks.push(name);loaded=false;}
 }));
 const store={local:{
   async get(keys){return Object.fromEntries(keys.map(k=>[k,state[k]]));},
   async set(patch){
     const old={...state};Object.assign(state,patch);
     const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
       [k,{oldValue:old[k],newValue:v}]));
     for(const fn of listeners)fn(changes,'local');
   }
 },onChanged:{addListener(fn){listeners.push(fn);}}};
 const document={
   get readyState(){return loaded?'complete':'loading';},
   body:{get innerText(){return warning?
     'Available Orders None CAPTCHA':'Available Orders None Order by Date added';}},
   querySelectorAll(sel){return sel.includes('a,button,span,th')?controls:[];},
   querySelector(){return null;},
   addEventListener(){}
 };
 const win={__prowellDualStorage:store,
   __prowellCardDetector:{pageKind:()=>'available',cards:()=>cards},
   __prowellDualActionableCards:()=>cards,
   __prowellDualStopRefresh(){stops++;},
   __prowellDualPrioritizeOrder(){handoffs.push(cards[0]?.id);return true;}};
 win.top=win;
 const ctx={window:win,document,URL,Date,Number,Math,Map,Set,console,
   location:{hostname:'good-writers.com',origin:'https://good-writers.com',
     href:'https://good-writers.com/available-orders'},
   chrome:{runtime:{sendMessage(message,cb){
     if(message.type==='GW_TAB_ID')cb({tabId:71});}}},
   setTimeout(fn,ms){const t={id:++id,fn,ms};timers.push(t);return id;},
   clearTimeout(n){const i=timers.findIndex(t=>t.id===n);
     if(i>=0)timers.splice(i,1);},
   MutationObserver:class{constructor(fn){mutations.push(fn);}observe(){}}
 };
 vm.runInNewContext(code,ctx);
 return {
   window:win, async settle(){await settle();},
   timer:()=>timers.find(t=>t.ms===800),
   async tick(){
     const t=timers.find(x=>x.ms===800);assert(t,'Must schedule 800ms sorting');
     timers.splice(timers.indexOf(t),1);await t.fn();await settle();
   },
   changeCards(v){cards=v;for(const fn of mutations)fn();},
   setLoaded(v){loaded=v;for(const fn of mutations)fn();},
   get stops(){return stops},
   async set(patch){await store.local.set(patch);await settle();}
 };
}
(async()=>{
 for(let i=0;i<5;i++){
   const p=page();await p.settle();
   assert.equal(p.window.__prowellDualGoodSortEnabled(),true,
     'Sortable empty list must qualify');
   assert(p.timer(),'Sorting must begin without a 4-second reload');
   await p.tick();
   assert.equal(clicks[i],labels[i%4],
     'Good-Writers rotation must survive each simulated full reload');
   assert.equal(state.goodSortIndex,(i+1)%4);
   assert.equal(p.timer(),undefined,'Do not click again while page is loading');
   assert(p.stops>0,'Sort mode should cancel the fallback refresh timer');
 }
 let p=page({order:true});await p.settle();
 assert.equal(p.timer(),undefined,'Order must suppress sorting');
 assert.equal(handoffs.at(-1),'1234567890','New order must hand off immediately');
 p=page();await p.settle();
 assert(p.timer());
 const n=handoffs.length;
 p.changeCards([{id:'1234567890',type:'available'}]);
 assert.equal(handoffs.length,n+1,'Mutation must hand off order immediately');
 assert.equal(p.timer(),undefined);
 p=page({headings:[]});await p.settle();
 assert.equal(p.window.__prowellDualGoodSortEnabled(),false,
   'Unknown Good-Writers UI must preserve 4-second fallback');
 assert.equal(p.timer(),undefined);
 p=page({warning:true});await p.settle();
 assert.equal(p.timer(),undefined,'Challenge must cancel sorting');
 p=page({ready:false});await p.settle();
 assert.equal(p.timer(),undefined,'Do not click partial page');
 p.setLoaded(true);await p.settle();
 assert(p.timer(),'Start only when fully loaded');
 await p.set({claim:{id:'1234567890'}});
 assert.equal(p.timer(),undefined,'Claim must cancel sort rotation');
 await p.set({claim:null,armed:false});
 assert.equal(p.timer(),undefined,'STOP must cancel sorting');
 console.log('Good-Writers optional sorting: 800ms, full reload persistence, order priority and 4-second fallback PASS');
})().catch(err=>{console.error(err);process.exitCode=1;});
