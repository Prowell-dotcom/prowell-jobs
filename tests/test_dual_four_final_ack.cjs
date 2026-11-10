'use strict';
// Simulate the screenshot's post-OK ORDER INFORMATION popup with an
// offscreen footer. The final button is "I understand, take the order".
// Check inner popup scroll AND real acknowledge click; background must stay.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/legacy/four/runtime-content.js'),'utf8');

const tick=async()=>{
  for(let i=0;i<15;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
};

async function check(label){
 const listeners=[],clicked=[],popupEvents=[];
 const state={armed:true,claimConsentVersion:'0.5.4',targetTabId:17,
  claim:{id:'0192065941',stage:'ok-clicked',startedAt:Date.now(),
   listUrl:'https://4writers.net/available_orders'}};
 let panelY=0,pageY=0;
 const panel={
  tagName:'DIV',className:'modal-body',clientHeight:380,scrollHeight:2100,
  get scrollTop(){return panelY},
  set scrollTop(v){panelY=v;popupEvents.push('popup-scroll '+v)},
  parentElement:null,querySelectorAll(){return[]}
 };
 const popup={
  tagName:'DIV',className:'modal-content',clientHeight:690,scrollHeight:690,
  scrollTop:0,parentElement:null,querySelectorAll(s){
   return s==='*'?[panel,button]:[];
  }
 };
 panel.parentElement=popup;
 const button={
  tagName:'BUTTON',innerText:label,textContent:label,className:'button',
  isConnected:true,disabled:false,parentElement:popup,
  getClientRects(){return [{}]},
  getAttribute(){return null},
  closest(){return popup},
  click(){clicked.push('acknowledgement-click');popupEvents.push('acknowledgement-click')}
 };
 const body={innerText:'ORDER INFORMATION Customer information and conditions',
  scrollHeight:3000,clientHeight:800};
 const docRoot={scrollHeight:3000,clientHeight:800,
  get scrollTop(){return pageY},
  set scrollTop(v){pageY=v}};
 const document={
  body,documentElement:docRoot,scrollingElement:docRoot,
  querySelectorAll(selector){
   if(selector.startsWith('a,button,input'))return[button];
   return[];
  },
  querySelector(){return null},
  addEventListener(){},
  createElement(){return {id:'',style:{},textContent:'',remove(){}}},
 };
 docRoot.appendChild=()=>{};
 const store={
  async get(request){const keys=Object.keys(request);
   return Object.fromEntries(keys.map(key=>[key,
    Object.prototype.hasOwnProperty.call(state,key)?state[key]:request[key]]));},
  async set(patch){
    Object.assign(state,patch);
    const changes=Object.fromEntries(Object.entries(patch)
      .map(([key,value])=>[key,{newValue:value}]));
    for(const listener of listeners)listener(changes,'local');
  }
 };
 const chrome={
  runtime:{lastError:null,onMessage:{addListener(){}},
   sendMessage(message,callback){
    if(message.type==='PROWELL_TAB_ID')callback({tabId:17});
    else if(callback)callback({ok:true});
   }},
  storage:{local:store,onChanged:{addListener(fn){listeners.push(fn)}}}
 };
 const window={};
 window.top=window;
 window.__prowellLegacyChrome=chrome;
 window.dispatchEvent=()=>{};
 const context={window,chrome,document,
  location:{origin:'https://4writers.net',href:'https://4writers.net/available_orders'},
  queueMicrotask,MutationObserver:class{observe(){}},
  Event:class{},Date,Promise,Set,URL,Error,
  setTimeout(fn,ms){if(ms===100)queueMicrotask(fn);return 1},clearTimeout(){},
  setInterval(){return 1},
  getComputedStyle(){return {position:'fixed',overflowY:'auto'}},
 };
 vm.runInNewContext(src,context,{filename:'legacy/four/runtime-content.js'});
 await tick();
 assert.deepEqual(clicked,['acknowledgement-click'],
   'After OK bot must click exact final acknowledgement once');
 assert.equal(state.claim?.stage,'acknowledged',
   'Order flow should advance to acknowledged');
 assert.equal(state.lastPostViewWithin2s,true,
   'Fast simulated View-to-final click must meet two-second soft target');
 assert(Number(state.lastPostViewDurationMs)<2000,
   'Timing report should be derived from actual View-to-final click');
 assert.equal(panelY,1720,
   'Popup must jump instantly to its vertical bottom before final click');
 assert.equal(pageY,0,
   'Background document must never be scrolled by post-OK step');
 assert.equal(state.lastAcknowledgementScroll,'scrolled-popup',
   'Show evidence of actual popup movement');
 assert.equal(popupEvents.filter(e=>e.startsWith('popup-scroll ')).length,6,
   'Scrolling must be gradual, not an instant jump');
 assert.equal(popupEvents.at(-1),'acknowledgement-click',
   'Final acceptance must occur only after all scrolling steps');
 assert.equal(popupEvents[0].startsWith('popup-scroll '),true);
 assert.equal(popupEvents.at(-2),'popup-scroll 1720');
 console.log('4writers post-OK '+label+': popup bottom and final click PASS');
}

(async()=>{
 await check('I understand, take the order');
 await check('I understand the order');
})().catch(error=>{console.error(error);process.exitCode=1;});
