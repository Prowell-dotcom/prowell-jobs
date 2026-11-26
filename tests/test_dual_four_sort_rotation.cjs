'use strict';
// Simulates 4Writers sortable Available Orders. Each heading triggers a
// full document reload, so the next heading must survive in scoped storage.
// Orders, STOP, warnings, partial loads and unrelated pages preempt sorting.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/four-order-sort.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/manifest.json'),'utf8'));
const sites=manifest.content_scripts.filter(x=>x.world!=='MAIN');
const four=sites.find(x=>x.matches.some(m=>m.includes('4writers.net')));
const good=sites.find(x=>x.matches.some(m=>m.includes('good-writers.com')));
assert(four.js.includes('four-order-sort.js'));
assert(!good.js.includes('four-order-sort.js'));
assert(four.js.indexOf('legacy/four/runtime-content.js')<
  four.js.indexOf('four-order-sort.js'),'Order detection must load before sorting');

const labels=['Date added','Time remaining','Pages','Total price'];
const state={armed:true,claimConsentVersion:'0.5.4',targetTabId:7,
  claim:null,fourSortIndex:0};
const history=[],handoffs=[];
const runtime=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/legacy/four/runtime-content.js'),'utf8');
assert.match(runtime,/FOLLOWUP_MS=120/,'4Writers detail-stage fallback must be responsive');
assert.match(runtime,/window\.__prowellDualPrioritizeOrder=prioritizeVisibleOrder/,
  '4Writers runtime must expose the order-priority handoff');
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));};
function newPage({loaded=true,warning=false,available=true,overview=false,
    card=false,allHeadings=true,onSave=null}={}){
  let cards=card?[{type:'available',id:'1234567890'}]:[],
    ready=loaded?'complete':'loading',blocked=warning;
  const subscribers=[],timers=[];
  let counter=0,mutation=null;
  const controls=labels.map(name=>({
    isConnected:true,disabled:false,innerText:name,textContent:name,
    getClientRects(){return [{}]},
    getAttribute(n){return n==='href'?'#sort':null;},
    closest(){return this;},
    click(){history.push(name);ready='loading';}
  }));
  const store={local:{
    async get(keys){
      return Object.fromEntries(keys.map(k=>[k,state[k]]));
    },
    async set(patch){
      Object.assign(state,patch);
      if(onSave)onSave(patch);
      const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
        [k,{oldValue:null,newValue:v}]));
      for(const fn of subscribers)fn(changes,'local');
    }
  },onChanged:{addListener(fn){subscribers.push(fn);}}};
  const document={
    body:{get innerText(){return blocked
      ?'Available orders Order by: Date added Time remaining Pages Total price None Using automated site parsers is prohibited.'
      :'Available orders Order by: Date added Time remaining Pages Total price None';}},
    get readyState(){return ready;},
    querySelector(sel){return null;},
    querySelectorAll(sel){
      if(sel.includes('a,button,span,th'))return allHeadings?controls:controls.slice(0,3);
      return [];
    },addEventListener(){}
  };
  const window={__prowellDualStorage:store,
    __prowellFourSections:{available:()=>available,overview:()=>overview},
    __prowellDualPrioritizeOrder(){handoffs.push(cards[0]?.id);return true;},
    __prowellDualActionableCards:()=>cards,
    __prowellCardDetector:{cards:()=>cards}};
  window.top=window;
  vm.runInNewContext(code,{window,document,
    location:{hostname:'4writers.net',href:'https://4writers.net/available',
      origin:'https://4writers.net'},
    URL,Date,Number,Map,Set,Math,console,queueMicrotask,
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},
    setTimeout(fn,ms){const t={id:++counter,fn,ms};timers.push(t);return t.id;},
    clearTimeout(id){const idx=timers.findIndex(t=>t.id===id);
      if(idx>=0)timers.splice(idx,1);},
    chrome:{runtime:{sendMessage(msg,cb){if(msg.type==='PROWELL_TAB_ID')cb({tabId:7});}}}
  });
  return {
    async tick(){
      const t=timers.find(x=>x.ms===800);
      assert(t,'Expected 800ms sort timer for loaded empty Available Orders');
      timers.splice(timers.indexOf(t),1);
      await t.fn();await flush();
    },
    async settle(){await flush();},
    timer:()=>timers.find(x=>x.ms===800),
    mutate:()=>mutation(),
    cards:(items)=>{cards=items;mutation();},
    setReady:(v)=>{ready=v;mutation();},
    setWarning:(v)=>{blocked=v;mutation();},
    async setState(patch){await store.local.set(patch);await flush();}
  };
}
(async()=>{
  for(let i=0;i<5;i++){
    const page=newPage();
    await page.settle();
    assert(page.timer(), 'Empty loaded screen should schedule an 800ms sort click');
    await page.tick();
    assert.equal(history[i],labels[i%4],
      'Full reload must resume on the NEXT sort heading');
    assert.equal(state.fourSortIndex,(i+1)%4);
    assert.equal(state.fourSortLastHeading,labels[i%4].toLowerCase());
    assert.equal(page.timer(),undefined,'Do not schedule another click during navigation');
  }
  let page=newPage();
  await page.settle();
  const earlierHandoffs=handoffs.length;
  page.cards([{type:'available',id:'1234567890'}]);
  assert.equal(handoffs.length,earlierHandoffs+1,
    'Sort observer must hand off a newly visible order synchronously');
  assert.equal(page.timer(),undefined,'Visible order cancels sorting');
  const beforeReloadHandoffs=handoffs.length;
  page=newPage({card:true});await page.settle();
  assert.equal(handoffs.length,beforeReloadHandoffs+1,
    'Page reload containing an order must trigger the immediate handoff');
  assert.equal(page.timer(),undefined,'Order on reloaded page preempts any sort click');
  page=newPage({warning:true});await page.settle();
  assert.equal(page.timer(),undefined,'Security warning blocks sorting');
  page=newPage({loaded:false});await page.settle();
  assert.equal(page.timer(),undefined,'Partial page must never be sorted');
  page.setReady('complete');await page.settle();
  assert(page.timer(),'Start sorting only after page becomes fully loaded');
  await page.setState({claim:{id:'1234567890',stage:'view-clicked'}});
  assert.equal(page.timer(),undefined,'Active claim cancels pending sort');
  await page.setState({claim:null,armed:false});
  assert.equal(page.timer(),undefined,'STOP must prevent sorting');
  await page.setState({armed:true,fourSortIndex:0});
  assert(page.timer(),'Manual START should reactivate the empty page');
  await page.tick();
  assert.equal(history.at(-1),'Date added','START must reset sort rotation');
  await page.setState({armed:false});
  page=newPage({overview:true});await page.settle();
  assert.equal(page.timer(),undefined,'Do not sort neutral overview');
  page=newPage({available:false});await page.settle();
  assert.equal(page.timer(),undefined,'Do not sort non-Available Orders');
  page=newPage({allHeadings:false});await page.settle();
  assert.equal(page.timer(),undefined,'Do not click when sorting toolbar is incomplete');
  await page.setState({armed:true});
  page=newPage({onSave(patch){
    if(patch.fourSortIndex!==undefined){
      // A new order can become visible between storing the next sort and click.
      page.cards([{type:'available',id:'1234567890'}]);
    }
  }});
  await page.settle();assert(page.timer());const before=history.length;
  const beforeStorageHandoffs=handoffs.length;
  await page.tick();
  assert.equal(handoffs.length,beforeStorageHandoffs+1,
    'Order appearing during sort storage write must trigger handoff now');
  assert.equal(history.length,before,
    'A new order during storage write must preempt sort click');
  console.log('4Writers sorted-order refresh across full reloads: 800ms rotation, order priority, START/STOP and warning guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
