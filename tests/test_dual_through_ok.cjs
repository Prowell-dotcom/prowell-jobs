'use strict';
// Simulate both live-active runtimes. Available: sound, View, Take it, OK,
// STOP (no acknowledgement). Good available: sound, STOP, View only.
// Processing: sound, STOP, View and verified scroll.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'../extension/dual-writers');
const settle=async()=>{for(let i=0;i<22;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
async function run(site,kind,{mismatched=false,resumeAtOk=false}={}){
  const host=site==='four'?'4writers.net':'good-writers.com';
  const version=site==='four'?'0.5.4':'1.0.4';
  const code=fs.readFileSync(path.join(ROOT,'legacy',site,'runtime-content.js'),'utf8');
  assert.match(code,/function takeStage\(/);
  assert.match(code,/function okStage\(/);
  assert.doesNotMatch(code,/ack(?:nowledg\w*|cept)\.click\(/i);
  const startsAt=Date.now();
  const state={armed:true,targetTabId:7,claimConsentVersion:version,
    soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    claim:resumeAtOk?{id:'1234567890',kind:'available',stage:'take-clicked',
      startedAt:startsAt,listUrl:'https://'+host+'/orders'}:null};
  const events=[],subscribers=[],timers=new Map();
  let timerId=0,mutation,step=resumeAtOk?'confirm':'list';
  const node=(text,click)=>({
    isConnected:true,disabled:false,innerText:text,textContent:text,
    getClientRects(){return [{}];},getAttribute(){return null},
    click
  });
  const view=node('View',()=>{events.push('VIEW');step='details';});
  const take=node('Take it',()=>{events.push('TAKE');step='confirm';});
  const ok=node('OK',()=>{events.push('OK');step='ack';});
  const ack=node('I understand',()=>{events.push('UNWANTED ACKNOWLEDGEMENT');});
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
  if(site==='good'&&kind==='available'&&!resumeAtOk){
    assert.equal(events.filter(x=>x==='SOUND').length,1,'Good-Writers alerts once');
    assert.equal(events.filter(x=>x==='VIEW').length,1,'Good-Writers opens View once');
    assert.equal(state.armed,false,'Good-Writers must STOP on View');
    assert.equal(state.targetTabId,null);
    assert.equal(state.claim,null);
    assert.equal(events.filter(x=>x==='TAKE'||x==='OK').length,0,
      'Good-Writers must not auto-take or confirm orders');
    assert(events.indexOf('STORE STOP')<events.indexOf('VIEW'),
      'Good-Writers must persist STOP before opening View');
    mutation();mutation();await settle();
    assert.equal(events.filter(x=>x==='VIEW').length,1,
      'DOM mutations after STOP must not re-open View');
    console.log('good available: sound / STOP / View once, no Take it or OK PASS');
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
    assert.equal(events.filter(x=>x==='UNWANTED ACKNOWLEDGEMENT').length,0);
    mutation();mutation();await settle();
    assert.equal(events.filter(x=>x==='OK').length,1,'DOM events cannot reclick OK');
    assert.equal(events.filter(x=>x==='UNWANTED ACKNOWLEDGEMENT').length,0);
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
  for(const site of ['four','good']){
    for(const kind of ['available','processing','warning'])await run(site,kind);
    if(site==='four'){
      await run(site,'available',{mismatched:true});
      await run(site,'available',{resumeAtOk:true});
    }
    await run(site,'processing',{mismatched:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
