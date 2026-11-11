'use strict';
/* Minimal dual popup. The only visible controls are START AUTO-TAKE and STOP
 * for each website. This file never changes either order-taking workflow.
 */
const SITES={
  four:{name:'4writers.net',prefix:'dual_four_',legacyVersion:'0.5.4',
    host:/^https:\/\/(?:www\.)?4writers\.net\//i},
  good:{name:'good-writers.com',prefix:'dual_good_',legacyVersion:'1.0.4',
    host:/^https:\/\/(?:www\.)?good-writers\.com\//i}
};
const VERSION='2.1.14';
const notice=document.querySelector('#sr-notice');
const key=(site,name)=>SITES[site].prefix+name;
const put=(site,values)=>chrome.storage.local.set(Object.fromEntries(
  Object.entries(values).map(([name,value])=>[key(site,name),value])));
const startButton=site=>document.querySelector('[data-start="'+site+'"]');
const stopButton=site=>document.querySelector('[data-stop="'+site+'"]');
const announce=text=>{if(notice)notice.textContent=text;};
const pick=async site=>{
  const tabs=await chrome.tabs.query({});
  const matches=tabs.filter(t=>SITES[site].host.test(t.url||t.pendingUrl||''));
  return matches.find(t=>t.active)||
    matches.find(t=>t.id===window.preferredTabId)||matches[0]||null;
};
async function render(site){
  const tab=await pick(site),cfg=SITES[site];
  const names=['armed','claimConsentVersion','targetTabId'];
  const data=await chrome.storage.local.get(names.map(name=>key(site,name)));
  const get=name=>data[key(site,name)];
  const running=get('armed')===true &&
    get('claimConsentVersion')===cfg.legacyVersion;
  startButton(site).disabled=!tab||running;
  stopButton(site).disabled=!running;
  startButton(site).title=!tab?'Open '+cfg.name+' in a browser tab':
    running?'Already watching '+cfg.name:'Start automatic order handling for '+cfg.name;
  stopButton(site).title=running?'Stop automatic order handling for '+cfg.name:
    'Monitoring is already stopped';
}
async function start(site){
  const tab=await pick(site);
  if(!tab){announce('Open '+SITES[site].name+' in a browser tab first.');return;}
  // Preserve the precise accepted START configuration from v2.1.6.
  await put(site,{
    autoFlow:null,seenOrderIds:[],autoAcceptEnabled:true,armed:true,
    claimConsentVersion:SITES[site].legacyVersion,targetTabId:tab.id,
    claim:null,soundRunId:crypto.randomUUID(),
    lastPostViewDurationMs:null,lastPostViewWithin2s:null,
    ...(site==='four'?{fourLastCheckedSection:'',fourLastCheckedAt:null,
      fourCycleCount:0,refreshCount:0,lastRefreshAt:null}:{}),
    lastResult:site==='four'
      ? 'Monitoring Overview + Writings + Rewritings (2-second idle checks) with audio alerts.'
      : 'Running the supplied original Good-Writers engine with audio alerts.'
  });
  // Sound is prepared separately; it does not delay scanning or clicking.
  void chrome.runtime.sendMessage({type:'PROWELL_PREPARE_ORDER_SOUND'}).catch(()=>{});
  announce(SITES[site].name+' monitoring started.');
  await render(site);
}
async function stop(site){
  await put(site,{armed:false,targetTabId:null,autoFlow:null,
    autoAcceptEnabled:false,lastResult:'Stopped by owner'});
  announce(SITES[site].name+' monitoring stopped.');
  await render(site);
}
for(const site of Object.keys(SITES)){
  startButton(site).addEventListener('click',()=>{
    void start(site).catch(error=>announce('Could not start '+SITES[site].name+
      ': '+String(error?.message||error)));
  });
  stopButton(site).addEventListener('click',()=>{
    void stop(site).catch(error=>announce('Could not stop '+SITES[site].name+
      ': '+String(error?.message||error)));
  });
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  for(const site of Object.keys(SITES)){
    if(Object.keys(changes).some(name=>name.startsWith(SITES[site].prefix)))
      void render(site).catch(error=>announce(String(error?.message||error)));
  }
});
void Promise.all(Object.keys(SITES).map(render))
  .catch(error=>announce(String(error?.message||error)));
