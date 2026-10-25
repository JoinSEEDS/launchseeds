const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const routes = [
  'app/api/admin/session/route.ts',
  'app/api/admin/processes/route.ts',
  'app/api/admin/process/route.ts',
  'app/api/admin/stream/route.ts',
  'app/api/admin/health/route.ts',
];
for (const name of routes) assert(fs.existsSync(path.join(root, name)), name);
for (const name of routes.slice(1)) {
  const src = read(name);
  assert(/requireAdmin|enforceAdminAction/.test(src), `${name} missing authentication`);
  assert(/adminError/.test(src), `${name} missing non-leaking error mapper`);
}
assert(read('app/api/admin/process/route.ts').includes('auditAdminAction'), 'Action requires audit');
assert(read('app/api/admin/process/route.ts').includes('enforceAdminAction'), 'Mutation needs origin');
assert(read('app/api/admin/stream/route.ts').includes('MAX_CONNECTIONS'), 'Bound active streams');
assert(read('app/api/admin/stream/route.ts').includes('MAX_STREAM_DURATION_MS'), 'Expire streams');
assert(read('lib/admin/bgrun.ts').includes('shell: false'), 'Commands must not invoke shell');
assert(read('lib/admin/bgrun.ts').includes('MAX_LOG_BYTES'), 'Log reads must be bounded');
assert(read('lib/admin/bgrun.ts').includes('LAUNCHSEEDS_ADMIN_CONTROL_PROCESSES'), 'Controls require allowlist');
assert(/target\.textContent\s*=\s*visible/.test(read('app/admin/page.client.tsx')), 'No raw HTML logs');
assert(read('app/admin/page.client.tsx').includes('source.addEventListener("snapshot"'), 'Live SSE log path');
assert(!read('app/layout.tsx').includes('href="/admin"'), 'Admin link must not appear in public header');
assert(!fs.existsSync(path.join(root, 'app/designer')), 'No generated designer layer');
console.log('Admin v12 structure: 20 checks passed');
