'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let signedIn=false, csrfToken='', activeTab='jobs';
let unreadCounts={};
let dataset={jobs:[],applications:[],candidates:[],reviews:[],reports:[],alerts:[],notification_outbox:[]};
const tabLabels={jobs:'Vacancies',applications:'Applications',candidates:'Candidates',reviews:'Reviews & comments',reports:'Safety reports',alerts:'Alert interest',notification_outbox:'Notifications'};
const headings={applications:'Private job applications',jobs:'Submitted vacancies',candidates:'Candidate profiles',reviews:'Community feedback',reports:'Safety reports',alerts:'Future alert interest',notification_outbox:'Notification delivery history'};
async function api(path,options={}){
 const method=(options.method||'GET').toUpperCase();
 const headers={...options.headers};
 if(['POST','PATCH','DELETE','PUT'].includes(method)&&csrfToken)headers['X-Admin-CSRF']=csrfToken;
 const res=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers});
 const data=await res.json();
 if(!res.ok){if(res.status===401&&signedIn)showSignedOut('Your session expired. Please sign in again.');throw Error(data.error||'Request failed.');}
 return data;
}
function renderUnreadBadges(){
 document.querySelectorAll('#adminTabs [data-tab]').forEach(button=>{
   const section=button.dataset.tab;
   const count=signedIn?Math.max(0,Number(unreadCounts[section]||0)):0;
   // "New" badges disappear once the section is opened; total counts remain in the heading.
   const badge=count?` <span class="admin-tab-badge" aria-hidden="true">${count>99?'99+':count}</span>`:'';
   button.innerHTML=tabLabels[section]+badge;
   button.setAttribute('aria-label',tabLabels[section]+(count?`, ${count} new`:', no new items'));
 });
}
async function fetchUnreadCounts(){
 if(!signedIn)return;
 const result=await api('/api/admin/unread_counts');
 unreadCounts=result.unread||{};
 renderUnreadBadges();
}
async function markSectionViewed(section){
 if(!signedIn)return;
 // A server-side read cursor survives refreshes, logout, and a later admin sign-in.
 await api('/api/admin/tab-viewed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({section})});
 unreadCounts[section]=0;
 renderUnreadBadges();
}
function showSignedIn(){signedIn=true;renderUnreadBadges();$('#keyForm').hidden=true;$('#sessionPanel').hidden=false;$('#notificationDiagnostics').hidden=activeTab!=='notification_outbox';}
function showSignedOut(message='Signed out. Use your administrator account to sign in again.'){
 signedIn=false;csrfToken='';unreadCounts={};renderUnreadBadges();dataset={jobs:[],applications:[],candidates:[],reviews:[],reports:[],alerts:[],notification_outbox:[]};
 $('#sessionPanel').hidden=true;$('#keyForm').hidden=false;$('#adminKey').value='';
 $('#adminStatus').textContent=message;$('#notificationDiagnostics').hidden=true;render();
}
async function refresh(){if(!signedIn)return;
 for(const table of Object.keys(dataset)){const data=await api('/api/admin/'+table);dataset[table]=data[table]||[];}
 render();
 await fetchUnreadCounts();
 await markSectionViewed(activeTab);
 if(activeTab==='notification_outbox')await refreshNotificationStatus();
}
async function refreshNotificationStatus(){
 if(!signedIn)return;
 const stat=await api('/api/admin/notification_status');
 const states=stat.notificationCounts||{};
 const flag=(ok)=>ok?'Ready':'Not configured';
 const last=stat.lastJobCreatedAt?new Date(stat.lastJobCreatedAt).toLocaleString():'No jobs submitted';
 $('#notificationStatus').innerHTML='<p><b>Resend credentials:</b> '+flag(stat.emailConfigured)+'</p>'+
 '<p><b>Sending email format:</b> '+flag(stat.senderConfigured)+'</p>'+
 '<p><b>Administrator recipient:</b> '+esc(stat.adminRecipient)+'</p>'+
 '<p><b>Jobs in database:</b> '+Number(stat.jobCount||0)+' · <b>Most recent:</b> '+esc(last)+'</p>'+
 '<p><b>Queue totals:</b> '+Object.entries(states).map(([k,v])=>esc(k)+': '+Number(v)).join(', ').replace(/^$/,'0')+'</p>'+
 '<p>Notifications are queued for new jobs submitted after activation; older job submissions are not automatically notified.</p>';
 $('#testEmailButton').disabled=!(stat.emailConfigured&&stat.senderConfigured&&stat.adminRecipientConfigured);
}

function detailText(label,value){return `<p><b>${esc(label)}:</b> ${esc(value||'Not provided')}</p>`;}
function actions(row){if(activeTab==='alerts'||activeTab==='notification_outbox')return '';
 const buttons=activeTab==='applications'?[['reviewed','approve','Mark reviewed'],['closed','reject','Close'],['pending','','Pending']]:[['approved','approve','Approve'],['rejected','reject','Reject'],['pending','','Pending']];
 if(activeTab==='reports')buttons[0][2]='Resolved';
 const base=buttons.map(([status,cls,label])=>`<button type="button" class="${cls}" data-id="${esc(row.id)}" data-status="${status}" ${row.status===status?'disabled':''}>${label}</button>`).join('');
 return `<div class="admin-actions">${base}${activeTab==='jobs'?`<button type="button" data-id="${esc(row.id)}" data-verified="${row.verified?'false':'true'}">${row.verified?'Remove Verified':'Mark Verified'}</button>`:''}</div>`;
}
function recordMarkup(r){let title='',desc='',full='';
 if(activeTab==='jobs'){
   title=`${esc(r.title)}${r.verified?' · ✓ Employer Verified':''}`;
   desc=`${esc(r.company)} · ${esc(r.location)} · ${esc(r.jobType)} · ${esc(r.category)}`;
   full=detailText('Description',r.description)+detailText('Responsibilities',r.responsibilities)+detailText('Requirements',r.requirements)+detailText('Pay',`${r.currency||''} ${r.salaryMin??'?'} – ${r.salaryMax??'?'} per ${r.payPeriod||'month'}`)+detailText('Apply email',r.email)+detailText('Apply URL',r.applyUrl)+detailText('Phone',r.phone)+detailText('Deadline',r.deadline)+detailText('Private notification email',r.notifyEmail)+detailText('Private SMS number',r.notifyPhone)+detailText('Notifications consent',r.notifyConsent?'Yes':'No');
 } else if(activeTab==='applications'){
   title=esc(r.fullName);desc=`Applied for ${esc(r.jobTitle)} · ${esc(r.employerName)}`;
   full=detailText('Job ID',r.jobId)+detailText('Country',r.country)+detailText('City / area',r.city)+detailText('Experience',r.experience)+detailText('Applicant message',r.message)+detailText('PRIVATE email',r.email)+detailText('PRIVATE phone',r.phone)+detailText('Consent',r.consent?'Received':'Not received')+'<p><strong>Private:</strong> Do not send details to an employer without verifying them and obtaining further express permission from the applicant.</p>';
 } else if(activeTab==='candidates'){
   title=esc(r.alias);desc=`${esc(r.category)} · ${esc(r.city||'')}, ${esc(r.country)} · ${esc(r.availability)}`;
   full=detailText('Skills',r.skills)+detailText('Summary',r.summary)+detailText('Experience',r.experience)+detailText('Expected pay',r.payExpectation)+detailText('PRIVATE email',r.email)+detailText('PRIVATE phone',r.phone)+detailText('Consent',r.consent?'Explicit consent received':'NO CONSENT');
 } else if(activeTab==='reviews'){
   title=esc(r.name);desc=`${esc(r.relationship)} · ${esc(r.kind)}${r.rating?' · '+r.rating+'/5':''}`;
   full=detailText('Feedback',r.comment);
 } else if(activeTab==='reports'){
   title=esc(r.subject);desc='Confidential report — never shown publicly';
   full=detailText('Report',r.details)+detailText('Email',r.email);
 } else if(activeTab==='notification_outbox'){
   title=esc(r.subject);desc=`${esc(r.channel)} · ${esc(r.status)} · ${esc(r.recipient)}`;
   full=detailText('Event',r.kind)+detailText('Attempts',r.attempts)+detailText('Sent on',r.sentAt)+detailText('Last error type',r.lastError);
 } else {
   title=esc(r.email);desc=`Sector: ${esc(r.category||'All')} · Country: ${esc(r.country||'Any')}`;
   full=detailText('Opt-in',r.consent?'Yes':'No')+'<p>Automated email delivery is not enabled.</p>';
 }
 return `<article class="admin-item"><div><h3>${title} ${r.status?`<span class="admin-pill ${esc(r.status)}">${esc(r.status)}</span>`:''}</h3><p>${desc} · ${esc(new Date(r.createdAt).toLocaleDateString())}</p><details><summary>View details${activeTab==='candidates'?' (private contact included)':''}</summary><div>${full}</div></details></div>${actions(r)}</article>`;
}
function render(){if(!signedIn){$('#adminTotal').textContent='(—)';$('#adminRecords').innerHTML='<p class="admin-empty">Sign in to review records.</p>';return;}const rows=dataset[activeTab]||[];const filter=$('#adminFilter').value;const shown=rows.filter(x=>filter==='all'||!x.status||x.status===filter);$('#adminHeading').textContent=headings[activeTab];$('#adminTotal').textContent=`(${shown.length})`;$('#adminRecords').innerHTML=shown.length?shown.map(recordMarkup).join(''):'<p class="admin-empty">No records in this view.</p>';$('#adminFilter').disabled=activeTab==='alerts';}
$('#keyForm').addEventListener('submit',e=>{e.preventDefault();location.assign('/account.html?mode=admin');});
$('#logoutButton').addEventListener('click',async()=>{
 try{await api('/api/admin/logout',{method:'POST'});}catch(err){$('#adminStatus').textContent='Unable to end session: '+err.message;return;}
 showSignedOut('Signed out successfully.');
});
$('#refreshNotificationsButton').addEventListener('click',async()=>{try{await refresh();$('#testEmailStatus').textContent='Delivery history refreshed.';}catch(err){$('#testEmailStatus').textContent='Refresh failed: '+err.message;}});
$('#testEmailButton').addEventListener('click',async()=>{
 const btn=$('#testEmailButton');btn.disabled=true;
 try{const data=await api('/api/admin/notifications/test',{method:'POST'});
 $('#testEmailStatus').textContent=data.message;
 await refresh();}catch(err){$('#testEmailStatus').textContent='Test could not be queued: '+err.message;}
 finally{if(signedIn)btn.disabled=false;}
});
(async()=>{try{
 const session=await api('/api/admin/session');
 if(session.authenticated&&session.csrfToken){csrfToken=session.csrfToken;showSignedIn();await refresh();$('#adminStatus').textContent='Welcome back. Your administrator session was restored.';}
 else showSignedOut('Please sign in with your administrator account.');
}catch(err){showSignedOut('Unable to check your session: '+err.message);}})();
$('#adminTabs').addEventListener('click',async e=>{
 const btn=e.target.closest('[data-tab]');if(!btn)return;
 const section=btn.dataset.tab;
 activeTab=section;
 document.querySelectorAll('#adminTabs [data-tab]').forEach(b=>{
   b.classList.toggle('active',b===btn);
   b.setAttribute('aria-selected',String(b===btn));
 });
 const filter=$('#adminFilter');filter.innerHTML=activeTab==='notification_outbox'?'<option value="all">All</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="retry">Retry</option><option value="failed">Failed</option>':activeTab==='applications'?'<option value="all">All records</option><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="closed">Closed</option>':'<option value="all">All records</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>';
 render();$('#notificationDiagnostics').hidden=!(signedIn&&activeTab==='notification_outbox');
 if(!signedIn)return;
 try{
   // Refresh this section first, so a new item is actually visible before marking it viewed.
   const result=await api('/api/admin/'+section);
   dataset[section]=result[section]||[];
   if(activeTab!==section)return;
   render();
   await markSectionViewed(section);
   if(section==='notification_outbox')await refreshNotificationStatus();
 }catch(err){$('#adminStatus').textContent='Could not load this section: '+err.message;}
});
// Lightweight live checks: show newly submitted records without page reload.
setInterval(()=>{if(signedIn)fetchUnreadCounts().catch(()=>{});},45000);

$('#adminFilter').addEventListener('change',render);
$('#adminRecords').addEventListener('click',async e=>{const btn=e.target.closest('[data-id]');if(!btn||!signedIn)return;const id=btn.dataset.id;const current=dataset[activeTab].find(r=>r.id===id);if(!current)return;const verification=btn.dataset.verified;
 if((btn.dataset.status==='approved'||verification==='true')&&!confirm('Confirm that the content or employer has been checked and may be published / verified.'))return;
 btn.disabled=true;let payload={status:btn.dataset.status||current.status};if(verification!==undefined)payload.verified=verification==='true';
 try{await api(`/api/admin/${activeTab}/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});Object.assign(current,payload);render();$('#adminStatus').textContent='Record updated successfully.';}catch(err){btn.disabled=false;$('#adminStatus').textContent=err.message;}
});
