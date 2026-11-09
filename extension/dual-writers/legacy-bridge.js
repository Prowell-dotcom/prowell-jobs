/* Shared extension compatibility: preserves each uploaded legacy bot engine
 * without mixing 4writers and Good-Writers Chrome storage keys. Original
 * source bodies are embedded unchanged in runtime-content/runtime-refresh.
 */
(() => {
  'use strict';
  const site=/(?:^|\.)4writers\.net$/i.test(location.hostname)?'four':
    /(?:^|\.)good-writers\.com$/i.test(location.hostname)?'good':null;
  const store=window.__prowellDualStorage;
  if(!site||!store)return;
  window.__prowellLegacyChrome={
    storage:{local:store.local,onChanged:store.onChanged},
    runtime:chrome.runtime
  };
  window.__prowellLegacySite=site;
})();
