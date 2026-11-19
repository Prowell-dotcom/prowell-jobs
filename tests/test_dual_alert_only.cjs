'use strict';
// Active dual-bot regression: order -> refresh cancelled -> sound -> STOP;
// no website clicks or scrolling; security warning requires manual restart.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'../extension/dual-writers');
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
async function run(site,kind){
  const host=site==='four'?'4writers.net':'good-writers.com';
  const version=site==='four'?'0.5.4':'1.0.4';
  const code=fs.readFileSync(path.join(ROOT,'legacy',site,'runtime-content.js'),'utf8');
  // This is a structural guarantee: no website interactions in active runtime.
  assert.doesNotMatch(code,/\.click\s*\(|scrollTop\s*=|scrollTo\s*\(/);
  const state={armed:true,targetTabId:7,claimConsentVersion:version,
    soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',claim:null};
  const events=[],subscribers=[];
  const button={click(){events.push('VIEW CLICK');}};
  const card={type:kind==='warning'?'available':kind,id:'1234567890',view:button};
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
  visible=[card];mutation();await settle();
  assert.deepEqual(events.slice(0,3),['CANCEL REFRESH','SOUND','STORED']);
  assert.equal(state.armed,false);
  assert.equal(state.targetTabId,null);
  assert.equal(state.claim,null);
  assert.equal(state.autoAcceptEnabled,false);
  assert.equal(state.lastAlertOrderId,card.id);
  assert(!events.includes('VIEW CLICK'));
  mutation();await settle();
  assert.equal(events.filter(x=>x==='SOUND').length,1);
  if(kind==='warning'){
    visible=[];
    document.body.innerText='Using automated site parsers is prohibited. If you do not stop, your account will be banned.';
    await store.local.set({armed:true,targetTabId:7,claim:null});
    mutation();await settle();
    assert.equal(state.armed,false,'Warning must disarm after manual restart');
    assert.equal(events.filter(x=>x==='SOUND').length,1,'No sound for warning');
  }else{
    await store.local.set({armed:true,targetTabId:7,claim:null});
    await settle();
    assert.equal(events.filter(x=>x==='SOUND').length,2,
      'Manual START may alert on an order still visible');
    assert.equal(state.armed,false);
  }
  console.log(site,kind,'alert-only PASS');
}
(async()=>{for(const site of ['four','good'])
  for(const kind of ['available','processing','warning'])await run(site,kind);
})().catch(e=>{console.error(e);process.exitCode=1;});
