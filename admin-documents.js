/* Admin-only document sender: upload one file and email using the existing Resend setup. */
(()=>{'use strict';
const $=s=>document.querySelector(s);
let csrf='';
let requestId=crypto.randomUUID();
const MAX_BYTES=7*1024*1024;
const allowed=new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','csv','odt','ods','odp','jpg','jpeg','png']);
function alertStatus(message,type='info'){
 const el=$('#sendStatus');el.textContent=message;el.className='notice visible '+type;
}
function readable(n){return (n/(1024*1024)).toFixed(2)+' MB';}
function validateFile(){
 const f=$('#documentFile').files[0];
 if(!f){$('#fileDetail').textContent='No file selected';return false;}
 const ext=f.name.split('.').pop().toLowerCase();
 $('#fileDetail').textContent=f.name+' · '+readable(f.size);
 if(!allowed.has(ext)){alertStatus('Please choose a supported document or image file.','error');return false;}
 if(!f.size||f.size>MAX_BYTES){alertStatus('The document must be larger than 0 bytes and no more than 7 MB.','error');return false;}
 $('#sendStatus').className='notice info';return true;
}
function arrayBufferToBase64(file){
 return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('Could not read the file.'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file);});
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
$('#documentFile').addEventListener('change',validateFile);
$('#senderForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!csrf||!validateFile())return;
 const recipient=$('#recipient').value.trim();const subject=$('#subject').value.trim();
 const file=$('#documentFile').files[0];
 if(!$('#confirmSend').checked)return;
 if(!window.confirm('Send "'+file.name+'" to '+recipient+'?\n\nPlease verify the email address and document before confirming.'))return;
 const button=$('#sendButton');button.disabled=true;button.textContent='Sending document…';alertStatus('Uploading securely to Resend. Please keep this page open.');
 try{
  const content=await arrayBufferToBase64(file);
  const res=await fetch('/api/admin/documents/send',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{
    'Content-Type':'application/json','Accept':'application/json','X-Admin-CSRF':csrf
  },body:JSON.stringify({recipient,subject,message:$('#message').value,filename:file.name,fileBase64:content,requestId,confirmed:true})});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Could not send email.');
  alertStatus(data.message+' Reference: '+data.emailId,'ok');requestId=crypto.randomUUID();
  $('#senderForm').reset();$('#fileDetail').textContent='No file selected';await history();
 }catch(e){alertStatus('Not confirmed sent: '+e.message+'. Check your Resend dashboard before trying again.','error');}
 finally{button.disabled=false;button.textContent='Send Document by Email';}
});
init();
})();
