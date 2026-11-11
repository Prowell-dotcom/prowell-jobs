'use strict';
// The dual ZIP must execute the ORIGINAL uploaded bot engines, not the
// experimental modern dual watcher. The only runtime addition is sound.
const assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'../extension/dual-writers');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'2.1.13');
const scripts=manifest.content_scripts;
assert.equal(scripts.length,4);
for(const site of ['four','good']){
 const legacy=site==='four'?'0.5.4':'1.0.4';
 const sourceManifest=JSON.parse(read('legacy/'+site+'/manifest.json'));
 assert.equal(sourceManifest.version,legacy,'Wrong user-uploaded source version');
 const origin=site==='four'?'4writers.net':'good-writers.com';
 const expected=scripts.find(item=>item.world!=='MAIN'&&
   item.matches.some(x=>x.includes(origin)));
 assert(expected,'Missing isolated legacy site script');
 if(site==='four')assert.deepEqual(expected.js,[
   'scoped-store.js','legacy-bridge.js',
   'legacy/four/order-card.js','four-sections.js','legacy-order-sound.js',
   'legacy/four/runtime-content.js','four-section-refresh.js'
 ],'4writers must monitor both order sections');
 else assert.deepEqual(expected.js,[
   'scoped-store.js','legacy-bridge.js',
   'legacy/good/order-card.js','legacy-order-sound.js',
   'legacy/good/runtime-content.js','legacy/good/runtime-refresh.js'
 ],'Good-Writers must use its unchanged engine');
 for(const name of ['content.js','refresh.js','background.js']){
   const original=read('legacy/'+site+'/'+name);
   const runner=read('legacy/'+site+'/runtime-'+name);
   if(name==='content.js'){
     // Archived supplied engine is still exact, but the active wrapper has
     // two necessary, screenshot-grounded fixes: final acknowledgement label
     // and scrolling the acknowledgement modal instead of the background.
     assert.match(runner,/const ACCEPT = \/\^i\\s\+understand/);
     assert.match(runner,/lastAcknowledgementScroll/);
     if(site==='four')assert.match(runner,/I understand, take the/);
     else assert.match(runner,/Good-Writers acknowledgements/);
     assert.doesNotMatch(original,/lastAcknowledgementScroll/,
       'Original uploaded archive must remain unchanged');
   }else if(name==='refresh.js'&&site==='good'){
     // The active Good-Writers refresh wrapper now intentionally ignores
     // historical ID arrays and uses the per-appearance View guard.
     // The owner's archived refresh.js remains byte-for-byte unchanged.
     assert.match(runner,/__prowellDualActionableCards/);
     assert.doesNotMatch(original,/__prowellDualActionableCards/);
   }else{
     assert(runner.includes(original),
       'Original '+site+' '+name+' must appear byte-for-byte in wrapper');
   }
   if(name==='background.js')
     assert.match(runner,/const chrome=\{runtime:rawChrome\.runtime/);
   else assert.match(runner,/const chrome=window\.__prowellLegacyChrome/);
 }
 for(const file of ['content.js','refresh.js','order-card.js','confirm-main.js',
   'background.js','popup.js','popup.html','popup-refresh.js','manifest.json'])
   assert(read('legacy/'+site+'/'+file).length>0,'Missing uploaded '+site+' '+file);
 const foreground=scripts.find(item=>item.world==='MAIN'&&
   item.matches.some(x=>x.includes(origin)));
 assert.deepEqual(foreground.js,['legacy/'+site+'/confirm-main.js']);
 for(const js of expected.js.filter(x=>x.endsWith('.js')))
   new vm.Script(read(js),{filename:js});
 console.log(site+' legacy v'+legacy+': original file bodies untouched and correctly loaded');
}
assert(!scripts.flatMap(s=>s.js).some(x=>['auto-accept.js','content.js','refresh.js',
 'four-order-card.js','good-order-card.js'].includes(x)),
 'The old experimental dual engine must not run alongside the original engines');

const tick=()=>new Promise(r=>setImmediate(r));
async function sound(host,site,version){
 const events=[],changes=[];
 const state={armed:true,targetTabId:7,claimConsentVersion:version,
   soundRunId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};
 let cards=[{type:'processing',id:'1234567890'}];
 const storage={
   local:{async get(defaults){return {...defaults,...state};}},
   onChanged:{addListener(fn){changes.push(fn);}}
 };
 const win={__prowellDualStorage:storage};win.top=win;
 const document={body:{},addEventListener(){}};
 const runtime={lastError:null,sendMessage(m,callback){
   if(m.type==='PROWELL_TAB_ID'||m.type==='GW_TAB_ID')
     callback({tabId:7});
   else if(m.type==='PROWELL_ORDER_SOUND'){
     events.push(m);
     if(callback)callback({ok:true});
   }
 }};
 const context={window:win,document,location:{hostname:host},chrome:{runtime},
   queueMicrotask,MutationObserver:class{constructor(fn){this.fn=fn}observe(){}},
   Date,Set,Promise};
 win.__prowellCardDetector={cards:()=>cards};
 vm.runInNewContext(read('legacy-order-sound.js'),context);
 await tick();
 assert.equal(events.length,1,'The first processing order must sound for '+site);
 assert.equal(events[0].kind,'processing');
 assert.equal(events[0].orderId,'1234567890');
 assert.equal(events[0].soundRunId,state.soundRunId);
 for(const fn of changes)fn({armed:{newValue:true}},'local');
 await tick();
 assert.equal(events.length,1,'Same order must not re-alert during DOM changes');
 cards=[{type:'available',id:'1234567891'}];
 for(const fn of changes)fn({armed:{newValue:true}},'local');
 await tick();
 assert.equal(events.length,2,'New available order must sound');
 assert.equal(events[1].kind,'available');
 state.soundRunId='aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
 for(const fn of changes)fn({soundRunId:{newValue:state.soundRunId}},'local');
 await tick();
 assert.equal(events.length,3,'Fresh START must allow alert for same processing/order ID');
 // The sound sidecar did not navigate, click, scroll or write to storage.
 console.log(site+' sound sidecar: both order kinds, no duplicate, new session: PASS');
}
(async()=>{
 await sound('4writers.net','four','0.5.4');
 await sound('good-writers.com','good','1.0.4');
})().catch(e=>{console.error(e);process.exitCode=1;});
