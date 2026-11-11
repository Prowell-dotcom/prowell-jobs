'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const match=html.match(/<script id="prowell-humanizer-inline">\s*([\s\S]*?)<\/script>/);
assert(match);const code=match[1].trim();
assert(html.includes('id="publicParaphraseEngine"'));
async function scenario(ready){
 const nodes={},tasks=[],requests=[],storage=new Map();let version=0;
 function node(id){
  if(nodes[id])return nodes[id];
  return nodes[id]={value:'',textContent:'',innerHTML:'',disabled:false,
   style:{},dataset:{},options:[],events:{},classList:{toggle(){}},
   addEventListener(name,fn){this.events[name]=fn},
   dispatch(name){let prevented=false;
     const pending=this.events[name]?.({preventDefault(){prevented=true}});
     return{pending,prevented:()=>prevented};
   },focus(){},select(){},remove(){}};
 }
 for(const id of ['publicParaphraseForm','publicParaphraseInput','publicParaphraseOutput',
  'publicParaphraseSubmit','publicParaphraseAgain','publicParaphraseStatus',
  'publicParaphraseInlineFeedback','publicParaphraseCount','publicParaphraseTone',
  'publicParaphraseEngine','publicDeepRewriteStatus','publicParaphraseLevel',
  'publicParaphraseLevelValue','publicParaphraseLevelDescription',
  'publicParaphraseProtectedTerms','publicParaphraseClear','publicParaphraseCopy',
  'publicParaphraseDownload'])node(id);
 node('publicParaphraseEngine').value='local';
 node('publicParaphraseEngine').options=[{value:'local',disabled:false},{value:'deep',disabled:true}];
 node('publicParaphraseTone').value='student';
 node('publicParaphraseTone').options=['natural','student','simple','academic','professional'].map(value=>({value}));
 node('publicParaphraseLevel').value='10';
 node('publicParaphraseSubmit').innerHTML='Humanize text';
 node('publicParaphraseAgain').innerHTML='Rehumanize text';
 const sessionStorage={getItem(key){return storage.get(key)||null},
   setItem(key,val){storage.set(key,String(val))},removeItem(key){storage.delete(key)}};
 const fetch=async(url,opts)=>{
   requests.push({url,opts});
   if(url.endsWith('/capabilities')){
    return{ok:true,json:async()=>({deepAvailable:ready,deepStatus:ready?'ready':'not_configured'})};
   }
   version+=1;
   return{ok:true,status:200,json:async()=>({
     engine:'deep',
     paraphrased:version===1?
      'Staff contacted patients before their scheduled visits with the help of clinic reminders.':
      'Before planned visits, the clinic used reminders to reach its patients.',
     editStrength:'Substantial',editableTextChangePercent:43,
     candidateCount:4,validCandidateCount:2
   })};
 };
 const document={getElementById:node,body:{appendChild(){}},
    createElement(){return{click(){},remove(){}}}};
 const window={addEventListener(){}};
 vm.runInNewContext(code,{
    document,window,fetch,AbortController,sessionStorage,console,
    navigator:{clipboard:{writeText:async()=>{}}},Blob:class{},
    URL:{createObjectURL(){return'blob:mock'},revokeObjectURL(){}},
    setTimeout(fn,ms){tasks.push({fn,ms});return tasks.length},clearTimeout(){}
 });
 const boot=tasks.find(x=>x.ms===100);
 assert(boot,'Model check must be scheduled');
 await boot.fn();
 assert.equal(node('publicParaphraseEngine').value,ready?'deep':'local');
 assert.equal(node('publicParaphraseEngine').options[1].disabled,!ready);
 assert(!node('publicDeepRewriteStatus').textContent.includes('.railway.internal'));
 if(!ready)return;
 node('publicParaphraseInput').value=
  'The clinic used appointment reminders so that staff could contact patients before their scheduled visits.';
 const start=node('publicParaphraseForm').dispatch('submit');await start.pending;
 assert(start.prevented());
 const posts=requests.filter(x=>x.opts?.method==='POST');
 assert.equal(posts.length,1);
 const payload=JSON.parse(posts[0].opts.body);
 assert.equal(payload.engine,'deep');assert.equal(payload.level,10);assert.equal(payload.mode,'first');
 assert.equal(node('publicParaphraseAgain').disabled,false);
 assert.match(node('publicParaphraseInlineFeedback').textContent,/Reviewed 2 of 4 generated versions/);
 const current=node('publicParaphraseOutput').value;
 const retry=node('publicParaphraseAgain').dispatch('click');await retry.pending;
 const two=requests.filter(x=>x.opts?.method==='POST');
 assert.equal(two.length,2);
 const re=JSON.parse(two[1].opts.body);
 assert.equal(re.engine,'deep');assert.equal(re.mode,'again');
 assert.equal(re.text,current);assert.equal(re.history.length,1);
 assert.equal(node('publicParaphraseOutput').value,
  'Before planned visits, the clinic used reminders to reach its patients.');
}
(async()=>{await scenario(true);await scenario(false);
 console.log('DeepRewrite availability, candidate ranking feedback and iteration: PASS')
})().catch(error=>{console.error(error);process.exitCode=1});
