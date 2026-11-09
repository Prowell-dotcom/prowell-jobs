'use strict';
/* Independent START / STOP controls for the two supported writer accounts. */
const SITES={
  four:{name:'4writers',prefix:'dual_four_',host:/^https:\/\/(?:www\.)?4writers\.net\//i},
  good:{name:'GoodWriters',prefix:'dual_good_',host:/^https:\/\/(?:www\.)?good-writers\.com\//i}
};
const VERSION='2.0.0';
const notice=document.querySelector('#notice');
const key=(site,name)=>SITES[site].prefix+name;
const put=(site,values)=>chrome.storage.local.set(Object.fromEntries(
  Object.entries(values).map(([name,value])=>[key(site,name),value])));
const pick=async site=>{
  const tabs=await chrome.tabs.query({});
  const matches=tabs.filter(t=>SITES[site].host.test(t.url||t.pendingUrl||''));
  return matches.find(t=>t.active)||matches.find(t=>t.id===window.preferredTabId)||matches[0]||null;
};
async function render(site){
  const obj=SITES[site],tab=await pick(site);
  const names=['armed','claimConsentVersion','targetTabId','autoAcceptEnabled','lastResult','refreshStatus'];
  const raw=await chrome.storage.local.get(names.map(n=>key(site,n)));
  const val=n=>raw[key(site,n)];
  const running=val('armed')===true&&val('claimConsentVersion')===VERSION;
  document.querySelector('[data-start="'+site+'"]').disabled=!tab||running;
  document.querySelector('[data-stop="'+site+'"]').disabled=!running;
  const check=document.querySelector('[data-accept="'+site+'"]');
  check.checked=val('autoAcceptEnabled')===true;
  check.disabled=running;
  document.querySelector('[data-status="'+site+'"]').textContent=
    (running?'WATCHING TAB #'+val('targetTabId'):'STOPPED')+
    '\n'+(tab?'Signed-in page detected (tab #'+tab.id+')':'Open the official site in a browser tab')+
    '\n'+(val('lastResult')||val('refreshStatus')||'Ready');
}
async function start(site){
  const tab=await pick(site);
  if(!tab){notice.textContent='Open '+SITES[site].name+' in a tab first.';return;}
  await put(site,{
    autoFlow:null,armed:true,claimConsentVersion:VERSION,targetTabId:tab.id,
    claim:null,soundRunId:crypto.randomUUID(),
    lastResult:'Monitoring for new orders. Ready for instant View and scroll.'
  });
  notice.textContent=SITES[site].name+' monitoring started; available orders can be accepted when opted in.';
  await render(site);
}
async function stop(site){
  await put(site,{armed:false,targetTabId:null,autoFlow:null,autoAcceptEnabled:false,
    lastResult:'Stopped by owner'});
  notice.textContent=SITES[site].name+' stopped. The other website is unaffected.';
  await render(site);
}
for(const site of Object.keys(SITES)){
  document.querySelector('[data-start="'+site+'"]').addEventListener('click',()=>void start(site));
  document.querySelector('[data-stop="'+site+'"]').addEventListener('click',()=>void stop(site));
  document.querySelector('[data-accept="'+site+'"]').addEventListener('change',async e=>{
    const checked=e.target.checked;
    const raw=await chrome.storage.local.get(key(site,'armed'));
    if(raw[key(site,'armed')]){await render(site);return;}
    if(checked&&!confirm('Enable automatic order acceptance for '+SITES[site].name+'? Review the platform rules and order responsibilities before continuing.')){
      e.target.checked=false;return;
    }
    await put(site,{autoAcceptEnabled:checked,autoFlow:null});
    notice.textContent=checked?SITES[site].name+' automatic acceptance enabled for the next eligible available order.':
      SITES[site].name+' automatic acceptance disabled.';
    await render(site);
  });
}
document.querySelector('#testSound').addEventListener('click',async()=>{
  try{const r=await chrome.runtime.sendMessage({type:'PROWELL_TEST_ORDER_SOUND'});
    notice.textContent=r?.ok?'Sound request sent. Check browser volume.':'Sound test failed.';
  }catch(error){notice.textContent='Sound unavailable: '+String(error?.message||error);}
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  for(const site of Object.keys(SITES))
    if(Object.keys(changes).some(n=>n.startsWith(SITES[site].prefix)))void render(site);
});
void Promise.all(Object.keys(SITES).map(render)).catch(error=>{notice.textContent=String(error?.message||error);});
