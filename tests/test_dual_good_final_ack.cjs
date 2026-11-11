'use strict';
// Simulate the screenshot's post-OK ORDER INFORMATION popup with an
// offscreen footer. The final button is "I understand, take the order".
// Check inner popup scroll AND real acknowledge click; background must stay.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/legacy/good/runtime-content.js'),'utf8');

const tick=async()=>{
  for(let i=0;i<15;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
};

async function check(label,range){
 const cases={near:{height:600,ms:300},medium:{height:1200,ms:500},
   long:{height:2100,ms:700}};
 const expected=cases[range];assert(expected);
 const listeners=[],clicked=[],popupEvents=[],waits=[];
 const state={armed:true,claimConsentVersion:'1.0.4',targetTabId:17,
  claim:{id:'0192065941',stage:'ok-clicked',startedAt:Date.now(),
   listUrl:'https://good-writers.com/available_orders'}};
 let panelY=0,pageY=0;
 const panel={
  tagName:'DIV',className:'modal-body',clientHeight:380,scrollHeight:expected.height,
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
    if(message.type==='GW_TAB_ID')callback({tabId:17});
    else if(callback)callback({ok:true});
   }},
  storage:{local:store,onChanged:{addListener(fn){listeners.push(fn)}}}
 };
 const window={};
 window.top=window;
 window.__prowellLegacyChrome=chrome;
 window.dispatchEvent=()=>{};
 const context={window,chrome,document,
  location:{origin:'https://good-writers.com',href:'https://good-writers.com/available_orders'},
  queueMicrotask,MutationObserver:class{observe(){}},
  Event:class{},Date,Promise,Set,URL,Error,
  setTimeout(fn,ms){if([60,100,140].includes(ms)){waits.push(ms);queueMicrotask(fn);}return 1},clearTimeout(){},
  setInterval(){return 1},
  getComputedStyle(){return {position:'fixed',overflowY:'auto'}},
 };
 vm.runInNewContext(src,context,{filename:'legacy/good/runtime-content.js'});
 await tick();
 assert.deepEqual(clicked,['acknowledgement-click'],
   'After OK bot must click exact final acknowledgement once');
 assert.equal(state.claim?.stage,'acknowledged',
   'Order flow should advance to acknowledged');
 assert.equal(state.lastPostViewWithin2s,true,
   'Fast simulated View-to-final click must meet two-second soft target');
 assert(Number(state.lastPostViewDurationMs)<2000,
   'Timing report should be derived from actual View-to-final click');
 assert.equal(panelY,expected.height-380,
   'Popup must reach its vertical bottom before final click');
 assert.equal(waits.length,0,'Instant acknowledgement must not schedule scroll waits');
 assert.equal(pageY,0,
   'Background document must never be scrolled by post-OK step');
 assert.equal(state.lastAcknowledgementScroll,'scrolled-popup',
   'Show evidence of actual popup movement');
 assert.equal(popupEvents.filter(e=>e.startsWith('popup-scroll ')).length,1,
   'Acknowledgement should jump to its bottom once');
 assert.equal(popupEvents.at(-1),'acknowledgement-click',
   'Final acceptance must occur after the direct bottom jump');
 assert.equal(popupEvents[0].startsWith('popup-scroll '),true);
 assert.equal(popupEvents.at(-2),'popup-scroll '+(expected.height-380));
 console.log('Good-Writers post-OK '+label+' '+range+
   ': immediate popup jump, then click PASS');
}

(async()=>{
 for(const range of ['near','medium','long']){
   await check('I understand',range);
   await check('I understand, take the order',range);
   await check('I understand the order',range);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
