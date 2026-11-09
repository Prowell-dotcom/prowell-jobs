'use strict';
// Verify that one clearly labelled START enables every acceptance action,
// including for users whose older saved setting had automatic taking OFF.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '..', 'extension');

function element(){
  const listeners = {};
  return {disabled:false,checked:false,textContent:'',value:'',listeners,
    addEventListener(name,fn){listeners[name]=fn;}};
}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};

async function single(site,host,version){
  const elements=new Map(),listeners=[];
  const node=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const state={autoAcceptEnabled:false,armed:false};
  const chrome={
    tabs:{async query(){return [{id:21,active:true,url:'https://'+host+'/free_orders'}];}},
    storage:{local:{
      async get(defaults){return Object.fromEntries(Object.entries(defaults).map(
        ([k,v])=>[k,Object.prototype.hasOwnProperty.call(state,k)?state[k]:v]));},
      async set(patch){Object.assign(state,patch);const change=Object.fromEntries(
        Object.entries(patch).map(([k,v])=>[k,{newValue:v}]));
        for(const fn of listeners)fn(change,'local');},
      async remove(name){delete state[name];}
    },onChanged:{addListener(fn){listeners.push(fn);}}},
    runtime:{async sendMessage(){return {ok:true};}}
  };
  const html=fs.readFileSync(path.join(base,site,'popup.html'),'utf8');
  assert.match(html,/>START AUTO-TAKE</,'START must describe what it enables');
  const js=fs.readFileSync(path.join(base,site,'popup.js'),'utf8');
  vm.runInNewContext(js,{document:{getElementById:node},window:{},chrome,
    crypto:{randomUUID:()=> 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},console});
  await tick();
  assert.equal(state.autoAcceptEnabled,false,'previous setting should start OFF');
  await node('arm').listeners.click();await tick();
  assert.equal(state.armed,true,site+' START should arm the watcher');
  assert.equal(state.autoAcceptEnabled,true,site+' START MUST enable all click steps');
  assert.equal(state.claimConsentVersion,version);
  assert.equal(state.targetTabId,21);
  assert.equal(state.autoFlow,null,'START must clear an earlier order flow');
  await node('stop').listeners.click();await tick();
  assert.equal(state.armed,false,site+' STOP must disable monitoring');
  assert.equal(state.autoAcceptEnabled,false,site+' STOP must disable taking');
  console.log(site+': START FULL AUTO despite previous OFF; STOP clears both: PASS');
}

async function dual(){
  const elements=new Map(),listeners=[];
  const node=selector=>{if(!elements.has(selector))elements.set(selector,element());
    return elements.get(selector);};
  const data={dual_four_autoAcceptEnabled:false,dual_good_autoAcceptEnabled:false};
  const tabs=[{id:31,url:'https://4writers.net/free_orders',active:true},
    {id:32,url:'https://good-writers.com/free_orders',active:false}];
  const chrome={
    tabs:{async query(){return tabs;}},
    storage:{local:{
      async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys])
        .filter(k=>Object.prototype.hasOwnProperty.call(data,k)).map(k=>[k,data[k]]));},
      async set(patch){Object.assign(data,patch);
        const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,{newValue:v}]));
        for(const fn of listeners)fn(changes,'local');}
    },onChanged:{addListener(fn){listeners.push(fn);}}},
    runtime:{async sendMessage(){return{ok:true};}}
  };
  const html=fs.readFileSync(path.join(base,'dual-writers','popup.html'),'utf8');
  assert.equal((html.match(/>START AUTO-TAKE</g)||[]).length,2);
  vm.runInNewContext(fs.readFileSync(path.join(base,'dual-writers','popup.js'),'utf8'),
    {document:{querySelector:node},window:{},chrome,
      crypto:{randomUUID:()=> 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},console});
  await tick();
  node('[data-start="four"]').listeners.click();await tick();
  assert.equal(data.dual_four_armed,true);
  assert.equal(data.dual_four_autoAcceptEnabled,true);
  assert.equal(data.dual_four_claimConsentVersion,'0.5.4');
  assert.equal(data.dual_four_targetTabId,31);
  assert.equal(data.dual_good_autoAcceptEnabled,false,'platforms must stay separate');
  node('[data-start="good"]').listeners.click();await tick();
  assert.equal(data.dual_good_armed,true);
  assert.equal(data.dual_good_autoAcceptEnabled,true);
  assert.equal(data.dual_good_claimConsentVersion,'1.0.4');
  assert.equal(data.dual_good_targetTabId,32);
  node('[data-stop="four"]').listeners.click();await tick();
  assert.equal(data.dual_four_armed,false);
  assert.equal(data.dual_four_autoAcceptEnabled,false);
  assert.equal(data.dual_good_armed,true);
  assert.equal(data.dual_good_autoAcceptEnabled,true);
  console.log('dual-writers: both FULL AUTO enabled independently; STOP isolated: PASS');
}

async function handoff(){
  for(const site of ['4writers','good-writers']){
    const source=fs.readFileSync(path.join(base,site,'content.js'),'utf8');
    const stop=source.indexOf('window.__prowellCancelRefresh?.()');
    const sound=source.indexOf("type:'PROWELL_ORDER_SOUND'");
    const view=source.indexOf('first.view.click()');
    assert(stop>0&&sound>stop&&view>sound,site+': stop → sound → View order broken');
    assert(source.includes("mode:accepts?'accept':'scroll-only'"),
      site+' requires the accept branch when Take it is available');
    const automation=fs.readFileSync(path.join(base,site,'auto-accept.js'),'utf8');
    for(const stage of ['take','ok','understand'])
      assert(automation.includes("flow.stage === '"+stage+"'"),site+' missing stage '+stage);
    assert.match(automation,/instantScroll\(root,bottom\)/);
    assert.doesNotMatch(automation,/await sleep\(|STEP_DELAY|STEP_PX/);
  }
  console.log('All three bot engines: stop → sound → View → instant scroll → three acceptance actions: PASS');
}

(async()=>{await single('4writers','4writers.net','0.5.16');
  await single('good-writers','good-writers.com','1.0.16');
  await dual();await handoff();})().catch(error=>{console.error(error);process.exitCode=1;});
