// Stage 2: raw float depth (+ source image) -> web assets.
//   depth/NNN.webp 14-bit depth packed into R (high byte) and G (low byte), lossless, GW x GH = mesh grid
//   tex/NNN.webp   colour texture, 1600 px wide
//   thumbs.webp    10 x 10 atlas of 320 x 187 thumbnails
// usage: node pack.mjs <srcDir> <rawDir> <outDir> [ids...]
import fs from 'fs'; import path from 'path'; import sharp from 'sharp';
const [,, srcDir, rawDir, outDir, ...only] = process.argv;
export const GW = 512, TEXW = 1600, TW = 320, TH = 187;
const SNAP = process.env.SNAP !== '0', PREVIEW = process.env.PREVIEW === '1', NOTEX = process.env.NOTEX === '1';

export function readRaw(f) {
  const b = fs.readFileSync(f);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4), sw = b.readUInt32LE(8), sh = b.readUInt32LE(12);
  const data = new Float32Array(b.buffer.slice(b.byteOffset + 16, b.byteOffset + 16 + w * h * 4));
  return { w, h, sw, sh, data };
}
// area-average resample (separable box filter with fractional coverage)
function resample1(src, sw, sh, dw) {
  const out = new Float32Array(dw * sh), sc = sw / dw;
  for (let x = 0; x < dw; x++) {
    const a = x * sc, b = (x + 1) * sc, i0 = Math.floor(a), i1 = Math.min(sw - 1, Math.ceil(b) - 1);
    for (let y = 0; y < sh; y++) {
      let s = 0, wsum = 0;
      for (let i = i0; i <= i1; i++) { const wgt = Math.min(b, i + 1) - Math.max(a, i); s += src[y * sw + i] * wgt; wsum += wgt; }
      out[y * dw + x] = s / wsum;
    }
  }
  return out;
}
function transpose(a, w, h) { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + y] = a[y * w + x]; return o; }
export function resample(src, sw, sh, dw, dh) {
  const a = resample1(src, sw, sh, dw);            // dw x sh
  const t = transpose(a, dw, sh);                   // sh x dw  (w=sh)
  const b = resample1(t, sh, dw, dh);               // dh x dw
  return transpose(b, dh, dw);                      // dw x dh
}
export function normalize(d) {
  const s = Float32Array.from(d).sort();
  const lo = s[Math.floor(s.length * 0.003)], hi = s[Math.floor(s.length * 0.997)];
  const o = new Float32Array(d.length);
  for (let i = 0; i < o.length; i++) o[i] = Math.min(1, Math.max(0, (d[i] - lo) / (hi - lo || 1)));
  return o;
}
function minmax(d, w, h, r) {
  const t1 = new Float32Array(w * h), t2 = new Float32Array(w * h), mn = new Float32Array(w * h), mx = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = Infinity, b = -Infinity;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { const v = d[y * w + k]; if (v < a) a = v; if (v > b) b = v; }
    t1[y * w + x] = a; t2[y * w + x] = b;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = Infinity, b = -Infinity;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { const i = k * w + x; if (t1[i] < a) a = t1[i]; if (t2[i] > b) b = t2[i]; }
    mn[y * w + x] = a; mx[y * w + x] = b;
  }
  return { mn, mx };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Turn the model's soft silhouettes into clean steps, then grow the near side by one cell so that
// the stretched faces at a depth jump are textured with background pixels rather than the outline.
export function sharpenEdges(d, w, h) {
  const a = minmax(d, w, h, 2), b = minmax(d, w, h, 6), o = new Float32Array(w * h);
  for (let i = 0; i < o.length; i++) {
    const r2 = a.mx[i] - a.mn[i], r6 = b.mx[i] - b.mn[i];
    const wgt = smooth(0.035, 0.09, r2) * smooth(0.45, 0.7, r2 / (r6 + 1e-6));
    const snapped = (d[i] - a.mn[i] > a.mx[i] - d[i]) ? a.mx[i] : a.mn[i];
    o[i] = d[i] + (snapped - d[i]) * wgt;
  }
  const c = minmax(o, w, h, 1), a2 = minmax(o, w, h, 2), out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) { const wgt = smooth(0.03, 0.08, a2.mx[i] - a2.mn[i]); out[i] = o[i] + (c.mx[i] - o[i]) * wgt; }
  return out;
}
export function depthGrid(rawFile, long = GW) {      // grid of that many samples along the longer side
  const r = readRaw(rawFile), wide = r.sw >= r.sh, gw = wide ? long : Math.round(long * r.sw / r.sh), gh = wide ? Math.round(long * r.sh / r.sw) : long;
  let d = resample(normalize(r.data), r.w, r.h, gw, gh);
  if (SNAP) d = sharpenEdges(d, gw, gh);
  return { d, gw, gh, sw: r.sw, sh: r.sh };
}
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  for (const sub of ['depth', 'tex']) fs.mkdirSync(path.join(outDir, sub), { recursive: true });
  const files = fs.readdirSync(srcDir).filter(f => /^\d{3}\.(png|jpg)$/i.test(f)).sort();
  const thumbs = [], manifest = [];
  for (const f of files) {
    const id = f.slice(0, 3); if (only.length && !only.includes(id)) continue;
    const rawFile = path.join(rawDir, id + '.f32'); if (!fs.existsSync(rawFile)) continue;
    const { d, gw, gh, sw, sh } = depthGrid(rawFile);
    const px = Buffer.alloc(gw * gh * 3);
    // 14-bit depth, left-aligned in 16 bits: R = high byte, G = low byte. Lossless WebP keeps it exact.
    for (let i = 0; i < d.length; i++) { const v = Math.round(Math.min(1, Math.max(0, d[i])) * 16383) << 2; px[i * 3] = v >> 8; px[i * 3 + 1] = v & 255; }
    await sharp(px, { raw: { width: gw, height: gh, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(path.join(outDir, 'depth', id + '.webp'));
    if (PREVIEW) { const g = Buffer.alloc(gw * gh); for (let i = 0; i < d.length; i++) g[i] = Math.round(d[i] * 255); await sharp(g, { raw: { width: gw, height: gh, channels: 1 } }).png().toFile(path.join(outDir, 'depth', id + '_preview.png')); }
    const texH = Math.round(TEXW * sh / sw);
    if (!NOTEX) await sharp(path.join(srcDir, f)).removeAlpha().resize(TEXW, texH, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: 84, effort: 5 }).toFile(path.join(outDir, 'tex', id + '.webp'));
    thumbs.push({ id, buf: await sharp(path.join(srcDir, f)).removeAlpha().resize(TW, TH, { fit: 'cover' }).png().toBuffer() });
    manifest.push({ id, w: TEXW, h: texH, gw, gh });
    console.log(id, gw + 'x' + gh, TEXW + 'x' + texH);
  }
  if (!only.length) {
    await sharp({ create: { width: TW * 10, height: TH * 10, channels: 3, background: '#0b1220' } })
      .composite(thumbs.map((t, k) => ({ input: t.buf, left: (k % 10) * TW, top: Math.floor(k / 10) * TH })))
      .webp({ quality: 78, effort: 5 }).toFile(path.join(outDir, 'thumbs.webp'));
    fs.writeFileSync(path.join(outDir, 'tools', 'manifest.json'), JSON.stringify(manifest));
  }
  console.log('packed', manifest.length);
}
