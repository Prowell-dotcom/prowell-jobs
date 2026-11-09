'use strict';
// Static regression checks for zero intentional delays. The dynamic modal and
// confirmation execution is covered by test_view_navigation_scroll.cjs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
for(const slug of ['4writers','good-writers']){
  const dir=path.join(__dirname,'../extension',slug);
  const auto=fs.readFileSync(path.join(dir,'auto-accept.js'),'utf8');
  const content=fs.readFileSync(path.join(dir,'content.js'),'utf8');
  assert.match(auto,/instantScroll\(root,bottom\)/);
  assert.match(auto,/behavior:\s*'instant'/);
  assert.match(auto,/el\.click\(\)/);
  assert.match(auto,/new MutationObserver\(inspect\)/);
  assert.doesNotMatch(auto,/STEP_DELAY|STEP_PX|await sleep\(/);
  assert.doesNotMatch(content,/setTimeout\s*\(/);
  assert.match(content,/first\.view\.click\(\)/);
  assert.match(content,/mode:accepts\?'accept':'scroll-only'/);
  console.log(slug+': instant scrolling and event-driven Take it / OK / acknowledgement: PASS');
}
