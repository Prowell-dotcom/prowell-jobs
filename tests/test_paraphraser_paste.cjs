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
 assert(html.includes('id="publicParaphraseAgain"'));
 assert(html.includes('Rehumanize text'));
 assert(html.includes('Your original passage remains unchanged.'));
 assert(html.includes('id="publicParaphraseLevel"'));
 assert(html.includes('min="1" max="10" step="1" value="9"'));
 assert(html.includes('Paraphrasing depth'));


 const store=new Map();
 const sessionStorage={
  setItem(key,val){store.set(key,String(val))},
  getItem(key){return store.get(key)||null},
  removeItem(key){store.delete(key)}
 };
 const requests=[],events=[];
 let responseError=null,copyText='';
 let replyText='Nurses contacted patients regularly.';
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
    'publicParaphraseSubmit','publicParaphraseAgain','publicParaphraseStatus','publicParaphraseCount',
    'publicParaphraseTone','publicParaphraseProtectedTerms','publicParaphraseClear',
    'publicParaphraseLevel','publicParaphraseLevelValue','publicParaphraseLevelDescription',
    'publicParaphraseCopy','publicParaphraseDownload'])create(id);
  create('publicParaphraseTone').value='student';
  create('publicParaphraseLevel').value='9';
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
    return{paraphrased:replyText,
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
 assert.equal(ui.node('publicParaphraseAgain').disabled,true,
   'Rehumanize must not be available before the first output');

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
 assert.equal(payload.mode,'first');
 assert.equal(payload.level,9,'Public tool must request the selected depth');
 assert.equal(payload.protectedTerms,'metformin');
 assert.equal(ui.node('publicParaphraseOutput').value,'Nurses contacted patients regularly.');
 assert.match(ui.node('publicParaphraseStatus').textContent,/Moderate edit/);
 await ui.node('publicParaphraseCopy').dispatch('click').pending;
 assert.equal(copyText,ui.node('publicParaphraseOutput').value);
 assert.equal(ui.node('publicParaphraseSubmit').disabled,false);
 assert.equal(ui.node('publicParaphraseAgain').disabled,false,
   'Rehumanize becomes clickable after a successful result');

 // Repeat processing uses the RESULT, not the original text.
 const original=input.value;
 replyText='The nurses regularly contacted the patients.';
 const second=ui.node('publicParaphraseAgain').dispatch('click');
 await second.pending;
 assert.equal(requests.length,2);
 const rebody=JSON.parse(requests[1].options.body);
 assert.equal(rebody.mode,'again');
 assert.equal(rebody.attempt,1);
 assert.equal(rebody.text,'Nurses contacted patients regularly.');
 assert.equal(rebody.originalText,original);
 assert.equal(rebody.level,9);
 assert.equal(input.value,original,'Original writing must be preserved');
 assert.equal(ui.node('publicParaphraseOutput').value,replyText);
 assert.match(ui.node('publicParaphraseStatus').textContent,/Rehumanized result updated/);
 assert.equal(ui.node('publicParaphraseAgain').disabled,false,
   'Rehumanize should remain available for another pass');

 // An unsuccessful rehumanization never erases the previous version.
 responseError={code:422,message:'No further safe rewording was available.'};
 const repeatError=ui.node('publicParaphraseAgain').dispatch('click');
 await repeatError.pending;
 assert.equal(requests.length,3);
 assert.equal(JSON.parse(requests[2].options.body).attempt,2);
 assert.equal(ui.node('publicParaphraseOutput').value,replyText);
 assert.match(ui.node('publicParaphraseStatus').textContent,/previous result was preserved/);
 assert.equal(ui.node('publicParaphraseAgain').disabled,false);
 responseError=null;

 // Cycling back to a previously seen version is not advertised as new.
 replyText='Nurses contacted patients regularly.';
 const repeatCycle=ui.node('publicParaphraseAgain').dispatch('click');
 await repeatCycle.pending;
 assert.equal(requests.length,4);
 assert.equal(ui.node('publicParaphraseOutput').value,
   'The nurses regularly contacted the patients.');
 assert.match(ui.node('publicParaphraseStatus').textContent,/earlier result/);
 replyText='Nurses contacted patients regularly.';

 // Simulate the exact reported failure: reload after writing.
 ui=launch();form=ui.node('publicParaphraseForm');input=ui.node('publicParaphraseInput');
 assert.equal(input.value,payload.text,'Original text must survive a tab refresh');
 assert.equal(ui.node('publicParaphraseProtectedTerms').value,'metformin');
 assert.equal(ui.node('publicParaphraseTone').value,'student');
 assert.equal(ui.node('publicParaphraseLevel').value,'9');
 assert.equal(ui.node('publicParaphraseOutput').value,
   'The nurses regularly contacted the patients.','Current version should survive refresh');
 assert.equal(ui.node('publicParaphraseAgain').disabled,false);
 assert.match(ui.node('publicParaphraseStatus').textContent,/unsent writing/);

 responseError={code:422,message:'This passage needs context-sensitive rewriting.'};
 input.value='Another example which the rules cannot safely rewrite.';
 const fail=form.dispatch('submit');
 await fail.pending;
 assert(fail.wasPrevented(),'Backend failure must not navigate away');
 assert.equal(requests.length,5);
 assert.equal(ui.node('publicParaphraseOutput').value,'');
 assert.match(ui.node('publicParaphraseStatus').textContent,/context-sensitive/);
 assert.equal(input.value,'Another example which the rules cannot safely rewrite.',
   'Original input must never be erased when rewriting fails');
 responseError=null;

 input.value=('word ').repeat(3001);
 const excessive=form.dispatch('submit');
 await excessive.pending;
 assert(excessive.wasPrevented());
 assert.equal(requests.length,5);
 assert.match(ui.node('publicParaphraseStatus').textContent,/Maximum 3,000 words/);

 await ui.node('publicParaphraseClear').dispatch('click').pending;
 assert.equal(input.value,'');
 assert.equal(ui.node('publicParaphraseOutput').value,'');
 assert.equal(ui.node('publicParaphraseAgain').disabled,true);
 assert.equal(store.has('prowell-humanizer-draft-v1'),false);
 console.log('Prowell Humanizer rehumanize iterations, no navigation, saved output, retries: PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
