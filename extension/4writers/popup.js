// Prowell popup controls: owner-activated detection and guidance.
'use strict';
const $ = id => document.getElementById(id);
const defaults = {armed:false,targetTabId:null,returnToList:true,lastResult:'Ready',log:[],claim:null,attemptedIds:[],completed:[]};
let state={...defaults}, activeTab=null;
function valid(url){return /^https:\/\/(?:www\.)?4writers\.net\//i.test(url||'');}
async function update(changes){Object.assign(state,changes);await chrome.storage.local.set(changes);display();}
function display(){
 const active=state.armed && activeTab && state.targetTabId===activeTab.id;
 $('arm').disabled=!activeTab || !valid(activeTab.url) || active;
 $('stop').disabled=!state.armed;
 $('returnToList').checked=state.returnToList!==false;
 $('status').textContent=(active?'MONITORING THIS TAB':state.armed?'MONITORING ANOTHER TAB':'STOPPED')+
 '\nLast event: '+state.lastResult+
 '\nOrders detected: '+(state.attemptedIds||[]).length;
 $('history').textContent=(state.log||[]).slice(-8).reverse().join('\n')||'No activity yet.';
}
async function start(){
 [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
 state={...defaults,...await chrome.storage.local.get(defaults)};
 display();
}
$('arm').addEventListener('click',()=>update({armed:true,targetTabId:activeTab.id,lastResult:'Monitoring new orders'}));
$('stop').addEventListener('click',()=>update({armed:false,targetTabId:null,lastResult:'Stopped'}));
$('reset').addEventListener('click',()=>update({lastResult:'Ready to monitor'}));
$('clear').addEventListener('click',()=>update({attemptedIds:[],log:[],lastResult:'History cleared'}));
$('returnToList').addEventListener('change',e=>{void update({returnToList:e.target.checked});});
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area!=='local')return;
 for(const [key,value] of Object.entries(changes))if(key in defaults)state[key]=value.newValue;
 display();
});
start().catch(e=>{$('status').textContent=e.message;});
