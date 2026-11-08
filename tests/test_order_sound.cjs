'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const version={ '4writers':'0.5.7','good-writers':'1.0.7' };
const host={ '4writers':'4writers.net','good-writers':'good-writers.com' };
const tabType={ '4writers':'PROWELL_TAB_ID','good-writers':'GW_TAB_ID' };

async function testWatcher(slug){
  const sent=[],listeners=[],cards=[];
  let changed=null,mutation=null;
  const run1='8a8b7c6d-4e5f-4a29-9012-123456789abc';
  const run2='9a8b7c6d-4e5f-4a29-9012-123456789abc';
  const tab=17,local={armed:true,claimConsentVersion:version[slug],targetTabId:tab,soundRunId:run1};
  const window={};window.top=window;window.__prowellCardDetector={cards:()=>cards};
  const chrome={
    runtime:{sendMessage(payload,callback){
      if(payload.type===tabType[slug])return callback({tabId:tab});
      sent.push(payload);callback?.({ok:true});
      return Promise.resolve({ok:true});
    }},
    storage:{
      local:{get:async()=>({...local})},
      onChanged:{addListener(fn){changed=fn;}}
    }
  };
  const document={addEventListener(){}};
  const context={window,document,chrome,setTimeout,
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},
    console};
  const src=fs.readFileSync(path.join(__dirname,'../extension',slug,'order-sound-watch.js'),'utf8');
  vm.runInNewContext(src,context);
  await new Promise(done=>setTimeout(done,1));
  assert.equal(sent.length,0,'No sound without an order');

  cards.push({type:'available',id:'0192065941'});
  mutation();
  assert.equal(sent.length,1,'Available card must notify immediately');
  assert.equal(sent[0].kind,'available');
  assert.equal(sent[0].orderId,'0192065941');
  assert.equal(sent[0].soundRunId,run1);
  mutation();mutation();
  assert.equal(sent.length,1,'Repeated DOM updates must not retrigger same order');

  cards.push({type:'processing',id:'0192065941'});
  mutation();
  assert.equal(sent.length,2,'Processing card is separately audible');
  assert.equal(sent[1].kind,'processing');
  cards.push({type:'available',id:'6447728953'});
  mutation();
  assert.equal(sent.length,3,'Second distinct available order must alert');
  local.armed=false;
  changed({armed:{newValue:false}},'local');
  cards.push({type:'processing',id:'77777777'});
  mutation();
  assert.equal(sent.length,3,'When stopped do not play further alerts');
  // A new START resets the deduplication epoch, even if the card remains.
  local.armed=true;local.soundRunId=run2;
  changed({armed:{newValue:true},soundRunId:{newValue:run2}},'local');
  assert.equal(sent.length,7,'Same cards must sound again when restarted');
  assert.equal(sent[3].soundRunId,run2);
  assert.equal(sent[3].kind,'available');
  assert.equal(sent[4].kind,'processing');
  assert.equal(sent[6].orderId,'77777777');
  // Removal and subsequent reappearance during a single run re-triggers.
  cards.splice(0,cards.length);
  mutation();
  cards.push({type:'processing',id:'0192065941'});
  mutation();
  assert.equal(sent.length,8,'Processing card that reappears must re-alert');
  assert(!sent.some(x=>x.type!=='PROWELL_ORDER_SOUND'));
  console.log(slug+': new/processing instant alerts, dedup and stop behavior PASS');
}

async function testBackground(slug){
  const notifications=[],handlers=[];
  const session={},prefix='chrome-extension://fakeid/';
  const chrome={
    runtime:{
      getURL:()=>prefix,
      onMessage:{addListener(fn){handlers.push(fn);}},
      sendMessage:async payload=>{
        notifications.push(payload);
        return {ok:true};
      }
    },
    offscreen:{
      hasDocument:async()=>notifications.some(x=>x.type==='offscreen-created'),
      createDocument:async()=>{notifications.push({type:'offscreen-created'});}
    },
    storage:{
      session:{
        get:async key=>({[key]:session[key]}),
        set:async values=>{Object.assign(session,values);}
      }
    }
  };
  const s=fs.readFileSync(path.join(__dirname,'../extension',slug,'order-sound-background.js'),'utf8');
  vm.runInNewContext(s,{chrome,Date,console,Promise});
  const sender={url:'https://'+host[slug]+'/free_orders/',tab:{id:20}};
  const send=(message,from=sender)=>new Promise(resolve=>{
    const handled=handlers.some(fn=>fn(message,from,result=>resolve(result))===true);
    if(!handled)throw Error('Alert message unhandled');
  });
  const run1='8a8b7c6d-4e5f-4a29-9012-123456789abc';
  const run2='9a8b7c6d-4e5f-4a29-9012-123456789abc';
  const msg=(kind,id,runId=run1)=>({type:'PROWELL_ORDER_SOUND',kind,orderId:id,soundRunId:runId});
  const first=await send(msg('available','6447728953'));
  assert.equal(first.played,true);
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,1);
  const repeated=await send(msg('available','6447728953'));
  assert.equal(repeated.played,false);
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,1);
  assert.equal((await send(msg('processing','6447728953'))).played,true);
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,2);
  assert.equal((await send(msg('available','0192065941'))).played,true);
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,3);
  assert.equal((await send(msg('available','6447728953',run2))).played,true,
    'New monitoring run must allow same order to sound again');
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,4);
  const rejected=await send(msg('available','23456789'),{url:'https://example.org',tab:{id:20}});
  assert.equal(rejected.ok,false);
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,4);
  const test=await send({type:'PROWELL_TEST_ORDER_SOUND'}, {url:prefix+'popup.html'});
  assert.equal(test.ok,true,'Popup Test Sound must play');
  assert.equal(notifications.filter(x=>x.type==='PROWELL_PLAY_ORDER_SOUND').length,5);
  console.log(slug+': background dedup, isolated order types, source verification and test sound PASS');
}

(async()=>{
  for(const slug of ['4writers','good-writers']){
    await testWatcher(slug);
    await testBackground(slug);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
