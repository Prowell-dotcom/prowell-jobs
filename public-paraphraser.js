'use strict';
// Prowell Humanizer: public writing editor, no login required.
// The optional model runs on a private self-hosted service, not a commercial AI API.
(() => {
  if(window.__prowellHumanizerInitialized)return;
  const $ = id => document.getElementById(id);
  const form=$('publicParaphraseForm');
  if(!form)return;
  window.__prowellHumanizerInitialized=true;
  const source=$('publicParaphraseInput'), result=$('publicParaphraseOutput');
  const submit=$('publicParaphraseSubmit'), retry=$('publicParaphraseAgain');
  const status=$('publicParaphraseStatus');
  const immediateStatus=$('publicParaphraseInlineFeedback');
  const submitLabel=submit.innerHTML;
  const retryLabel=retry.innerHTML;
  const copy=$('publicParaphraseCopy'), save=$('publicParaphraseDownload');
  const counter=$('publicParaphraseCount');
  const engine=$('publicParaphraseEngine');
  const deepStatus=$('publicDeepRewriteStatus');
  let deepAvailable=false;
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
        engine:engine.value,
        history:versionHistory.slice(-3),
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
      if(saved.engine==='local'||saved.engine==='deep'){
        engine.dataset.savedChoice=saved.engine;
        if(saved.engine==='local')engine.value='local';
      }
      if(Array.isArray(saved.history)){
        versionHistory=saved.history.filter(x=>typeof x==='string'&&x.length<=7000).slice(-3);
      }
      const terms=$('publicParaphraseProtectedTerms');
      if(!terms.value&&typeof saved.protectedTerms==='string')terms.value=saved.protectedTerms.slice(0,3000);
      if(!result.value&&typeof saved.humanizedResult==='string')
        result.value=saved.humanizedResult.slice(0,85000);
      if(typeof saved.originalForResult==='string')
        originalForResult=saved.originalForResult.slice(0,85000);
      if(Number.isInteger(saved.retryCount)&&saved.retryCount>=0)
        retryCount=saved.retryCount;
      if(result.value.trim()&&!versionHistory.length)
        versionHistory=[result.value];
    }catch(_){}
  }
  const notify=(message,kind='info')=>{
    status.textContent=message;
    status.dataset.state=kind;
    // Show the most important result feedback beside the Rehumanize control;
    // visitors should not have to scroll below both text areas to find it.
    immediateStatus.textContent=message;
    immediateStatus.dataset.state=kind;
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
  engine.addEventListener('change',()=>{
    rememberDraft();
    notify(engine.value==='deep'?
      'DeepRewrite selected. The private model will generate and compare multiple candidates; longer processing is normal.':
      'Fast editing selected. This uses conservative rules, not full semantic paraphrasing.');
    refresh();
  });
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
    if(engine.value==='deep' && (!deepAvailable || count>350)){
      notify(!deepAvailable?
        'DeepRewrite is not active. Select Fast editing or ask the website owner to configure the private model.':
        'DeepRewrite supports up to 350 words at a time. Select a shorter section to preserve quality.','error');
      return;
    }
    const previous=result.value;
    const attempt=again?(retryCount%20)+1:0;
    const baseline=again?originalForResult:source.value.trim();
    busy=true;
    submit.innerHTML=again?submitLabel:'Humanizing…';
    retry.innerHTML=again?'Rehumanizing…':retryLabel;
    if(!again){
      result.value='';
      result.placeholder='Improving wording and sentence clarity…';
    }
    notify(engine.value==='deep'?
      (again?
        'DeepRewrite is generating different candidates from your current result and checking their consistency…':
        'DeepRewrite is generating multiple alternatives and checking meaning, fluency and protected facts…'):
      (again?
        'Applying another fast edit. Your last version stays visible…':
        'Applying the available fast rewriting rules…'),
      'working');
    refresh();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),
      engine.value==='deep'?135000:30000);
    try{
      const response=await fetch('/api/paraphrase',{
        method:'POST',cache:'no-store',credentials:'omit',
        signal:controller.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          text,engine:engine.value,tone:$('publicParaphraseTone').value,
          level:Number(depth.value),
          mode:again?'again':'first',
          ...(again?{attempt,originalText:baseline,
             history:versionHistory.slice(-3)}:{}),
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
      if(again && versionHistory.some(previous=>normalize(previous)===normalize(next))){
        throw Error('This variation matches an earlier result. Your current version was kept. Try changing the writing style or depth.');
      }
      if(again && normalize(next)===normalize(previous)){
        throw Error('No new wording was produced. Your current version was kept.');
      }
      result.value=next;
      result.placeholder='Your humanized result will appear here.';
      if(again){
        retryCount=attempt;
        versionHistory.push(next);
        versionHistory=versionHistory.slice(-12);
      }else{
        originalForResult=baseline;
        retryCount=0;
        versionHistory=[next];
      }
      const percent=Number(data.editableTextChangePercent);
      const description=(typeof data.editStrength==='string'&&Number.isFinite(percent))?
        (' '+data.editStrength+' edit: '+percent+'% of editable wording changed.'): '';
      const warning=typeof data.qualityWarning==='string'?
        data.qualityWarning.trim():'';
      const candidates=engine.value==='deep'&&Number.isInteger(data.candidateCount)?
        ' Reviewed '+data.validCandidateCount+' of '+data.candidateCount+
        ' generated versions.':'';
      const intro=again?'Rehumanized result updated.':'Text revision complete.';
      notify(warning?intro+description+' '+warning:
        intro+' '+wordCount(next).toLocaleString()+' words.'+description+
        candidates+' Review meaning and factual accuracy before using.',
        warning?'warning':'success');
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
      submit.innerHTML=submitLabel;
      retry.innerHTML=retryLabel;
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
  // Probe service capabilities shortly after page load without blocking Fast
  // editing. The model URL is never exposed to visitors.
  async function checkDeepAvailability(){
    try{
      const response=await fetch('/api/paraphrase/capabilities',{
        credentials:'omit',cache:'no-store'});
      const info=await response.json();
      deepAvailable=Boolean(response.ok&&info.deepAvailable);
      const option=Array.from(engine.options).find(o=>o.value==='deep');
      if(option)option.disabled=!deepAvailable;
      if(deepAvailable){
        if(engine.dataset.savedChoice!=='local')engine.value='deep';
        deepStatus.textContent='Prowell DeepRewrite is ready. A private language model generates and checks multiple candidates. Up to 350 words per request.';
        deepStatus.dataset.state='ready';
      }else{
        engine.value='local';
        deepStatus.textContent='DeepRewrite is not active yet: the website owner needs to configure its private model service. Fast editing remains available.';
        deepStatus.dataset.state='unavailable';
      }
    }catch(_){
      engine.value='local';
      deepAvailable=false;
      deepStatus.textContent='DeepRewrite model status could not be checked. Fast editing remains available.';
      deepStatus.dataset.state='unavailable';
    }
    refresh();
  }
  setTimeout(checkDeepAvailability,100);
  notify(source.value.trim()?
    'Your unsent writing is available in this tab. Select Humanize text when ready.':
    'Ready to improve your writing. No login required.');
})();
