/** Deep clone of a plain serialisable value (objects, arrays, numbers, strings, booleans, null). */
export function clone<T>(x: T): T {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) {
    const out = new Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = clone(x[i]);
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in x as Record<string, unknown>) out[k] = clone((x as Record<string, unknown>)[k]);
  return out as T;
}
