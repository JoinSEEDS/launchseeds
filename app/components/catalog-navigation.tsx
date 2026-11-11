import { catalogHref, type CatalogPage } from "../../lib/catalog-pagination";
export function CatalogNavigation({page}:{page:CatalogPage}) { return <div className="row">{page.previous?<a className="btn btn-white" href={catalogHref(page,"before",page.previous)}>Previous</a>:null}{page.next?<a className="btn btn-white" href={catalogHref(page,"after",page.next)}>Next</a>:null}</div>; }
