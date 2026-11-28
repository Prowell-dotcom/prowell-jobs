'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),
  vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../extension/4writers-v129');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'2.1.29.1');
assert.equal(manifest.content_scripts.length,2);
assert(manifest.content_scripts.every(s=>s.matches.every(x=>x.includes('4writers.net'))),
  'Standalone extension must never inject into Good-Writers');
assert(manifest.host_permissions.every(x=>!x.includes('good-writers.com')));
const html=read('popup.html');
assert.equal((html.match(/<button\b/g)||[]).length,2,'Exactly START and STOP buttons');
assert.match(html,/START WATCH/);
assert.match(html,/>STOP</);
assert(!/data-start="good"|data-stop="good"/.test(html));
const source=read('four-section-refresh.js');
const match=source.match(/const INTERVALS=Object\.freeze\(\[([\d\s,]+)\]\)/);
assert(match,'Must define the exact fixed irregular timing sequence');
const intervals=match[1].split(',').map(x=>x.trim()).filter(Boolean).map(Number);
assert.deepEqual(intervals,[12000,3000,9000,5000,13000,4000,10000,
  7000,11000,6000,8000]);
assert.equal(new Set(intervals).size,11);
const shared={armed:true,claimConsentVersion:'0.5.4',
  targetTabId:77,claim:null,refreshCount:0};
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();
  await new Promise(r=>setImmediate(r));};
function page({ready=true,warning=false,order=false}={}){
  let loaded=ready,blocked=warning,found=order;
  const listeners=[],timers=[];
  let nextTimer=0,reloads=0,observer=null;
  const store={
    local:{
      async get(keys){return Object.fromEntries(keys.map(k=>[k,shared[k]]));},
      async set(patch){
        const old={...shared};Object.assign(shared,patch);
        const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>
          [k,{oldValue:old[k],newValue:v}]));
        listeners.forEach(fn=>fn(changes,'local'));
      }
    },
    onChanged:{addListener(fn){listeners.push(fn);}}
  };
  const window={__prowellDualStorage:store,
    __prowellFourSections:{overview:()=>true,available:()=>false,
      selected:()=>null,links:()=>[]},
    __prowellCardDetector:{cards:()=>found?[{id:'1234567890',type:'available'}]:[]}
  };
  window.top=window;
  const document={
    get readyState(){return loaded?'complete':'loading';},
    body:{get innerText(){return blocked?'Using automated site parsers is prohibited.':'Available orders';}},
    querySelector(){return null;},querySelectorAll(){return [];},
    addEventListener(){}
  };
  const location={hostname:'4writers.net',href:'https://4writers.net/dashboard',
    origin:'https://4writers.net',reload(){reloads++;}};
  vm.runInNewContext(source,{window,document,location,Date,Set,Number,URL,
    console,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},
    setTimeout(fn,ms){const id=++nextTimer;timers.push({id,ms,fn});return id;},
    clearTimeout(id){const n=timers.findIndex(t=>t.id===id);
      if(n>=0)timers.splice(n,1);},
    chrome:{runtime:{sendMessage(_msg,callback){callback({tabId:77});}}}
  });
  return {
    async settle(){await flush();},
    timer:()=>timers.find(t=>intervals.includes(t.ms)),
    async tick(){
      const item=this.timer();assert(item,'Expected irregular reload timer');
      timers.splice(timers.indexOf(item),1);
      await item.fn();await flush();
    },
    get reloads(){return reloads;},
    setOrder(value){found=value;observer();},
    setWarning(value){blocked=value;observer();},
    setLoaded(value){loaded=value;observer();},
    async patch(delta){await store.local.set(delta);await flush();}
  };
}
(async()=>{
  for(let i=0;i<intervals.length*2;i++){
    const p=page();await p.settle();
    assert.equal(p.timer()?.ms,intervals[i%intervals.length],
      'Scheduled delay must continue across full page reloads');
    await p.tick();
    assert.equal(p.reloads,1,'A complete empty dashboard must reload once');
    assert.equal(shared.refreshCount,i+1,'Persist next delay before navigation');
  }
  shared.refreshCount=0;
  let p=page();await p.settle();assert(p.timer());
  p.setOrder(true);
  assert.equal(p.timer(),undefined,'DOM order must immediately cancel refresh');
  p.setOrder(false);assert(p.timer(),'Refresh resumes if order disappears');
  await p.patch({claim:{id:'1234567890',stage:'view-clicked'}});
  assert.equal(p.timer(),undefined,'In-progress order cancels refresh');
  await p.patch({claim:null});
  assert(p.timer());
  p.setWarning(true);
  await p.settle();
  assert.equal(p.timer(),undefined,'Security warning cancels refresh');
  assert.equal(shared.armed,false,'Security warning must STOP');
  shared.armed=true;shared.targetTabId=77;
  p=page({ready:false});await p.settle();
  assert.equal(p.timer(),undefined,'Loading document cannot schedule refresh');
  p.setLoaded(true);await p.settle();
  assert.equal(p.timer()?.ms,12000);
  await p.patch({armed:false,targetTabId:null});
  assert.equal(p.timer(),undefined,'Manual STOP cancels refresh');
  console.log('Standalone 4Writers: exact irregular 3–13-second cycle, full-reload persistence, order priority, warning and STOP PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
