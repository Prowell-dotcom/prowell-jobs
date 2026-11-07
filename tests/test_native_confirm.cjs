'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

for(const slug of ['4writers','good-writers']){
  const callbacks=new Map();
  let nativeCalls=0;
  const window={
    confirm(message){nativeCalls++;return false;},
    addEventListener(name,handler){callbacks.set(name,handler);},
    dispatchEvent(evt){callbacks.get(evt.type)?.(evt);return true;}
  };
  class Event {constructor(type){this.type=type;}}
  const source=fs.readFileSync(path.join(__dirname,'../extension',slug,'confirm-main.js'),'utf8');
  vm.runInNewContext(source,{window,Event,Date,String});
  assert.equal(window.confirm('Are you sure?'),false,'unarmed dialogs must be unchanged');
  assert.equal(nativeCalls,1);
  window.dispatchEvent(new Event('prowell-order-confirm-arm'));
  assert.equal(window.confirm('Are you sure you want to take this order?'),true,'armed order confirm auto-accept');
  assert.equal(nativeCalls,1,'arm should not invoke browser dialog');
  assert.equal(window.confirm('Are you sure?'),false,'arm must be consumed once');
  assert.equal(window.confirm('Delete account?'),false,'unrelated messages must be forwarded');
  window.dispatchEvent(new Event('prowell-order-confirm-arm'));
  assert.equal(window.confirm('Delete your profile?'),false,'unrelated message cannot be auto-approved');
  console.log(slug+' Take it native confirm is scoped, single-use and tested.');
}
