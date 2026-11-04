'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminKey='', activeTab='jobs';
let dataset={jobs:[],applications:[],candidates:[],reviews:[],reports:[],alerts:[],notification_outbox:[]};
const headings={applications:'Private job applications',jobs:'Submitted vacancies',candidates:'Candidate profiles',reviews:'Community feedback',reports:'Safety reports',alerts:'Future alert interest',notification_outbox:'Notification delivery history'};
async function api(path,options={}){const res=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+adminKey}});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed.');return data;}
async function refresh(){for(const table of Object.keys(dataset)){const data=await api('/api/admin/'+table);dataset[table]=data[table]||[];}render();}
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
function render(){const rows=dataset[activeTab]||[];const filter=$('#adminFilter').value;const shown=rows.filter(x=>filter==='all'||!x.status||x.status===filter);$('#adminHeading').textContent=headings[activeTab];$('#adminTotal').textContent=`(${shown.length})`;$('#adminRecords').innerHTML=shown.length?shown.map(recordMarkup).join(''):'<p class="admin-empty">No records in this view.</p>';$('#adminFilter').disabled=activeTab==='alerts';}
$('#keyForm').addEventListener('submit',async e=>{e.preventDefault();adminKey=$('#adminKey').value;try{await refresh();$('#adminKey').value='';$('#adminStatus').textContent='Connected. Review records and approve only after appropriate checks.';}catch(err){adminKey='';$('#adminStatus').textContent=err.message;}});
$('#adminTabs').addEventListener('click',e=>{const btn=e.target.closest('[data-tab]');if(!btn)return;activeTab=btn.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-selected',String(b===btn));});const filter=$('#adminFilter');filter.innerHTML=activeTab==='notification_outbox'?'<option value="all">All</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="retry">Retry</option><option value="failed">Failed</option>':activeTab==='applications'?'<option value="all">All records</option><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="closed">Closed</option>':'<option value="all">All records</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>';render();});
$('#adminFilter').addEventListener('change',render);
$('#adminRecords').addEventListener('click',async e=>{const btn=e.target.closest('[data-id]');if(!btn||!adminKey)return;const id=btn.dataset.id;const current=dataset[activeTab].find(r=>r.id===id);if(!current)return;const verification=btn.dataset.verified;
 if((btn.dataset.status==='approved'||verification==='true')&&!confirm('Confirm that the content or employer has been checked and may be published / verified.'))return;
 btn.disabled=true;let payload={status:btn.dataset.status||current.status};if(verification!==undefined)payload.verified=verification==='true';
 try{await api(`/api/admin/${activeTab}/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});Object.assign(current,payload);render();$('#adminStatus').textContent='Record updated successfully.';}catch(err){btn.disabled=false;$('#adminStatus').textContent=err.message;}
});
