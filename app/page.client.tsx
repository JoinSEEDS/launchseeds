/** The designer's tabs, search and full-row navigation preserve SSR rows. */
type Filter = "progress" | "switched" | "new";
export default function mount() {
  const table = document.querySelector<HTMLTableElement>("#token-table");
  const body = table?.tBodies[0],
    bar = table?.closest("section")?.querySelector<HTMLElement>(".ledger-bar");
  if (!body || !bar) return;
  const original = Array.from(
    body.querySelectorAll<HTMLTableRowElement>("tr[data-href]"),
  );
  const input = bar.querySelector<HTMLInputElement>("input[data-filter]");
  const tabs = Array.from(
    bar.querySelectorAll<HTMLButtonElement>(".tabs .tab"),
  );
  let selected: Filter = "progress",
    search = "";
  const modes: Filter[] = ["progress", "switched", "new"];
  function update() {
    const order = [...original].sort((a, b) =>
      selected === "progress"
        ? Number(b.dataset.progress || 0) - Number(a.dataset.progress || 0)
        : selected === "switched"
          ? Number(b.dataset.switched || 0) - Number(a.dataset.switched || 0)
          : Number(b.dataset.created || 0) - Number(a.dataset.created || 0),
    );
    for (const row of order) {
      row.hidden = !(row.dataset.search || "").includes(search);
      body!.append(row);
    }
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(selected === modes[i]));
      tab.tabIndex = selected === modes[i] ? 0 : -1;
    });
  }
  const type = () => {
    search = (input?.value || "").trim().toLowerCase();
    update();
  };
  const clickTab = (index: number) => () => {
    selected = modes[index];
    update();
  };
  const callbacks = tabs.map((tab, i) => {
    const fn = clickTab(i);
    tab.addEventListener("click", fn);
    return fn;
  });
  const navigate = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLTableRowElement>("tr[data-href]");
    if (row && !target.closest("a,button,input"))
      location.assign(row.dataset.href || "/");
  };
  input?.addEventListener("input", type);
  body.addEventListener("click", navigate);
  update();
  return () => {
    input?.removeEventListener("input", type);
    body.removeEventListener("click", navigate);
    tabs.forEach((tab, i) => tab.removeEventListener("click", callbacks[i]));
  };
}
