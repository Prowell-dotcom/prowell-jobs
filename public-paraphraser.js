'use strict';
// Prowell Humanizer: public writing editor, no login required.
// Only local editing is available. Do not send credentials or private API keys.
(() => {
  const $ = id => document.getElementById(id);
  const form=$('publicParaphraseForm');
  if(!form)return;
  const source=$('publicParaphraseInput'), result=$('publicParaphraseOutput');
  const submit=$('publicParaphraseSubmit'), status=$('publicParaphraseStatus');
  const copy=$('publicParaphraseCopy'), save=$('publicParaphraseDownload');
  const counter=$('publicParaphraseCount');
  const wordCount=value=>(String(value||'').trim().match(/\S+/gu)||[]).length;
  let busy=false;
  const notify=(message,kind='info')=>{
    status.textContent=message;
    status.dataset.state=kind;
  };
  function refresh(){
    const count=wordCount(source.value);
    counter.textContent=count.toLocaleString()+' / 3,000 words';
    counter.classList.toggle('pp-over',count>3000);
    submit.disabled=busy;
    copy.disabled=!result.value.trim();
    save.disabled=!result.value.trim();
  }
  source.addEventListener('input',refresh);
  source.addEventListener('paste',()=>setTimeout(refresh,0));
  source.addEventListener('change',refresh);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    const text=source.value.trim();
    const count=wordCount(text);
    if(!count){notify('Paste or type some text before selecting Humanize text.','error');return;}
    if(count>3000){notify('Maximum 3,000 words; remove '+(count-3000)+' words.','error');return;}
    busy=true;
    result.value='';
    result.placeholder='Improving wording and sentence clarity…';
    notify('Prowell Humanizer is improving your writing…');
    refresh();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('/api/paraphrase',{
        method:'POST',cache:'no-store',credentials:'omit',
        signal:controller.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          text,engine:'local',tone:$('publicParaphraseTone').value,
          protectedTerms:$('publicParaphraseProtectedTerms').value.trim()
        })
      });
      let data;
      try{data=await response.json();}
      catch(_){throw Error('Unexpected server response. Refresh and try again.');}
      if(!response.ok)throw Error(data?.error||'Rewriting failed (HTTP '+response.status+').');
      if(!data||typeof data.paraphrased!=='string'||!data.paraphrased.trim()){
        throw Error('The editor returned no revised text.');
      }
      result.value=data.paraphrased;
      result.placeholder='Your humanized result will appear here.';
      const percent=Number(data.editableTextChangePercent);
      const description=(typeof data.editStrength==='string'&&Number.isFinite(percent))?
        (' '+data.editStrength+' edit: '+percent+'% of editable wording changed (not a human-authorship score).'):'';
      notify('Completed — '+wordCount(result.value).toLocaleString()+
        ' words.'+description+' Review the revised text for accuracy.','success');
    }catch(error){
      const message=error?.name==='AbortError'?
        'The request timed out. Please try a shorter passage.':
        (error?.message||'Could not complete the rewrite.');
      result.placeholder='No result generated.';
      notify(message,'error');
    }finally{
      clearTimeout(timeout);
      busy=false;
      refresh();
    }
  });
  $('publicParaphraseClear').addEventListener('click',()=>{
    if(busy)return;
    source.value='';
    result.value='';
    result.placeholder='Your humanized result will appear here.';
    $('publicParaphraseProtectedTerms').value='';
    notify('Ready to improve your writing. No login required.');
    refresh();
  });
  copy.addEventListener('click',async()=>{
    if(!result.value.trim())return;
    try{
      await navigator.clipboard.writeText(result.value);
      notify('Humanized text copied.','success');
    }catch(_){
      result.focus();
      result.select();
      notify('Select the text and press Ctrl+C to copy it.');
    }
  });
  save.addEventListener('click',()=>{
    if(!result.value.trim())return;
    const blob=new Blob([result.value],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download='prowell-humanized-text.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2500);
    notify('Humanized text saved.','success');
  });
  refresh();
})();
