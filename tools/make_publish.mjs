// A lighter copy of the site for publishing where total size is capped: pictures 1024 px on the long
// side, depth grids 320 samples on the long side. The page itself is the same file.
// usage: node make_publish.mjs <siteDir> <rawDepthDir> <outDir>
import fs from 'fs'; import path from 'path'; import sharp from 'sharp';
import { depthGrid } from './pack.mjs';
const [,, site, rawDir, out] = process.argv, LONG = 1024, GRID = 320;
for (const sub of ['tex', 'depth']) fs.mkdirSync(path.join(out, sub), { recursive: true });
let n = 0, bytes = 0;
for (const f of fs.readdirSync(path.join(site, 'tex')).filter(f => f.endsWith('.webp')).sort()) {
  const name = f.slice(0, -5), raw = path.join(rawDir, name + '.f32'); if (!fs.existsSync(raw)) { console.log('no raw depth for', name); continue; }
  const src = path.join(site, 'tex', f), dstT = path.join(out, 'tex', f), dstD = path.join(out, 'depth', f);
  if (!fs.existsSync(dstT) || fs.statSync(dstT).mtimeMs < fs.statSync(src).mtimeMs) {
    const m = await sharp(src).metadata(), wide = m.width >= m.height;
    await sharp(src).resize(wide ? LONG : null, wide ? null : LONG, { kernel: 'lanczos3' }).webp({ quality: 78, effort: 5 }).toFile(dstT);
    const { d, gw, gh } = depthGrid(raw, GRID), px = Buffer.alloc(gw * gh * 3);
    for (let i = 0; i < d.length; i++) { const v = Math.round(Math.min(1, Math.max(0, d[i])) * 4095) << 4; px[i * 3] = v >> 8; px[i * 3 + 1] = v & 255; }
    await sharp(px, { raw: { width: gw, height: gh, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(dstD);
  }
  n++; bytes += fs.statSync(dstT).size + fs.statSync(dstD).size;
}
fs.copyFileSync(path.join(site, 'thumbs.webp'), path.join(out, 'thumbs.webp'));
// the published page cannot hand out files, so the local-only parts (GLB export) are left out
const page = fs.readFileSync(path.join(site, 'index.html'), 'utf8').replace(/<!--LOCAL-BEGIN-->[\s\S]*?<!--LOCAL-END-->/g, '').replace(/\/\*LOCAL-BEGIN\*\/[\s\S]*?\/\*LOCAL-END\*\//g, '')
  .replace(/<!doctype html>\n|<html[^>]*>\n|<\/?head>\n|<\/?body>\n|<\/html>\n|<meta name="viewport"[^>]*>\n/g, '');
fs.writeFileSync(path.join(out, 'index.html'), page);
for (const f of ['index.html', 'thumbs.webp']) bytes += fs.statSync(path.join(out, f)).size;
console.log('views:', n, 'total MB:', (bytes / 1048576).toFixed(1));
