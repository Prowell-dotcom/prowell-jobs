'use strict';
// Simulate a View navigation into a scrollable order-details dialog.
// A regression here must fail if a future change clicks Take it before scrolling.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
async function run(site,preview=false){
 const host=site==='4writers'?'4writers.net':'good-writers.com';
 const tabMessage=site==='4writers'?'PROWELL_TAB_ID':'GW_TAB_ID';
 const events=[],scrolls=[],listeners=[];
 let state='take',position=0;
 const pane={
  isConnected:true,scrollHeight:1300,clientHeight:450,
  className:'modal-body',innerText:'Order information ID 1234567890 instructions',
  getClientRects(){return[1]},querySelectorAll(){return[]},closest(){return null},contains(){return true}
 };
 Object.defineProperty(pane,'scrollTop',{get(){return position},set(n){
  if(n!==position){position=n;scrolls.push({stage:state,pos:n});}
 }});
 const modal={
  isConnected:true,scrollHeight:450,clientHeight:450,
  innerText:'Order details ID 1234567890',className:'modal',
  getClientRects(){return[1]},querySelectorAll(){return[pane]},contains(){return true}
 };
 function button(){
  return{
   isConnected:true,disabled:false,innerText:state==='take'?'Take it':
     state==='ok'?'OK':'I understand',
   parentElement:pane,getClientRects(){return[1]},getAttribute(){return null},
   getBoundingClientRect(){return{top:160,bottom:185,width:80,height:25}},
   click(){
    events.push({stage:state,time:Date.now(),scroll:position});
    state=state==='take'?'ok':state==='ok'?'understand':'done';
    if(state==='understand')pane.scrollTop=0;
   }
  };
 }
 const document={
  body:{innerText:'ORDER INFORMATION Order ID 1234567890 instructions'},
  scrollingElement:pane,documentElement:pane,querySelector(){return null},
  querySelectorAll(q){
   if(q.includes('button,a,input'))return state==='done'?[]:[button()];
   if(q.includes('[role="dialog"]'))return[modal];
   if(q==='body *')return[modal,pane];
   return[pane];
  },addEventListener(){}
 };
 const flow={enabled:true,mode:preview?'scroll-only':'accept',tabId:17,orderId:'1234567890',startedAt:Date.now(),
  listUrl:'https://'+host+'/free_orders',stage:'await-view',stageStartedAt:Date.now()};
 const storage={autoFlow:flow,log:[],attemptedIds:[]};
 const chrome={
  runtime:{sendMessage(m,cb){if(m.type===tabMessage)cb({tabId:17})},
   onMessage:{addListener(){}}},
  storage:{
   local:{
    async get(keys){const names=Array.isArray(keys)?keys:Object.keys(keys);
     return Object.fromEntries(names.map(k=>[k,storage[k]??(Array.isArray(keys)?undefined:keys[k])]));},
    async set(values){
     Object.assign(storage,values);
     const changes=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{newValue:v}]));
     for(const listener of listeners)listener(changes,'local');
    }
   },onChanged:{addListener(fn){listeners.push(fn);}}
  }
 };
 const window={innerHeight:850,__prowellCardDetector:{pageKind:()=> 'unknown'}};
 window.top=window;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',site,'auto-accept.js'),'utf8'),
  {window,document,chrome,location:{origin:'https://'+host,hostname:host,
   href:'https://'+host+'/order/1234567890'},
   setTimeout,clearTimeout,Date,Number,Set,Promise,Error,
   getComputedStyle(){return{overflowY:'auto'};}});
 const deadline=Date.now()+8000;
 while(storage.autoFlow&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
 assert.equal(storage.autoFlow,null,site+' workflow must finish');
 if(preview){
   assert.deepEqual(events,[],site+' scroll-only preview must not click any acceptance controls');
   assert(scrolls.filter(x=>x.stage==='take').length>=3,site+' scroll-only must move the pane');
   assert.equal(storage.lastScrollResult,'verified-movement');
   console.log(site+' View navigation → automatic scroll, NO acceptance clicks: PASS');
 }else{
   assert.deepEqual(events.map(x=>x.stage),['take','ok','understand']);
   assert(scrolls.filter(x=>x.stage==='take').length>=3,site+' must scroll before Take it');
   assert(events[0].scroll>0,'Take it cannot happen before scrolling');
   assert(events[1].time-events[0].time>=475,'OK wait must be roughly 0.5s');
   if(site==='4writers')assert(scrolls.some(x=>x.stage==='understand'));
   else assert.equal(scrolls.filter(x=>x.stage==='understand'&&x.pos>0).length,0);
   console.log(site+' View navigation → incremental scroll → confirmations: PASS');
 }
}
Promise.all([run('4writers'),run('good-writers'),run('4writers',true),run('good-writers',true)]).catch(e=>{
 console.error(e);process.exitCode=1;
});
