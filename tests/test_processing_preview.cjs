'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');

async function preview(slug,site,version,tabMessage){
 let currentHref='https://'+site+'/processing_orders/';
 const clicks=[],scrolls=[],listeners=[];
 let onMutation=()=>{};
 const storage={armed:true,claimConsentVersion:version,targetTabId:17,
   refreshMs:2000,claim:null,processingPreviewedIds:[],attemptedIds:[],completed:[],
   lastResult:'Ready',log:[],returnToList:true};
 const body={innerText:'Available orders Writings'};
 const view={
  innerText:'View',isConnected:true,disabled:false,
  getClientRects(){return [1];},getAttribute(){return null;},
  click(){clicks.push('View');currentHref='https://'+site+'/order/123456789/';onMutation([{target:body}]);}
 };
 const take={innerText:'Take it',isConnected:true,disabled:false,getClientRects(){return [1];},
  getAttribute(){return null;},click(){clicks.push('Take it');}};
 const document={
   body,documentElement:{scrollHeight:6000,appendChild(el){el.isConnected=true;}},
   scrollingElement:{scrollTo(y,z){scrolls.push(z);}},
   querySelector(){return null;},
   querySelectorAll(){return [take];},
   addEventListener(){},
   createElement(){return {style:{},textContent:'',isConnected:true,contains(){return false;}};}
 };
 const window={};window.top=window;window.scrollTo=(x,y)=>scrolls.push(y);
 window.__prowellCardDetector={
   pageKind:()=>currentHref.includes('processing_orders')?'processing':'unknown',
   cards:()=>currentHref.includes('processing_orders')?[{id:'123456789',type:'processing',view}]:[]
 };
 const location={origin:'https://'+site,get href(){return currentHref;},assign(){}};
 const chrome={
  runtime:{
   sendMessage(m,cb){if(m.type===tabMessage){cb({tabId:17});return;}cb?.({ok:true});},
   onMessage:{addListener(){}},lastError:null
  },
  storage:{
   local:{
    async get(keys){return Object.fromEntries(Object.entries(storage).filter(([key])=>
       Array.isArray(keys)?keys.includes(key):Object.prototype.hasOwnProperty.call(keys,key)));},
    async set(update){
      Object.assign(storage,update);
      for(const fn of listeners)fn(Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{newValue:v}])),'local');
    }
   },
   onChanged:{addListener(fn){listeners.push(fn);}}
  }
 };
 const context={window,document,location,chrome,
  MutationObserver:class{constructor(callback){onMutation=callback;}observe(){}},
  setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,Date,URL};
 const file=path.join(__dirname,'../extension/'+slug+'/content.js');
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 const until=Date.now()+1200;
 while(storage.claim!==null || !storage.processingPreviewedIds.includes('123456789')){
  if(Date.now()>until)throw Error(slug+': processing preview failed to complete');
  await new Promise(done=>setTimeout(done,10));
 }
 assert.deepEqual(clicks,['View'],slug+' must NEVER click Take it from processing page');
 assert(scrolls.some(v=>v===6000),'Should scroll to bottom of opened order');
 assert.equal(storage.armed,false);
 console.log(slug+' processing preview: View → bottom scroll → STOP, no claiming');
}
Promise.all([
 preview('4writers','4writers.net','0.5.3','PROWELL_TAB_ID'),
 preview('good-writers','good-writers.com','1.0.3','GW_TAB_ID')
]).then(()=>process.exit(0),err=>{console.error(err);process.exit(1);});
