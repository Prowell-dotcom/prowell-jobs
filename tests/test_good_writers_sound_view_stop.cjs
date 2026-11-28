'use strict';
// Active Good-Writers standalone v1.0.17: sound -> STOP -> View exactly once.
// No Take it, OK, I understand, scrolling or automatic rearming.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../extension/good-writers');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'1.0.17');
assert.equal(manifest.content_scripts.length,1);
assert(!JSON.stringify(manifest.content_scripts).includes('auto-accept.js'));
assert(!JSON.stringify(manifest.content_scripts).includes('confirm-main.js'));
assert(manifest.content_scripts[0].matches.every(x=>x.includes('good-writers.com')));
assert(!JSON.stringify(manifest).includes('4writers.net'));
const popup=read('popup.html');
assert.equal((popup.match(/<button\b/g)||[]).length,2);
assert.match(popup,/>START WATCH</);
assert.match(popup,/>STOP</);
assert.doesNotMatch(popup,/START AUTO-TAKE|FULL AUTO/);
assert.doesNotMatch(read('content.js'),/scrollIntoView\s*\(|scrollTo\s*\(|take\.click\s*\(|ok\.click\s*\(/i);
const flush=async()=>{for(let i=0;i<18;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
async function run(kind,{warning=false,throwOnView=false}={}){
  const events=[],subscribers=[];
  let observer=null,cardList=[];
  const state={armed:true,claimConsentVersion:'1.0.17',
    targetTabId:7,soundRunId:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    log:[],autoAcceptEnabled:false,autoFlow:null};
  const store={local:{
    async get(defaults){return {...defaults,...state};},
    async set(patch){
      const old={...state};
      Object.assign(state,patch);
      events.push(patch.armed===false?'STORE STOP':'STORE UPDATE');
      const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
        [k,{oldValue:old[k],newValue:v}]));
      for(const fn of subscribers)fn(changes,'local');
    }
  },onChanged:{addListener(fn){subscribers.push(fn);}}};
  const doc={body:{get innerText(){return warning
    ?'Using automated site parsers is prohibited. Your account will be banned.'
    :'Available orders';}},
    querySelector(){return null;},addEventListener(){}};
  const win={};win.top=win;
  win.__prowellCancelRefresh=()=>events.push('CANCEL REFRESH');
  win.__prowellCardDetector={cards:()=>cardList};
  const chrome={storage:store,runtime:{
    lastError:null,onMessage:{addListener(){}},
    sendMessage(msg,reply){
      if(msg.type==='GW_TAB_ID')reply({tabId:7});
      else if(msg.type==='PROWELL_ORDER_SOUND')events.push('SOUND');
    }}};
  vm.runInNewContext(read('content.js'),{
    window:win,document:doc,chrome,
    location:{origin:'https://good-writers.com',href:'https://good-writers.com/free_orders'},
    Date,Number,console,
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}}
  });
  await flush();
  if(warning){
    assert.equal(state.armed,false,'Warning must STOP');
    assert.deepEqual(events,['CANCEL REFRESH','STORE STOP']);
    console.log('Good-Writers security warning: STOP without sound/View PASS');return;
  }
  const button=id=>({isConnected:true,click(){
    events.push('VIEW '+id);
    if(throwOnView)throw Error('View cannot open');
  }});
  cardList=[{id:'1234567890',type:kind,view:button('1234567890')}];
  observer();await flush();
  assert.deepEqual(events.slice(0,4),
    ['CANCEL REFRESH','SOUND','STORE STOP','VIEW 1234567890'],
    'Order triggers synchronous refresh shutdown and sound, persists STOP, opens View');
  assert.equal(state.armed,false);
  assert.equal(state.targetTabId,null);
  assert.equal(state.claim,null);
  assert.equal(state.autoFlow,null);
  assert.equal(state.autoAcceptEnabled,false);
  assert.equal(state.lastAlertOrderId,'1234567890');
  observer();observer();await flush();
  assert.equal(events.filter(x=>x.startsWith('VIEW')).length,1,
    'Repeated DOM events cannot reclick View after STOP');
  // A different card cannot trigger until the user explicitly restarts.
  cardList=[{id:'1234567891',type:'available',view:button('1234567891')}];
  observer();await flush();
  assert.equal(events.filter(x=>x.startsWith('VIEW')).length,1);
  cardList=[];
  await store.local.set({armed:true,targetTabId:7,
    autoAcceptEnabled:false,claimConsentVersion:'1.0.17'});
  cardList=[{id:'1234567891',type:'available',view:button('1234567891')}];
  observer();await flush();
  assert.equal(events.filter(x=>x==='VIEW 1234567891').length,1,
    'Manual START can enable exactly one next View');
  assert.equal(state.armed,false);
  assert.equal(events.filter(x=>x==='SOUND').length,2);
  console.log('Good-Writers',kind,'sound STOP View once / manual START PASS');
}
(async()=>{
  for(const kind of ['available','processing'])await run(kind);
  await run('available',{warning:true});
})().catch(error=>{console.error(error);process.exitCode=1;});
