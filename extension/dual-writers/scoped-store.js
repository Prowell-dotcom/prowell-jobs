/* Independent state for 4writers and GoodWriters inside one MV3 extension.
 * Content scripts use this adapter instead of unprefixed chrome.storage keys.
 */
(() => {
  'use strict';
  const host = location.hostname.toLowerCase();
  const site = /^(?:www\.)?4writers\.net$/.test(host) ? 'four' :
    /^(?:www\.)?good-writers\.com$/.test(host) ? 'good' : null;
  if (!site) return;
  const prefix = 'dual_' + site + '_';
  const key = name => prefix + name;
  const local = {
    async get(request) {
      const isArray = Array.isArray(request);
      const isObject = request && !isArray && typeof request === 'object';
      const keys = isArray ? request : isObject ? Object.keys(request) :
        typeof request === 'string' ? [request] : [];
      const values = await chrome.storage.local.get(keys.map(key));
      const result = {};
      for (const name of keys) {
        if (Object.prototype.hasOwnProperty.call(values,key(name)))
          result[name] = values[key(name)];
        else if (isObject) result[name] = request[name];
      }
      return result;
    },
    async set(patch) {
      await chrome.storage.local.set(Object.fromEntries(
        Object.entries(patch).map(([name,value]) => [key(name),value])));
    },
    async remove(names) {
      const list = Array.isArray(names) ? names : [names];
      await chrome.storage.local.remove(list.map(key));
    }
  };
  const onChanged = {
    addListener(fn) {
      chrome.storage.onChanged.addListener((changed,area) => {
        if (area !== 'local') return;
        const updates = {};
        for (const [name,value] of Object.entries(changed))
          if (name.startsWith(prefix)) updates[name.slice(prefix.length)] = value;
        if (Object.keys(updates).length) fn(updates,'local');
      });
    }
  };
  window.__prowellDualStorage = {site,prefix,local,onChanged};
})();
