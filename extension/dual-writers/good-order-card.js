/* Good-Writers order-card detection for the combined Prowell bot.
 * A View in the same verified order row as Files is eligible; Messages
 * distinguishes a processing order. Never infer a new order from an
 * unrelated View button elsewhere on the page.
 */
(() => {
  'use strict';
  if(window.__prowellCardDetector)return;
  const ACTIONS='a,button,input[type="button"],input[type="submit"],[role="button"]';
  const ORDER_ID=/(?:\b(?:order\s*)?id\b|\border\s*(?:number|no\.?|#)\b)\s*[:#]?\s*(\d{5,16})\b/i;
  const VIEW=/^view(?:\s+(?:order|details))?$/i;
  const FILES=/^files?(?:\s*\(\s*\d+\s*\))?$/i;
  const MESSAGES=/^messages?(?:\s*\(\s*\d+\s*\))?$/i;
  const label=el=>String(el?.getAttribute?.('aria-label')||
    el?.getAttribute?.('title')||el?.value||el?.innerText||el?.textContent||'')
    .trim().replace(/\s+/g,' ');
  const visible=el=>Boolean(el?.isConnected && el.getClientRects?.().length &&
    !el.disabled && el.getAttribute?.('aria-disabled')!=='true');
  function pageKind(){
    const path=(location.pathname||new URL(location.href).pathname).toLowerCase();
    if(/(?:^|\/)(?:processing|current|assigned|in[_-]?progress|my[_-]?orders?)(?:[_-]?orders?)?(?:\/|$)/.test(path))
      return 'processing';
    if(/(?:^|\/)(?:free|available|latest)(?:[_-]?orders?)?(?:\/|$)/.test(path))
      return 'available';
    const headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .filter(visible).map(label);
    if(headings.some(t=>/\b(?:processing|current|assigned|in.progress)\s+orders?\b/i.test(t)))
      return 'processing';
    if(headings.some(t=>/\b(?:available|free|latest)\s+orders?\b/i.test(t)))
      return 'available';
    if(document.querySelector?.('.performance-record,#performance-record,.user-info,.writer-info'))
      return 'overview';
    return 'unknown';
  }
  function controlsIn(root,all){
    return all.filter(b=>root===b || (typeof root.contains==='function'
      ? root.contains(b)
      : (()=>{for(let p=b;p;p=p.parentElement)if(p===root)return true;return false;})()));
  }
  function orderId(text,container){
    const explicit=ORDER_ID.exec(text);
    if(explicit)return explicit[1];
    const attr=String(container?.getAttribute?.('data-order-id')||
      container?.getAttribute?.('data-id')||'');
    if(/^\d{5,16}$/.test(attr))return attr;
    // Good-Writers can use a table row with a bare ID in its first cell,
    // while the column header supplies "ID" outside that row.
    const kind=String(container?.tagName||'').toLowerCase();
    const row=kind==='tr'||container?.getAttribute?.('role')==='row'||
      /\b(?:order|task)[-_ ]?(?:row|item)\b/i.test(String(container?.className||''));
    if(!row)return null;
    const cells=[...(container.querySelectorAll?.('td,[role="cell"]')||[])];
    for(const cell of cells.slice(0,3)){
      const val=String(cell.innerText||cell.textContent||'').trim();
      if(/^\d{5,16}$/.test(val))return val;
    }
    // A single naked order number in a verified short row is also valid.
    const numbers=[...text.matchAll(/\b\d{5,16}\b/g)].map(m=>m[0]);
    return numbers.length===1?numbers[0]:null;
  }
  function cards(){
    const buttons=[...document.querySelectorAll(ACTIONS)].filter(visible);
    const hits=[],visited=new Set(),page=pageKind();
    const views=buttons.filter(b=>VIEW.test(label(b)));
    for(const view of views){
      // Choose the smallest row that has the selected View and a valid ID.
      // Some sites render Files as a styled span instead of <button>.
      for(let p=view,depth=0;p&&p!==document.body&&depth<18;
          p=p.parentElement,depth++){
        const t=String(p.innerText||p.textContent||'');
        if(t.length>8500)break;
        const contained=controlsIn(p,buttons);
        const hasView=contained.includes(view);
        if(!hasView)continue;
        const hasFiles=contained.some(b=>FILES.test(label(b))) ||
          [...(p.querySelectorAll?.('a,[role="button"],[class*="file"]')||[])]
            .some(e=>visible(e)&&FILES.test(label(e)));
        const hasMessages=contained.some(b=>MESSAGES.test(label(b))) ||
          [...(p.querySelectorAll?.('a,[role="button"],[class*="message"]')||[])]
            .some(e=>visible(e)&&MESSAGES.test(label(e)));
        if(!hasFiles)continue;
        const id=orderId(t,p);
        if(!id)continue;
        // An explicit processing row wins over an available heading.
        // For unknown routes, the Messages action is a reliable discriminator.
        const processing=hasMessages||page==='processing';
        if(page==='processing'&&!hasMessages)continue;
        if(visited.has(id))break;
        hits.push({id,view,hasFiles:true,hasMessages,
          type:processing?'processing':'available',container:p});
        visited.add(id);
        break;
      }
    }
    return hits;
  }
  function diagnostics(){
    const actions=[...document.querySelectorAll(ACTIONS)].filter(visible);
    const count=actions.filter(el=>VIEW.test(label(el))).length;
    return {page:pageKind(),visibleViews:count,validCards:cards().length,
      url:String(location.pathname||'')};
  }
  window.__prowellCardDetector={pageKind,cards,visible,label,diagnostics};
})();
