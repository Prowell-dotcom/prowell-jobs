/* Prowell Jobs: secure member session UI. No API keys or passwords stored in web storage. */
(()=>{
'use strict';
let current=null;
let ready=null;
const qs=(s)=>document.querySelector(s);
const safe=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function session(force=false){
  if(ready&&!force)return ready;
  ready=fetch('/api/member/me',{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'}).then(async r=>{
    if(!r.ok)throw Error('Unable to check login status.');
    current=await r.json();updateNav();return current;
  }).catch(()=>{current=null;return {authenticated:false};});
  return ready;
}
function updateNav(){
  document.querySelectorAll('[data-member-guest]').forEach(n=>n.hidden=Boolean(current?.authenticated));
  document.querySelectorAll('[data-member-user]').forEach(n=>n.hidden=!current?.authenticated);
  document.querySelectorAll('[data-member-name]').forEach(n=>n.textContent=current?.member?.fullName||'');
}
async function api(url,options={}){
  await session();
  const headers=new Headers(options.headers||{});
  if(current?.csrfToken)headers.set('X-Member-CSRF',current.csrfToken);
  return fetch(url,{...options,headers,credentials:'same-origin'});
}
async function requireRole(role){
  const state=await session();
  if(!state.authenticated){
    const intent=role==='employer'?'post':'apply';
    const next='/jobs.html'+(role==='employer'?'?post=1#jobs':'#jobs');
    location.href='/account.html?mode=signup&role='+encodeURIComponent(role)+'&intent='+intent+'&next='+encodeURIComponent(next);
    return false;
  }
  if(state.member.role!==role){
    alert('This action requires a '+(role==='employer'?'business/employer':'job-seeker')+' account. You are signed in as '+state.member.role+'.');
    return false;
  }
  if(!state.member.emailVerified){
    alert('Please verify your email before submitting. Check the verification link sent to '+state.member.email+'.');
    return false;
  }
  return true;
}
async function json(url,data){
  const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed.');return result;
}
async function logout(){
  try{await json('/api/member/logout',{});}finally{current=null;ready=null;location.href='/';}
}
window.ProwellAuth={session,fetch:api,json,requireRole,logout,safe};
window.addEventListener('DOMContentLoaded',()=>{
  session();document.querySelectorAll('[data-member-logout]').forEach(b=>b.addEventListener('click',logout));
  const page=document.body.dataset.page;
  if(page==='account')initAccount();
  if(page==='dashboard')initDashboard();
});
function setMsg(msg,kind){const box=qs('#authStatus');if(box){box.textContent=msg;box.dataset.kind=kind||'info';box.hidden=false;}}
function switchMode(mode){
  const forms={login:'loginForm',signup:'signupForm',forgot:'forgotForm',reset:'resetForm'};
  Object.entries(forms).forEach(([name,id])=>{
    const form=qs('#'+id);
    if(form)form.hidden=name!==mode;
  });
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  const msg=qs('#authStatus');if(msg)msg.hidden=true;
}
function initAccount(){
  const params=new URLSearchParams(location.search);
  if(params.get('verified')){setMsg(params.get('verified')==='1'?'Email verified. You can sign in and start using Prowell Jobs.':'Verification link invalid or expired. Please contact support.','info');}
  const mode=params.has('reset')?'reset':(params.get('mode')==='signup'?'signup':'login');switchMode(mode);
  if(params.get('verified'))setMsg(params.get('verified')==='1'?'Your email is verified. Welcome to Prowell Jobs.':'The verification link was invalid or expired. Please contact support.',params.get('verified')==='1'?'success':'error');
  if(params.get('role')&&qs('#signupRole'))qs('#signupRole').value=params.get('role');
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.mode)));
  const nextRaw=params.get('next')||'/dashboard.html';
  const next=(nextRaw.startsWith('/')&&!nextRaw.startsWith('//')&&!nextRaw.includes('\\'))?nextRaw:'/dashboard.html';
  const bind=(id,endpoint,converter,onSuccess)=>{const form=qs('#'+id);if(!form)return;form.addEventListener('submit',async e=>{
    e.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{const obj=converter(new FormData(form));const result=await json(endpoint,obj);onSuccess(result);}catch(err){setMsg(err.message,'error');}finally{button.disabled=false;}
  });};
  bind('loginForm','/api/member/login',f=>({email:f.get('email'),password:f.get('password')}),()=>location.assign(next));
  bind('signupForm','/api/member/signup',f=>({fullName:f.get('fullName'),email:f.get('email'),role:f.get('role'),phone:f.get('phone'),password:f.get('password'),consent:f.get('consent')==='on'}),()=>location.assign('/dashboard.html?welcome=1'));
  bind('forgotForm','/api/member/forgot',f=>({email:f.get('email')}),r=>setMsg(r.message,'success'));
  bind('resetForm','/api/member/reset',f=>({token:params.get('reset'),password:f.get('password')}),r=>{switchMode('login');setMsg(r.message,'success');history.replaceState(null,'','/account.html');});
  session().then(s=>{if(s.authenticated){const p=qs('#alreadySignedIn');if(p){p.hidden=false;p.innerHTML='Signed in as <strong>'+safe(s.member.fullName)+'</strong>. <a href="/dashboard.html">Open your dashboard →</a>';}}});
}
async function initDashboard(){
  const s=await session();if(!s.authenticated){location.replace('/account.html?mode=login&next=%2Fdashboard.html');return;}
  const name=qs('#dashName'),role=qs('#dashRole'),verification=qs('#emailVerifyState');
  if(name)name.textContent=s.member.fullName.split(' ')[0];
  if(role)role.textContent=s.member.role==='employer'?'Employer dashboard':'Job seeker dashboard';
  if(verification){verification.textContent=s.member.emailVerified?'Email verified':'Please check your email to verify your account before applying or posting.';verification.dataset.verified=String(Boolean(s.member.emailVerified));}
  const e=qs('#employerActions'),j=qs('#seekerActions');if(e)e.hidden=s.member.role!=='employer';if(j)j.hidden=s.member.role!=='jobseeker';
  try{const r=await api('/api/member/dashboard');const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load your dashboard');
    [['jobs','jobsList','jobTitle'],['applications','applicationsList','jobTitle'],['candidates','profilesList','alias']].forEach(([key,id,fallback])=>{
      const arr=d[key]||[],node=qs('#'+id);if(!node)return;
      if(!arr.length){node.innerHTML='<div class="empty-list">No submissions yet. New activity will appear here.</div>';return;}
      node.innerHTML=arr.map(x=>'<article class="member-record"><div><strong>'+safe(x.title||x.jobTitle||x.alias||'Submission')+'</strong><small>'+safe(x.company||x.employerName||x.category||'')+' · '+safe((x.createdAt||'').slice(0,10))+'</small></div><span class="status-pill '+safe(x.status)+'">'+safe(x.status||'pending')+'</span></article>').join('');
    });
    const stat=qs('#dashCount');if(stat)stat.textContent=s.member.role==='employer'?d.jobs.length:d.applications.length;
  }catch(err){const el=qs('#dashError');if(el){el.textContent=err.message;el.hidden=false;}}
}
})();
