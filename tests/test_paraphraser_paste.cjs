'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function run(){
  const html=fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');
  assert.match(html,/id="paraphraseSubmit"(?!\s+disabled)/);
  assert(html.includes('admin.js?v=verified-editor-v11'));
  assert(!html.includes('<script src="admin-paraphraser.js'), 'No competing paraphraser script should load');
  const full=fs.readFileSync(path.join(__dirname,'../admin.js'),'utf8');
  const start=full.indexOf('// BEGIN PRIVATE PARAPHRASER');
  assert(start>0,'The paraphraser handler must be in admin.js');
  const code=full.slice(start);

  assert(html.includes('value="student"'), 'Student writing style must be visible');
  assert(html.includes('value="local" selected'), 'No-API local engine must be the default');
  const nodes={}, timed=[],listeners={},posts=[];
  let fail=false;
  function node(id){
    if(!nodes[id]){
      nodes[id]={
        value:'',textContent:'',disabled:false,hidden:false,style:{},
        listeners:{},addEventListener(name,cb){this.listeners[name]=cb;},
        dispatch(name){return this.listeners[name]?.({preventDefault(){}});},
        focus(){},select(){},appendChild(){},remove(){}
      };
    }
    return nodes[id];
  }
  const ids=['paraphraseForm','paraphraseInput','paraphraseOutput','paraphraseSubmit',
    'paraphraseStatus','paraphraseInputCount','paraphraseOutputCount',
    'paraphraseCopy','paraphraseDownload','paraphraseTone','paraphraseClear',
    'privateParaphraserPanel','paraphraserShortcut','paraphraseProtectedTerms','paraphraseEngine'];
  ids.forEach(node);
  node('paraphraseTone').value='student';
  node('paraphraseEngine').value='local';
  const document={
    hidden:false,getElementById:node,
    addEventListener(name,cb){listeners['document:'+name]=cb;}
  };
  const window={
    addEventListener(name,cb){listeners['window:'+name]=cb;}
  };
  let signedIn=true,csrfToken='csrf123';
  const api=async(request,opts)=>{
    posts.push({request,opts});
    if(fail)throw Error('Gemini connection or quota problem.');
    return {paraphrased:'The revised paragraph reads naturally and clearly.'};
  };
  vm.runInNewContext(code,{document,window,api,URL,Blob,AbortController,Date,
    signedIn,csrfToken,setInterval(cb){timed.push(cb);return 1;},
    setTimeout(cb){timed.push(cb);return 1;},clearInterval(){},clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},
    console});
  const input=node('paraphraseInput'),button=node('paraphraseSubmit'),form=node('paraphraseForm');
  assert.equal(button.disabled,false,'Button must always be clickable when idle');
  form.dispatch('submit');
  assert.match(node('paraphraseStatus').textContent,/Paste or type/);
  assert.equal(posts.length,0);

  node('paraphraseProtectedTerms').value='metformin';
  input.value='First paragraph is deliberately added with metformin without an input event.';
  timed[0]();
  assert.equal(button.disabled,false);
  assert.equal(node('paraphraseInputCount').textContent,'11 / 3,000 words');
  form.dispatch('submit');
  assert.equal(button.disabled,true,'Button must be disabled only during a request');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts.length,1,'Clicking must actually submit the server API request');
  assert.equal(posts[0].request,'/api/admin/paraphrase');
  assert.equal(posts[0].opts.method,'POST');
  assert.equal(JSON.parse(posts[0].opts.body).protectedTerms,'metformin');
  assert.equal(JSON.parse(posts[0].opts.body).tone,'student');
  assert.equal(JSON.parse(posts[0].opts.body).engine,'local');
  assert.equal(posts[0].opts.body.includes(input.value),true);
  assert.equal(button.disabled,false);
  assert.match(node('paraphraseOutput').value,/revised paragraph/);

  fail=true;
  input.value='Second example text should show a clear backend error.';
  form.dispatch('submit');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(node('paraphraseStatus').textContent,/Paraphrasing failed: Gemini connection or quota problem/);
  assert.match(node('paraphraseOutput').placeholder,/No result generated/);
  assert.equal(button.disabled,false,'Button must reset after server error');
  fail=false;

  input.value=('word ').repeat(3001);
  timed[0]();
  assert.equal(button.disabled,false,'Over-length input must show error rather than dead button');
  form.dispatch('submit');
  assert.match(node('paraphraseStatus').textContent,/Maximum 3,000 words/);
  assert.equal(posts.length,2, 'Error case sends a request but over-limit text does not');
  assert.equal(typeof window.updateProwellParaphraser,'function');
}
run().then(()=>console.log('Paraphraser button click and API request simulation PASS'))
  .catch(error=>{console.error(error);process.exitCode=1;});
