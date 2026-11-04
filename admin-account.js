/* Owner-only administrator login and permanently single-use setup. */
(()=>{'use strict';
const $=s=>document.querySelector(s);
function notify(message,bad=false){const n=$('#adminOwnerMsg');if(!n)return;n.textContent=message;n.hidden=false;n.dataset.kind=bad?'error':'info';}
async function request(path,data){const r=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const body=await r.json();if(!r.ok)throw Error(body.error||'Request failed');return body;}
async function openAdmin(){
 const section=$('#adminOwnerSection');if(!section)return;
 document.querySelectorAll('.auth-form').forEach(f=>f.hidden=true);
 section.hidden=false;
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false')});
 const b=$('[data-admin-entry]');if(b){b.classList.add('selected');b.setAttribute('aria-pressed','true')}
 const url=new URL(location.href);url.searchParams.set('mode','admin');history.replaceState(null,'',url.pathname+url.search);
 $('#adminOwnerLogin').hidden=true;$('#adminOwnerSetup').hidden=true;$('#adminOwnerMsg').hidden=true;
 try{const state=await request('/api/admin/bootstrap/status');
   if(state.registrationOpen){$('#adminOwnerSetup').hidden=false;notify('Initial setup is available only to the holder of the private Railway ADMIN_KEY.');}
   else{$('#adminOwnerLogin').hidden=false;notify('Administrator registration is closed. Sign in with your owner email and password.');}
 }catch(e){notify('Unable to check administrator setup status: '+e.message,true)}
}
function submit(formId,url){const f=$('#'+formId);f?.addEventListener('submit',async ev=>{ev.preventDefault();const btn=f.querySelector('[type=submit]');btn.disabled=true;
 try{const data=Object.fromEntries(new FormData(f));if(formId==='adminOwnerSetup'&&data.password!==data.confirmPassword)throw Error('Passwords do not match.');
 await request(url,data);location.assign('/admin.html');}
 catch(e){notify(e.message,true);if(url.endsWith('/bootstrap')&&/already|closed|created/i.test(e.message))openAdmin();}
 finally{btn.disabled=false;}
});}
window.addEventListener('DOMContentLoaded',()=>{
 if(!$('[data-admin-entry]'))return;
 submit('adminOwnerSetup','/api/admin/bootstrap');submit('adminOwnerLogin','/api/admin/login');
 $('[data-admin-entry]').addEventListener('click',openAdmin);
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{
   $('#adminOwnerSection').hidden=true;$('[data-admin-entry]').classList.remove('selected');
   $('[data-admin-entry]').setAttribute('aria-pressed','false');
 }));
 if(new URLSearchParams(location.search).get('mode')==='admin')openAdmin();
});})();
