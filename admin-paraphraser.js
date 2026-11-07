'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const form=$('paraphraseForm');
 if(!form)return;
 const input=$('paraphraseInput'),output=$('paraphraseOutput');
 const count=txt=>(txt.trim().match(/\S+/gu)||[]).length;
 let isReady=false,working=false;

 function status(message){$('paraphraseStatus').textContent=message;}
 function update(){
   const n=count(input.value);
   $('paraphraseInputCount').textContent=n.toLocaleString()+' / 3,000 words';
   $('paraphraseInputCount').style.color=n>3000?'#ad2831':'';
   $('paraphraseSubmit').disabled=working||!isReady||!n||n>3000;
   $('paraphraseOutputCount').textContent=count(output.value).toLocaleString()+' words';
   $('paraphraseCopy').disabled=!output.value.trim()||!isReady;
   $('paraphraseDownload').disabled=!output.value.trim()||!isReady;
   if(n>3000)status('Please remove '+(n-3000)+' words to meet the 3,000-word maximum.');
 }
 input.addEventListener('input',update);
 window.addEventListener('prowell-admin-session',event=>{
   isReady=Boolean(event.detail?.signedIn);
   $('privateParaphraserPanel').hidden=!isReady;
   if(!isReady){input.value='';output.value='';status('Signed out.');}
   else status('Ready to paraphrase.');
   update();
 });
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   const n=count(input.value);
   if(!isReady||working||n<1||n>3000)return;
   working=true;output.value='';update();status('Rewriting securely…');
   try{
     const token=window.prowellAdminCsrf?.()||'';
     if(!token)throw Error('Administrator session token is unavailable. Refresh and sign in again.');
     const response=await fetch('/api/admin/paraphrase',{
       method:'POST',
       credentials:'same-origin',
       cache:'no-store',
       headers:{'Content-Type':'application/json','X-Admin-CSRF':token},
       body:JSON.stringify({text:input.value,tone:$('paraphraseTone').value})
     });
     const data=await response.json();
     if(!response.ok)throw Error(data.error||'The rewrite could not be completed.');
     output.value=data.paraphrased||'';
     status('Rewrite complete. '+(data.outputWords||count(output.value))+' words. Detector score not tested.');
   }catch(error){status('Unable to paraphrase: '+error.message);}
   finally{working=false;update();}
 });
 $('paraphraseClear').addEventListener('click',()=>{
   if(working)return;
   input.value='';output.value='';status('Cleared.');update();
 });
 $('paraphraseCopy').addEventListener('click',async()=>{
   if(!isReady||!output.value)return;
   try{await navigator.clipboard.writeText(output.value);status('Paraphrased text copied.');}
   catch(_){output.focus();output.select();status('Select and copy the text using Ctrl+C.');}
 });
 $('paraphraseDownload').addEventListener('click',()=>{
   if(!isReady||!output.value)return;
   const blob=new Blob([output.value],{type:'text/plain;charset=utf-8'});
   const url=URL.createObjectURL(blob);
   const a=document.createElement('a');
   a.href=url;a.download='prowell-paraphrased-text.txt';
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2500);
   status('TXT file saved.');
 });
 update();
})();
