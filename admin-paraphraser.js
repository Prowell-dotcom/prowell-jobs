'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const form=$('paraphraseForm');
 if(!form)return;
 const input=$('paraphraseInput'),output=$('paraphraseOutput');
 const count=txt=>(String(txt??'').trim().match(/\S+/gu)||[]).length;
 let isReady=false,working=false,lastInputValue=null;

 function status(message){$('paraphraseStatus').textContent=message;}
 function update(){
   // Always read the live textarea value rather than relying on input events.
   // Browser restore, accessibility tools and paste extensions may set .value
   // without emitting input, leaving the counter at 0 and the button disabled.
   const value=input.value;
   lastInputValue=value;
   const n=count(value);
   $('paraphraseInputCount').textContent=n.toLocaleString()+' / 3,000 words';
   $('paraphraseInputCount').style.color=n>3000?'#ad2831':'';
   $('paraphraseSubmit').disabled=working||!isReady||n<1||n>3000;
   $('paraphraseOutputCount').textContent=count(output.value).toLocaleString()+' words';
   $('paraphraseCopy').disabled=!output.value.trim()||!isReady;
   $('paraphraseDownload').disabled=!output.value.trim()||!isReady;
   if(n>3000)status('Please remove '+(n-3000)+' words to meet the 3,000-word maximum.');
 }
 for(const eventName of ['input','change','keyup','paste','cut','drop','focus','blur']){
   input.addEventListener(eventName,()=>{
     // Paste, cut and drop events usually precede the value update.
     update();
     if(['paste','cut','drop'].includes(eventName))setTimeout(update,0);
   });
 }
 // Also handle programmatic paste and browser form restoration. The sync runs
 // only when the textarea actually changes, to avoid unnecessary UI updates.
 setInterval(()=>{
   if(input.value!==lastInputValue)update();
 },400);
 window.addEventListener('pageshow',()=>setTimeout(update,0));
 document.addEventListener('visibilitychange',()=>{
   if(!document.hidden)update();
 });
 function syncSession(ready){
   isReady=Boolean(ready);
   $('privateParaphraserPanel').hidden=!isReady;
   const shortcut=$('paraphraserShortcut');if(shortcut)shortcut.hidden=!isReady;
   if(!isReady){input.value='';output.value='';status('Signed out.');}
   else status('Ready to paraphrase.');
   update();
 }
 window.addEventListener('prowell-admin-session',event=>syncSession(event.detail?.signedIn));
 // Resynchronize in case session restoration completed before this script loaded.
 syncSession(Boolean(window.prowellAdminSignedIn?.()));
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   update(); // Revalidate at click time even if an input event was missed.
   const source=input.value;
   const n=count(source);
   if(!isReady||working||n<1||n>3000){
     if(!isReady)status('Sign in as administrator to use the studio.');
     return;
   }
   working=true;output.value='';update();status('Rewriting and reviewing sentence quality…');
   try{
     const token=window.prowellAdminCsrf?.()||'';
     if(!token)throw Error('Administrator session token is unavailable. Refresh and sign in again.');
     const response=await fetch('/api/admin/paraphrase',{
       method:'POST',
       credentials:'same-origin',
       cache:'no-store',
       headers:{'Content-Type':'application/json','X-Admin-CSRF':token},
       body:JSON.stringify({text:source,tone:$('paraphraseTone').value})
     });
     const data=await response.json();
     if(!response.ok)throw Error(data.error||'The rewrite could not be completed.');
     output.value=data.paraphrased||'';
     status('Editorial rewrite complete. '+(data.outputWords||count(output.value))+' words. Please review meaning and references.');
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
