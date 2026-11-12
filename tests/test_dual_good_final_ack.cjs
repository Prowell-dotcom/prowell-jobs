'use strict';
// Good-Writers may scroll the VIEW order-details popup only, then STOP.
// The final after-OK acknowledgement is entirely human-controlled:
// no automated Take it, OK, I understand or second scroll.
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/legacy/good/runtime-content.js'),'utf8');
assert.match(src,/async function handoffToOwner\(card\)/);
assert.match(src,/view\.click\(\)/);
assert.match(src,/function scrollOpenedDetails\(claim\)/);
assert.match(src,/function instantScroll\(el\)/);
assert.match(src,/const SCROLL_STAGE='good-view-await-scroll'/);
assert.match(src,/state\.armed=false;state\.claim=null;/,
  'Monitoring must stop as soon as View details are scrolled');
for(const blocked of [
 /scrollAcknowledgment\(/, /clickStage\(/,
 /find\(TAKE\)/, /find\(OK\)/, /find\(ACCEPT\)/,
 /lastAcknowledgementScroll/, /button\.click\(\)/,
 /FAST_SCROLL_POSITIONS|FAST_SCROLL_FRAME_MS/
])assert.doesNotMatch(src,blocked,
  'Good-Writers must not click acceptance buttons or scroll after OK');
console.log('Good-Writers View popup: instant scroll then STOP; Take it, OK and I understand manual PASS');
