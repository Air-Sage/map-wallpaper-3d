// Pack the generated side views (NNN_DDD.png from Codex) next to the original ones and record
// which views exist in index.html.
// usage: node pack_views.mjs <viewsDir> <rawDir> <outDir>
import fs from 'fs'; import path from 'path'; import sharp from 'sharp';
import { depthGrid, TEXW } from './pack.mjs';
const [,, viewsDir, rawDir, outDir] = process.argv;
for (const f of fs.readdirSync(viewsDir).filter(f => /^\d{3}_\d{3}\.png$/.test(f)).sort()) {
  const name = f.slice(0, 7), rawFile = path.join(rawDir, name + '.f32'), tex = path.join(outDir, 'tex', name + '.webp');
  if (!fs.existsSync(rawFile) || (fs.existsSync(tex) && fs.statSync(tex).mtimeMs > fs.statSync(path.join(viewsDir, f)).mtimeMs)) continue;
  const { d, gw, gh, sw, sh } = depthGrid(rawFile), px = Buffer.alloc(gw * gh * 3);
  for (let i = 0; i < d.length; i++) { const v = Math.round(Math.min(1, Math.max(0, d[i])) * 16383) << 2; px[i * 3] = v >> 8; px[i * 3 + 1] = v & 255; }
  await sharp(px, { raw: { width: gw, height: gh, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(path.join(outDir, 'depth', name + '.webp'));
  await sharp(path.join(viewsDir, f)).removeAlpha().resize(sw >= sh ? TEXW : Math.round(TEXW * sw / sh), sw >= sh ? Math.round(TEXW * sh / sw) : TEXW, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: 84, effort: 5 }).toFile(tex);
  console.log(name, gw + 'x' + gh);
}
// view list for the page: degrees -> [scale, turn, shift x, shift z, tan of camera height angle] (register.mjs refines these)
const regFile = path.join(outDir, 'tools', 'registration.json'), reg = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : {};
const views = {};
for (const f of fs.readdirSync(path.join(outDir, 'tex')).sort()) {
  const m = /^(\d{3})_(\d{3})\.webp$/.exec(f); if (!m || !fs.existsSync(path.join(outDir, 'depth', f))) continue;
  const id = m[1], put = g => { (views[id] ||= {})[g] = reg[id] && reg[id][g] ? reg[id][g] : [1, 0, 0, 0, g ? 1 : 1.43, 1]; };
  put(0); put(+m[2]);
}
const html = path.join(outDir, 'index.html'), s = fs.readFileSync(html, 'utf8');
const out = s.replace(/\/\*VIEWS-BEGIN\*\/[\s\S]*?\/\*VIEWS-END\*\//, () => '/*VIEWS-BEGIN*/' + JSON.stringify(views) + '/*VIEWS-END*/');
if (out === s && !s.includes(JSON.stringify(views))) throw new Error('VIEWS marker not found in index.html');
fs.writeFileSync(html, out);
console.log('maps with side views:', Object.keys(views).length, JSON.stringify(views).slice(0, 200));
