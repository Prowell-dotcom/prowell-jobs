'use strict';
// Identify the current frame's tab without reading account credentials.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message && message.type === 'PROWELL_TAB_ID') reply({tabId: sender.tab ? sender.tab.id : null});
});
// Some official View links open a separate tab; continue monitoring it.
chrome.tabs.onCreated.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;
  chrome.storage.local.get(['armed', 'targetTabId'], state => {
    if (!state.armed || state.targetTabId !== tab.openerTabId) return;
    const newTab = tab.id;
    const listener = (id, info, current) => {
      if (id !== newTab) return;
      const url = (current && current.url) || info.url || '';
      if (/^https:\/\/(?:www\.)?4writers\.net\//i.test(url)) {
        chrome.storage.local.set({targetTabId: id, status: 'Following official order tab'});
        chrome.tabs.onUpdated.removeListener(listener);
      } else if (/^https?:\/\//i.test(url)) chrome.tabs.onUpdated.removeListener(listener);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
});
