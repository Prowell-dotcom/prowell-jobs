'use strict';
// Live-active dual logic: STOP refresh synchronously, request sound, persist
// STOP, open View exactly once; never accept an order or ignore a warning.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'../extension/dual-writers');
const settle=async()=>{for(let i=0;i<18;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
async function run(site,kind){
  const host=site==='four'?'4writers.net':'good-writers.com';
  const version=site==='four'?'0.5.4':'1.0.4';
  const code=fs.readFileSync(path.join(ROOT,'legacy',site,'runtime-content.js'),'utf8');
  assert.match(code,/view\.click\(\)/);
  assert.doesNotMatch(code,/take\.click\(|scrollTop\s*=|scrollTo\s*\(/);
  const state={armed:true,targetTabId:7,claimConsentVersion:version,
    soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',claim:null};
  const events=[],subscribers=[];
  const view={isConnected:true,click(){events.push('VIEW CLICK');}};
  const card={type:kind==='warning'?'available':kind,id:'1234567890',view};
  let visible=[],mutation;
  const store={local:{
    async get(defaults){return {...defaults,...state};},
    async set(update){
      const changes=Object.fromEntries(Object.entries(update).map(([k,v])=>
        [k,{oldValue:state[k],newValue:v}]));
      Object.assign(state,update);
      events.push('STORED');
      subscribers.forEach(fn=>fn(changes,'local'));
    }
  },onChanged:{addListener(fn){subscribers.push(fn);}}};
  const win={};win.top=win;
  win.__prowellLegacyChrome={storage:store,runtime:{lastError:null,
    sendMessage(msg,reply){
      if(msg.type==='PROWELL_ORDER_SOUND'){events.push('SOUND');return;}
      if(msg.type==='PROWELL_TAB_ID'||msg.type==='GW_TAB_ID')
        reply({tabId:7});
    }
  }};
  win.__prowellCardDetector={cards:()=>visible};
  win.__prowellDualStopRefresh=()=>events.push('CANCEL REFRESH');
  const document={body:{innerText:'Available Orders'},
    querySelector(){return null;},addEventListener(){}};
  vm.runInNewContext(code,{window:win,document,location:{hostname:host},
    queueMicrotask,Date,console,MutationObserver:class{
      constructor(fn){mutation=fn;}observe(){}
    }});
  await settle();
  if(kind==='warning'){
    document.body.innerText='Using automated site parsers is prohibited. Your account will be banned.';
  }else{
    visible=[card];
  }
  mutation();await settle();
  const expected=kind==='warning'
    ?['CANCEL REFRESH','STORED']
    :['CANCEL REFRESH','SOUND','STORED','VIEW CLICK'];
  assert.deepEqual(events.slice(0,expected.length),expected,
    'STOP and notification must precede single View click');
  assert.equal(state.armed,false);
  assert.equal(state.targetTabId,null);
  assert.equal(state.claim,null);
  assert.equal(state.autoAcceptEnabled,false);
  if(kind==='warning'){
    assert.equal(events.filter(x=>x==='SOUND').length,0);
    assert.equal(events.filter(x=>x==='VIEW CLICK').length,0);
  }else{
    assert.equal(state.lastAlertOrderId,card.id);
    assert.equal(events.filter(x=>x==='VIEW CLICK').length,1);
  }
  mutation();mutation();await settle();
  assert.equal(events.filter(x=>x==='VIEW CLICK').length,kind==='warning'?0:1,
    'Repeated DOM changes cannot click a second time');
  if(kind==='warning'){
    await store.local.set({armed:true,targetTabId:7,claim:null});
    mutation();await settle();
    assert.equal(state.armed,false,'Warning must disarm after manual restart');
    assert.equal(events.filter(x=>x==='VIEW CLICK').length,0);
  }else{
    await store.local.set({armed:true,targetTabId:7,claim:null});
    await settle();
    assert.equal(events.filter(x=>x==='SOUND').length,2,
      'A fresh manual START can re-alert a still-visible order');
    assert.equal(events.filter(x=>x==='VIEW CLICK').length,2,
      'Exactly one new View click per manual START');
    assert.equal(state.armed,false);
  }
  console.log(site,kind,'5-second monitor: STOP + SOUND + single View PASS');
}
(async()=>{for(const site of ['four','good'])
  for(const kind of ['available','processing','warning'])await run(site,kind);
})().catch(e=>{console.error(e);process.exitCode=1;});
