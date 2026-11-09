'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function run(site){
 const host=site==='4writers'?'4writers.net':'good-writers.com';
 let backgroundY=0,orderY=0;
 const changes=[];
 let handler;
 const elem=(props={})=>({
   isConnected:true,hidden:false,tagName:'DIV',
   getClientRects(){return[1]},
   getAttribute(k){return k==='role'?this.role||null:null},
   getBoundingClientRect(){return{top:20,left:10,width:this.width||460,
     height:this.clientHeight||500,bottom:20+(this.clientHeight||500)}},
   contains(node){return node===this},
   querySelectorAll(){return[]},...props
 });
 const background=elem({tagName:'HTML',className:'body',clientHeight:900,scrollHeight:2900});
 Object.defineProperty(background,'scrollTop',{get(){return backgroundY},set(v){backgroundY=v;changes.push(['background',v]);}});
 const pane=elem({className:'scrollable-order-description',clientHeight:500,scrollHeight:1560,
   innerText:'Order #0783450648 Subject Ethics Description instructions'});
 Object.defineProperty(pane,'scrollTop',{get(){return orderY},set(v){orderY=v;changes.push(['order',v]);}});
 const take=elem({tagName:'BUTTON',innerText:'Take it',clientHeight:30,scrollHeight:30,
   parentElement:pane,disabled:false});
 const popup=elem({className:'modal order-popup',role:'dialog',width:465,
   clientHeight:760,scrollHeight:760,innerText:'Order #0783450648 Subject Ethics Description',
   querySelectorAll(q){return q==='*'?[pane,take]:[]},
   contains(node){return node===popup||node===pane||node===take}});
 const backdrop=elem({className:'modal-backdrop',clientHeight:900,scrollHeight:900});
 const doc={body:elem({innerText:'Order #0783450648 Subject Ethics Description'}),
   documentElement:background,scrollingElement:background,querySelector(){return null},
   addEventListener(){},querySelectorAll(q){
     if(q.startsWith('button,a,input'))return[take];
     if(q.startsWith('[role="dialog"]'))return[popup,backdrop];
     if(q==='body *')return[background,popup,pane,take,backdrop];
     return[pane];
   }};
 const chrome={runtime:{
   sendMessage(m,cb){if(m.type==='PROWELL_TAB_ID'||m.type==='GW_TAB_ID')cb({tabId:7});},
   onMessage:{addListener(fn){handler=fn;}}
 },storage:{local:{
   async get(){return{autoFlow:null}},async set(){}
 },onChanged:{addListener(){}}}};
 const win={innerHeight:900};win.top=win;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',site,'auto-accept.js'),'utf8'),{
   document:doc,window:win,chrome,setTimeout,Date,Set,Promise,Error,Number,
   location:{origin:'https://'+host,hostname:host,href:'https://'+host+'/free_orders'},
   getComputedStyle(el){return{
     overflowY:el===pane?'auto':'visible',display:'block',visibility:'visible',
     position:el===popup?'fixed':'static',zIndex:el===popup?'1000':'1'
   }}
 });
 assert.equal(typeof handler,'function',site+' must register scroll-test handler');
 const outcome=await new Promise(resolve=>handler({type:'PROWELL_SCROLL_TEST'},{},resolve));
 assert.equal(outcome.ok,true,site+' should move the order description');
 assert(outcome.steps>=3,'must scroll gradually in several increments');
 assert.equal(backgroundY,0,'must never scroll background behind the order popup');
 assert.equal(orderY,1060,'should scroll the order description to its end');
 assert(changes.every(([which])=>which==='order'),'all scroll mutations must be inside the popup');
 console.log(site+': popup details move, background stays still: PASS');
}
Promise.all([run('4writers'),run('good-writers')]).catch(err=>{
 console.error(err);process.exitCode=1;
});
