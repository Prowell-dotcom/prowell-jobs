'use strict';
const $ = id => document.getElementById(id);
const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,refreshMs:1000,
 claim:null,lastResult:'Ready',log:[],autoAcceptEnabled:false};
let state={...DEFAULTS},tab=null;
const valid=url=>/^https:\/\/(?:www\.)?good-writers\.com\//i.test(url||'');
const current=()=>Boolean(tab&&valid(tab.url)&&state.targetTabId===tab.id);
const isArmed=()=>Boolean(state.armed&&state.claimConsentVersion==='1.0.9');
async function store(delta){state={...state,...delta};await chrome.storage.local.set(delta);render();}
function render(){
 $('arm').disabled=!tab||!valid(tab.url)||Boolean(isArmed()&&current());
 $('stop').disabled=!isArmed();
 $('status').textContent=(isArmed()&&current()?'ARMED — THIS TAB':isArmed()?'ARMED IN ANOTHER TAB':'STOPPED')+
 '\nRefresh interval: every 1 second' +
 '\nAction after detection: '+(state.autoAcceptEnabled?'automatic order acceptance (opt-in)':'View only; manual review')+
 '\nLast: '+(state.lastResult||'Ready');
 if($('autoAcceptEnabled')){$('autoAcceptEnabled').checked=Boolean(state.autoAcceptEnabled);$('autoAcceptEnabled').disabled=isArmed();}
 $('history').textContent=(state.log||[]).slice(-10).reverse().join('\n')||'No events yet.';
 // No auto-return: opening View hands control to the user.
}
async function start(){
 [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
 if(!tab||!valid(tab.url))$('notice').textContent='Open good-writers.com in Chrome first.';
 render();
}
$('arm').addEventListener('click',async()=>{
 if(!tab||!valid(tab.url))return;
 await chrome.storage.local.set({autoFlow:null});
 await store({armed:true,claimConsentVersion:'1.0.9',targetTabId:tab.id,claim:null,soundRunId:crypto.randomUUID(),lastResult:'Watching for orders; will stop after opening View'});
 $('notice').textContent='Order watcher enabled. Leave the good-writers tab open.';
});
$('stop').addEventListener('click',async()=>{
 await chrome.storage.local.set({autoFlow:null});
 await store({autoAcceptEnabled:false,armed:false,targetTabId:null,lastResult:'Stopped by owner'});
 $('notice').textContent='Monitoring stopped. Any in-progress acceptance workflow was cancelled.';
});
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area!=='local')return;
 for(const [key,value] of Object.entries(changes))if(key in DEFAULTS)state[key]=value.newValue;
 render();
});


async function updateGoodWritersPairingStatus(){
 const values=await chrome.storage.local.get(['goodWritersReportCode','goodWritersReportStatus','goodWritersPending']);
 $('gwPairStatus').textContent=(values.goodWritersReportCode?'Paired':'Not paired')+
  ' · '+(values.goodWritersReportStatus||'No connection test yet.')+
  ' · Pending reports: '+(values.goodWritersPending||[]).length;
}
$('gwPair')?.addEventListener('click',async()=>{
 const code=$('gwReportCode').value.trim();
 if(code.length<30||code.length>180){$('gwPairStatus').textContent='Paste the Good-Writers pairing code from the Prowell administrator dashboard.';return;}
 $('gwPair').disabled=true;
 $('gwPairStatus').textContent='Verifying pairing with Prowell Jobs…';
 try{
  const response=await chrome.runtime.sendMessage({type:'GOOD_WRITERS_VERIFY',code});
  if(!response?.ok)throw Error(response?.error||'Pairing could not be verified.');
  $('gwReportCode').value='';
  await updateGoodWritersPairingStatus();
 }catch(err){$('gwPairStatus').textContent='Connection failed: '+err.message;}
 finally{$('gwPair').disabled=false;}
});
$('gwUnpair')?.addEventListener('click',async()=>{
 if(!confirm('Disconnect Good-Writers notifications? Saved local reports will remain.'))return;
 await chrome.runtime.sendMessage({type:'GOOD_WRITERS_DISCONNECT'});
 $('gwReportCode').value='';
 await updateGoodWritersPairingStatus();
});
$('gwRetry')?.addEventListener('click',async()=>{
 $('gwPairStatus').textContent='Retrying pending Good-Writers reports…';
 const result=await chrome.runtime.sendMessage({type:'GOOD_WRITERS_RETRY'});
 await updateGoodWritersPairingStatus();
 if(result?.error)$('gwPairStatus').textContent=result.error;
});
chrome.storage.onChanged.addListener((changed,area)=>{
 if(area==='local' && ['goodWritersReportCode','goodWritersReportStatus','goodWritersPending'].some(k=>changed[k])){
  void updateGoodWritersPairingStatus();
 }
});

$('testOrderSound')?.addEventListener('click',async()=>{
 const button=$('testOrderSound');
 button.disabled=true;
 $('notice').textContent='Playing a test notification chime…';
 try{
   const result=await chrome.runtime.sendMessage({type:'PROWELL_TEST_ORDER_SOUND'});
   $('notice').textContent=result?.ok?'Notification sound sent. Check your browser and system volume.':
     'Sound could not play; check Chrome audio permissions and extension status.';
 }catch(_){$('notice').textContent='Sound test failed; reload the extension and try again.';}
 finally{button.disabled=false;}
});
start().catch(err=>{$('notice').textContent=err.message;});
void updateGoodWritersPairingStatus();
// Automatic acceptance is a separate explicit per-session opt-in.
$('autoAcceptEnabled')?.addEventListener('change',async event=>{
  if(isArmed()){event.target.checked=Boolean(state.autoAcceptEnabled);return;}
  const enabled=event.target.checked;
  if(enabled && !confirm('Enable automatic Take it, OK and I understand for available orders on this platform? Review the site rules and accept responsibility for order requirements.')){
    event.target.checked=false;return;
  }
  await store({autoAcceptEnabled:enabled,autoFlow:null});
});
