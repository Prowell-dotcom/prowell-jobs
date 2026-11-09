'use strict';
// Regression for the screenshot-like ORDER INFORMATION popup.
// In this realistic structure .modal-body is a small *header*, while its
// unnamed fixed-position ancestor owns the scrollbar. Previous code searched
// only children of the recognized modal element and never moved that scrollbar.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../extension/dual-writers/auto-accept.js'),'utf8');
const id='0192065941';

async function simulate(host,locked=false){
  const history=[],listeners=[];
  const flow={enabled:true,mode:'processing-preview',orderKind:'processing',
    orderId:id,tabId:19,startedAt:Date.now(),stage:'await-view',
    stageStartedAt:Date.now(),listUrl:'https://'+host+'/processing_orders/'};
  const state={autoFlow:flow,log:[],processingPreviewedIds:[]};
  const store={local:{
    async get(request){
      const keys=Array.isArray(request)?request:Object.keys(request||{});
      return Object.fromEntries(keys.map(k=>[k,
        Object.hasOwn(state,k)?state[k]:(Array.isArray(request)?undefined:request[k])]));
    },
    async set(patch){
      Object.assign(state,patch);
      const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,{newValue:v}]));
      for(const fn of listeners)fn(changes,'local');
    }
  },onChanged:{addListener(fn){listeners.push(fn);}}};

  const rect=(width=450,height=620)=>({top:50,bottom:50+height,left:10,right:10+width,width,height});
  function el(className,text,clientHeight,scrollHeight){
    return {className,innerText:text,textContent:text,isConnected:true,
      hidden:false,clientHeight,scrollHeight,scrollTop:0,
      parentElement:null,getClientRects(){return[{}]},
      getBoundingClientRect(){return rect(450,clientHeight)},
      getAttribute(k){return null},contains(other){
        for(let p=other;p;p=p.parentElement)if(p===this)return true;
        return false;
      },querySelectorAll(){return []}};
  }
  const body=el('page','Processing Orders ID '+id,800,2700);
  const background=el('html','Background list',800,2700);
  let scrollY=0,backgroundY=0;
  Object.defineProperty(background,'scrollTop',{get(){return backgroundY},
    set(v){backgroundY=v;history.push('BACKGROUND SCROLL '+v)}});
  const shell=el('unnamed-outer-window',
    'ORDER INFORMATION Order #'+id+' Subject Law Description long instructions',620,2850);
  Object.defineProperty(shell,'scrollTop',{get(){return scrollY},
    set(v){if(!locked){scrollY=v;history.push('ORDER SCROLL '+v)}}});
  const heading=el('modal-body','ORDER INFORMATION Order #'+id,38,38);
  const description=el('long-content','Description '.repeat(200),1700,1700);
  shell.parentElement=body;
  heading.parentElement=shell;
  description.parentElement=shell;
  shell.querySelectorAll=()=>[heading,description];
  const document={body,documentElement:background,scrollingElement:background,
    querySelector(){return null},addEventListener(){},
    querySelectorAll(selector){
      if(selector.includes('button,a,input'))return[];
      if(selector.startsWith('[role="dialog"]'))return[heading];
      if(selector==='body *')return[shell,heading,description];
      return[];
    }
  };
  // Visible heading has a recognizable modal class; actual scrollbar is
  // an unnamed ancestor and cannot be found by a descendent-only search.
  const window={innerHeight:850,__prowellDualStorage:store};
  window.top=window;
  window.addEventListener=()=>{};
  const chrome={runtime:{
    sendMessage(m,cb){if(m.type===(host==='4writers.net'?'PROWELL_TAB_ID':'GW_TAB_ID'))
      cb({tabId:19});},onMessage:{addListener(){}}
  }};
  vm.runInNewContext(src,{
    window,document,chrome,location:{origin:'https://'+host,hostname:host,
      href:'https://'+host+'/processing_orders/'},
    Date,Number,Set,Promise,Error,Event:class{},
    setTimeout,clearTimeout,
    getComputedStyle(element){
      return {display:'block',visibility:'visible',
        position:element===shell?'fixed':'static',
        overflowY:element===shell?'auto':'visible',zIndex:'8'};
    }
  });
  const until=Date.now()+1600;
  while(state.autoFlow && Date.now()<until)await new Promise(r=>setTimeout(r,10));
  assert.equal(state.autoFlow,null,host+' flow must finish, including when scrolling fails');
  assert.equal(backgroundY,0,'page behind ORDER INFORMATION must not scroll');
  if(locked){
    assert.equal(state.lastProcessingPreview.result,'scroll-failed',
      'must not show a false PASS when scrollTop cannot move');
    assert.equal(scrollY,0);
  }else{
    assert.equal(scrollY,2230,'scrollable ancestor must jump directly to bottom');
    assert.equal(state.lastProcessingPreview.result,'scroll-passed');
    assert.equal(state.lastScrollPixels,2230);
    assert.deepEqual(history,['ORDER SCROLL 2230']);
  }
  console.log(host+' processing popup ancestor '+(locked?'stuck/failure':'instant scroll')+': PASS');
}
(async()=>{
  for(const host of ['4writers.net','good-writers.com']){
    await simulate(host);
    await simulate(host,true);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
