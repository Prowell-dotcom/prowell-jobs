/* MAIN-world helper: handle only the expected "Are you sure?" browser
 * confirmation immediately after the isolated extension clicks Take it.
 * All unrelated dialogs use the website's original confirmation behavior.
 */
(() => {
  'use strict';
  if (window.__prowellTakeConfirmInstalled) return;
  window.__prowellTakeConfirmInstalled = true;
  const realConfirm = window.confirm.bind(window);
  let armedUntil=0;
  const arm=()=>{armedUntil=Date.now()+1500;};
  window.addEventListener('prowell-order-confirm-arm',arm);
  window.confirm=function(message){
    const text=String(message??'').trim();
    if(Date.now()<=armedUntil && /^are you sure\b/i.test(text)){
      armedUntil=0;
      window.dispatchEvent(new Event('prowell-order-confirm-accepted'));
      return true;
    }
    return realConfirm(message);
  };
})();
