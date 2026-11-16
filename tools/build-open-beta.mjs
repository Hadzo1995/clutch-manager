/**
 * Builds the private open beta: one HTML file with everything inside (player photos and icons
 * included), no sign-in, no closed-beta lock and no online features, plus a notes pill for writing
 * down what to improve. It opens from a double-click with no internet and no server.
 *
 * It is never deployed: `npm run build` and Cloudflare Pages do not run this. Run `npm run open-beta`
 * and the file lands in dist-open-beta/ (ignored by git).
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { build } from 'vite';

// No server settings may reach this build, whatever the shell has set.
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
process.env.VITE_OPEN_BETA_VERSION = pkg.version;
process.env.VITE_OPEN_BETA_BUILT = built;

const dataUrl = (file) => `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(`public/${file}`).toString('base64')}`;

/** Player photos and icons normally load from the site next to the page; put them inside it instead. */
const inlineAssets = {
  name: 'open-beta-inline-assets',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('playerPhotos.generated.ts')) return null;
    return code.replace(/"src": "(players\/[^"]+)"/g, (_m, f) => `"src": "${dataUrl(f)}"`);
  },
  transformIndexHtml(html) {
    return html
      .replace(/\s*<link rel="manifest"[^>]*>/, '')
      .replace(/href="(icons\/[^"]+\.png)"/g, (_m, f) => `href="${dataUrl(f)}"`)
      .replace(/<title>([^<]*)<\/title>/, '<title>$1 (open beta)</title>');
  },
};

const out = 'dist-open-beta';
await build({ mode: 'openbeta', logLevel: 'warn', plugins: [inlineAssets], build: { outDir: out, emptyOutDir: true, copyPublicDir: false } });

const html = readFileSync(`${out}/index.html`, 'utf8');
if (/https:\/\/[a-z0-9]+\.supabase\.co/.test(html)) {
  console.error('open beta: the build still holds a Supabase project address, so it would ask for a sign-in. Stopping.');
  process.exit(1);
}
if (/"src": ?"players\//.test(html)) {
  console.error('open beta: some player photos still point at files outside the page. Stopping.');
  process.exit(1);
}
const file = `${out}/clutch-manager-open-beta-v${pkg.version}.html`;
mkdirSync(out, { recursive: true });
renameSync(`${out}/index.html`, file);
rmSync(`${out}/assets`, { recursive: true, force: true });
console.log(`open beta: ${file} (${(statSync(file).size / 1e6).toFixed(1)} MB, built ${built})`);
