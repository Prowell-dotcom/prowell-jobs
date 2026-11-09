'use strict';
/* Verify per-site state isolation and instant, opt-in-only acceptance logic. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'../extension/dual-writers');
const source=name=>fs.readFileSync(path.join(dir,name),'utf8');
const manifest=JSON.parse(source('manifest.json'));
assert.equal(manifest.version,'2.0.4');
assert.equal(manifest.content_scripts.length,4);
assert(manifest.host_permissions.some(h=>h.includes('4writers.net')));
assert(manifest.host_permissions.some(h=>h.includes('good-writers.com')));
const jsFiles=['scoped-store.js','content.js','refresh.js','auto-accept.js',
 'background.js','popup.js','four-order-card.js','good-order-card.js','confirm-main.js',
 'order-sound-background.js','order-sound.js'];
for(const file of jsFiles)new vm.Script(source(file),{filename:file});
const auto=source('auto-accept.js');
assert.match(auto,/instantScroll\(root,bottom\)/);
assert.match(auto,/behavior:\s*'instant'/);
assert.doesNotMatch(auto,/STEP_DELAY|STEP_PX|await sleep\(/);
const content=source('content.js');
assert.match(content,/autoAcceptEnabled===true/);
assert.match(content,/first\.type==='processing'/);
assert.match(content,/mode:processing\?'processing-preview':accepts\?'accept':'scroll-only'/);
assert.doesNotMatch(content,/setTimeout\s*\(/);
const refresh=source('refresh.js');
assert.match(refresh,/const interval = 1000/);
assert.match(refresh,/store\.local\.set/);
assert.match(source('background.js'),/dual_four_/);
assert.match(source('background.js'),/dual_good_/);
(async()=>{
 const data={};const observers=[];
 const chrome={storage:{local:{
  async get(keys){
   const result={};for(const key of keys)
    if(Object.hasOwn(data,key))result[key]=data[key];
   return result;
  },
  async set(patch){
   Object.assign(data,patch);
   const changed=Object.fromEntries(Object.entries(patch)
     .map(([key,value])=>[key,{newValue:value}]));
   for(const listener of observers)listener(changed,'local');
  },
  async remove(keys){for(const key of keys)delete data[key];}
 },onChanged:{addListener(fn){observers.push(fn);}}}};
 function make(hostname){
  const window={};
  vm.runInNewContext(source('scoped-store.js'),
   {location:{hostname},window,chrome});
  return window.__prowellDualStorage;
 }
 const four=make('4writers.net'),good=make('good-writers.com');
 assert.equal(four.site,'four');assert.equal(good.site,'good');
 const seenFour=[],seenGood=[];
 four.onChanged.addListener(d=>seenFour.push(Object.keys(d)));
 good.onChanged.addListener(d=>seenGood.push(Object.keys(d)));
 await four.local.set({armed:true,autoAcceptEnabled:true,autoFlow:{orderId:'12345'}});
 await good.local.set({armed:false,autoAcceptEnabled:false,autoFlow:null});
 assert.equal((await four.local.get({armed:false})).armed,true);
 assert.equal((await good.local.get({armed:true})).armed,false);
 assert.equal(data.dual_four_autoAcceptEnabled,true);
 assert.equal(data.dual_good_autoAcceptEnabled,false);
 assert.equal(seenFour.length,1);
 assert.equal(seenGood.length,1);
 await four.local.set({armed:false});
 assert.equal((await good.local.get({armed:true})).armed,false);
 assert.equal(seenGood.length,1);
 console.log('Dual-platform state isolation, instant scrolling, and opt-in controls: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
