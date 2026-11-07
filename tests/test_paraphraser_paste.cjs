'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
async function run(){
 const nodes=new Map(),events={},intervals=[],timeouts=[],requests=[];
 function node(id){
   if(!nodes.has(id)){
     nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false,style:{},
       listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},
       dispatch(type){this.listeners[type]?.({preventDefault(){}});},
       focus(){},select(){}});
   }
   return nodes.get(id);
 }
 [
 'paraphraseForm','paraphraseInput','paraphraseOutput','paraphraseInputCount','paraphraseSubmit',
 'paraphraseOutputCount','paraphraseCopy','paraphraseDownload','paraphraseStatus',
 'privateParaphraserPanel','paraphraserShortcut','paraphraseTone','paraphraseClear'
 ].forEach(node);
 node('paraphraseTone').value='natural';
 const document={getElementById:node,hidden:false,addEventListener(name,fn){events['document:'+name]=fn;}};
 const window={addEventListener(name,fn){events['window:'+name]=fn;},
   prowellAdminSignedIn:()=>true,prowellAdminCsrf:()=> 'csrf-test'};
 const source=fs.readFileSync(path.join(__dirname,'../admin-paraphraser.js'),'utf8');
 vm.runInNewContext(source,{
  document,window,setInterval(fn){intervals.push(fn);return 1;},
  setTimeout(fn){timeouts.push(fn);return 1;},
  fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>({
    paraphrased:'The rewritten sentence is natural and clear.',outputWords:8
  })};},
  Blob,URL,console,navigator:{clipboard:{writeText:async()=>{}}}
 });
 const input=node('paraphraseInput'),button=node('paraphraseSubmit');
 assert.equal(button.disabled,true,'empty editor should disable button');
 // Mimic paste by browser extension: programmatically set value but emit no event.
 input.value='A sample paragraph with some naturally written sentences.';
 assert.equal(button.disabled,true,'button not yet synced');
 intervals.forEach(fn=>fn());
 assert.equal(node('paraphraseInputCount').textContent,'8 / 3,000 words');
 assert.equal(button.disabled,false,'pasted text must activate button');
 node('paraphraseForm').dispatch('submit');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1,'submit should send one request');
 assert.equal(requests[0].opts.headers['X-Admin-CSRF'],'csrf-test');
 assert.equal(JSON.parse(requests[0].opts.body).text,input.value);
 assert.match(node('paraphraseOutput').value,/rewritten sentence/);
 input.value=('word ').repeat(3001);
 intervals.forEach(fn=>fn());
 assert.equal(button.disabled,true,'over-limit should disable button');
 events['window:prowell-admin-session']({detail:{signedIn:false}});
 assert.equal(node('privateParaphraserPanel').hidden,true);
 assert.equal(button.disabled,true);
 console.log('Paraphraser eventless paste, word counter, submit and sign-out tests: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
