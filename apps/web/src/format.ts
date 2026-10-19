export const usd = (x: number, decimals = 0): string => (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
export const usdK = (x: number): string => (Math.abs(x) >= 1e6 ? (x < 0 ? "-$" : "$") + (Math.abs(x) / 1e6).toFixed(2) + "m" : Math.abs(x) >= 1e4 ? (x < 0 ? "-$" : "$") + (Math.abs(x) / 1e3).toFixed(0) + "k" : usd(x));
export const signed = (x: number, d = 2): string => (x >= 0 ? "+" : "") + x.toFixed(d);
export const px = (x: number, d = 2): string => x.toFixed(d);
export const pct = (x: number, d = 0): string => (x * 100).toFixed(d) + "%";
