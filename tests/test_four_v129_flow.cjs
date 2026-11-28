'use strict';
// Simulate both live-active runtimes. Available: sound, View, Take it, OK,
// STOP after OK, scroll to and click I understand ONCE; processing View-only.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'../extension/4writers-v129');
const settle=async()=>{for(let i=0;i<22;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
async function run(site,kind,{mismatched=false,resumeAtOk=false,resumeAtAck=false}={}){
  const host='4writers.net';
  const version='0.5.4';
  const code=fs.readFileSync(path.join(ROOT,'legacy',site,'runtime-content.js'),'utf8');
  assert.match(code,/function takeStage\(/);
  assert.match(code,/function okStage\(/);
  assert.match(code,/target\.click\(\)/,'One-use I understand click exists');
  const startsAt=Date.now();
  const state={armed:!resumeAtAck,targetTabId:resumeAtAck?null:7,claimConsentVersion:version,
    soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    claim:resumeAtOk?{id:'1234567890',kind:'available',stage:'take-clicked',
      startedAt:startsAt,listUrl:'https://'+host+'/orders'}:null,
    pendingAck:resumeAtAck?{id:'1234567890',tabId:7,
      startedAt:startsAt,listUrl:'https://'+host+'/orders'}:null};
  const events=[],subscribers=[],timers=new Map();
  let timerId=0,mutation,step=resumeAtAck?'ack':resumeAtOk?'confirm':'list';
  const node=(text,click)=>({
    isConnected:true,disabled:false,innerText:text,textContent:text,
    getClientRects(){return [{}];},getAttribute(){return null},
    click
  });
  const view=node('View',()=>{events.push('VIEW');step='details';});
  const take=node('Take it',()=>{events.push('TAKE');step='confirm';});
  const ok=node('OK',()=>{events.push('OK');step='ack';});
  const ack=node('I understand',()=>{events.push('ACK CLICK');step='done';});
  ack.scrollIntoView=()=>events.push('ACK SCROLL');
  const detail={...node(mismatched?'Order ID: 9999999999':'Order ID: 1234567890',()=>{}),
    scrollHeight:1800,scrollTop:0,
    scrollTo(_x,y){events.push('DETAIL SCROLL');this.scrollTop=y;},
    querySelectorAll(sel){return sel.startsWith('a,button')?[take]:[];}};
  const confirm={...node('Order #1234567890 confirmation',()=>{}),
    querySelectorAll(sel){return sel.startsWith('a,button')?[ok]:[];}};
  const document={
    body:{get innerText(){if(kind==='warning')return 'Using automated site parsers is prohibited. Your account will be banned.';
      return step==='details'?detail.innerText:step==='confirm'?confirm.innerText:
        step==='ack'?'I understand the order.':'Available Orders';},
      get textContent(){return this.innerText}},
    querySelector(sel){return null},
    querySelectorAll(sel){
      if(sel.startsWith('a,button'))return step==='confirm'?[ok]:step==='ack'?[ack]:step==='details'?[take]:[view];
      if(sel.includes('dialog[open]')||sel.includes('.modal.show'))
        return step==='confirm'?[confirm]:step==='details'?[detail]:[];
      return [];
    },
    addEventListener(){}
  };
  const card={type:kind==='warning'?'available':kind,id:'1234567890',view};
  const store={local:{
    async get(defaults){return {...defaults,...state};},
    async set(patch){
      const old={...state};Object.assign(state,patch);
      events.push('STORE '+(patch.armed===false?'STOP':patch.claim?.stage||'UPDATE'));
      const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
        [k,{oldValue:old[k],newValue:v}]));
      subscribers.forEach(fn=>fn(changes,'local'));
    }
  },onChanged:{addListener(fn){subscribers.push(fn);}}};
  const win={};win.top=win;
  win.__prowellLegacyChrome={storage:store,runtime:{lastError:null,
    sendMessage(msg,reply){
      if(msg.type==='PROWELL_ORDER_SOUND'){events.push('SOUND');return;}
      if(msg.type==='PROWELL_TAB_ID'||msg.type==='GW_TAB_ID')
        reply({tabId:7});
    }}};
  win.__prowellCardDetector={cards:()=>resumeAtOk?[]:[card]};
  win.__prowellDualStopRefresh=()=>events.push('CANCEL REFRESH');
  win.dispatchEvent=event=>{events.push('ARM '+event.type);return true;};
  const context={window:win,document,location:{hostname:host,href:'https://'+host+'/orders'},
    queueMicrotask,Date,console,Event:class{constructor(type){this.type=type;}},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);}
  };
  vm.runInNewContext(code,context);
  await settle();
  if(resumeAtAck){
    assert.equal(state.armed,false,'Acknowledgement handoff never rearms bot');
    assert.equal(events.filter(x=>x==='ACK SCROLL').length,1,
      'Resume after navigation scrolls to acknowledgement');
    assert.equal(events.filter(x=>x==='ACK CLICK').length,1,
      'Resume after navigation clicks I understand exactly once');
    assert.equal(state.pendingAck,null,'One-use acknowledgement marker cleared');
    assert.equal(state.lastAckOrderId,'1234567890','Persist final acknowledged ID');
    assert(events.indexOf('STORE UPDATE')<events.indexOf('ACK CLICK'),
      'Persist one-use acknowledgement guard before click');
    mutation();mutation();await settle();
    assert.equal(events.filter(x=>x==='ACK SCROLL').length,1);
    assert.equal(events.filter(x=>x==='ACK CLICK').length,1,
      'Repeated DOM mutations cannot click final acknowledgement twice');
    console.log('four resume-after-OK automatic one-time acknowledgement PASS');
    return;
  }
  if(kind==='available' && !resumeAtOk){
    assert.equal(events.filter(x=>x==='VIEW').length,1,'First View must click once');
    assert.equal(events.filter(x=>x==='SOUND').length,1);
    assert.equal(state.claim?.stage,'view-clicked');
    assert.equal(events[0],'CANCEL REFRESH');
    mutation();await settle();
    if(mismatched){
      assert.equal(events.filter(x=>x==='TAKE').length,0,'Wrong-ID modal must never be taken');
      assert.equal(state.claim?.stage,'view-clicked');
      await store.local.set({armed:false,targetTabId:null,claim:null});
      mutation();await settle();
      assert.equal(events.filter(x=>x==='OK').length,0);
      console.log(site,'wrong order ID: no Take it/OK PASS');return;
    }
    assert.equal(events.filter(x=>x==='TAKE').length,1);
    assert.equal(state.claim?.stage,'take-clicked');
    assert(events.includes('ARM prowell-order-confirm-arm'));
    mutation();await settle();
  }
  if(resumeAtOk){
    assert.equal(events.filter(x=>x==='VIEW').length,0,'Resume must not reclick View');
    assert.equal(events.filter(x=>x==='TAKE').length,0,'Resume must not reclick Take it');
  }
  assert.equal(state.armed,false,'Monitoring must STOP');
  assert.equal(state.targetTabId,null);
  assert.equal(state.claim,null);
  assert.equal(state.autoAcceptEnabled,false);
  if(kind==='available'){
    assert.equal(events.filter(x=>x==='OK').length,1,'Must click OK exactly once');
    assert(events.indexOf('STORE STOP')<events.indexOf('OK'),'Persist STOP before OK');
    assert.equal(state.lastOkOrderId,'1234567890');
    assert.equal(events.filter(x=>x==='ACK SCROLL').length,1,
      'After OK scroll to I understand once');
    assert.equal(events.filter(x=>x==='ACK CLICK').length,1,
      'After OK click I understand exactly once');
    assert.equal(state.pendingAck,null,'Clear persisted one-use acknowledgement marker');
    assert.equal(state.lastAckOrderId,'1234567890');
    assert.equal(state.armed,false,'Bot remains STOPPED after final click');
    assert(events.indexOf('OK')<events.indexOf('ACK CLICK'),
      'Only click I understand AFTER OK');
    assert(events.indexOf('STORE STOP')<events.indexOf('ACK CLICK'),
      'Persist STOP before final click');
    mutation();mutation();await settle();
    assert.equal(events.filter(x=>x==='OK').length,1,'DOM events cannot reclick OK');
    assert.equal(events.filter(x=>x==='ACK CLICK').length,1,
      'DOM events cannot reclick I understand');
    assert.equal(events.filter(x=>x==='ACK SCROLL').length,1);
  }else if(kind==='processing'){
    assert.equal(events.filter(x=>x==='VIEW').length,1,'Processing opens View once');
    assert.equal(events.filter(x=>x==='TAKE').length,0,'Processing is never taken');
    assert.equal(events.filter(x=>x==='OK').length,0);
    assert.equal(events.filter(x=>x==='SOUND').length,1);
    if(mismatched){
      assert.equal(events.filter(x=>x==='DETAIL SCROLL').length,0,
        'Wrong-order processing modal must not be scrolled');
      assert.equal(state.processingScroll?.id,'1234567890',
        'One-time scroll remains pending until matching order details appear');
      detail.innerText='ID: 1234567890';
      mutation();await settle();
    }
    assert.equal(events.filter(x=>x==='DETAIL SCROLL').length,1,
      'Scroll matching order details exactly once');
    assert.equal(detail.scrollTop,detail.scrollHeight);
    assert.equal(state.processingScroll,null,'Clear one-use processing marker');
    assert(events.indexOf('STORE STOP')<events.indexOf('VIEW'),
      'Persist STOP before processing View');
    assert(events.indexOf('VIEW')<events.indexOf('DETAIL SCROLL'),
      'Scroll only after View has opened order details');
    mutation();mutation();await settle();
    assert.equal(events.filter(x=>x==='DETAIL SCROLL').length,1,
      'Repeated DOM changes must not scroll again');
  }else{
    assert.equal(events.filter(x=>x==='VIEW').length,0,'Warning never clicks View');
    assert.equal(events.filter(x=>x==='SOUND').length,0,'Warning never triggers sound');
    assert.equal(events.filter(x=>x==='TAKE').length,0);
    assert.equal(events.filter(x=>x==='OK').length,0);
  }
  console.log(site,kind,resumeAtOk?'resume-at-OK':'workflow','PASS');
}
(async()=>{
  const site='four';
  for(const kind of ['available','processing','warning'])await run(site,kind);
  await run(site,'available',{mismatched:true});
  await run(site,'available',{resumeAtOk:true});
  await run(site,'processing',{mismatched:true});
  await run(site,'available',{resumeAtAck:true});
})().catch(e=>{console.error(e);process.exitCode=1;});
