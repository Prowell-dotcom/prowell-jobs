/* Prowell opt-in order acceptance. Fixed waits and incremental navigation,
 * no randomized interaction or bot-detection evasion.
 * Works only on the tab and order selected by the Prowell watcher.
 */
(() => {
  'use strict';
  if (window !== window.top || !/^https:\/\/(?:www\.)?(?:4writers\.net|good-writers\.com)$/i.test(location.origin)) return;
  if (window.__prowellAutoAcceptanceLoaded) return;
  window.__prowellAutoAcceptanceLoaded = true;
  const IS_FOUR = /(?:^|\.)4writers\.net$/i.test(location.hostname);
  const TAB_MESSAGE = IS_FOUR ? 'PROWELL_TAB_ID' : 'GW_TAB_ID';
  const SELECTORS = 'button,a,input[type="button"],input[type="submit"],[role="button"]';
  const RUN_TTL = 90000;
  const STEP_TIMEOUT = 20000;
  const STEP_PX = 140;
  const STEP_DELAY = 100;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let tabId = null, flow = null, busy = false;
  function guarded() {
    return Boolean(flow && flow.enabled === true && Number.isInteger(tabId) &&
      flow.tabId === tabId && /^\d{5,16}$/.test(String(flow.orderId || '')) &&
      Date.now() - flow.startedAt < RUN_TTL);
  }
  function checkSecurity() {
    return /captcha|verify you are human|unusual activity/i.test(document.body?.innerText || '') ||
      Boolean(document.querySelector('iframe[src*="captcha"],[class*="g-recaptcha"]'));
  }
  function label(el) {
    return String(el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') ||
      el?.value || el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
  }
  function visible(el) {
    return Boolean(el?.isConnected && el.getClientRects?.().length &&
      !el.disabled && el.getAttribute?.('aria-disabled') !== 'true');
  }
  function matches(stage, txt) {
    if (stage === 'take') return /^take it$/i.test(txt);
    if (stage === 'ok') return /^ok$/i.test(txt);
    return /^i understand(?: the order)?$/i.test(txt);
  }
  function find(stage) {
    const hits = [...document.querySelectorAll(SELECTORS)].filter(el => visible(el) && matches(stage, label(el)));
    if (hits.length > 1) throw Error('Ambiguous ' + stage + ' controls');
    return hits[0] || null;
  }
  function inViewport(el) {
    const r = el.getBoundingClientRect?.();
    return Boolean(r && r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.top < (window.innerHeight || 850));
  }
  function scrollRoot(el, stage = 'take') {
    // Read the order's actual scrolling content, not just the fixed footer
    // holding Take it / I understand. Those buttons can already be visible.
    const overlays = [...document.querySelectorAll(
      '[role="dialog"],dialog,[aria-modal="true"],.modal,.modal-body,.popup,[class*="modal"],[class*="order-info"],[class*="order-detail"]'
    )].filter(visible);
    const related = [];
    for (const overlay of overlays) {
      related.push(overlay);
      related.push(...overlay.querySelectorAll('*'));
    }
    const other = [...document.querySelectorAll(
      '[style*="overflow"],[class*="scroll"],[class*="description"],[class*="details"],[class*="content"]'
    )];
    const parents = [];
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) parents.push(p);
    const candidates = [...new Set([...related, ...parents, ...other])].filter(node => {
      if (!visible(node) || !Number.isFinite(node.scrollHeight) || !Number.isFinite(node.clientHeight)) return false;
      if (node.clientHeight < 80 || node.scrollHeight <= node.clientHeight + 60) return false;
      const overflow = getComputedStyle(node).overflowY || '';
      return /auto|scroll|hidden/i.test(overflow) || related.includes(node);
    });
    const score = node => {
      const text = node.innerText || '';
      const role = node.closest?.('[role="dialog"],dialog,[aria-modal="true"],.modal,.popup,[class*="modal"]');
      let result = 0;
      if (related.includes(node)) result += 25;
      if (role) result += 30;
      if (stage === 'take' && text.includes(String(flow?.orderId || ''))) result += 20;
      if (stage === 'understand' && /understand|acknowledge|order (?:rules|terms)/i.test(text)) result += 20;
      if (node.contains?.(el)) result += 8;
      // Favor the inner scrollable reading pane over a large outer panel.
      if (node.clientHeight < 850) result += 3;
      return result;
    };
    candidates.sort((a,b) => score(b) - score(a));
    return candidates[0] || document.scrollingElement || document.documentElement;
  }
  async function waitForOrderDetails() {
    const started = Date.now();
    while (Date.now() - started < STEP_TIMEOUT) {
      if (!guarded()) throw Error('Order workflow expired while opening View');
      if (checkSecurity()) throw Error('Security challenge detected');
      const page = (document.body?.innerText || '') + ' ' + location.href;
      if (page.includes(String(flow.orderId)) && find('take')) return;
      await sleep(150);
    }
    throw Error('Order details or Take it button did not appear after View');
  }
  async function readThrough(stage) {
    const root = scrollRoot(find(stage), stage);
    if (!root) throw Error('No scrollable order details container found');
    let steps = 0;
    const maximumSteps = 100;
    const startedAt = Date.now();
    while (steps < maximumSteps && Date.now() - startedAt < STEP_TIMEOUT) {
      if (!guarded()) throw Error('Order workflow was stopped or expired');
      if (checkSecurity()) throw Error('Security challenge detected');
      const distance = (root.scrollHeight || 0) - (root.clientHeight || 0) - (root.scrollTop || 0);
      if (distance <= 3) break;
      if (!await move(root, 1)) break;
      steps++;
    }
    if ((root.scrollHeight || 0) - (root.clientHeight || 0) - (root.scrollTop || 0) > 5)
      throw Error('Could not finish scrolling through ' + stage + ' information');
    await chrome.storage.local.set({
      lastScrollStage: stage,
      lastScrollSteps: steps,
      lastScrollAt: Date.now()
    });
  }
  async function move(root, direction) {
    if (!root || !guarded() || checkSecurity()) return false;
    const initial = root.scrollTop || 0;
    const limit = Math.max(0, (root.scrollHeight || 0) - (root.clientHeight || 0));
    const next = Math.max(0, Math.min(limit, initial + direction * STEP_PX));
    if (Math.abs(next - initial) < 1) return false;
    root.scrollTop = next;
    await sleep(STEP_DELAY);
    return true;
  }
  async function locate(stage, scrollAllowed) {
    const start = Date.now();
    let steps = 0;
    while (Date.now() - start < STEP_TIMEOUT) {
      if (!guarded()) throw Error('Order workflow was stopped or expired');
      if (checkSecurity()) throw Error('Security challenge detected');
      const el = find(stage);
      if (el) {
        if (inViewport(el)) return el;
        if (!scrollAllowed) throw Error(stage + ' control is not visible; no automatic scrolling allowed');
        const rect = el.getBoundingClientRect();
        const direction = rect.top >= (window.innerHeight || 850) ? 1 : -1;
        if (steps < 90 && await move(scrollRoot(el), direction)) {
          steps++;
          continue;
        }
      } else if (scrollAllowed && steps < 90) {
        if (await move(scrollRoot(null), 1)) {
          steps++;
          continue;
        }
      }
      await sleep(150);
    }
    throw Error('Timed out waiting for ' + stage + ' control');
  }
  async function updateStage(stage) {
    if (!guarded()) throw Error('Workflow stopped');
    flow = {...flow, stage, stageStartedAt: Date.now()};
    await chrome.storage.local.set({autoFlow: flow});
  }
  async function end(message, outcome) {
    const current = await chrome.storage.local.get({log: [], attemptedIds: []});
    const entry = new Date().toLocaleTimeString() + ' ' + message;
    const attemptedIds = [...new Set([...(current.attemptedIds || []), String(flow?.orderId || '')])].filter(Boolean).slice(-100);
    await chrome.storage.local.set({
      autoFlow: null,
      lastResult: message,
      refreshStatus: message,
      log: [...(current.log || []), entry].slice(-30),
      attemptedIds,
      lastAcceptanceOutcome: outcome
    });
    flow = null;
  }
  async function execute() {
    if (busy || !guarded() || !document.body) return;
    busy = true;
    try {
      while (guarded()) {
        if (checkSecurity()) throw Error('Security challenge detected');
        if (flow.stage === 'take') {
          await waitForOrderDetails();
          await readThrough('take');
          const el = await locate('take', true);
          const page = (document.body?.innerText || '') + ' ' + location.href;
          if (!page.includes(flow.orderId)) throw Error('Selected order ID not found in details');
          await updateStage('ok');
          if (!guarded() || !el.isConnected) throw Error('Details changed before Take it');
          el.click();
        } else if (flow.stage === 'ok') {
          const elapsed = Date.now() - (flow.stageStartedAt || Date.now());
          if (elapsed < 500) await sleep(500 - elapsed);
          const el = await locate('ok', false);
          await updateStage('understand');
          if (!guarded() || !el.isConnected) throw Error('Confirmation changed before OK');
          el.click();
        } else if (flow.stage === 'understand') {
          if (IS_FOUR) await readThrough('understand');
          const el = await locate('understand', IS_FOUR);
          await updateStage('verify');
          if (!guarded() || !el.isConnected) throw Error('Acknowledgment changed before I understand');
          el.click();
        } else if (flow.stage === 'verify') {
          await sleep(850);
          if (!guarded()) throw Error('Workflow stopped before verification');
          await end('Order #' + flow.orderId + ': confirmation steps submitted. Verify assignment on the website.', 'submitted-unverified');
        } else {
          throw Error('Unknown acceptance step');
        }
      }
    } catch (e) {
      if (flow) await end('Order #' + flow.orderId + ': stopped — ' + String(e?.message || e), 'stopped');
    } finally {
      busy = false;
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoFlow) return;
    flow = changes.autoFlow.newValue || null;
    if (flow) void execute();
  });
  chrome.runtime.sendMessage({type: TAB_MESSAGE}, async response => {
    tabId = response?.tabId ?? null;
    const stored = await chrome.storage.local.get(['autoFlow']);
    flow = stored.autoFlow || null;
    void execute();
  });
  document.addEventListener('DOMContentLoaded', () => void execute(), {once: true});
})();