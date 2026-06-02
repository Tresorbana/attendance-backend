/**
 * Minutiae-based fingerprint matching pipeline.
 *
 * Pipeline: histogram-equalize → Otsu binarize → 3×3 blur → Zhang-Suen thin →
 * crossing-number extraction → spur filter → MPA (Minutiae Pair Alignment) matching.
 *
 * DigitalPersona U.are.U FTIR optics: ridges scatter light → appear DARK.
 * So ridge pixels have LOW values → mapped to 1 (foreground) after binarization.
 */

export interface Minutia {
  x: number;      // column (0-based)
  y: number;      // row (0-based)
  angle: number;  // radians in [-π, π], ridge direction at the minutia
  type: 'ending' | 'bifurcation';
}

export interface MinutiaeTemplate {
  minutiae: Minutia[];
  width: number;
  height: number;
}

/** Returns true if the string is a JSON minutiae template (not raw pixels or PNG). */
export function isMinutiaeTemplate(s: string): boolean {
  return s.startsWith('{');
}

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Pixels from the image edge that are excluded from minutiae. */
const BORDER_MARGIN = 12;

/**
 * Minimum skeleton branch length to keep a minutia.
 * Zhang-Suen spurs are 1–3 px; genuine endings need ≥ 5 px of branch.
 * At 256×256 (from ~400×400 source), ridge pitch ≈ 6 px → 5 is conservative.
 */
const MIN_RIDGE_LEN = 5;

const MIN_MINUTIAE = 5;   // reject probe/gallery with fewer minutiae
const MAX_MINUTIAE = 60;  // cap to bound matching cost
const MIN_DIST_SQ  = 49;  // squared min separation (7 px)

/** Minimum absolute matched pairs — prevents tiny lists fooling the ratio score. */
const MIN_MATCH_PAIRS = 4;

// MPA matching tolerances
const D_TOL    = 12;              // spatial tolerance (pixels)
const D_TOL_SQ = D_TOL * D_TOL;
const A_TOL    = Math.PI / 6;    // angle tolerance ≈ 30°

// ── Neighbor offsets (Zhang-Suen clockwise from top) ─────────────────────────
// Index 0=P2 (above), 1=P3, 2=P4 (right), 3=P5, 4=P6 (below), 5=P7, 6=P8 (left), 7=P9

const ZS_DR = [-1, -1,  0,  1, 1,  1,  0, -1];
const ZS_DC = [ 0,  1,  1,  1, 0, -1, -1, -1];

// ── Otsu threshold ───────────────────────────────────────────────────────────

function otsuThreshold(pixels: Uint8Array, n: number): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[pixels[i]]++;

  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const d = mB - mF;
    const v = wB * wF * d * d;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }

  return threshold;
}

// ── 3×3 box blur ─────────────────────────────────────────────────────────────

function boxBlur3(pixels: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      let s = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          s += pixels[(r + dr) * W + (c + dc)];
      out[r * W + c] = (s / 9 + 0.5) | 0;
    }
  }
  for (let c = 0; c < W; c++) {
    out[c] = pixels[c];
    out[(H - 1) * W + c] = pixels[(H - 1) * W + c];
  }
  for (let r = 1; r < H - 1; r++) {
    out[r * W] = pixels[r * W];
    out[r * W + W - 1] = pixels[r * W + W - 1];
  }
  return out;
}

// ── Binarization ─────────────────────────────────────────────────────────────
// Ridge (DARK pixel) → 1; valley (BRIGHT pixel) → 0.

function binarize(pixels: Uint8Array, n: number, threshold: number): Uint8Array {
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = pixels[i] <= threshold ? 1 : 0;
  return bin;
}

// ── Zhang-Suen thinning ──────────────────────────────────────────────────────

function getN8(img: Uint8Array, W: number, r: number, c: number): Uint8Array {
  const n = new Uint8Array(8);
  for (let k = 0; k < 8; k++) n[k] = img[(r + ZS_DR[k]) * W + (c + ZS_DC[k])];
  return n;
}

function countB(n: Uint8Array): number {
  return n[0]+n[1]+n[2]+n[3]+n[4]+n[5]+n[6]+n[7];
}

function countA(n: Uint8Array): number {
  let a = 0;
  for (let k = 0; k < 8; k++) if (n[k] === 0 && n[(k+1) % 8] === 1) a++;
  return a;
}

