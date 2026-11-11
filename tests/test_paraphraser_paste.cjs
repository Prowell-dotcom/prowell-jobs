'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');

async function run(){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const admin=fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');
 const maintained=fs.readFileSync(path.join(__dirname,'../public-paraphraser.js'),'utf8').trim();
 const script=html.match(/<script id="prowell-humanizer-inline">\s*([\s\S]*?)<\/script>/);
 assert(script,'The public page must include its own working Humanizer script');
 const code=script[1].trim();
 assert.equal(code,maintained,'The inline working code must match the tested file');
 assert(html.includes('id="publicParaphraseForm"'));
 assert(html.includes('novalidate onsubmit="return false;"'),
   'Even if initialization fails, native browser form submission must be prevented');
 assert(!html.includes('src="public-paraphraser.js'),
   'A failed external script request must not break the public form');
 assert(!admin.includes('id="paraphraseForm"'));
 assert(html.includes('Prowell <span>Humanizer.</span>'));
 assert(html.includes('id="prowell-humanizer-critical-styles"'));
 assert(html.includes('original administrator studio presentation'));
 assert(html.includes('grid-template-columns:minmax(0,1fr);gap:22px'));
 assert(html.includes('height:300px'));
 assert(html.includes('background:#5355e5'));
 assert(html.includes('Humanize text'));

 const store=new Map();
 const sessionStorage={
  setItem(key,val){store.set(key,String(val))},
  getItem(key){return store.get(key)||null},
  removeItem(key){store.delete(key)}
 };
 const requests=[],events=[];
 let responseError=null,copyText='';
 function launch(){
  const nodes={};
  const create=id=>{
   if(nodes[id])return nodes[id];
   const n={id,value:'',textContent:'',placeholder:'',disabled:false,
    dataset:{},style:{},classList:{toggle(){}},events:{},
    addEventListener(name,handler){this.events[name]=handler},
    dispatch(name){
     let prevented=false;
     const pending=this.events[name]?.({preventDefault(){prevented=true}});
     return{pending,wasPrevented:()=>prevented};
    },
    focus(){},select(){},remove(){}
   };
   nodes[id]=n;
   return n;
  };
  for(const id of ['publicParaphraseForm','publicParaphraseInput','publicParaphraseOutput',
    'publicParaphraseSubmit','publicParaphraseStatus','publicParaphraseCount',
    'publicParaphraseTone','publicParaphraseProtectedTerms','publicParaphraseClear',
    'publicParaphraseCopy','publicParaphraseDownload'])create(id);
  create('publicParaphraseTone').value='student';
  create('publicParaphraseTone').options=['natural','student','simple','academic','professional'].map(value=>({value}));
  const document={getElementById:create,
    body:{appendChild(){}},
    createElement(){return{click(){},remove(){}}}
  };
  const window={addEventListener(name,handler){events.push({name,handler})}};
  const fetch=async (url,options)=>{
   requests.push({url,options});
   if(responseError)return{ok:false,status:responseError.code,async json(){return{error:responseError.message}}};
   return{ok:true,status:200,async json(){
    return{paraphrased:'Nurses contacted patients regularly.',
     editStrength:'Moderate',editableTextChangePercent:28};
   }};
  };
  vm.runInNewContext(code,{
   document,window,fetch,console,sessionStorage,AbortController,
   navigator:{clipboard:{async writeText(value){copyText=value}}},
   Blob:class{},URL:{createObjectURL:()=>'blob:mock',revokeObjectURL(){}},
   setTimeout:()=>1,clearTimeout(){}
  });
  return{node:create,window};
 }

 let ui=launch();
 let form=ui.node('publicParaphraseForm');
 let input=ui.node('publicParaphraseInput');
 assert.match(ui.node('publicParaphraseStatus').textContent,/Ready to improve/);
 let submission=form.dispatch('submit');
 await submission.pending;
 assert(submission.wasPrevented(),'No text should also prevent navigation');
 assert.match(ui.node('publicParaphraseStatus').textContent,/Paste or type/);
 assert.equal(requests.length,0);

 input.value='It is important to note that nurses contacted patients on a regular basis.';
 ui.node('publicParaphraseProtectedTerms').value='metformin';
 ui.node('publicParaphraseTone').value='student';
 input.dispatch('input');
 assert.equal(JSON.parse(store.get('prowell-humanizer-draft-v1')).text,input.value);
 submission=form.dispatch('submit');
 await submission.pending;
 assert(submission.wasPrevented(),'Real submit must call preventDefault');
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/paraphrase');
 assert.equal(requests[0].options.credentials,'omit');
 const payload=JSON.parse(requests[0].options.body);
 assert.equal(payload.tone,'student');
 assert.equal(payload.engine,'local');
 assert.equal(payload.protectedTerms,'metformin');
 assert.equal(ui.node('publicParaphraseOutput').value,'Nurses contacted patients regularly.');
 assert.match(ui.node('publicParaphraseStatus').textContent,/Moderate edit/);
 await ui.node('publicParaphraseCopy').dispatch('click').pending;
 assert.equal(copyText,ui.node('publicParaphraseOutput').value);
 assert.equal(ui.node('publicParaphraseSubmit').disabled,false);

 // Simulate the exact reported failure: reload after writing.
 ui=launch();form=ui.node('publicParaphraseForm');input=ui.node('publicParaphraseInput');
 assert.equal(input.value,payload.text,'Original text must survive a tab refresh');
 assert.equal(ui.node('publicParaphraseProtectedTerms').value,'metformin');
 assert.equal(ui.node('publicParaphraseTone').value,'student');
 assert.match(ui.node('publicParaphraseStatus').textContent,/unsent writing/);

 responseError={code:422,message:'This passage needs context-sensitive rewriting.'};
 input.value='Another example which the rules cannot safely rewrite.';
 const fail=form.dispatch('submit');
 await fail.pending;
 assert(fail.wasPrevented(),'Backend failure must not navigate away');
 assert.equal(requests.length,2);
 assert.equal(ui.node('publicParaphraseOutput').value,'');
 assert.match(ui.node('publicParaphraseStatus').textContent,/context-sensitive/);
 assert.equal(input.value,'Another example which the rules cannot safely rewrite.',
   'Original input must never be erased when rewriting fails');
 responseError=null;

 input.value=('word ').repeat(3001);
 const excessive=form.dispatch('submit');
 await excessive.pending;
 assert(excessive.wasPrevented());
 assert.equal(requests.length,2);
 assert.match(ui.node('publicParaphraseStatus').textContent,/Maximum 3,000 words/);

 await ui.node('publicParaphraseClear').dispatch('click').pending;
 assert.equal(input.value,'');
 assert.equal(ui.node('publicParaphraseOutput').value,'');
 assert.equal(store.has('prowell-humanizer-draft-v1'),false);
 console.log('Prowell Humanizer inline startup, no navigation, draft restore, errors: PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
