'use strict';
/* Independent START / STOP controls for the two supported writer accounts. */
const SITES={
  four:{name:'4writers',prefix:'dual_four_',host:/^https:\/\/(?:www\.)?4writers\.net\//i},
  good:{name:'GoodWriters',prefix:'dual_good_',host:/^https:\/\/(?:www\.)?good-writers\.com\//i}
};
const VERSION='2.0.4';
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
  const names=['armed','claimConsentVersion','targetTabId','autoAcceptEnabled','lastResult','refreshStatus','lastProcessingPreview'];
  const raw=await chrome.storage.local.get(names.map(n=>key(site,n)));
  const val=n=>raw[key(site,n)];
  const running=val('armed')===true&&val('claimConsentVersion')===VERSION;
  document.querySelector('[data-start="'+site+'"]').disabled=!tab||running;
  document.querySelector('[data-stop="'+site+'"]').disabled=!running;
  // START AUTO-TAKE enables acceptance, so no separate checkbox is needed.
  document.querySelector('[data-status="'+site+'"]').textContent=
    (running?'WATCHING TAB #'+val('targetTabId'):'STOPPED')+
    '\n'+(tab?'Signed-in page detected (tab #'+tab.id+')':'Open the official site in a browser tab')+
    '\n'+(val('lastResult')||val('refreshStatus')||'Ready')+
    (val('lastProcessingPreview')?.result==='scroll-passed'
      ? '\nProcessing test: PASS (View + instant scroll; Take it not required)'
      : val('lastProcessingPreview')?.result==='scroll-failed'
        ? '\nProcessing test: scroll failed; check current details view'
        : '');
}
async function start(site){
  const tab=await pick(site);
  if(!tab){notice.textContent='Open '+SITES[site].name+' in a tab first.';return;}
  await put(site,{
    autoFlow:null,seenOrderIds:[],lastProcessingPreview:null,autoAcceptEnabled:true,armed:true,claimConsentVersion:VERSION,targetTabId:tab.id,
    claim:null,soundRunId:crypto.randomUUID(),
    lastResult:'Monitoring until one available or processing order is detected; then STOPPED until START is pressed again.'
  });
  // Do not block monitoring/automatic clicks while preparing audio.
  // If audio cannot be prewarmed, the normal order alert still tries playback.
  void chrome.runtime.sendMessage({type:'PROWELL_PREPARE_ORDER_SOUND'}).catch(()=>{});
  notice.textContent=SITES[site].name+': Monitoring ON. The first order will sound, open View and scroll, then stay STOPPED until you press START again.';
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
