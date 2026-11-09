'use strict';
const $ = id => document.getElementById(id);
const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,refreshMs:1000,
 claim:null,lastResult:'Ready',log:[],autoAcceptEnabled:false};
let state={...DEFAULTS},tab=null;
const valid=url=>/^https:\/\/(?:www\.)?4writers\.net\//i.test(url||'');
const current=()=>Boolean(tab&&valid(tab.url)&&state.targetTabId===tab.id);
const isArmed=()=>Boolean(state.armed&&state.claimConsentVersion==='0.5.12');
async function store(delta){state={...state,...delta};await chrome.storage.local.set(delta);render();}
function render(){
 $('arm').disabled=!tab||!valid(tab.url)||Boolean(isArmed()&&current());
 $('stop').disabled=!isArmed();
 $('status').textContent=(isArmed()&&current()?'ARMED — THIS TAB':isArmed()?'ARMED IN ANOTHER TAB':'STOPPED')+
 '\nRefresh interval: every 1 second' +
 '\nSupported: account overview and available orders'+
 '\nAction after detection: '+(state.autoAcceptEnabled?'automatic order acceptance (opt-in)':'View + automatic gradual scroll; manual acceptance')+
 '\nLast: '+(state.lastResult||'Ready');
 if($('autoAcceptEnabled')){$('autoAcceptEnabled').checked=Boolean(state.autoAcceptEnabled);$('autoAcceptEnabled').disabled=isArmed();}
 $('history').textContent=(state.log||[]).slice(-10).reverse().join('\n')||'No events yet.';
 // Automatic scrolling is available independently of order acceptance.
}
async function start(){
 [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
 if(!tab||!valid(tab.url))$('notice').textContent='Open 4writers.net in Chrome first.';
 render();
}
$('arm').addEventListener('click',async()=>{
 if(!tab||!valid(tab.url))return;
 await chrome.storage.local.set({autoFlow:null});
 await store({armed:true,claimConsentVersion:'0.5.12',targetTabId:tab.id,claim:null,soundRunId:crypto.randomUUID(),lastResult:'Watching for orders; will stop after opening View'});
 $('notice').textContent=state.autoAcceptEnabled?'Automatic acceptance ON: View, gradual scroll, Take it and confirmations.':'Automatic scrolling ON; you handle Take it and confirmations manually.';
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

$('saveReportCode')?.addEventListener('click',async()=>{
 const value=$('reportCode').value.trim();
 if(value.length<30||value.length>180){$('notice').textContent='Enter a valid code from your dashboard.';return;}
 await chrome.storage.local.set({reportCode:value});
 $('reportCode').value='';
 $('notice').textContent='Private reporting connected.';
});
$('removeReportCode')?.addEventListener('click',async()=>{
 await chrome.storage.local.remove('reportCode');
 $('reportCode').value='';
 $('notice').textContent='Reporting disconnected.';
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
// Automatic acceptance is a separate explicit per-session opt-in.
$('autoAcceptEnabled')?.addEventListener('change',async event=>{
  if(isArmed()){event.target.checked=Boolean(state.autoAcceptEnabled);return;}
  const enabled=event.target.checked;
  if(enabled && !confirm('Enable automatic Take it, OK and I understand for available orders on this platform? Review the site rules and accept responsibility for order requirements.')){
    event.target.checked=false;return;
  }
  await store({autoAcceptEnabled:enabled,autoFlow:null});
});

$('testScrollOnly')?.addEventListener('click',async()=>{
  const btn=$('testScrollOnly');
  btn.disabled=true;
  $('notice').textContent='Checking order-details scrolling; no acceptance buttons will be clicked…';
  try{
    const [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!activeTab||!valid(activeTab.url))throw Error('Open an order and click View on the correct website.');
    const response=await chrome.tabs.sendMessage(activeTab.id,{type:'PROWELL_SCROLL_TEST'});
    $('notice').textContent=response?.ok?
      'Scroll test passed: '+response.steps+' gradual movements in '+(response.container||'order panel')+'.':
      'Scroll test failed: '+(response?.reason||'Could not reach extension in this tab. Reload the extension and page.');
  }catch(error){$('notice').textContent='Scroll test failed: '+String(error?.message||error);}
  finally{btn.disabled=false;}
});
