'use strict';
// The dual extension keeps original per-site engines and isolates storage.
const assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('node:vm'),path=require('node:path');
const dir=path.join(__dirname,'../extension/dual-writers');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'2.1.2');
assert.equal(manifest.content_scripts.length,4);
assert(manifest.host_permissions.some(h=>h.includes('4writers.net')));
assert(manifest.host_permissions.some(h=>h.includes('good-writers.com')));
const files=['scoped-store.js','legacy-bridge.js','legacy-order-sound.js',
 'four-sections.js','four-section-refresh.js',
 'background.js','popup.js','order-sound-background.js','order-sound.js',
 'legacy/four/runtime-content.js','legacy/four/runtime-refresh.js',
 'legacy/four/order-card.js','legacy/four/confirm-main.js',
 'legacy/good/runtime-content.js','legacy/good/runtime-refresh.js',
 'legacy/good/order-card.js','legacy/good/confirm-main.js',
 'legacy/four/runtime-background.js','legacy/good/runtime-background.js'];
for(const file of files)new vm.Script(read(file),{filename:file});
const sources=manifest.content_scripts.flatMap(s=>s.js);
for(const site of ['four','good']){
 for(const file of ['runtime-content.js','order-card.js','confirm-main.js'])
   assert(sources.includes('legacy/'+site+'/'+file));
}
assert(sources.includes('four-section-refresh.js'));
assert(sources.includes('legacy/good/runtime-refresh.js'));
assert(!sources.includes('legacy/four/runtime-refresh.js'));
assert(!sources.includes('auto-accept.js'));
assert(!sources.includes('content.js'));
assert(!sources.includes('refresh.js'));
assert(sources.filter(x=>x==='legacy-order-sound.js').length===2);
(async()=>{
 const data={},observers=[];
 const chrome={storage:{local:{
   async get(keys){return Object.fromEntries(keys.filter(k=>Object.hasOwn(data,k))
     .map(k=>[k,data[k]]));},
   async set(patch){
     Object.assign(data,patch);
     const changed=Object.fromEntries(Object.entries(patch)
       .map(([k,v])=>[k,{newValue:v}]));
     for(const listener of observers)listener(changed,'local');
   },
   async remove(keys){for(const k of keys)delete data[k];}
 },onChanged:{addListener(fn){observers.push(fn);}}}};
 function make(hostname){
   const window={};
   vm.runInNewContext(read('scoped-store.js'),{
     window,chrome,location:{hostname}
   });
   return window.__prowellDualStorage;
 }
 const four=make('4writers.net'),good=make('good-writers.com');
 assert.equal(four.site,'four');
 assert.equal(good.site,'good');
 const changesFour=[],changesGood=[];
 four.onChanged.addListener(c=>changesFour.push(Object.keys(c)));
 good.onChanged.addListener(c=>changesGood.push(Object.keys(c)));
 await four.local.set({armed:true,claimConsentVersion:'0.5.4',claim:{id:'123456'}});
 await good.local.set({armed:false,claimConsentVersion:'1.0.4',claim:null});
 assert.equal((await four.local.get({armed:false})).armed,true);
 assert.equal((await good.local.get({armed:true})).armed,false);
 assert.equal(data.dual_four_claimConsentVersion,'0.5.4');
 assert.equal(data.dual_good_claimConsentVersion,'1.0.4');
 assert.equal(changesFour.length,1);
 assert.equal(changesGood.length,1);
 await four.local.set({armed:false});
 assert.equal((await good.local.get({armed:true})).armed,false);
 assert.equal(changesGood.length,1);
 console.log('Dual original engines: syntax, correct injection and site isolation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