function zhangSuenThin(binary: Uint8Array, W: number, H: number): Uint8Array {
  const img  = new Uint8Array(binary);
  const mark = new Uint8Array(W * H);
  let changed = true;
  let maxIter = 120;

  while (changed && maxIter-- > 0) {
    changed = false;

    // Sub-iteration 1
    for (let r = 1; r < H - 1; r++) {
      for (let c = 1; c < W - 1; c++) {
        if (!img[r * W + c]) continue;
        const n = getN8(img, W, r, c);
        const B = countB(n);
        if (B < 2 || B > 6 || countA(n) !== 1) continue;
        if (n[0]*n[2]*n[4] || n[2]*n[4]*n[6]) continue; // P2·P4·P6=0 and P4·P6·P8=0
        mark[r * W + c] = 1; changed = true;
      }
    }
    for (let i = 0; i < img.length; i++) if (mark[i]) { img[i] = 0; mark[i] = 0; }

    // Sub-iteration 2
    for (let r = 1; r < H - 1; r++) {
      for (let c = 1; c < W - 1; c++) {
        if (!img[r * W + c]) continue;
        const n = getN8(img, W, r, c);
        const B = countB(n);
        if (B < 2 || B > 6 || countA(n) !== 1) continue;
        if (n[0]*n[2]*n[6] || n[0]*n[4]*n[6]) continue; // P2·P4·P8=0 and P2·P6·P8=0
        mark[r * W + c] = 1; changed = true;
      }
    }
    for (let i = 0; i < img.length; i++) if (mark[i]) { img[i] = 0; mark[i] = 0; }
  }

  return img;
}

// ── Crossing number ───────────────────────────────────────────────────────────
// CN=1 → ridge ending; CN=3 → bifurcation.

function crossingNumber(n: Uint8Array): number {
  let cn = 0;
  for (let k = 0; k < 8; k++) cn += Math.abs(n[(k+1) % 8] - n[k]);
  return cn >> 1;
}

// ── Spur filter ───────────────────────────────────────────────────────────────
//
// Zhang-Suen thinning creates short "spur" branches at ridge borders. These appear
// as ridge endings with a very short stub (1–3 pixels) or bifurcations with one
// short stub branch. We trace each skeleton branch from a minutia; if any branch
// dead-ends within MIN_RIDGE_LEN steps the minutia is discarded.
//
// NOTE: branches that reach another junction within MIN_RIDGE_LEN are accepted —
// those indicate two genuine features that are naturally close together.

function branchIsLongEnough(
  skeleton: Uint8Array, W: number, H: number,
  startR: number, startC: number,
  fromR: number, fromC: number,
): boolean {
  let cr = startR, cc = startC;
  let pr = fromR,  pc = fromC;

  for (let step = 1; step <= MIN_RIDGE_LEN; step++) {
    let nr = -1, nc = -1, count = 0;
    for (let k = 0; k < 8; k++) {
      const r2 = cr + ZS_DR[k];
      const c2 = cc + ZS_DC[k];
      if (r2 < 0 || r2 >= H || c2 < 0 || c2 >= W) continue;
      if (!skeleton[r2 * W + c2]) continue;
      if (r2 === pr && c2 === pc) continue; // don't double back
      nr = r2; nc = c2; count++;
    }

    if (count === 0) return false;  // dead end — spur
    if (count > 1)  return true;   // joined another junction — valid
    // count === 1: keep tracing
    if (step === MIN_RIDGE_LEN) return true; // survived full length
    pr = cr; pc = cc;
    cr = nr; cc = nc;
  }

  return true;
}

function isValidMinutia(skeleton: Uint8Array, W: number, H: number, m: Minutia): boolean {
  let total = 0, short = 0;
  for (let k = 0; k < 8; k++) {
    const nr = m.y + ZS_DR[k];
    const nc = m.x + ZS_DC[k];
    if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
    if (!skeleton[nr * W + nc]) continue;
    total++;
    if (!branchIsLongEnough(skeleton, W, H, nr, nc, m.y, m.x)) short++;
  }
  // Endings (1 branch): branch must be long enough.
  // Bifurcations (3 branches): at most 1 branch may be a spur (the other 2 are genuine ridges).
  return short === 0 || (total === 3 && short === 1);
}

// ── Angle estimation ──────────────────────────────────────────────────────────
// Weighted mean direction of skeleton pixels in a local radius.
// Inverse-distance weighting gives more influence to nearby pixels.

function estimateAngle(skeleton: Uint8Array, W: number, H: number, mx: number, my: number): number {
  const R  = 10;
  const R2 = R * R;
  let dx = 0, dy = 0;

  const rMin = Math.max(1, my - R), rMax = Math.min(H - 2, my + R);
  const cMin = Math.max(1, mx - R), cMax = Math.min(W - 2, mx + R);

  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      if (c === mx && r === my) continue;
      const d2 = (c - mx)*(c - mx) + (r - my)*(r - my);
      if (d2 > R2 || !skeleton[r * W + c]) continue;
      const w = 1 / Math.sqrt(d2);
      dx += w * (c - mx);
      dy += w * (r - my);
    }
  }

  return Math.atan2(dy, dx);
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicate(minutiae: Minutia[]): Minutia[] {
  const result: Minutia[] = [];
  for (const m of minutiae) {
    let close = false;
    for (const r of result) {
      if ((m.x-r.x)*(m.x-r.x) + (m.y-r.y)*(m.y-r.y) < MIN_DIST_SQ) { close = true; break; }
    }
    if (!close) result.push(m);
  }
  return result;
}

