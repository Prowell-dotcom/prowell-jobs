/* Administrator-only, multi-attachment Resend sender; bounded in memory. */
(()=>{'use strict';
const $=s=>document.querySelector(s);
let csrf='';
let requestId=crypto.randomUUID();
const selectedFiles=[];
const MAX_FILES=5, MAX_BYTES=7*1024*1024, MAX_TOTAL_BYTES=15*1024*1024;
const allowed=new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','csv','odt','ods','odp','jpg','jpeg','png']);
function alertStatus(message,type='info'){
 const el=$('#sendStatus');el.textContent=message;el.className='notice visible '+type;
}
function readable(n){return (n/(1024*1024)).toFixed(2)+' MB';}
function totalBytes(){return selectedFiles.reduce((n,f)=>n+f.size,0);}
function renderFiles(){
 const node=$('#fileDetail');node.replaceChildren();
 if(!selectedFiles.length){node.textContent='No files selected';return;}
 const summary=document.createElement('div');summary.className='file-count';
 summary.textContent=selectedFiles.length+' of '+MAX_FILES+' files · '+readable(totalBytes())+' of '+readable(MAX_TOTAL_BYTES)+' total';
 node.appendChild(summary);
 selectedFiles.forEach((file,index)=>{
  const row=document.createElement('div');row.className='file-row';
  const label=document.createElement('span');label.textContent=file.name+' · '+readable(file.size);
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';
  remove.setAttribute('aria-label','Remove '+file.name);
  remove.addEventListener('click',()=>{selectedFiles.splice(index,1);renderFiles();});
  row.append(label,remove);node.appendChild(row);
 });
}
function addFiles(files){
 let problem='';
 for(const file of files){
  const ext=file.name.split('.').pop().toLowerCase();
  if(!allowed.has(ext)){problem='Unsupported file type: '+file.name;continue;}
  if(!file.size || file.size>MAX_BYTES){problem='Each file must be between 1 byte and 7 MB: '+file.name;continue;}
  if(selectedFiles.some(f=>f.name===file.name && f.size===file.size && f.lastModified===file.lastModified))continue;
  if(selectedFiles.length>=MAX_FILES){problem='You can attach up to five documents per email.';break;}
  if(totalBytes()+file.size>MAX_TOTAL_BYTES){problem='Combined attachment size cannot exceed 15 MB.';continue;}
  selectedFiles.push(file);
 }
 renderFiles();
 if(problem)alertStatus(problem,'error');
 else $('#sendStatus').className='notice info';
}
function validateFiles(){
 if(!selectedFiles.length){alertStatus('Add at least one document before sending.','error');return false;}
 if(selectedFiles.length>MAX_FILES||totalBytes()>MAX_TOTAL_BYTES){alertStatus('Attachment limit exceeded.','error');return false;}
 return true;
}
function fileToBase64(file){
 return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('Could not read '+file.name));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file);});
}
async function history(){
 const list=$('#historyList');
 try{
  const r=await fetch('/api/admin/documents/history',{credentials:'same-origin',cache:'no-store'});
  const data=await r.json();if(!r.ok)throw Error(data.error||'History unavailable');
  list.replaceChildren();
  if(!data.records.length){const li=document.createElement('li');li.textContent='No document emails sent yet.';list.appendChild(li);return;}
  for(const item of data.records){
   const li=document.createElement('li');const title=document.createElement('strong');title.textContent=item.filename+' → '+item.recipient;
   const sub=document.createElement('small');sub.textContent=item.subject+' · '+new Date(item.sentAt).toLocaleString();
   const ref=document.createElement('small');ref.textContent='Resend ID: '+(item.providerEmailId||'Unknown');
   li.append(title,sub,ref);list.appendChild(li);
  }
 }catch(e){list.textContent=e.message;}
}
async function init(){
 try{
  const r=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store'});
  const data=await r.json();if(!data.authenticated||!data.csrfToken){
   alertStatus('Please sign in as administrator before sending documents.','error');
   $('#historyList').textContent='Administrator sign-in required.';return;
  }
  csrf=data.csrfToken;$('#sendButton').disabled=false;await history();
 }catch(e){alertStatus('Could not verify administrator session: '+e.message,'error');}
}
$('#documentFile').addEventListener('change',ev=>{
 addFiles(Array.from(ev.target.files||[]));ev.target.value=''; // Allow adding more files on later selections.
});
$('#senderForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!csrf||!validateFiles())return;
 const recipient=$('#recipient').value.trim(),subject=$('#subject').value.trim();
 if(!$('#confirmSend').checked)return;
 const summary=selectedFiles.map(f=>f.name).join('\n');
 if(!window.confirm('Send '+selectedFiles.length+' document(s) to '+recipient+'?\n\n'+summary+'\n\nPlease verify the address and files.'))return;
 const button=$('#sendButton');button.disabled=true;button.textContent='Sending '+selectedFiles.length+' documents…';
 alertStatus('Uploading attachments securely to Resend. Please keep this page open.');
 try{
  const attachments=await Promise.all(selectedFiles.map(async f=>({filename:f.name,contentBase64:await fileToBase64(f)})));
  const res=await fetch('/api/admin/documents/send',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{
    'Content-Type':'application/json','Accept':'application/json','X-Admin-CSRF':csrf
  },body:JSON.stringify({recipient,subject,message:$('#message').value,attachments,requestId,confirmed:true})});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Could not send email.');
  alertStatus(data.message+' Reference: '+data.emailId,'ok');requestId=crypto.randomUUID();
  selectedFiles.length=0;$('#senderForm').reset();renderFiles();await history();
 }catch(e){alertStatus('Not confirmed sent: '+e.message+'. Check your Resend dashboard before trying again.','error');}
 finally{button.disabled=false;button.textContent='Send Documents by Email';}
});
renderFiles();init();
})();
