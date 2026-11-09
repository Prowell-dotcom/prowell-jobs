/* Sole-owner administrator access + email recovery. No public admin registration. */
(()=>{'use strict';
const $=s=>document.querySelector(s);
const forms=['adminOwnerLogin','adminOwnerSetup','adminRecoveryEmail','adminRecoveryReset'];
function notify(message,bad=false){const n=$('#adminOwnerMsg');if(!n)return;n.textContent=message;n.hidden=false;n.dataset.kind=bad?'error':'info';}
function show(id){forms.forEach(name=>{const el=$('#'+name);if(el)el.hidden=name!==id})}
async function request(path,data){const r=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const body=await r.json();if(!r.ok)throw Error(body.error||'Request failed');return body;}
function clearResetToken(){const u=new URL(location.href);u.searchParams.delete('adminReset');u.searchParams.set('mode','admin');history.replaceState(null,'',u.pathname+u.search)}
async function openAdmin(){
 const section=$('#adminOwnerSection');if(!section)return;
 document.querySelectorAll('.auth-form').forEach(f=>f.hidden=true);
 section.hidden=false;
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false')});
 const btn=$('[data-admin-entry]');if(btn){btn.classList.add('selected');btn.setAttribute('aria-pressed','true')}
 const u=new URL(location.href);u.searchParams.set('mode','admin');history.replaceState(null,'',u.pathname+u.search);
 const msg=$('#adminOwnerMsg');if(msg)msg.hidden=true;
 try {const state=await request('/api/admin/bootstrap/status');
   const token=new URLSearchParams(location.search).get('adminReset');
   if(token && !state.registrationOpen){show('adminRecoveryReset');notify('Set a new password for your existing administrator account.');}
   else if(state.registrationOpen){show('adminOwnerSetup');notify('One-time owner setup requires the private Railway ADMIN_KEY.');}
   else {show('adminOwnerLogin');notify('Sign in using your sole administrator email and password.');}
 }catch(e){notify('Unable to check administrator status: '+e.message,true)}
}
function bind(formId,url,onSuccess){const f=$('#'+formId);if(!f)return;f.addEventListener('submit',async ev=>{ev.preventDefault();const button=f.querySelector('[type=submit]');button.disabled=true;
 try{const data=Object.fromEntries(new FormData(f));if(data.confirmPassword!==undefined&&data.password!==data.confirmPassword)throw Error('Passwords do not match.');
   const result=await request(url,data);await onSuccess(result);}
 catch(e){notify(e.message,true);if(url.endsWith('/bootstrap')&&/already|closed|created/i.test(e.message))openAdmin()}
 finally{button.disabled=false}
});}
window.addEventListener('DOMContentLoaded',()=>{
 if(!$('[data-admin-entry]'))return;
 bind('adminOwnerSetup','/api/admin/bootstrap',async()=>location.assign('/admin.html'));
 bind('adminOwnerLogin','/api/admin/login',async()=>location.assign('/admin.html'));
 bind('adminRecoveryEmail','/api/admin/recovery/start',async r=>{notify(r.message);});
 bind('adminRecoveryReset','/api/admin/recovery/complete',async r=>{
   clearResetToken();show('adminOwnerLogin');$('#adminRecoveryReset').reset();notify(r.message);
 });
 $('#adminForgotLink')?.addEventListener('click',()=>{show('adminRecoveryEmail');notify('A recovery link will be sent only to the existing owner email address.')});
 document.querySelectorAll('[data-admin-back]').forEach(b=>b.addEventListener('click',()=>{clearResetToken();show('adminOwnerLogin');notify('Sign in using the administrator account email and password.')}));
 $('[data-admin-entry]').addEventListener('click',openAdmin);
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{$('#adminOwnerSection').hidden=true;$('[data-admin-entry]').classList.remove('selected');$('[data-admin-entry]').setAttribute('aria-pressed','false')}));
 if(new URLSearchParams(location.search).get('mode')==='admin'||new URLSearchParams(location.search).has('adminReset'))openAdmin();
});})();
