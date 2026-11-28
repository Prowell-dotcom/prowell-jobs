'use strict';
// Exact fixed mixed-length cycle must survive repeated full page reloads.
// The DOM observer is independent: it cancels refreshing on a visible order.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../extension/4writers-v129');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.version,'2.1.29.5');
assert.deepEqual(manifest.content_scripts.map(s=>s.matches.length),[2,2]);
assert.equal(manifest.content_scripts.some(s=>s.matches.some(x=>x.includes('good-writers.com'))),false);
const code=fs.readFileSync(path.join(root,'four-section-refresh.js'),'utf8');
const sequence=[30000,7000,24000,3000,18000,11000,27000,5000,15000,2000,
  22000,9000,29000,4000,13000,6000,25000,10000,17000,8000];
assert.equal(sequence.length,20);
assert.equal(new Set(sequence).size,sequence.length);
assert.equal(Math.min(...sequence),2000);
assert.equal(Math.max(...sequence),30000);
assert(sequence.filter(x=>x<=5000).length<=5,
  'Short waits should be infrequent to limit reload pressure');
const state={armed:true,claimConsentVersion:'0.5.4',
  targetTabId:37,claim:null,refreshCount:0,fourLastCheckedSection:''};
let reloads=0;
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
function simulate({orders=false,warning=false,listing=false,ready=true}={}){
 const listeners=[],timers=[],clicks=[];let observer=null,id=0;
 let selected='writings';
 const store={local:{
   async get(keys){
     return Object.fromEntries(keys.map(k=>[k,state[k]]));
   },
   async set(patch){
     const previous={...state};Object.assign(state,patch);
     const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
       [k,{oldValue:previous[k],newValue:v}]));
     listeners.forEach(fn=>fn(changes,'local'));
   }
 },onChanged:{addListener(fn){listeners.push(fn);}}};
 const document={
   get readyState(){return ready?'complete':'loading';},
   body:{innerText:warning?'Using automated site parsers is prohibited. Your account will be banned.'
     :'Available orders Order by Date added None'},
   querySelectorAll(sel){
     if(sel.includes('h1,h2,h3'))return [{innerText:'Available orders',
       getClientRects(){return [{}]}}];
     return [];
   },
   querySelector(){return null;},
   addEventListener(){}
 };
 const sections={
   available:()=>listing,overview:()=>!listing,
   selected:()=>selected,
   links:()=>['writings','rewritings'].map(name=>({
     innerText:name,textContent:name,getAttribute(k){return k==='href'?'#'+name:null;},
     click(){selected=name;clicks.push(name);}
   }))
 };
 const win={__prowellDualStorage:store,__prowellFourSections:sections,
   __prowellDualActionableCards:()=>orders?[{type:'available',id:'1234567890'}]:[],
   __prowellCardDetector:{cards:()=>orders?[{type:'available',id:'1234567890'}]:[]}};
 win.top=win;
 const location={hostname:'4writers.net',href:'https://4writers.net/writer/dashboard',
   origin:'https://4writers.net',reload(){reloads++;}};
 const context={window:win,document,location,URL,Date,Number,
   console,Set,Promise,
   chrome:{runtime:{sendMessage(message,callback){if(message.type==='PROWELL_TAB_ID')callback({tabId:37});}}},
   MutationObserver:class{constructor(fn){observer=fn;}observe(){}},
   setTimeout(fn,ms){const timer={id:++id,fn,ms};timers.push(timer);return timer.id;},
   clearTimeout(n){const index=timers.findIndex(t=>t.id===n);if(index>=0)timers.splice(index,1);}
 };
 vm.runInNewContext(code,context);
 return {
   timers,clicks,async settle(){await settle();},
   find:()=>timers.find(t=>sequence.includes(t.ms)),
   mutation:()=>observer?.(),
   async fire(){
     const timer=this.find();assert(timer,'Scheduled refresh missing');
     timers.splice(timers.indexOf(timer),1);
     await timer.fn();await settle();
   },
   async patch(delta){await store.local.set(delta);await settle();}
 };
}
(async()=>{
 for(let i=0;i<sequence.length*2;i++){
   const p=simulate();await p.settle();
   assert.equal(p.find()?.ms,sequence[i%sequence.length],
     'Alternating schedule must survive page reload '+i);
   await p.fire();
   assert.equal(state.refreshCount,i+1,'Refresh index persisted before unload');
   assert.equal(reloads,i+1,'Overview reload must occur after selected interval');
 }
 state.refreshCount=0;
 let p=simulate({listing:true});await p.settle();
 assert.equal(p.find()?.ms,30000,'Writings/Rewritings share sequence');
 await p.fire();
 assert.deepEqual(p.clicks,['rewritings']);
 assert.equal(state.refreshCount,1);
 p=simulate({orders:true});await p.settle();
 assert.equal(p.find(),undefined,'An order cancels waiting timer on initial render');
 p=simulate();await p.settle();
 assert(p.find(),'Empty screen begins watching');
 await p.patch({claim:{id:'1234567890',stage:'view-clicked'}});
 assert.equal(p.find(),undefined,'Claim cancels refresh');
 await p.patch({claim:null,armed:false});
 assert.equal(p.find(),undefined,'Manual STOP cancels all scheduled refreshes');
 state.armed=true;
 p=simulate({warning:true});await p.settle();
 assert.equal(p.find(),undefined,'Website warning blocks refresh');
 assert.equal(state.armed,false,'Website warning stops monitoring');
 console.log('Standalone 4Writers: all 20 mixed-length delays, page reload persistence, order priority, claim and warning STOP PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
