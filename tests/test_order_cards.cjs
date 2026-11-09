'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function mock(site,type,id){
 const body={innerText:'',textContent:'',parentElement:null};
 const wrapper={innerText:'ID: '+id+' Deadline: tomorrow',parentElement:body};
 const card={innerText:'ID: '+id+' Files View',parentElement:wrapper};
 const controls=(type==='processing'?['Files','Messages','View']:['Files','View']).map(name=>({
  innerText:name,textContent:name,parentElement:card,isConnected:true,disabled:false,
  getClientRects(){return [1];},getAttribute(){return null;}
 }));
 const heading={innerText:type==='processing'?'Processing orders':'Available orders',
  isConnected:true,getClientRects(){return [1];},getAttribute(){return null;}};
 const document={body,title:'',querySelectorAll(selector){
  if(selector.startsWith('h1,'))return [heading];
  return controls;
 }};
 const pathname=type==='processing'?'/processing_orders/':'/free_orders/essay/';
 const location={pathname,href:'https://'+site+pathname};
 const window={};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/'+
  (site.startsWith('4writers')?'4writers':'good-writers')+'/order-card.js'),'utf8'),{
  window,document,location,URL
 });
 const detector=window.__prowellCardDetector;
 assert(detector);
 const hits=detector.cards();
 assert.equal(hits.length,1);
 assert.equal(hits[0].id,id);
 assert.equal(hits[0].type,type);
 assert.equal(hits[0].view.innerText,'View');
 assert.equal(hits[0].hasMessages,type==='processing');
}
for(const site of ['4writers.net','good-writers.com']){
 mock(site,'available','6447728953');
 mock(site,'processing','0192065941');
}
console.log('Both extensions: screenshots-style Files/View and Files/Messages/View cards identified correctly');
