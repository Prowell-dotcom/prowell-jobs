'use strict';
// Good-Writers final acknowledgements are HUMAN-ONLY in handoff mode.
// Even if the website shows a Take it, OK or I understand button, this
// active engine must never scroll or click any acceptance control.
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/legacy/good/runtime-content.js'),'utf8');
assert.match(src,/async function handoffToOwner\(card\)/);
assert.match(src,/view\.click\(\)/,'Only View is clicked automatically');
for(const blocked of [
 /scrollOpenedOrder\(/, /scrollAcknowledgment\(/,
 /rapidScroll\(/, /rapidTargets\(/, /scrollTop\s*=/,
 /clickStage\(/, /find\(TAKE\)/, /find\(OK\)/, /find\(ACCEPT\)/,
 /lastAcknowledgementScroll/
])assert.doesNotMatch(src,blocked,'No post-View automated scrolling or acceptance');
console.log('Good-Writers final acknowledgement: human only, no bot scroll/click PASS');
