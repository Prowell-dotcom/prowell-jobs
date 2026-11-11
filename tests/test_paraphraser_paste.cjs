'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');

async function run(){
 const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const admin=fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../public-paraphraser.js'),'utf8');
 assert(index.includes('id="publicParaphraseForm"'));
 assert(index.includes('public-paraphraser.js?v=humanizer-v2'));
 assert(!admin.includes('id="paraphraseForm"'));
 assert(index.includes('Prowell <span>Humanizer.</span>'));
 assert(index.includes('id="prowell-humanizer-critical-styles"'));
 assert(index.includes('min-height:380px'));
 assert(index.includes('original administrator studio presentation'));
 assert(index.includes('grid-template-columns:minmax(0,1fr);gap:22px'));
 assert(index.includes('height:300px'));
 assert(index.includes('background:#5355e5'));
 assert(index.includes('class="pp-columns"'));
 assert(index.includes('Humanize text'));
 const nodes={};
 const clicks=[];
 const make=id=>{
  if(nodes[id])return nodes[id];
  const n={id,value:'',textContent:'',placeholder:'',disabled:false,
   dataset:{},style:{},
   classList:{toggle(){}},
   events:{},
   addEventListener(event,fn){this.events[event]=fn},
   dispatch(event){return this.events[event]?.({preventDefault(){}})},
   focus(){},select(){},remove(){},
  };
  nodes[id]=n;return n;
 };
 [
  'publicParaphraseForm','publicParaphraseInput','publicParaphraseOutput',
  'publicParaphraseSubmit','publicParaphraseStatus','publicParaphraseCount',
  'publicParaphraseTone','publicParaphraseProtectedTerms',
  'publicParaphraseClear','publicParaphraseCopy','publicParaphraseDownload'
 ].forEach(make);
 const doc={getElementById:make,
  body:{appendChild(obj){clicks.push(obj)}},
  createElement(){return{click(){},remove(){}}}
 };
 make('publicParaphraseTone').value='student';
 let error=null;
 const requests=[];
 const fetch=async (url,options)=>{
  requests.push({url,options});
  if(error)return{ok:false,status:error.code,async json(){return{error:error.message}}};
  return{ok:true,status:200,async json(){
   return{paraphrased:'Nurses contacted patients regularly.',
    editStrength:'Moderate',editableTextChangePercent:28};
  }};
 };
 let copied='';
 const globalVars={document:doc,fetch,console,
  AbortController,
  navigator:{clipboard:{async writeText(value){copied=value}}},
  Blob:class{},
  URL:{createObjectURL:()=>'blob:mock',revokeObjectURL(){}},
  setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(js,globalVars);
 const form=make('publicParaphraseForm'),input=make('publicParaphraseInput');
 const output=make('publicParaphraseOutput'),button=make('publicParaphraseSubmit');
 await form.dispatch('submit');
 assert.match(make('publicParaphraseStatus').textContent,/Paste or type/);
 assert.equal(requests.length,0);
 input.value='It is important to note that nurses contacted patients on a regular basis.';
 make('publicParaphraseProtectedTerms').value='metformin';
 await form.dispatch('submit');
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/paraphrase');
 assert.equal(requests[0].options.method,'POST');
 assert.equal(requests[0].options.credentials,'omit');
 const body=JSON.parse(requests[0].options.body);
 assert.equal(body.engine,'local');
 assert.equal(body.tone,'student');
 assert.equal(body.protectedTerms,'metformin');
 assert.equal(output.value,'Nurses contacted patients regularly.');
 assert.equal(button.disabled,false);
 assert.match(make('publicParaphraseStatus').textContent,/Moderate edit/);
 assert.equal(make('publicParaphraseCopy').disabled,false);
 await make('publicParaphraseCopy').dispatch('click');
 assert.equal(copied,output.value);
 error={code:422,message:'This passage needs context-sensitive rewriting.'};
 input.value='This sentence cannot safely be changed.';
 await form.dispatch('submit');
 assert.equal(requests.length,2);
 assert.equal(output.value,'');
 assert.match(make('publicParaphraseStatus').textContent,/context-sensitive/);
 assert.equal(button.disabled,false);
 error=null;
 input.value=('word ').repeat(3001);
 await form.dispatch('submit');
 assert.equal(requests.length,2);
 assert.match(make('publicParaphraseStatus').textContent,/Maximum 3,000 words/);
 await make('publicParaphraseClear').dispatch('click');
 assert.equal(input.value,'');
 assert.equal(output.value,'');
 console.log('Prowell Humanizer homepage, styling and browser interactions: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
