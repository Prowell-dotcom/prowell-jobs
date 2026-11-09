'use strict';
(() => {
  const box=document.createElement('div');
  box.id='prowellRefreshDiagnostics';
  box.className='panel';
  box.setAttribute('role','status');
  const info=document.getElementById('status');
  info?.insertAdjacentElement('afterend',box);
  const format = n => n ? new Date(n).toLocaleTimeString() : 'Not yet';
  async function update(){
    const values=await chrome.storage.local.get(['refreshCount','lastRefreshAt','refreshStatus']);
    box.textContent='Refresh status: '+(values.refreshStatus||'Initializing')+
      '\nCompleted reload requests: '+(Number(values.refreshCount)||0)+
      '\nLast refresh request: '+format(values.lastRefreshAt);
  }
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'local' && ['refreshCount','lastRefreshAt','refreshStatus'].some(k => changes[k])) {
      void update();
    }
  });
  void update();
})();