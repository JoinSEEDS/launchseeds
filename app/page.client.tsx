import { render } from "tradjs/client";
import { TokenCards } from "./components/token-cards";
import { CatalogNavigation } from "./components/catalog-navigation";
import { catalogHref, type CatalogPage, type CatalogFilter } from "../lib/catalog-pagination";
export default function mount() {
  const root=document.getElementById("token-cards"),nav=document.getElementById("catalog-pagination"),status=document.getElementById("catalog-status");
  if(!root)return;
  let page:CatalogPage;try{page=JSON.parse(root.dataset.page!);}catch{return;}
  const search=document.querySelector<HTMLInputElement>("[data-card-search]");
  const tabs=Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-card-filter]"));
  let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,serial=0;
  async function load(href:string,mode:"push"|"replace"|"none"="push") {
    const id=++serial;controller?.abort();controller=new AbortController();
    if(status)status.textContent="Loading launches…";
    root!.setAttribute("aria-busy","true");
    try {
      const url=new URL(href,location.href);
      const response=await fetch("/api/launch-catalog"+url.search,{signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw new Error();
      const next:CatalogPage=await response.json();if(id!==serial)return;
      page=next;render(<TokenCards items={page.items}/>,root!);
      if(nav)render(<CatalogNavigation page={page}/>,nav);
      if(status)status.textContent=`${page.total} launches`;
      if(search)search.value=page.q;
      tabs.forEach(t=>{const selected=t.dataset.cardFilter===page.filter;t.setAttribute("aria-selected",String(selected));t.tabIndex=selected?0:-1;t.href=catalogHref({filter:t.dataset.cardFilter as CatalogFilter,q:page.q});});
      if(mode!=="none")history[mode==="push"?"pushState":"replaceState"](null,"",url.pathname+url.search);
    }catch(error){if(id===serial && !(error instanceof DOMException && error.name==="AbortError") && status)status.textContent="Could not load launches. Try searching or selecting the page again.";}
    finally{if(id===serial)root!.removeAttribute("aria-busy");}
  }
  const click=(event:MouseEvent)=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const link=(event.target as Element).closest<HTMLAnchorElement>("a");if(!link||(!link.matches("[data-card-filter]")&&!nav?.contains(link)))return;event.preventDefault();clearTimeout(timer);void load(link.href);};
  const input=()=>{clearTimeout(timer);controller?.abort();++serial;timer=setTimeout(()=>void load(catalogHref({filter:page.filter,q:search?.value.trim()??""}),"replace"),250);};
  const submit=(event:Event)=>{event.preventDefault();clearTimeout(timer);void load(catalogHref({filter:page.filter,q:search?.value.trim()??""}));};
  const pop=()=>{clearTimeout(timer);void load(location.href,"none");};
  const keys=(event:KeyboardEvent)=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;const i=tabs.indexOf(document.activeElement as HTMLAnchorElement);if(i<0)return;event.preventDefault();const n=event.key==="Home"?0:event.key==="End"?tabs.length-1:(i+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;tabs[n]?.focus();tabs[n]?.click();};
  document.addEventListener("click",click);search?.addEventListener("input",input);search?.form?.addEventListener("submit",submit);tabs.forEach(t=>t.addEventListener("keydown",keys));window.addEventListener("popstate",pop);
  return()=>{++serial;controller?.abort();clearTimeout(timer);document.removeEventListener("click",click);search?.removeEventListener("input",input);search?.form?.removeEventListener("submit",submit);tabs.forEach(t=>t.removeEventListener("keydown",keys));window.removeEventListener("popstate",pop);};
}
