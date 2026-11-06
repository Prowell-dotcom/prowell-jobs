'use strict';
const $ = id => document.getElementById(id);
const DEFAULTS={armed:false,claimConsentVersion:'',targetTabId:null,refreshMs:2000,returnToList:true,
 claim:null,attemptedIds:[],completed:[],lastResult:'Ready',log:[]};
let state={...DEFAULTS},tab=null;
const valid=url=>/^https:\/\/(?:www\.)?4writers\.net\//i.test(url||'');
const current=()=>Boolean(tab&&valid(tab.url)&&state.targetTabId===tab.id);
const isArmed=()=>Boolean(state.armed&&state.claimConsentVersion==='0.5.0');
async function store(delta){state={...state,...delta};await chrome.storage.local.set(delta);render();}
function render(){
 $('arm').disabled=!tab||!valid(tab.url)||Boolean(isArmed()&&current());
 $('stop').disabled=!isArmed();
 $('status').textContent=(isArmed()&&current()?'ARMED — THIS TAB':isArmed()?'ARMED IN ANOTHER TAB':'STOPPED')+
 '\nRefresh interval: every 2 seconds' +
 '\nIn progress: '+(state.claim?'#'+state.claim.id+' ('+state.claim.stage+')':'none')+
 '\nSuccessfully claimed: '+(state.completed||[]).length+
 '\nLast: '+(state.lastResult||'Ready');
 $('history').textContent=(state.log||[]).slice(-10).reverse().join('\n')||'No events yet.';
 $('returnToList').checked=state.returnToList!==false;
}
async function start(){
 [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 state={...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};
 if(!tab||!valid(tab.url))$('notice').textContent='Open 4writers.net in Chrome first.';
 render();
}
$('arm').addEventListener('click',async()=>{
 if(!tab||!valid(tab.url))return;
 if(!confirm('AUTO-CLAIM EVERY ORDER? This will refresh every 2 seconds, click View, Take it, and acknowledge the order without checking its pay, deadline, or topic. Each acceptance may be binding. Continue?'))return;
 await store({armed:true,claimConsentVersion:'0.5.0',targetTabId:tab.id,claim:null,lastResult:'Monitoring and auto-claim enabled'});
 $('notice').textContent='Auto-claim enabled. Leave the 4writers tab open.';
});
$('stop').addEventListener('click',async()=>{
 await store({armed:false,targetTabId:null,lastResult:'Stopped by owner'});
 $('notice').textContent='Bot stopped. Previously accepted orders are not cancelled.';
});
$('reset').addEventListener('click',async()=>{
 if(!confirm('Check your Processing orders first. Reset an unfinished claim?'))return;
 await store({claim:null,lastResult:'Unfinished claim reset'});
});
$('clear').addEventListener('click',async()=>{
 if(!confirm('Clear previously attempted order IDs?'))return;
 await store({attemptedIds:[],lastResult:'Attempted IDs cleared'});
});
$('returnToList').addEventListener('change',e=>{void store({returnToList:e.target.checked});});
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
start().catch(err=>{$('notice').textContent=err.message;});