// Derivative-free minimiser for a handful of parameters in the unit box: separable CMA-ES (Ros & Hansen 2008: the
// covariance is a diagonal, which is plenty for ~10 knobs and needs no eigendecomposition). The objective is a
// render + comparison, so it may be async and need not be smooth. Seeded, so runs repeat.

export interface MinimizeOptions {
  /** Start point, each in 0..1 */
  start: readonly number[];
  /** Initial step as a fraction of the box (default 0.25) */
  sigma?: number;
  /** Maximum objective evaluations */
  budget: number;
  seed?: number;
  /** Stop when the best value is below this */
  target?: number;
  onProgress?: (evaluations: number, best: number) => void;
}

export interface MinimizeResult {
  x: number[];
  value: number;
  /** The objective at the start point */
  startValue: number;
  evaluations: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Mulberry32 PRNG in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

export async function minimize(f: (x: number[]) => number | Promise<number>, o: MinimizeOptions): Promise<MinimizeResult> {
  const n = o.start.length;
  const r = prng(o.seed ?? 1);
  const lambda = 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  const raw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const total = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((v) => v / total);
  const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const cs = (mueff + 2) / (n + mueff + 5);
  const c1 = ((2 / ((n + 1.3) ** 2 + mueff)) * (n + 2)) / 3;
  const cmu = Math.min(1 - c1, ((2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff)) * ((n + 2) / 3));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

  let m = o.start.map(clamp01);
  let sigma = o.sigma ?? 0.25;
  const C = new Array<number>(n).fill(1);
  const pc = new Array<number>(n).fill(0);
  const ps = new Array<number>(n).fill(0);
  const startValue = await f(m.slice());
  let best = { x: m.slice(), value: startValue };
  let evaluations = 1;
  let generation = 0;

  while (evaluations + lambda <= o.budget && best.value > (o.target ?? -Infinity)) {
    generation++;
    const pop: { y: number[]; value: number }[] = [];
    for (let k = 0; k < lambda; k++) {
      const x = m.map((mi, i) => clamp01(mi + sigma * Math.sqrt(C[i]) * gaussian(r)));
      const value = await f(x.slice());
      evaluations++;
      pop.push({ y: x.map((xi, i) => (xi - m[i]) / sigma), value });
      if (value < best.value) best = { x: x.slice(), value };
    }
    o.onProgress?.(evaluations, best.value);
    pop.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    const yw = new Array<number>(n).fill(0);
    for (let k = 0; k < mu; k++) for (let i = 0; i < n; i++) yw[i] += w[k] * pop[k].y[i];
    m = m.map((mi, i) => clamp01(mi + sigma * yw[i]));
    let psNorm = 0;
    for (let i = 0; i < n; i++) {
      ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * mueff) * (yw[i] / Math.sqrt(C[i]));
      psNorm += ps[i] * ps[i];
    }
    psNorm = Math.sqrt(psNorm);
    const hsig = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * generation)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      pc[i] = (1 - cc) * pc[i] + hsig * Math.sqrt(cc * (2 - cc) * mueff) * yw[i];
      let rankMu = 0;
      for (let k = 0; k < mu; k++) rankMu += w[k] * pop[k].y[i] ** 2;
      C[i] = Math.max(1e-6, (1 - c1 - cmu) * C[i] + c1 * pc[i] ** 2 + cmu * rankMu);
    }
    sigma = Math.min(0.5, sigma * Math.exp((cs / damps) * (psNorm / chiN - 1)));
  }
  return { x: best.x, value: best.value, startValue, evaluations };
}
