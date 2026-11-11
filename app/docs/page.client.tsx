/** Highlights the section being read in the table of contents. */
export default function mount() {
  const links = document.querySelectorAll<HTMLAnchorElement>("#toc a");
  if (!links.length || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${e.target.id}`));
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  document.querySelectorAll(".doc-sec").forEach((s) => io.observe(s));
  return () => io.disconnect();
}
