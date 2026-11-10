'use strict';
// Full-flow simulation for BOTH dual engines. A fast website must not cause
// Take it/OK/I understand to finish early. Short=3s, medium=4s, long=5s
// measured from View. Timers use a deterministic virtual clock.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'../extension/dual-writers');
const tick=async()=>{for(let i=0;i<80;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
async function run(site,size,stopEarly=false){
  const four=site==='four',host=four?'4writers.net':'good-writers.com';
  const h={short:600,medium:1200,long:2200}[size];
  const target={short:3000,medium:4000,long:5000}[size];
  const src=fs.readFileSync(path.join(root,'legacy/'+site+'/runtime-content.js'),'utf8');
  assert.match(src,/completionTargetMs/);
  assert.match(src,/STAGE_FRACTIONS/);
  let time=1700000000000,activeButton='take',scroll=0,ackScroll=0;
  const start=time,events=[],listeners=[];
  class VirtualDate extends Date{
    constructor(...args){super(...(args.length?args:[time]));}
    static now(){return time;}
  }
  const id='0192065941';
  const claim={id,stage:'view-clicked',viewClickedAt:start,startedAt:start,
    listUrl:'https://'+host+'/available_orders'};
  const state={armed:true,targetTabId:17,claim,
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
      if(stopEarly && time-start>=900 && state.armed){
        state.armed=false;
        for(const cb of listeners)cb({armed:{oldValue:true,newValue:false}},'local');
      }
      queueMicrotask(fn);return 1;
    }
  };
  vm.runInNewContext(src,context,{filename:'runtime-'+site+'.js'});
  await tick();
  if(stopEarly){
    assert.equal(events.length,0,site+': STOP while pacing must cancel clicks');
    return;
  }
  assert.equal(state.claim?.completionTargetMs,target,
    site+' '+size+': description size must select correct TOTAL target');
  assert.equal(state.claim?.completionSize,size);
  assert.equal(events.length,3,site+' '+size+': Take/OK/final must all click');
  assert.deepEqual(events.map(e=>e.action),
    ['Take it','OK',four?'I understand, take the order':'I understand']);
  assert(events[0].elapsed>=target*.4,site+' '+size+': Take it was early');
  assert(events[1].elapsed>=target*.72,site+' '+size+': OK was early');
  assert(events[2].elapsed>=target,site+' '+size+': acknowledgement was early');
  assert.equal(events[2].elapsed,target,
    site+' '+size+': fast simulated website should finish at exact target');
  assert.equal(state.lastCompletionTargetMs,target);
  assert.equal(state.lastCompletionNoEarlierThanTarget,true);
  assert.equal(state.lastCompletionDurationMs,target);
  assert.equal(scroll,h-400,'Order-details popup should scroll to bottom');
  assert.equal(ackScroll,h-380,'Acknowledgement popup should scroll to bottom');
  console.log(site+' '+size+': Take '+events[0].elapsed+
    'ms → OK '+events[1].elapsed+'ms → final '+events[2].elapsed+'ms PASS');
}
(async()=>{
  for(const site of ['four','good']){
    for(const size of ['short','medium','long'])await run(site,size);
    await run(site,'short',true);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
