'use strict';
// Prowell Humanizer: public writing editor, no login required.
// Only local editing is available. Do not send credentials or private API keys.
(() => {
  if(window.__prowellHumanizerInitialized)return;
  const $ = id => document.getElementById(id);
  const form=$('publicParaphraseForm');
  if(!form)return;
  window.__prowellHumanizerInitialized=true;
  const source=$('publicParaphraseInput'), result=$('publicParaphraseOutput');
  const submit=$('publicParaphraseSubmit'), retry=$('publicParaphraseAgain');
  const status=$('publicParaphraseStatus');
  const copy=$('publicParaphraseCopy'), save=$('publicParaphraseDownload');
  const counter=$('publicParaphraseCount');
  const depth=$('publicParaphraseLevel');
  const depthValue=$('publicParaphraseLevelValue');
  const depthDescription=$('publicParaphraseLevelDescription');
  const depthDescriptions=[
    'Minimal cleanup and removal of filler',
    'Light wording improvements',
    'Conservative phrase edits',
    'Clearer student-friendly expressions',
    'More concise phrasing and vocabulary',
    'Phrase editing with safe clause changes',
    'More sentence restructuring where supported',
    'Stronger structural edits and targeted wording',
    'Extensive safe sentence and phrase changes',
    'Maximum supported rule-based rewriting'
  ];
  function updateDepth(){
    const level=Number(depth.value)||9;
    depthValue.textContent='Level '+level+' / 10';
    depthDescription.textContent=depthDescriptions[level-1]+
      '. The actual amount changed depends on the text; no AI-detector result is guaranteed.';
  }
  const wordCount=value=>(String(value||'').trim().match(/\S+/gu)||[]).length;
  let busy=false;
  let originalForResult='';
  let retryCount=0;
  let versionHistory=[];
  const normalize=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
  const draftKey='prowell-humanizer-draft-v1';
  // Drafts stay in this browser tab; no text is sent to storage services.
  // Continue operating when storage is blocked by a privacy setting.
  function rememberDraft(){
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({
        text:source.value,
        tone:$('publicParaphraseTone').value,
        level:Number(depth.value),
        protectedTerms:$('publicParaphraseProtectedTerms').value,
        humanizedResult:result.value,
        originalForResult,
        retryCount
      }));
    } catch(_){}
  }
  function restoreDraft(){
    try {
      const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');
      if(!saved||typeof saved!=='object')return;
      if(!source.value&&typeof saved.text==='string')source.value=saved.text.slice(0,85000);
      const style=$('publicParaphraseTone');
      if(typeof saved.tone==='string'&&Array.from(style.options).some(option=>option.value===saved.tone))style.value=saved.tone;
      if(Number.isInteger(saved.level)&&saved.level>=1&&saved.level<=10){
        depth.value=String(saved.level);
      }
      updateDepth();
      const terms=$('publicParaphraseProtectedTerms');
      if(!terms.value&&typeof saved.protectedTerms==='string')terms.value=saved.protectedTerms.slice(0,3000);
      if(!result.value&&typeof saved.humanizedResult==='string')
        result.value=saved.humanizedResult.slice(0,85000);
      if(typeof saved.originalForResult==='string')
        originalForResult=saved.originalForResult.slice(0,85000);
      if(Number.isInteger(saved.retryCount)&&saved.retryCount>=0)
        retryCount=saved.retryCount;
      if(result.value.trim())versionHistory=[normalize(result.value)];
    }catch(_){}
  }
  const notify=(message,kind='info')=>{
    status.textContent=message;
    status.dataset.state=kind;
  };
  function refresh(){
    const count=wordCount(source.value);
    counter.textContent=count.toLocaleString()+' / 3,000 words';
    counter.classList.toggle('pp-over',count>3000);
    submit.disabled=busy;
    retry.disabled=busy||!result.value.trim()||!originalForResult||
      normalize(source.value)!==normalize(originalForResult);
    copy.disabled=!result.value.trim();
    save.disabled=!result.value.trim();
  }
  source.addEventListener('input',()=>{rememberDraft();refresh()});
  source.addEventListener('paste',()=>setTimeout(()=>{rememberDraft();refresh()},0));
  source.addEventListener('change',()=>{rememberDraft();refresh()});
  $('publicParaphraseTone').addEventListener('change',rememberDraft);
  depth.addEventListener('input',()=>{updateDepth();rememberDraft()});
  depth.addEventListener('change',()=>{updateDepth();rememberDraft()});
  $('publicParaphraseProtectedTerms').addEventListener('input',rememberDraft);
  window.addEventListener('pagehide',rememberDraft);
  async function runHumanizer(again=false){
    if(busy)return;
    if(again && (!result.value.trim()||!originalForResult)){
      notify('Humanize the original text first, then choose Rehumanize text.','error');
      return;
    }
    if(again && normalize(source.value)!==normalize(originalForResult)){
      notify('The original text has changed. Humanize it again before rehumanizing the result.','error');
      return;
    }
    rememberDraft();
    const text=again?result.value.trim():source.value.trim();
    const count=wordCount(text);
    if(!count){
      notify('Paste or type some text before selecting Humanize text.','error');
      return;
    }
    if(count>3000){
      notify('Maximum 3,000 words; remove '+(count-3000)+' words.','error');
      return;
    }
    const previous=result.value;
    const attempt=again?(retryCount%20)+1:0;
    const baseline=again?originalForResult:source.value.trim();
    busy=true;
    if(!again){
      result.value='';
      result.placeholder='Improving wording and sentence clarity…';
    }
    notify(again?
      'Rehumanizing the current result. Your previous version is kept until a new one is ready…':
      'Prowell Humanizer is improving your writing…');
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
          level:Number(depth.value),
          mode:again?'again':'first',
          ...(again?{attempt,originalText:baseline}:{}),
          protectedTerms:$('publicParaphraseProtectedTerms').value.trim()
        })
      });
      let data;
      try{data=await response.json();}
      catch(_){throw Error('Unexpected server response. Try again in a moment.');}
      if(!response.ok)throw Error(data?.error||'Rewriting failed (HTTP '+response.status+').');
      if(!data||typeof data.paraphrased!=='string'||!data.paraphrased.trim()){
        throw Error('The editor returned no revised text.');
      }
      const next=data.paraphrased.trim();
      if(again && versionHistory.includes(normalize(next))){
        throw Error('This variation matches an earlier result. Your current version was kept. Try changing the writing style or depth.');
      }
      if(again && normalize(next)===normalize(previous)){
        throw Error('No new wording was produced. Your current version was kept.');
      }
      result.value=next;
      result.placeholder='Your humanized result will appear here.';
      if(again){
        retryCount=attempt;
        versionHistory.push(normalize(next));
        versionHistory=versionHistory.slice(-12);
      }else{
        originalForResult=baseline;
        retryCount=0;
        versionHistory=[normalize(next)];
      }
      const percent=Number(data.editableTextChangePercent);
      const description=(typeof data.editStrength==='string'&&Number.isFinite(percent))?
        (' '+data.editStrength+' edit: '+percent+'% of editable wording changed.'): '';
      const warning=typeof data.qualityWarning==='string'?
        data.qualityWarning.trim():'';
      const intro=again?'Rehumanized result updated.':'Humanized result ready.';
      notify(warning?intro+description+' '+warning:
        intro+' '+wordCount(next).toLocaleString()+' words.'+description+
        ' Review the revised text for accuracy.',warning?'warning':'success');
    }catch(error){
      const message=error?.name==='AbortError'?
        'The request timed out. Try a shorter passage.':
        (error?.message||'Could not complete the rewrite.');
      if(again){
        result.value=previous;
        retryCount=attempt;
        notify('Your previous result was preserved. '+message,'error');
      }else{
        result.placeholder='No result generated.';
        notify(message,'error');
      }
    }finally{
      clearTimeout(timeout);
      busy=false;
      rememberDraft();
      refresh();
    }
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    return runHumanizer(false);
  });
  retry.addEventListener('click',()=>{
    return runHumanizer(true);
  });
  $('publicParaphraseClear').addEventListener('click',()=>{
    if(busy)return;
    source.value='';
    result.value='';
    originalForResult='';
    retryCount=0;
    versionHistory=[];
    result.placeholder='Your humanized result will appear here.';
    $('publicParaphraseProtectedTerms').value='';
    try{sessionStorage.removeItem(draftKey)}catch(_){}
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
  updateDepth();
  restoreDraft();
  refresh();
  notify(source.value.trim()?
    'Your unsent writing is available in this tab. Select Humanize text when ready.':
    'Ready to improve your writing. No login required.');
})();
