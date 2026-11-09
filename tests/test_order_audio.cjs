'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function run(slug){
  const sounds=[],listeners=[];
  class Audio{
    constructor(src){this.src=src;this.volume=1;}
    play(){sounds.push(this);return Promise.resolve();}
  }
  const chrome={runtime:{onMessage:{addListener(fn){listeners.push(fn);}}}};
  const code=fs.readFileSync(path.join(__dirname,'../extension',slug,'order-sound.js'),'utf8');
  vm.runInNewContext(code,{chrome,Audio,btoa,ArrayBuffer,DataView,Uint8Array,Math,String,console,Promise});
  const send=msg=>new Promise(resolve=>{
    const accepted=listeners.some(fn=>fn(msg,{},result=>resolve(result))===true);
    if(!accepted)throw Error('Offscreen message did not reach listener');
  });
  for(const kind of ['available','processing']){
    const result=await send({type:'PROWELL_PLAY_ORDER_SOUND',
      target:'prowell-offscreen-audio',kind});
    assert.equal(result.ok,true);
  }
  assert.equal(sounds.length,2);
  assert(sounds.every(s=>s.src.startsWith('data:audio/wav;base64,')));
  assert.notEqual(sounds[0].src,sounds[1].src,'Available and processing must have distinct melodies');
  assert(sounds.every(s=>s.volume>0));
  console.log(slug+': native WAV generation and playable order chime tests PASS');
}
(async()=>{for(const slug of ['4writers','good-writers'])await run(slug);})()
.catch(error=>{console.error(error);process.exitCode=1;});
