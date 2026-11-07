/* Offline browser simulation for Prowell 4writers assistant.
 * This verifies the DOM state machine, not real 4writers compatibility.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function run(){
 const clicks=[],messages=[],subscribers=[],scrolls=[],timeline=[];
 let buttons=[],text='Available orders Writings',dialogShown=false;
 const modal={innerText:'ORDER INFORMATION Order #6447728953',isConnected:true,scrollHeight:7000,getClientRects(){return [1];},scrollTo(x,y){timeline.push('modal-scroll');}};
 const storage={armed:true,claimConsentVersion:'1.0.6',targetTabId:7,refreshMs:2000,claim:null,attemptedIds:[],completed:[],lastResult:'',log:[],returnToList:false};
 let onMutation=()=>{};
 const body={get innerText(){return text;},get textContent(){return text;}};
 const root={scrollHeight:5000,appendChild(el){el.isConnected=true;}};
 const document={
   body,documentElement:root,
   querySelectorAll(selector){return selector.includes('dialog')||selector.includes('modal')||selector.includes('order-info')?dialogShown?[modal]:[]:buttons;},
   querySelector(){return null;},
   addEventListener(){},
   createElement(){return {style:{},textContent:'',isConnected:true,contains(){return false;}};}
 };
 function emit(){
  setTimeout(()=>onMutation([{target:body}]),0);
 }
 function button(name,action,parent=null){
  return {textContent:name,innerText:name,isConnected:true,disabled:false,parentElement:parent,
   getAttribute(){return null;},getClientRects(){return [1];},
   click(){clicks.push(name);timeline.push(name);action();emit();}
  };
 }
 function update(name){
  if(name==='View'){dialogShown=true;text='ORDER INFORMATION Order #6447728953';buttons=[button('Take it',()=>update('Take it'))];}
  if(name==='Take it'){text='Confirm order';buttons=[button('OK',()=>update('OK'))];}
  if(name==='OK'){text='Acknowledgement';buttons=[button('I understand the order',()=>update('I understand the order'))];}
  if(name==='I understand the order'){text='Now you can write the order';buttons=[];}
 }
 const parent={innerText:'ID: 6447728953 Deadline: tomorrow',parentElement:body};
 buttons=[button('View',()=>update('View'),parent)];
 const chrome={
  storage:{
   local:{
    async get(keys){return Object.fromEntries(Object.entries(storage).filter(([k])=>Array.isArray(keys)?keys.includes(k):Object.prototype.hasOwnProperty.call(keys,k)));},
    async set(values){Object.assign(storage,values);const changed=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{newValue:v}]));subscribers.forEach(fn=>fn(changed,'local'));},
   },
   onChanged:{addListener(fn){subscribers.push(fn);}}
  },
  runtime:{
   sendMessage(message,callback){
    if(message.type==='GW_TAB_ID')return callback({tabId:7});
    if(message.type==='GOOD_WRITERS_RESULT'){messages.push(message.payload);callback?.({ok:true});}
   },
   onMessage:{addListener(){}},lastError:null
  }
 };
 const location={origin:'https://good-writers.com',href:'https://good-writers.com/orders',reload(){},assign(){}};
 const window={};window.top=window;
 window.scrollTo=(x,y)=>{scrolls.push(y);timeline.push('scroll');};
 window.__prowellCardDetector={pageKind:()=> 'available',
   cards:()=>buttons.filter(b=>b.innerText==='View').map(b=>({id:'6447728953',view:b,type:'available'}))};
 const context={chrome,location,window,document,MutationObserver:class{constructor(fn){onMutation=fn;}observe(){}},
  setTimeout,clearTimeout,setInterval,clearInterval,Date,URL,queueMicrotask,console};
 const filename=path.join(__dirname,'../extension/good-writers/content.js');
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
 const deadline=Date.now()+1000;
 while(Date.now()<deadline && storage.completed.length===0)await new Promise(r=>setTimeout(r,15));
 assert.deepEqual(clicks,['View','Take it','OK','I understand the order']);
 assert(timeline.indexOf('modal-scroll')<timeline.indexOf('Take it'),'Good-Writers scrolls before Take it');
 assert(!timeline.slice(timeline.indexOf('OK')+1,timeline.indexOf('I understand the order')).includes('scroll'),'Good-Writers does not scroll after OK');
 assert.equal(storage.completed[0],'6447728953');
 assert.equal(messages.length,1);
 assert.equal(messages[0].outcome,'success');
 assert.equal(messages[0].orderId,'6447728953');
 console.log('Good-Writers simulated View → Take it → OK → I understand → success passed');
}
run().then(()=>process.exit(0),err=>{console.error(err);process.exit(1);});
