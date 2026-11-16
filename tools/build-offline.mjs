/**
 * Adds dist/offline.html to website builds: the same game without the online features (no sign-in,
 * no closed-beta lock, no Clutch League, beta tournament or cloud save), served at /offline. It is
 * built in Vite's "offline" mode, which does not read .env.production, so it has no server
 * settings; player photos and icons load from the site next to it.
 *
 * Only Cloudflare Pages builds (CF_PAGES is set there) get it, so the phone apps, which copy
 * dist/ after `npm run build`, stay small. Run with OFFLINE_PAGE=1 to build it locally.
 */
import { copyFileSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'vite';

if (!process.env.CF_PAGES && !process.env.OFFLINE_PAGE) {
  console.log('offline page: skipped (website builds only; set OFFLINE_PAGE=1 to build it here)');
  process.exit(0);
}

// Server settings given as build variables (instead of .env.production) must not reach this page either.
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const tmp = 'dist-offline';
await build({ mode: 'offline', logLevel: 'warn', build: { outDir: tmp, emptyOutDir: true, copyPublicDir: false } });
const html = readFileSync(`${tmp}/index.html`, 'utf8');
if (/https:\/\/[a-z0-9]+\.supabase\.co/.test(html)) {
  console.error('offline page: the build still holds a Supabase project address, so it would ask for a sign-in. Stopping.');
  process.exit(1);
}
copyFileSync(`${tmp}/index.html`, 'dist/offline.html');
rmSync(tmp, { recursive: true, force: true });
console.log(`offline page: dist/offline.html (${(html.length / 1e6).toFixed(1)} MB)`);