// ── Public: extract minutiae from a 256×256 grayscale pixel array ─────────────

export function extractMinutiae(pixels: Uint8Array, W: number, H: number): MinutiaeTemplate {
  const n = W * H;

  const blurred   = boxBlur3(pixels, W, H);
  const threshold = otsuThreshold(blurred, n);
  const binary    = binarize(blurred, n, threshold);
  const skeleton  = zhangSuenThin(binary, W, H);

  const raw: Minutia[] = [];

  for (let r = BORDER_MARGIN; r < H - BORDER_MARGIN; r++) {
    for (let c = BORDER_MARGIN; c < W - BORDER_MARGIN; c++) {
      if (!skeleton[r * W + c]) continue;
      const n8 = getN8(skeleton, W, r, c);
      const cn = crossingNumber(n8);
      if (cn !== 1 && cn !== 3) continue;

      const m: Minutia = {
        x: c, y: r,
        angle: estimateAngle(skeleton, W, H, c, r),
        type: cn === 1 ? 'ending' : 'bifurcation',
      };

      // Discard spurious spur artifacts from Zhang-Suen thinning
      if (!isValidMinutia(skeleton, W, H, m)) continue;

      raw.push(m);
    }
  }

  const minutiae = deduplicate(raw).slice(0, MAX_MINUTIAE);
  return { minutiae, width: W, height: H };
}

// ── MPA (Minutiae Pair Alignment) matching ────────────────────────────────────
//
// For every (probe_i, gallery_j) reference pair, compute the rigid alignment
// T = (rotation θ, translation tx/ty) that maps probe_i onto gallery_j, then
// apply T to the full probe set and count how many probe minutiae fall within
// (D_TOL pixels, A_TOL radians) of a gallery minutia (one-to-one matching).
//
// Score = 2·matched / (|probe| + |gallery|)   (Dice coefficient, range 0–1).
// Returns the maximum score over all reference pairs.

function angleDiff(a: number, b: number): number {
  const d = ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return d < 0 ? -d : d;
}

export function matchMinutiae(probe: MinutiaeTemplate, gallery: MinutiaeTemplate): number {
  const pm = probe.minutiae;
  const gm = gallery.minutiae;

  if (pm.length < MIN_MINUTIAE || gm.length < MIN_MINUTIAE) return 0;

  const denominator = pm.length + gm.length;
  let bestScore = 0;

  for (let pi = 0; pi < pm.length; pi++) {
    const pRef = pm[pi];

    for (let gi = 0; gi < gm.length; gi++) {
      const gRef = gm[gi];

      const theta = gRef.angle - pRef.angle;
      const cosT  = Math.cos(theta);
      const sinT  = Math.sin(theta);

      // Translation: rotate pRef onto gRef
      const tx = gRef.x - (pRef.x * cosT - pRef.y * sinT);
      const ty = gRef.y - (pRef.x * sinT + pRef.y * cosT);

      let matched = 0;
      const used = new Uint8Array(gm.length);

      for (let pj = 0; pj < pm.length; pj++) {
        const p  = pm[pj];
        const tX = p.x * cosT - p.y * sinT + tx;
        const tY = p.x * sinT + p.y * cosT + ty;
        const tA = p.angle + theta;

        let bestD2 = D_TOL_SQ + 1;
        let bestGi = -1;

        for (let gj = 0; gj < gm.length; gj++) {
          if (used[gj]) continue;
          const g  = gm[gj];
          if (g.type !== p.type) continue; // ending↔ending or bifurcation↔bifurcation only
          const dx = tX - g.x, dy = tY - g.y;
          const d2 = dx*dx + dy*dy;
          if (d2 < D_TOL_SQ && angleDiff(tA, g.angle) < A_TOL && d2 < bestD2) {
            bestD2 = d2; bestGi = gj;
          }
        }

        if (bestGi >= 0) { used[bestGi] = 1; matched++; }
      }

      // Require a minimum absolute count to guard against tiny-list flukes
      if (matched < MIN_MATCH_PAIRS) continue;

      const score = (2 * matched) / denominator;
      if (score > bestScore) bestScore = score;
    }
  }

  return bestScore;
}
