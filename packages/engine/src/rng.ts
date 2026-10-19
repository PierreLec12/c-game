/**
 * Seeded, splittable random streams. Stateless by design: every draw is a pure function of
 * (seed, stream name, tick, counter), so the engine needs no RNG state in the save file and any
 * subsystem can draw without disturbing another. Determinism (section 2 of the prompt) follows.
 *
 * Hashing: a 64-bit SplitMix64-style mix on 32-bit halves (Murmur3-fmix on two lanes), good enough
 * for a game, not for cryptography. The Student-t draw uses chi-square(4) = -2 ln(U1 U2).
 */

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Stream {
  /** uniform in [0, 1) */
  uniform(): number;
  /** standard normal (Box-Muller) */
  normal(): number;
  /** Student-t with `dof` degrees of freedom, scaled to unit variance when dof > 2 */
  studentT(dof: number): number;
  /** integer in [lo, hi] inclusive */
  int(lo: number, hi: number): number;
  /** one of the items */
  pick<T>(items: readonly T[]): T;
  /** true with probability p */
  chance(p: number): boolean;
}

export interface Rng {
  readonly seed: number;
  /** A stream for `name` at `tick`. Draws from the same (name, tick) always repeat in the same order. */
  stream(name: string, tick: number): Stream;
}

export function makeRng(seed: number): Rng {
  const seedHash = fmix32((seed >>> 0) ^ 0x9e3779b9);
  return {
    seed,
    stream(name: string, tick: number): Stream {
      const base = fmix32(seedHash ^ hashString(name) ^ Math.imul(tick + 1, 0x7feb352d));
      let counter = 0;
      const next = (): number => {
        counter += 1;
        const a = fmix32(base + Math.imul(counter, 0x9e3779b1));
        const b = fmix32(a ^ 0x6c62272e ^ counter);
        // 53-bit float from two 32-bit words
        return ((a >>> 5) * 67108864 + (b >>> 6)) / 9007199254740992;
      };
      const uniform = (): number => {
        let u = next();
        if (u <= 0) u = Number.MIN_VALUE;
        return u;
      };
      const normal = (): number => {
        const u1 = uniform();
        const u2 = uniform();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      };
      return {
        uniform,
        normal,
        studentT(dof: number): number {
          // chi-square with 2k dof is Gamma(k, 2): for dof = 4, chi2 = -2 ln(U1 U2)
          const z = normal();
          let chi2: number;
          if (dof === 4) chi2 = -2 * Math.log(uniform() * uniform());
          else if (dof === 2) chi2 = -2 * Math.log(uniform());
          else {
            chi2 = 0;
            for (let i = 0; i < dof; i++) {
              const n = normal();
              chi2 += n * n;
            }
          }
          const t = z / Math.sqrt(chi2 / dof);
          return dof > 2 ? t / Math.sqrt(dof / (dof - 2)) : t;
        },
        int(lo: number, hi: number): number {
          return lo + Math.floor(uniform() * (hi - lo + 1));
        },
        pick<T>(items: readonly T[]): T {
          return items[Math.floor(uniform() * items.length)];
        },
        chance(p: number): boolean {
          return uniform() < p;
        },
      };
    },
  };
}
