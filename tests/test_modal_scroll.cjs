'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function simulate(slug,site,version,messageType){
 const clicks=[],scrolls=[],storageListeners=[];
 let onMutation=()=>{},dialogShown=false;
 const storage={armed:true,claimConsentVersion:version,targetTabId:8,claim:null,
   processingPreviewedIds:[],attemptedIds:[],completed:[],log:[],returnToList:true};
 const modal={
   isConnected:true,scrollHeight:9000,innerText:'ORDER INFORMATION Order #0783450648',
   getClientRects(){return [1];},
   scrollTo(x,y){scrolls.push(y);}
 };
 const view={click(){clicks.push('View');dialogShown=true;
   setTimeout(()=>onMutation([{target:body}]),0);}};
 const take={innerText:'Take it',getClientRects(){return [1];},
   click(){clicks.push('Take it');}};
 const body={innerText:'Processing orders',scrollHeight:800};
 const doc={
   body,documentElement:{scrollHeight:800,appendChild(){}},
   scrollingElement:{scrollHeight:800,scrollTo(){}},
   querySelectorAll(selector){
      if(selector.includes('dialog')||selector.includes('modal')||selector.includes('order-info'))
        return dialogShown?[modal]:[];
      return [take];
   },
   querySelector(){return null;},
   addEventListener(){},
   createElement(){return {style:{},isConnected:true,contains(){return false;}};}
 };
 const window={};window.top=window;window.scrollTo=()=>{};
 window.__prowellCardDetector={pageKind:()=> 'processing',
   cards:()=>[{type:'processing',id:'0783450648',view}]};
 const chrome={
   runtime:{sendMessage(m,cb){if(m.type===messageType)return cb({tabId:8});
     cb?.({ok:true});},onMessage:{addListener(){}},lastError:null},
   storage:{local:{
     async get(defaults){return Object.fromEntries(Object.entries(storage).filter(([k])=>
       Object.prototype.hasOwnProperty.call(defaults,k)));},
     async set(update){Object.assign(storage,update);storageListeners.forEach(fn=>
       fn(Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{newValue:v}])),'local'));}
   },onChanged:{addListener(fn){storageListeners.push(fn);}}}
 };
 const location={origin:'https://'+site,href:'https://'+site+'/processing_orders/'};
 const context={window,document:doc,chrome,location,Date,URL,Event,
   setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,
   MutationObserver:class{constructor(fn){onMutation=fn;}observe(){}}};
 const file=path.join(__dirname,'../extension',slug,'content.js');
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 let until=Date.now()+1500;
 while(storage.armed!==false){if(Date.now()>until)throw Error(slug+' did not finish modal preview');
   await new Promise(r=>setTimeout(r,15));}
 assert.deepEqual(clicks,['View'],slug+' processing test must not accept an order');
 assert(scrolls.includes(9000),slug+' did not scroll modal internal content');
 assert(storage.processingPreviewedIds.includes('0783450648'));
 console.log(slug+' View modal (same URL) → scroll internal order details → stop: PASS');
}
Promise.all([
 simulate('4writers','4writers.net','0.5.3','PROWELL_TAB_ID'),
 simulate('good-writers','good-writers.com','1.0.3','GW_TAB_ID')
]).then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
