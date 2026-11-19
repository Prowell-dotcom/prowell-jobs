'use strict';
// Verify the user's archived engines are retained, but no legacy acceptance
// engine or website click can run in the current alert-only package.
const assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'../extension/dual-writers');
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'2.1.24');
assert.equal(manifest.content_scripts.length,4);
for(const site of ['four','good']){
  const host=site==='four'?'4writers.net':'good-writers.com';
  const active=manifest.content_scripts.find(item=>item.world!=='MAIN'&&
    item.matches.some(m=>m.includes(host)));
  assert(active,'Missing site-specific content script: '+site);
  const code=read('legacy/'+site+'/runtime-content.js');
  assert.match(code,/__prowellDualActionableCards=cards/);
  assert.match(code,/PROWELL_ORDER_SOUND/);
  assert.match(code,/__prowellDualStopRefresh/);
  assert.match(code,/using automated site parsers is prohibited/);
  assert.doesNotMatch(code,/\.click\s*\(|scrollTop\s*=|scrollTo\s*\(/,
    'Active bot must never click or scroll the website');
  new vm.Script(code);
  assert(active.js.includes('legacy/'+site+'/order-card.js'));
  assert(active.js.includes('legacy/'+site+'/runtime-content.js'));
  assert(active.js.includes('legacy-order-sound.js'));
  assert(read('legacy/'+site+'/content.js').length>0,
    'Archived legacy file must be retained for reference');
}
for(const disallowed of ['auto-accept.js','content.js','refresh.js']){
  assert(!manifest.content_scripts.flatMap(x=>x.js).includes(disallowed));
}
console.log('Dual legacy archive retained; active alert-only scripts have no website click PASS');
