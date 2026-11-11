import { SITE_NAME } from "../lib/site-brand";

export default function RootLayout({ children }: { children: any }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#E8E1F3" />
        <link rel="icon" type="image/png" href="/logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" />
        <title>{SITE_NAME}</title>
        <meta name="description" content="Launch coins free. Their trading fees pay the people who complete their challenges." />
      </head>
      <body>
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <symbol id="i-leaf" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14V7" /><path d="M8 8c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5Z" /><path d="M8 10c0-2.5-2-4-5-4 0 2.5 2 4 5 4Z" /></g></symbol>
          <symbol id="i-arrow" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10" /><path d="M9 4l4 4-4 4" /></g></symbol>
          <symbol id="i-search" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></g></symbol>
          <symbol id="i-clock" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></g></symbol>
          <symbol id="i-back" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3" /><path d="M7 4 3 8l4 4" /></g></symbol>
          <symbol id="i-ext" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l6-6" /><path d="M6 5h5v5" /></g></symbol>
        </svg>
        {children}
        <footer className="footer">
          <div className="container">
            <div className="footer-brand"><img src="/logo.png" alt="" width="32" height="32" /><div><b>{SITE_NAME}</b>A launchpad where trading rewards real-world action.</div></div>
            <div className="footer-links"><a href="/#launches">Challenges</a><a href="/docs">Docs</a></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
