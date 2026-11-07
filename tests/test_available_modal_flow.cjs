'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');

async function simulate(slug,site,version,tabMessage){
 const clicks=[],timeline=[],listeners=[];
 let buttons=[],modalOpen=false,onMutation=()=>{};
 let bodyText='Available orders',page='available';
 const storage={armed:true,claimConsentVersion:version,targetTabId:9,claim:null,
  attemptedIds:[],completed:[],log:[],returnToList:false};
 const modal={scrollHeight:14000,innerText:'ORDER INFORMATION Order #0783450648',isConnected:true,
   getClientRects(){return [1];},
   scrollTo(x,y){timeline.push('modal-scroll-'+y);}
 };
 const body={get innerText(){return bodyText;},scrollHeight:1000};
 const button=(label,fn)=>({
  textContent:label,innerText:label,isConnected:true,disabled:false,
  getAttribute(){return null;},getClientRects(){return [1];},
  scrollIntoView(){timeline.push('scroll-into-view-'+label);},
  click(){clicks.push(label);timeline.push(label);fn();
   setTimeout(()=>onMutation([{target:body}]),0);}
 });
 const update=stage=>{
  if(stage==='view'){
   modalOpen=true;page='detail';bodyText='ORDER INFORMATION Order #0783450648';
   buttons=[button('Take it',()=>update('take'))];
  }else if(stage==='take'){
   buttons=[button('OK',()=>update('ok'))];
  }else if(stage==='ok'){
   page='acknowledge';bodyText='Acknowledgement';
   buttons=[button('I understand the order',()=>update('ack'))];
  }else if(stage==='ack'){
   bodyText='Now you can write the order';buttons=[];
  }
 };
 buttons=[button('View',()=>update('view'))];
 const document={
  body,documentElement:{scrollHeight:1000,appendChild(){}},
  scrollingElement:{scrollHeight:1000,scrollTo(){}},
  querySelectorAll(selector){
   if(selector.includes('dialog')||selector.includes('modal')||selector.includes('popup')||
      selector.includes('order-info'))return modalOpen?[modal]:[];
   return buttons;
  },
  querySelector(){return null;},addEventListener(){},
  createElement(){return {style:{},isConnected:true,contains(){return false;}};}
 };
 const window={};window.top=window;window.scrollTo=()=>{};
 window.__prowellCardDetector={pageKind:()=>page==='available'?'available':'unknown',
  cards:()=>page==='available'?[{id:'0783450648',view:buttons[0],type:'available'}]:[]};
 const location={origin:'https://'+site,href:'https://'+site+'/free_orders/essay/',assign(){}};
 const chrome={
  runtime:{sendMessage(msg,cb){if(msg.type===tabMessage)return cb({tabId:9});
    cb?.({ok:true});},onMessage:{addListener(){}},lastError:null},
  storage:{local:{
    async get(defaults){return Object.fromEntries(Object.entries(storage).filter(([k])=>k in defaults));},
    async set(update){Object.assign(storage,update);
     const changed=Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{newValue:v}]));
     listeners.forEach(fn=>fn(changed,'local'));}
   },onChanged:{addListener(fn){listeners.push(fn);}}}
 };
 const context={document,window,location,chrome,Date,URL,Event,
  setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,
  MutationObserver:class{constructor(fn){onMutation=fn;}observe(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',slug,'content.js'),'utf8'),context);
 const deadline=Date.now()+2000;
 while(storage.completed.length===0){
  if(Date.now()>deadline)throw Error(slug+' did not finish new-order modal flow: '+clicks.join(', '));
  await new Promise(r=>setTimeout(r,15));
 }
 assert.deepEqual(clicks,['View','Take it','OK','I understand the order']);
 const takeIndex=timeline.indexOf('Take it'),okIndex=timeline.indexOf('OK'),ackIndex=timeline.indexOf('I understand the order');
 assert(timeline.slice(0,takeIndex).includes('modal-scroll-14000'),'Take it must follow internal modal scrolling');
 if(slug==='4writers')
  assert(timeline.slice(okIndex,ackIndex).some(x=>x==='scroll-into-view-I understand the order'),
   '4writers should scroll after confirmation');
 else assert(!timeline.slice(okIndex,ackIndex).includes('modal-scroll-14000'),
   'Good-Writers must not add a second scroll after OK');
 console.log(slug+' new available order modal: View → internal scroll → Take it → OK → acknowledgement: PASS');
}
Promise.all([
 simulate('4writers','4writers.net','0.5.4','PROWELL_TAB_ID'),
 simulate('good-writers','good-writers.com','1.0.4','GW_TAB_ID')
]).then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
