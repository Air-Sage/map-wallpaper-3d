// Line up the generated side views of each map with the original view on the turntable.
// Every view is unprojected with the page's own code and looked at from straight above.
// The original picture's camera height angle is read off its ground slope. Each generated view is taken
// to be drawn from the same height angle and is scaled and shifted so that the patch of ground it shows
// covers the patch of ground the original shows (both seen from straight above). Where a picture has no
// clear ground, plain geometry is used instead: a back view in the original's own framing, a side view
// scaled so that its picture width spans the ground depth of the original.
// With --search the placement is also refined by matching top-down pictures (scale, turn, shift and
// height angle); that helps on maps with a clear, textured floor and misleads on the others, so it is off
// by default. Last, a relief gain per view evens out how tall things stand.
// usage: node register.mjs <outDir> [ids...] [--png dir]   -> tools/registration.json, VIEWS in index.html
import fs from 'fs'; import path from 'path'; import sharp from 'sharp';
const args = process.argv.slice(2), pi = args.indexOf('--png'), pngDir = pi >= 0 ? args.splice(pi, 2)[1] : null;
const si = args.indexOf('--search'), SEARCH = si >= 0; if (SEARCH) args.splice(si, 1);
const [outDir, ...only] = args;
const htmlFile = path.join(outDir, 'index.html'), html = fs.readFileSync(htmlFile, 'utf8');
const shared = /\/\*SHARED-BEGIN[\s\S]*?\*\/([\s\S]*?)\/\*SHARED-END\*\//.exec(html)[1];
const S = new Function(shared + '\nreturn { TAU, unproject, buildLayers, meshData, fitGround, placeView };')();
const CAM = 1 / Math.tan(16 * Math.PI / 180), RAD = Math.PI / 180, G = 88, RG = 2.2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function loadView(name) {
  const dm = await sharp(path.join(outDir, 'depth', name + '.webp')).raw().toBuffer({ resolveWithObject: true });
  const gw = dm.info.width, gh = dm.info.height, ch = dm.info.channels, d = new Float32Array(gw * gh);
  for (let i = 0; i < d.length; i++) d[i] = (dm.data[i * ch] * 256 + dm.data[i * ch + 1]) / 65535;
  const tex = path.join(outDir, 'tex', name + '.webp'), meta = await sharp(tex).metadata(), aspect = meta.width / meta.height;
  const col = await sharp(tex).removeAlpha().resize(gw, gh, { fit: 'fill' }).raw().toBuffer();
  return { d, gw, gh, col, aspect, plane: S.fitGround(d, gw, gh, aspect) };
}
// Every 2nd sample of a view in turntable space: [x, y, z, r, g, b] per sample.
function cloud(v, deg, tanPhi, reg, gain = 1) {
  const pl = S.placeView(v.plane, deg, tanPhi, CAM, reg), m = pl.m, { d, gw, gh, col } = v, out = new Float32Array(Math.ceil(gw / 2) * Math.ceil(gh / 2) * 6);
  let o = 0;
  for (let y = 0; y < gh; y += 2) for (let x = 0; x < gw; x += 2) {
    const i = y * gw + x, p = S.unproject(x / (gw - 1), y / (gh - 1), d[i], pl.k, pl.d0, v.aspect, CAM, v.plane, gain);
    out[o++] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]; out[o++] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2]; out[o++] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    out[o++] = col[i * 3]; out[o++] = col[i * 3 + 1]; out[o++] = col[i * 3 + 2];
  }
  return out;
}
// Seen from straight above: per ground cell the colour and height of the highest sample.
function topDown(pc, g = G) {
  const hgt = new Float32Array(g * g).fill(-1e9), col = new Float32Array(g * g * 3), ok = new Uint8Array(g * g);
  for (let i = 0; i < pc.length; i += 6) {
    const wy = pc[i + 1]; if (wy > 1.3 || wy < -0.5) continue;
    const cx = Math.floor((pc[i] + RG) / (2 * RG) * g), cz = Math.floor((pc[i + 2] + RG) / (2 * RG) * g);
    if (cx < 0 || cz < 0 || cx >= g || cz >= g) continue;
    const c = cz * g + cx;
    if (wy > hgt[c]) { hgt[c] = wy; col[c * 3] = pc[i + 3]; col[c * 3 + 1] = pc[i + 4]; col[c * 3 + 2] = pc[i + 5]; ok[c] = 1; }
  }
  return { hgt, col, ok };
}
// How tall things stand: a high percentile of the heights above ground near the middle of the turntable.
function tallness(pc) {
  const h = [];
  for (let i = 0; i < pc.length; i += 6) if (Math.hypot(pc[i], pc[i + 2]) < 1.2 && pc[i + 1] < 1.6) h.push(pc[i + 1]);
  if (h.length < 200) return 0;
  h.sort((a, b) => a - b); return h[Math.floor(h.length * 0.93)];
}
function points(td) {
  const p = [];
  for (let cz = 0; cz < G; cz++) for (let cx = 0; cx < G; cx++) { const c = cz * G + cx; if (td.ok[c]) p.push((cx + 0.5) / G * 2 * RG - RG, (cz + 0.5) / G * 2 * RG - RG, td.col[c * 3], td.col[c * 3 + 1], td.col[c * 3 + 2], clamp(td.hgt[c], -0.2, 0.9) * 255); }
  return Float32Array.from(p);
}
// How well the moved view agrees with the reference: correlation of colour and height where they overlap.
function score(ref, pts, s, del, tx, tz, stride, exp) {
  const cs = Math.cos(del) * s, sn = Math.sin(del) * s, n0 = pts.length / 6;
  let n = 0; const A = [0, 0, 0, 0], B = [0, 0, 0, 0], AB = [0, 0, 0, 0], AA = [0, 0, 0, 0], BB = [0, 0, 0, 0];
  for (let i = 0; i < n0; i += stride) {
    const x = pts[i * 6], z = pts[i * 6 + 1], X = cs * x + sn * z + tx, Z = -sn * x + cs * z + tz;
    const cx = Math.floor((X + RG) / (2 * RG) * G), cz = Math.floor((Z + RG) / (2 * RG) * G);
    if (cx < 0 || cz < 0 || cx >= G || cz >= G) continue;
    const c = cz * G + cx; if (!ref.ok[c]) continue;
    n++;
    for (let k = 0; k < 4; k++) { const a = k < 3 ? pts[i * 6 + 2 + k] : pts[i * 6 + 5] * s, b = k < 3 ? ref.col[c * 3 + k] : clamp(ref.hgt[c], -0.2, 0.9) * 255; A[k] += a; B[k] += b; AB[k] += a * b; AA[k] += a * a; BB[k] += b * b; }
  }
  const total = Math.ceil(n0 / stride); if (n < total * 0.35) return -1;
  let sc = 0;
  for (let k = 0; k < 4; k++) { const va = n * AA[k] - A[k] * A[k], vb = n * BB[k] - B[k] * B[k]; if (va > 1e-6 && vb > 1e-6) sc += (k < 3 ? 1 / 6 : 0.5) * (n * AB[k] - A[k] * B[k]) / Math.sqrt(va * vb); }
  return sc * Math.sqrt(n / total) - 0.06 * Math.abs(Math.log(s / exp.s)) - 0.03 * (Math.abs(tx - exp.tx) + Math.abs(tz - exp.tz)) - 0.002 * Math.abs(del / RAD);
}
// exp = where plain geometry expects the view (scale and shift); the search starts and is anchored there
function register(ref, td, exp) {
  const pts = points(td), id0 = score(ref, pts, exp.s, 0, exp.tx, exp.tz, 1, exp); let best = { sc: id0, s: exp.s, del: 0, tx: exp.tx, tz: exp.tz };
  const tryIt = (s, del, tx, tz, stride) => { const sc = score(ref, pts, s, del, tx, tz, stride, exp); if (sc > best.sc) best = { sc, s, del, tx, tz }; };
  // geometry already puts the view close: only fine adjustments around the expected spot are tried
  for (let s = exp.s * 0.8; s <= exp.s * 1.23; s *= 1.035) for (let del = -9; del <= 9; del += 3) for (let tx = -0.36; tx <= 0.361; tx += 0.09) for (let tz = -0.36; tz <= 0.361; tz += 0.09) tryIt(s, del * RAD, exp.tx + tx, exp.tz + tz, 2);
  let ds = 1.025, dd = 2 * RAD, dt = 0.05;
  for (let round = 0; round < 4; round++) {
    const b = { ...best };
    for (const s of [b.s / ds, b.s, b.s * ds]) for (const del of [b.del - dd, b.del, b.del + dd]) for (const tx of [b.tx - dt, b.tx, b.tx + dt]) for (const tz of [b.tz - dt, b.tz, b.tz + dt]) tryIt(s, del, tx, tz, 1);
    ds = Math.sqrt(ds); dd /= 2; dt /= 2;
  }
  best.gain = best.sc - id0;
  return best;
}
function merge(ref, td) {               // grow the reference with what the newly placed view adds
  for (let c = 0; c < G * G; c++) if (td.ok[c] && !ref.ok[c]) { ref.ok[c] = 1; ref.hgt[c] = td.hgt[c]; for (let k = 0; k < 3; k++) ref.col[c * 3 + k] = td.col[c * 3 + k]; }
}
async function png(pc, file) {
  const g = 256, td = topDown(pc, g), b = Buffer.alloc(g * g * 3, 18);
  for (let c = 0; c < g * g; c++) if (td.ok[c]) for (let k = 0; k < 3; k++) b[c * 3 + k] = td.col[c * 3 + k];
  for (let t = -6; t <= 6; t++) for (const c of [(g / 2) * g + g / 2 + t, (g / 2 + t) * g + g / 2]) { b[c * 3] = 255; b[c * 3 + 1] = 0; b[c * 3 + 2] = 0; }
  return sharp(b, { raw: { width: g, height: g, channels: 3 } }).png().toBuffer();
}
const regFile = path.join(outDir, 'tools', 'registration.json');
const reg = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : {};
const ids = {};
for (const f of fs.readdirSync(path.join(outDir, 'tex'))) { const m = /^(\d{3})_(\d{3})\.webp$/.exec(f); if (m && fs.existsSync(path.join(outDir, 'depth', f))) (ids[m[1]] ||= []).push(+m[2]); }
const none = { s: 1, del: 0, tx: 0, tz: 0, sc: 0, gain: 0 };
// Ground reach of the original picture in front of and behind its centre, for a camera height angle.
function reach(tp) { const q = 1 / (CAM * tp), near = 1 / (1 + q), far = 1 / Math.max(0.45, 1 - q); return [Math.hypot(near, CAM * (1 - near)), Math.hypot(far, CAM * (far - 1))]; }
// Where plain geometry puts a generated view: a side view's picture width spans the original's ground depth.
function expected(v, deg, tp0) {
  const [near, far] = reach(tp0), c = Math.cos(deg * RAD), sn = Math.sin(deg * RAD), mid = (near - far) / 2;
  if (v.aspect >= 1.2) return { s: 1, tx: 0, tz: 0 };                       // drawn in the original's own framing
  const s = Math.min(2.4, (near + far) / 2 / v.aspect) * (1 - 0.25 * Math.abs(c));   // squarer frames for the views in between
  return { s, tx: 0, tz: mid * Math.abs(sn) };
}
// The patch of ground a view shows, as a box on the turntable: the samples lying on its ground plane, measured
// across and along the line of sight of a camera standing axis degrees round ([uMin, uMax, wMin, wMax]).
function groundBox(v, deg, tp, axis) {
  if (v.plane.frac < 0.15) return null;
  const pl = S.placeView(v.plane, deg, tp, CAM, null), m = pl.m, { d, gw, gh } = v, xs = [], zs = [], ca = Math.cos(axis * RAD), sa = Math.sin(axis * RAD);
  for (let y = 0; y < gh; y += 3) for (let x = 0; x < gw; x += 3) {
    const i = y * gw + x, px = (2 * x / (gw - 1) - 1) * v.aspect, py = 1 - 2 * y / (gh - 1);
    if (Math.abs(d[i] - (v.plane.a * px + v.plane.b * py + v.plane.c)) > 0.03) continue;
    const p = S.unproject(x / (gw - 1), y / (gh - 1), d[i], pl.k, pl.d0, v.aspect, CAM);
    const X = m[0] * p[0] + m[4] * p[1] + m[8] * p[2], Z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2];
    xs.push(X * ca - Z * sa); zs.push(X * sa + Z * ca);
  }
  if (xs.length < 300) return null;
  xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  const lo = Math.floor(xs.length * 0.03), hi = Math.floor(xs.length * 0.97);
  return [xs[lo], xs[hi], zs[lo], zs[hi]];
}
// Scale and shift that lay one ground box over another. Things standing on the ground hide parts of it
// differently from each side, so the boxes are only trusted within limits: a view in the original's own
// framing stays near the original's scale, and no view is pushed far off centre.
function boxPlace(b0, bk, sameFraming, axis) {
  if (!b0 || !bk) return null;
  const w0 = b0[1] - b0[0], d0 = b0[3] - b0[2], wk = bk[1] - bk[0], dk = bk[3] - bk[2];
  const s = clamp((w0 * wk + d0 * dk) / (wk * wk + dk * dk), sameFraming ? 0.78 : 0.6, sameFraming ? 1.15 : 2.4);
  const du = clamp((b0[0] + b0[1]) / 2 - s * (bk[0] + bk[1]) / 2, -0.22, 0.22), dw = clamp((b0[2] + b0[3]) / 2 - s * (bk[2] + bk[3]) / 2, -0.22, 0.22);
  const ca = Math.cos(axis * RAD), sa = Math.sin(axis * RAD);
  return { s, tx: du * ca + dw * sa, tz: -du * sa + dw * ca };     // back from the camera's axes to the turntable's
}
for (const id of Object.keys(ids).sort()) {
  if (only.length ? !only.includes(id) : (reg[id] && ids[id].every(g => reg[id][g]))) continue;
  const v0 = await loadView(id);
  const tp0 = clamp(1 / (CAM * 0.6 * Math.hypot(v0.plane.a, v0.plane.b)), Math.tan(45 * RAD), Math.tan(75 * RAD)), phi0 = Math.atan(tp0) / RAD;
  const pc0 = cloud(v0, 0, tp0, null), ref = topDown(pc0), shots = pngDir ? [await png(pc0)] : null;
  reg[id] = { 0: [1, 0, 0, 0, +tp0.toFixed(4)] };
  const order = ids[id].slice().sort((p, q) => Math.min(p, 360 - p) - Math.min(q, 360 - q));    // nearest to the original first
  const placed = [{ v: v0, deg: 0, out: reg[id][0] }];
  for (const deg of order) {
    const v = await loadView(id + '_' + String(deg).padStart(3, '0')), exp = boxPlace(groundBox(v0, 0, tp0, deg), groundBox(v, deg, tp0, deg), deg === 180 && v.aspect >= 1.2, deg) || expected(v, deg, tp0);
    // a view in the original's framing was most likely drawn from the original's height angle; a side view may differ more
    const span = v.aspect >= 1.2 ? [-12, -6, 0, 6, 12] : [-30, -24, -18, -12, -6, 0, 6, 12];
    let best = null;
    const trust = SEARCH && v0.plane.frac >= 0.2 && v.plane.frac >= 0.2;      // without a clear ground in both pictures there is nothing to match
    for (const dphi of trust ? span : [0]) {
      const phi = clamp(phi0 + dphi, 26, 80), tp = Math.tan(phi * RAD), cand = register(ref, topDown(cloud(v, deg, tp, null)), exp);
      cand.tp = tp; cand.total = cand.sc - 0.0015 * Math.abs(dphi); cand.base = cand.sc - cand.gain;
      if (!best || cand.total > best.total) best = cand;
    }
    // only move a view off the expected spot when it clearly helps
    const q = trust && best.gain > 0.05 ? best : { ...none, ...exp, tp: tp0, sc: best.base };
    const out = [+q.s.toFixed(4), +(q.del / RAD).toFixed(2), +q.tx.toFixed(4), +q.tz.toFixed(4), +q.tp.toFixed(4)];
    reg[id][deg] = out; placed.push({ v, deg, out });
    const pc = cloud(v, deg, q.tp, out); merge(ref, topDown(pc)); if (shots) shots.push(await png(pc));
    console.log(id, String(deg).padStart(3), 'place', JSON.stringify(out.slice(0, 4)), 'angle', (Math.atan(q.tp) / RAD).toFixed(0) + '°', 'score', q.sc.toFixed(3), 'gain', q.gain.toFixed(3), 'ground', v.plane.frac.toFixed(2));
  }
  // Relief gain: depth read off a steep, near top-down picture makes things stand too tall. The side views
  // show heights best, so every view is squeezed or stretched until its things stand as tall as theirs.
  const tall = (p, g) => tallness(cloud(p.v, p.deg, p.out[4], p.out, g));
  const sides = placed.filter(p => p.v.aspect < 1.2), basis = (sides.length ? sides : placed.slice(1)).map(p => tall(p, 1)).sort((a, b) => a - b);
  const target = basis.length ? basis[basis.length >> 1] : 0, gains = [];
  for (const p of placed) {
    let g = 1;
    if (target > 0.03) for (let it = 0; it < 4; it++) { const h = tall(p, g); if (h < 0.01) break; g = clamp(g * target / h, 0.3, 1.35); }
    p.out[5] = +g.toFixed(3); gains.push(p.deg + ':' + p.out[5]);
  }
  console.log(id, 'original drawn from', phi0.toFixed(0) + '°', 'ground', v0.plane.frac.toFixed(2), 'tallness', target.toFixed(3), 'gains', gains.join(' '));
  fs.writeFileSync(regFile, JSON.stringify(reg));
  if (shots) await sharp({ create: { width: 4 * 256, height: Math.ceil(shots.length / 4) * 256, channels: 3, background: '#000' } })
    .composite(shots.map((input, k) => ({ input, left: (k % 4) * 256, top: Math.floor(k / 4) * 256 }))).png().toFile(path.join(pngDir, 'topdown_' + id + '.png'));
}
// write the view list (with placements) into the page
const views = {};
for (const id of Object.keys(ids).sort()) { views[id] = {}; for (const g of [0, ...ids[id].sort((p, q) => p - q)]) views[id][g] = reg[id] && reg[id][g] ? reg[id][g] : [1, 0, 0, 0, g ? 1 : 1.43, 1]; }
const cur = fs.readFileSync(htmlFile, 'utf8');
fs.writeFileSync(htmlFile, cur.replace(/\/\*VIEWS-BEGIN\*\/[\s\S]*?\/\*VIEWS-END\*\//, () => '/*VIEWS-BEGIN*/' + JSON.stringify(views) + '/*VIEWS-END*/'));
console.log('maps with side views:', Object.keys(views).length);
