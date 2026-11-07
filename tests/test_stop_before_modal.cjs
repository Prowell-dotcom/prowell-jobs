'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function run(slug,site,version,tabMessage){
 let shown=false,clicked=[],scrolled=[],onMutate=()=>{};
 const subs=[],state={armed:true,claimConsentVersion:version,targetTabId:3,claim:null,
  attemptedIds:[],completed:[],log:[],returnToList:false};
 const modal={isConnected:true,innerText:'ORDER INFORMATION Order #123456789',
  scrollHeight:12000,getClientRects(){return [1];},scrollTo(x,y){scrolled.push(y);}};
 const body={innerText:'Available Orders',scrollHeight:4500};
 const button=(name,fn)=>({innerText:name,isConnected:true,disabled:false,
   getAttribute(){return null;},getClientRects(){return [1];},click(){clicked.push(name);fn();onMutate([{target:body}]);}});
 const view=button('View',()=>{});
 const take=button('Take it',()=>{});
 const document={body,documentElement:{scrollHeight:4500,appendChild(){}},
  scrollingElement:{scrollHeight:4500,scrollTo(){scrolled.push('page');}},
  querySelectorAll(sel){
   if(sel.includes('dialog')||sel.includes('modal'))return shown?[modal]:[];
   return shown?[take]:[view];
  },querySelector(){return null;},addEventListener(){},
  createElement(){return {style:{},isConnected:true,contains(){return false;},remove(){}};}};
 const window={};window.top=window;window.scrollTo=()=>scrolled.push('page');
 window.__prowellCardDetector={pageKind:()=> 'available',cards:()=>shown?[]:[{id:'123456789',type:'available',view}]};
 const chrome={runtime:{sendMessage(m,cb){if(m.type===tabMessage)cb({tabId:3});else cb?.({ok:true});},
   onMessage:{addListener(){}},lastError:null},
  storage:{local:{async get(defaults){return Object.fromEntries(Object.entries(state).filter(([k])=>k in defaults));},
    async set(update){Object.assign(state,update);for(const fn of subs)fn(Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{newValue:v}])),'local');}},
    onChanged:{addListener(fn){subs.push(fn);}}}};
 const location={origin:'https://'+site,href:'https://'+site+'/free_orders/essay/',assign(){}};
 const context={chrome,window,document,location,Date,URL,Event,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,
  MutationObserver:class{constructor(fn){onMutate=fn;}observe(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',slug,'content.js'),'utf8'),context);
 const until=Date.now()+1000;
 while(!clicked.includes('View')){if(Date.now()>until)throw Error('View was not clicked');await new Promise(r=>setTimeout(r,5));}
 assert.deepEqual(scrolled,[],'No premature scrolling before details');
 await new Promise(r=>setTimeout(r,80));
 assert.deepEqual(scrolled,[],'No scrolling while modal absent');
 // Simulate the user pressing STOP before the order modal appears.
 await chrome.storage.local.set({armed:false,claim:null});
 shown=true;onMutate([{target:body}]);
 await new Promise(r=>setTimeout(r,400));
 assert.deepEqual(scrolled,[],'STOP must suppress delayed scrolling');
 assert.deepEqual(clicked,['View'],'STOP must block Take it');
 console.log(slug+' View-first modal gating and STOP cancellation passed');
}
Promise.all([
 run('4writers','4writers.net','0.5.5','PROWELL_TAB_ID'),
 run('good-writers','good-writers.com','1.0.5','GW_TAB_ID')
]).then(()=>process.exit(0),err=>{console.error(err);process.exit(1);});
