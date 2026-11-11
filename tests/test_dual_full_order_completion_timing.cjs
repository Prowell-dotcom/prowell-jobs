'use strict';
// Full-flow simulation for BOTH dual engines: instant bottom jump and
// immediate Take it / OK / I understand on short, medium and long orders.
// Only 4writers scrolls its final acknowledgement popup; Good-Writers does not.
// The test clock detects any accidental timed delay.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'../extension/dual-writers');
const tick=async()=>{for(let i=0;i<80;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
async function run(site,size,stopEarly=false){
  const four=site==='four',host=four?'4writers.net':'good-writers.com';
  const h={short:600,medium:1200,long:2200}[size];
  // Description length must not impose a minimum acceptance duration.
  const src=fs.readFileSync(path.join(root,'legacy/'+site+'/runtime-content.js'),'utf8');
  assert.match(src,/function jumpToBottom\(el,bottom\)/);
  assert.doesNotMatch(src,/STAGE_FRACTIONS|COMPLETION_TARGETS|SCROLL_STEPS/,
    'No 3/4/5-second pacing or gradual scrolling may remain');
  let time=1700000000000,activeButton='take',scroll=0,ackScroll=0;
  const start=time,events=[],listeners=[];
  class VirtualDate extends Date{
    constructor(...args){super(...(args.length?args:[time]));}
    static now(){return time;}
  }
  const id='0192065941';
  const claim={id,stage:'view-clicked',viewClickedAt:start,startedAt:start,
    listUrl:'https://'+host+'/available_orders'};
  const state={armed:!stopEarly,targetTabId:17,claim,
    claimConsentVersion:four?'0.5.4':'1.0.4',
    attemptedIds:[],completed:[],processingPreviewedIds:[]};
  const store={
    async get(defaults){return Object.fromEntries(Object.keys(defaults).map(k=>
      [k,Object.hasOwn(state,k)?state[k]:defaults[k]]));},
    async set(patch){
      const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
        [k,{newValue:v,oldValue:state[k]}]));
      Object.assign(state,patch);
      for(const fn of listeners)fn(changes,'local');
    }
  };
  const chrome={runtime:{lastError:null,onMessage:{addListener(){}},
    sendMessage(msg,cb){
      if(msg.type===(four?'PROWELL_TAB_ID':'GW_TAB_ID'))cb?.({tabId:17});
      else cb?.({ok:true});
    }},storage:{local:store,onChanged:{addListener(fn){listeners.push(fn);}}}};
  const orderPanel={isConnected:true,scrollHeight:h,clientHeight:400,
    innerText:'ORDER INFORMATION Order #'+id,
    textContent:'ORDER INFORMATION Order #'+id,
    getClientRects(){return[{}];},
    get scrollTop(){return scroll;},set scrollTop(v){scroll=v;},
    querySelectorAll(){return[]}
  };
  const ackPane={clientHeight:380,scrollHeight:h,
    get scrollTop(){return ackScroll;},set scrollTop(v){ackScroll=v;},
    querySelectorAll(){return[]}
  };
  const popup={clientHeight:600,scrollHeight:600,scrollTop:0,parentElement:null,
    querySelectorAll(){return[ackPane,ackButton];}};
  function makeButton(name,next){
    return {isConnected:true,disabled:false,value:'',
      innerText:name,textContent:name,getClientRects(){return[{}]},
      getAttribute(){return null},closest(){return popup;},
      click(){events.push({action:name,elapsed:time-start});
        activeButton=next;}
    };
  }
  const take=makeButton('Take it','ok');
  const ok=makeButton('OK','ack');
  const ackButton=makeButton(four?'I understand, take the order':'I understand','done');
  const document={
    body:{innerText:'Order #'+id,scrollHeight:3000},
    documentElement:{appendChild(){},scrollHeight:3000},
    scrollingElement:{clientHeight:800,scrollHeight:3000},
    querySelectorAll(selector){
      if(selector.startsWith('dialog[open]'))return [orderPanel];
      if(selector.startsWith('a,button,input')){
        return activeButton==='take'?[take]:activeButton==='ok'?[ok]:
          activeButton==='ack'?[ackButton]:[];
      }
      return[];
    },
    querySelector(){return null},addEventListener(){},
    createElement(){return {style:{},textContent:'',remove(){}};}
  };
  const win={__prowellLegacyChrome:chrome,dispatchEvent(){}};
  win.top=win;
  const context={
    window:win,document,chrome,VirtualDate,Date:VirtualDate,URL,
    Promise,Set,Map,Number,Error,Event:class{},console,queueMicrotask,
    location:{href:'https://'+host+'/available_orders',
      origin:'https://'+host},
    getComputedStyle(){return{position:'fixed',overflowY:'auto'};},
    MutationObserver:class{observe(){}},
    clearTimeout(){},setInterval(){return 1;},
    setTimeout(fn,ms){
      if(ms>0)time+=ms;
      queueMicrotask(fn);return 1;
    }
  };
  vm.runInNewContext(src,context,{filename:'runtime-'+site+'.js'});
  await tick();
  if(stopEarly){
    assert.equal(events.length,0,site+': STOP must prevent all acceptance clicks');
    return;
  }
  assert.equal(events.length,3,site+' '+size+': all three buttons must click');
  assert.deepEqual(events.map(e=>e.action),
    ['Take it','OK',four?'I understand, take the order':'I understand']);
  assert.deepEqual(events.map(e=>e.elapsed),[0,0,0],
    site+' '+size+': no staged delays may occur after View');
  assert.equal(state.lastCompletionTargetMs,null);
  assert.equal(state.lastCompletionDurationMs,0);
  assert.equal(scroll,h-400,'Order-details popup should scroll to bottom');
  assert.equal(ackScroll,four?h-380:0,
    four?'4writers acknowledgement must jump to bottom':
      'Good-Writers acknowledgement must NOT scroll after OK');
  console.log(site+' '+size+': View → direct bottom → Take it → OK → I understand: instant PASS');
}
(async()=>{
  for(const site of ['four','good']){
    for(const size of ['short','medium','long'])await run(site,size);
    await run(site,'short',true);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
