'use strict';
// The dual popup must match the user's supplied screenshots: exactly one
// site name with the proper separate handoff START control and STOP button, without
// the old walls of status text. All workflow scripts stay in the manifest.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=path.join(__dirname,'../extension/dual-writers');
const html=fs.readFileSync(path.join(base,'popup.html'),'utf8');
const js=fs.readFileSync(path.join(base,'popup.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
assert.equal(manifest.version,'2.1.17');
const visible=html
  .replace(/<style>[\s\S]*?<\/style>/g,'')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
assert.equal((visible.match(/<h2>/g)||[]).length,2);
assert.match(visible,/<h2>4writers\.net<\/h2>/);
assert.match(visible,/<h2>good-writers\.com<\/h2>/);
assert.equal((visible.match(/<button\b/g)||[]).length,4);
assert.equal((visible.match(/>START WATCH<\/button>/g)||[]).length,1);
assert.equal((visible.match(/>START TO TAKE<\/button>/g)||[]).length,1);
assert.equal((visible.match(/>STOP<\/button>/g)||[]).length,2);
for(const site of ['four','good']){
  assert.match(visible,new RegExp('data-start="'+site+'"'));
  assert.match(visible,new RegExp('data-stop="'+site+'"'));
}
for(const obsolete of [
  /data-status=/, /id="testSound"/, /id="notice"/,
  /<h1>/, /<small>/, /<p(?:\s|>)/,
  /Writings \+ Rewritings monitored/, /Version 2\.1\./
])assert.doesNotMatch(visible,obsolete,'No detailed controls or explanations in the popup');
assert.match(html,/id="sr-notice" class="sr-only"/,'Non-visual feedback remains accessible');
assert.match(html,/width:248px/,'Popup should be less than half its earlier width');
assert.match(html,/height:27px/,'Buttons should be half their earlier height');
assert.match(html,/font:700 10px/,'Small button text must fit compact controls');
assert.match(html,/gap:6px/,'Compact buttons should remain separate');
assert.doesNotMatch(html,/width:490px|height:54px/,'Old oversized controls must be gone');
assert.match(js,/autoAcceptEnabled:false,armed:true/,'START watches orders but forbids automatic acceptance');
assert.match(js,/autoAcceptEnabled:false/,'STOP must disable automation');
assert.match(js,/PROWELL_PREPARE_ORDER_SOUND/,'Starting must still prepare audio');
assert.match(js,/claimConsentVersion:SITES\[site\]\.legacyVersion/);
assert.match(js,/soundRunId:crypto\.randomUUID\(\)/);
assert.match(js,/fourLastCheckedSection/,'4writers refresh settings must be preserved');
for(const script of manifest.content_scripts){
  assert(!script.js.includes('popup.js'),'Popup must not replace content scripts');
}
assert(manifest.content_scripts.some(x=>x.js.includes('legacy/four/runtime-content.js')));
assert(manifest.content_scripts.some(x=>x.js.includes('legacy/good/runtime-content.js')));
assert(manifest.content_scripts.some(x=>x.js.includes('four-section-refresh.js')));
assert(manifest.content_scripts.some(x=>x.js.includes('legacy/good/runtime-refresh.js')));
console.log('Dual popup: 4writers START TO TAKE, Good-Writers START WATCH; four compact controls PASS');
