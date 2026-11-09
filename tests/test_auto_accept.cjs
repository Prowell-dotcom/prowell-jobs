'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
async function simulate(site){
 const isFour=site==='4writers';
 const host=isFour?'4writers.net':'good-writers.com';
 const tabType=isFour?'PROWELL_TAB_ID':'GW_TAB_ID';
 const clicks=[],events=[];
 let step='take',status={},listeners=[],ready=true,scrollAfterOk=0;
 const flow={enabled:true,orderId:'1234567890',tabId:8,startedAt:Date.now(),stage:'take',stageStartedAt:Date.now()};
 const storage={autoFlow:flow,log:[],attemptedIds:[]};
 const root={scrollTop:0,scrollHeight:1100,clientHeight:420};
 const body={innerText:'Order ID: 1234567890'};
 const getButton=()=>{
  const labels={take:'Take it',ok:'OK',understand:'I understand'};
  if(step==='done')return [];
  const label=labels[step];
  const button={
   isConnected:true,disabled:false,innerText:label,
   getAttribute(){return null;},
   getClientRects(){return [1];},
   getBoundingClientRect(){
     const top=step==='take'?700-root.scrollTop:step==='understand'&&isFour?690-root.scrollTop:150;
     return {top,bottom:top+30,width:70,height:30};
   },
   click(){clicks.push(label);events.push([label,Date.now()]);
     if(step==='take')step='ok';
     else if(step==='ok'){step='understand';root.scrollTop=0;}
     else if(step==='understand')step='done';
   },
   parentElement:root
  };
  return [button];
 };
 root.parentElement=body;root.scrollHeight=1100;root.clientHeight=420;
 const doc={body,documentElement:root,scrollingElement:root,
   querySelector:()=>null,
   querySelectorAll(sel){return sel==='button,a,input[type="button"],input[type="submit"],[role="button"]'?getButton():[];},
   addEventListener(){},
 };
 const win={};win.top=win;win.innerHeight=480;
 const chrome={
  runtime:{sendMessage(msg,reply){if(msg.type===tabType)reply({tabId:8});}},
  storage:{
   local:{
    async get(what){const keys=Array.isArray(what)?what:Object.keys(what);return Object.fromEntries(keys.map(k=>[k,storage[k]??(Array.isArray(what)?undefined:what[k]) ]));},
    async set(update){Object.assign(storage,update);const changes=Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{newValue:v}]));for(const fn of listeners)fn(changes,'local');}
   },
   onChanged:{addListener(fn){listeners.push(fn);}}
  }
 };
 const context={document:doc,window:win,chrome,location:{origin:'https://'+host,hostname:host,href:'https://'+host+'/free_orders/?id=1234567890'},
 Date,Number,Set,Promise,Error,Boolean,RegExp,setTimeout,clearTimeout,
 getComputedStyle:()=>({overflowY:'auto'})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/'+site+'/auto-accept.js'),'utf8'),context);
 const deadline=Date.now()+6500;
 while(storage.autoFlow && Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert.equal(storage.autoFlow,null,'flow should complete');
 assert.equal(storage.lastAcceptanceOutcome,'submitted-unverified');
 assert.deepEqual(clicks,['Take it','OK','I understand']);
 assert(events[1][1]-events[0][1]>=475,'OK should wait about half a second');
 assert(storage.attemptedIds.includes('1234567890'));
 console.log(site+': opt-in, Take it, fixed wait, OK, acknowledgment: PASS');
}
Promise.all([simulate('4writers'),simulate('good-writers')])
.then(()=>process.exit(0),err=>{console.error(err);process.exit(1)});
