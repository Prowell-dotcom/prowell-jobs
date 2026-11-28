'use strict';
const $=id=>document.getElementById(id);
const VERSION='1.0.17';
const valid=url=>/^https:\/\/(?:www\.)?good-writers\.com\//i.test(url||'');
const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,
  refreshMs:2000,claim:null,lastResult:'Ready',autoAcceptEnabled:false,
  autoFlow:null,seenOrderIds:[]};
let tab=null,state={...DEFAULTS};
function armed(){return state.armed===true&&state.claimConsentVersion===VERSION;}
function render(){
  $('arm').disabled=!tab||!valid(tab.url)||armed();
  $('stop').disabled=!armed();
  $('status').textContent=(armed()?'WATCHING':'STOPPED')+
    '\nIdle refresh: every 2 seconds'+
    '\nOrder action: sound → STOP → View once'+
    '\nLast: '+(state.lastResult||'Ready');
}
async function put(patch){
  state={...state,...patch};
  await chrome.storage.local.set(patch);
  render();
}
$('arm').addEventListener('click',async()=>{
  if(!tab||!valid(tab.url)){ $('notice').textContent='Open good-writers.com first.';return; }
  try{
    await put({
      armed:true,claimConsentVersion:VERSION,targetTabId:tab.id,
      claim:null,autoFlow:null,autoAcceptEnabled:false,seenOrderIds:[],
      soundRunId:crypto.randomUUID(),refreshMs:2000,refreshCount:0,
      lastResult:'Watching Good-Writers; order taking remains manual'
    });
    $('notice').textContent='Watching. The next detected order stops monitoring.';
  }catch(error){$('notice').textContent='START failed: '+error.message;}
});
$('stop').addEventListener('click',async()=>{
  try{
    await put({armed:false,targetTabId:null,claim:null,autoFlow:null,
      autoAcceptEnabled:false,lastResult:'Stopped manually'});
    $('notice').textContent='Monitoring stopped.';
  }catch(error){$('notice').textContent='STOP failed: '+error.message;}
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  for(const name of Object.keys(DEFAULTS))
    if(changes[name])state[name]=changes[name].newValue;
  render();
});
(async()=>{
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
  render();
})().catch(error=>{$('notice').textContent='Could not read status: '+error.message;});
