/** A small, self-contained version of LaunchSeeds's gold thumbs-up branding. */
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#090e15"/>
<circle cx="32" cy="32" r="26" fill="none" stroke="#ffc52f" stroke-width="4"/>
<path fill="#ffc52f" d="M16 29h7v21h-7zm11 21V29l7-16c1-2 5-1 5 3v10h8c4 0 5 3 4 6l-4 14c-1 3-3 4-6 4z"/>
</svg>`;
export function GET() {
  return new Response(icon, { headers: {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
  } });
}
