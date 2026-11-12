'use strict';
// 4writers now auto-clicks ONLY Take it on a verified available order.
// Native Are you sure?, OK and I understand must remain manual.
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,
  '../extension/dual-writers/legacy/four/runtime-content.js'),'utf8');
assert.match(source,/const TAKE = \/\^take\\s\*it/);
assert.match(source,/function matchedDetailsPanel\(claim\)/);
assert.match(source,/async function scrollOpenedOrder\(claim\)/);
assert.match(source,/async function stopHandoff\(claim,stage,message\)/);
assert.match(source,/take\.click\(\)/);
assert.match(source,/state\.armed=false;\s*state\.claim=null;/);
assert.doesNotMatch(source,/find\(OK\)|find\(ACCEPT\)/);
assert.doesNotMatch(source,/clickStage\(|scrollAcknowledgment\(/);
assert.doesNotMatch(source,/dispatchEvent\(new Event\(['"]prowell-order-confirm-arm/,
  'Browser Are you sure? confirmation cannot be auto-approved');
assert.doesNotMatch(source,/lastAcknowledgementScroll/,
  'No automated final acknowledgement');
console.log('4writers: View → verified scroll → Take it; OK, native confirm and I understand manual PASS');
