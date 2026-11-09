/* Dual-only 4writers section adapter.
 * Keeps the owner's original v0.5.4 detector unchanged and expands the
 * eligible Available Orders listings to BOTH Writings and Rewritings.
 * Only real order rows with Files + View are ever returned by the detector.
 */
(() => {
  'use strict';
  if(!/^(?:www\.)?4writers\.net$/i.test(location.hostname))return;
  const original=window.__prowellCardDetector;
  if(!original || window.__prowellFourSections)return;
  const label=el=>String(el?.innerText||el?.textContent||el?.value||'')
    .trim().replace(/\s+/g,' ');
  const visible=el=>Boolean(el?.isConnected && el.getClientRects?.().length);
  const SECTION_LABEL=/^(writings|rewritings)$/i;
  function links(){
    const all=[...document.querySelectorAll('a,button,[role="tab"]')]
      .filter(el=>visible(el) && SECTION_LABEL.test(label(el)));
    // Prefer main content navigation (Writings and Rewritings in the
    // screenshot) rather than "Processing rewritings" in the sidebar.
    return all.sort((a,b)=>score(b)-score(a));
  }
  function score(el){
    const parent=el.closest?.('nav,.nav,.nav-tabs,.tabs,[role="tablist"],header') ||
      el.parentElement;
    const own=String(el.className||'')+' '+
      String(el.parentElement?.className||'');
    let n=0;
    if(/tab|nav|active|current|selected/i.test(own))n+=15;
    if(el.closest?.('.nav-tabs,[role="tablist"],.tabs'))n+=20;
    if(el.closest?.('header,nav'))n+=8;
    if(/sidebar|side-menu|user-info/i.test(String(parent?.className||'')))n-=12;
    return n;
  }
  function selected(){
    const tabs=links();
    for(const el of tabs){
      const attrs=String(el.className||'')+' '+
        String(el.parentElement?.className||'')+' '+
        String(el.getAttribute?.('aria-current')||'')+' '+
        String(el.getAttribute?.('aria-selected')||'');
      if(/(?:\bactive\b|\bselected\b|\bcurrent\b|\btrue\b)/i.test(attrs))
        return label(el).toLowerCase();
    }
    for(const el of tabs){
      const href=el.getAttribute?.('href');
      if(!href || href.startsWith('#') || /^javascript:/i.test(href))continue;
      try{
        const destination=new URL(href,location.href);
        if(destination.href===location.href)return label(el).toLowerCase();
      }catch(_){}
    }
    const url=location.pathname.toLowerCase()+location.search.toLowerCase();
    if(/rewrite|rewritings/.test(url))return 'rewritings';
    if(/writings|free.?orders|available.?orders/.test(url))return 'writings';
    return null;
  }
  function available(){
    const text=String(document.body?.innerText||'');
    const path=(location.pathname||'').toLowerCase();
    if(/(?:processing|current|my|late)[_-]?(?:orders?|rewritings?)/.test(path))
      return false;
    if(original.pageKind()==='processing')return false;
    const heads=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .filter(visible).map(label);
    if(heads.some(s=>/^available\s+(?:orders|writings|rewritings)$/i.test(s)))
      return true;
    if(/available\s+(?:orders|writings|rewritings)/i.test(text) &&
       /\b(?:order by|find|show all|search keywords)\b/i.test(text))
      return true;
    return original.pageKind()==='available';
  }
  function pageKind(){
    const base=original.pageKind();
    if(base==='processing')return base;
    return available()?'available':base;
  }
  function cards(){
    const type=pageKind();
    const cards=original.cards();
    return type==='available'
      ?cards.map(card=>card.type==='unknown'?{...card,type:'available'}:card)
      :cards;
  }
  window.__prowellCardDetector={...original,pageKind,cards};
  window.__prowellFourSections={links,selected,available};
})();