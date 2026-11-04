/* Writing marketplace front-end. Uses existing secure Prowell member sessions. */
(()=>{'use strict';
const $=x=>document.querySelector(x),e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={session:null,orders:[],mine:null};
async function req(path,method='GET',data){const o={credentials:'same-origin',method,headers:{Accept:'application/json'}};if(data!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(data)}if(method!=='GET'&&state.session?.csrfToken)o.headers['X-Member-CSRF']=state.session.csrfToken;const res=await fetch(path,o);const j=await res.json();if(!res.ok)throw Error(j.error||'Unable to complete request');return j}
function msg(id,t,bad=false){const n=$(id);if(n){n.textContent=t;n.classList.toggle('error',bad)}}
function human(s){return {'open':'Open for bids','assigned':'Writer selected','submitted':'Awaiting admin approval','delivered':'File ready','pending':'Awaiting review','approved':'Approved','rejected':'Needs revision','selected':'Selected','not_selected':'Not selected'}[s]||s}
async function init(){try{state.session=await req('/api/member/me')}catch{state.session={authenticated:false}}
  const cat=$('#orderCategory');if(cat){const result=await req('/api/writing/orders');state.orders=result.orders;cat.innerHTML='<option value="">Choose a service</option>'+result.categories.map(x=>`<option>${e(x)}</option>`).join('');renderOrders()}else{const result=await req('/api/writing/orders');state.orders=result.orders;renderOrders()}
  const role=state.session.member?.role;
  if(['client','employer'].includes(role)&&state.session.member.emailVerified){$('#orderForm').hidden=false;$('#clientLogin').hidden=true}
  if(state.session.authenticated)await refreshMine();else $('#workspaceContent').innerHTML='<p>Already registered? <a href="/account.html?mode=login&next=%2Fwriting.html">Log in</a> or <a href="/account.html?mode=signup&role=writer&next=%2Fwriting.html">create a free account</a>.</p>';
  if($('#orderForm'))$('#orderForm').addEventListener('submit',postOrder);
  if($('#orders')){$('#orders').addEventListener('submit',bid);$('#orders').addEventListener('click',ev=>{const b=ev.target.closest('[data-open-bid]');if(!b)return;const f=$('#orders').querySelector('[data-bid="'+b.dataset.openBid+'"]');if(!f)return;f.hidden=!f.hidden;b.setAttribute('aria-expanded',String(!f.hidden));if(!f.hidden)f.querySelector('input')?.focus()})}
  if($('#workspaceContent')){$('#workspaceContent').addEventListener('click',clickWorkspace);$('#workspaceContent').addEventListener('submit',submitUpload)}
}
function renderOrders(){const n=$('#orders');if(!n)return;
if(!state.orders.length){n.innerHTML='<div class="notice">No open writing projects yet. New requests will appear here.</div>';return}
const ownerIds=new Set((state.mine?.orders||[]).map(x=>x.id));
const bidIds=new Set((state.mine?.bids||[]).map(x=>x.orderId));
n.innerHTML=state.orders.map(o=>{
 const isOwner=ownerIds.has(o.id),alreadyBid=bidIds.has(o.id),loggedIn=state.session.authenticated,
      verified=state.session.member?.emailVerified;
 let action='';
 if(isOwner){action='<p class="bid-note">This is your order. Scroll to <a href="#workspace">My projects & delivery</a> to review writer bids.</p>'}
 else if(alreadyBid){action='<p class="bid-note">✓ Your proposal has been submitted. Track its status below.</p>'}
 else if(!loggedIn){action='<p class="bid-note">Sign in to place a bid.</p>'}
 else if(!verified){action='<p class="bid-note">Verify your email to unlock bidding.</p>'}
 else{action=`<button type="button" class="bid-action" data-open-bid="${e(o.id)}" aria-expanded="false">Place Bid</button>
 <form data-bid="${e(o.id)}" class="mini bid-form" hidden><label>Your price (KSh)<input type="number" name="amountKES" min="0" max="10000000" value="${Number(o.budgetKES)||0}" required></label><label>Days to deliver<input type="number" name="days" min="1" max="120" value="3" required></label><label>Your proposal<textarea required name="proposal" minlength="20" maxlength="1200" placeholder="Explain your experience and proposed approach"></textarea></label><button type="submit" class="bid-action">Submit Bid</button></form>`}
 return `<article class="order"><h3>${e(o.title)}</h3><div class="chips"><span>${e(o.category)}</span><span>Due ${e(o.deadline)}</span><span>Budget ${o.budgetKES?`KSh ${Number(o.budgetKES).toLocaleString()}`:'Discuss'}</span></div><p class="muted">${e(o.publicSummary)}</p>${action}</article>`
}).join('')}

async function postOrder(ev){ev.preventDefault();const f=ev.currentTarget,submit=f.querySelector('[type="submit"]');submit.disabled=true;
const d=Object.fromEntries(new FormData(f));delete d.attachments;d.budgetKES=Number(d.budgetKES);d.integrityConsent=Boolean(f.elements.integrityConsent.checked);
try{const files=Array.from(f.elements.attachments.files||[]);if(files.length>5)throw Error('Upload up to five supporting documents.');
if(files.reduce((total,file)=>total+file.size,0)>60*1024*1024)throw Error('Combined attachments must be 60 MB or smaller.');
d.attachments=await Promise.all(files.map(async file=>{if(file.size>20*1024*1024)throw Error('Each attachment must be 20 MB or smaller.');
const contentBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read file.'));reader.readAsDataURL(file)});
return {filename:file.name,contentBase64}}));
const r=await req('/api/writing/orders','POST',d);msg('#orderMsg',r.message);f.reset();await reload()}catch(x){msg('#orderMsg',x.message,true)}finally{submit.disabled=false}}
async function bid(ev){const f=ev.target;if(!f.matches('[data-bid]'))return;ev.preventDefault();const d=Object.fromEntries(new FormData(f));d.amountKES=Number(d.amountKES);d.days=Number(d.days);try{await req('/api/writing/orders/'+encodeURIComponent(f.dataset.bid)+'/bids','POST',d);msg('#bidMsg','Proposal submitted successfully.');f.reset();await refreshMine()}catch(x){msg('#bidMsg',x.message,true)}}
async function reload(){const d=await req('/api/writing/orders');state.orders=d.orders;renderOrders();await refreshMine()}
async function refreshMine(){if(!state.session.authenticated)return;try{state.mine=await req('/api/writing/my');renderMine();renderOrders()}catch(x){msg('#workMsg',x.message,true)}}
function renderMine(){const d=state.mine,role=state.session.member.role;
let html='';if(['client','employer'].includes(role)){
html='<h3>My writing requests</h3>'+(d.orders.length?d.orders.map(o=>`<article class="record"><h3>${e(o.title)}</h3><p class="muted">${e(o.category)} · ${human(o.status)} · Deadline ${e(o.deadline)}</p>${o.status==='open'?`<button data-viewbids="${e(o.id)}">View writer bids</button><div id="bids-${e(o.id)}"></div>`:''}</article>`).join(''):'<p class="muted">You have not posted a request yet.</p>')}
html+='<h3>My writing bids</h3>'+(d.bids.length?d.bids.map(b=>`<article class="record"><h3>${e(b.title)}</h3><p class="muted">KSh ${Number(b.amountKES).toLocaleString()} · ${human(b.status)} · Order ${human(b.orderStatus)}</p></article>`).join(''):'<p class="muted">No bids yet.</p>')+'<h3>Selected projects</h3>'+(d.assignments.length?d.assignments.map(o=>`<article class="record"><h3>${e(o.title)}</h3><p class="muted">${human(o.status)}</p>${['assigned','submitted','delivered'].includes(o.status)?`<button type="button" data-instructions="${e(o.id)}">View private instructions & documents</button><div id="instructions-${e(o.id)}"></div>`:''}${o.status==='assigned'?`<form data-upload="${e(o.id)}"><label>Upload completed file for administrator review (max 20 MB)<input type="file" accept=".pdf,.docx,.txt,.md,.csv,.rtf,.odt,.xlsx,.pptx,.jpg,.jpeg,.png,.webp,.mp3,.wav,.mp4" required></label><button type="submit">Submit work for review</button></form>`:''}</article>`).join(''):'<p class="muted">No selected projects yet.</p>');
html+='<h3>Deliverable history</h3>'+(d.deliverables.length?d.deliverables.map(f=>`<article class="record"><strong>${e(f.originalName)}</strong> <span class="status">${human(f.status)}</span> ${f.status==='approved'&&['client','employer'].includes(role)?`<a class="download" href="/api/writing/files/${encodeURIComponent(f.id)}">Download approved file</a>`:''}</article>`).join(''):'<p class="muted">No files submitted yet.</p>');$('#workspaceContent').innerHTML=html}

async function clickWorkspace(ev){const b=ev.target.closest('button[data-viewbids],button[data-choose],button[data-instructions]');if(!b)return;try{if(b.dataset.instructions){const id=b.dataset.instructions,r=await req('/api/writing/orders/'+encodeURIComponent(id)+'/instructions');const el=document.getElementById('instructions-'+id);if(el)el.innerHTML='<div class="mini"><h4>Confidential project instructions</h4><p>'+e(r.order.brief)+'</p><h4>Supporting documents</h4>'+(r.attachments.length?r.attachments.map(x=>'<a class="download" href="/api/writing/attachments/'+encodeURIComponent(x.id)+'">'+e(x.originalName)+'</a>').join(' '):'<p>No attachments uploaded.</p>')+'</div>';}else if(b.dataset.viewbids){const id=b.dataset.viewbids,r=await req('/api/writing/orders/'+encodeURIComponent(id)+'/bids');const n=document.getElementById('bids-'+id);n.innerHTML=r.bids.length?r.bids.map(x=>`<article class="mini"><b>${e(x.writerName)}</b> · KSh ${Number(x.amountKES).toLocaleString()} · ${x.days} days <p class="muted">${e(x.proposal)}</p><button data-choose="${e(id)}" data-bidid="${e(x.id)}" type="button">Choose this writer</button></article>`).join(''):'<p>No bids yet.</p>'}
else if(b.dataset.choose){if(!confirm('Select this writer for the project?'))return;await req('/api/writing/orders/'+encodeURIComponent(b.dataset.choose)+'/choose','POST',{bidId:b.dataset.bidid});msg('#workMsg','Writer selected.');await reload()}}catch(x){msg('#workMsg',x.message,true)}}
async function submitUpload(ev){const f=ev.target;if(!f.matches('[data-upload]'))return;ev.preventDefault();const input=f.querySelector('input[type=file]'),file=input.files[0];if(!file)return;if(file.size>20*1024*1024){msg('#workMsg','File must be no larger than 20 MB.',true);return}const button=f.querySelector('button');button.disabled=true;msg('#workMsg','Uploading for administrator review…');try{const contentBase64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.onerror=reject;fr.readAsDataURL(file)});const r=await req('/api/writing/orders/'+encodeURIComponent(f.dataset.upload)+'/deliver','POST',{filename:file.name,contentBase64});msg('#workMsg',r.message);await refreshMine()}catch(x){msg('#workMsg',x.message,true)}finally{button.disabled=false}}
window.addEventListener('DOMContentLoaded',()=>init().catch(e=>msg('#bidMsg','Unable to load the writing marketplace: '+e.message,true)));
})();
