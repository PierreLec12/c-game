/**
 * What the player is told, when, and how reliably (section 5.4): news items with a source type and a
 * base rate, rumours resolved on screen, releases with consensus and actual.
 */
import type { NewsItem, Release, State } from "./types";

export const RELIABILITY: Record<NewsItem["source"], number> = {
  wire: 0.95, release: 1.0, leak: 0.67, rumour: 0.5, mentor: 1.0, risk: 1.0, exchange: 1.0,
};

export function publishNews(state: State, item: Omit<NewsItem, "id" | "reliability" | "tick"> & { tick?: number; reliability?: number }): NewsItem {
  const delay = state.pendingNewsDelay ?? 0;
  const n: NewsItem = { id: `n${++state.counters.news}`, tick: (item.tick ?? state.tick) + delay, reliability: item.reliability ?? RELIABILITY[item.source], ...item, shockTick: delay > 0 ? state.tick : undefined } as NewsItem;
  state.news.push(n);
  return n;
}

export function resolveNews(state: State, newsId: string, outcome: "true" | "false", text: string): void {
  const n = state.news.find((x) => x.id === newsId);
  if (n) n.resolved = { tick: state.tick, outcome, text };
}

export function addRelease(state: State, r: Omit<Release, "published" | "consensus" | "actual">): Release {
  const rel: Release = { ...r, consensus: null, actual: null, published: false };
  state.releases.push(rel);
  return rel;
}

/** Hours until the next unpublished release, as a 0..1 proximity for the vol surface (1 within a day). */
export function releaseProximity(state: State): number {
  const next = state.releases.filter((r) => !r.published && r.tick > state.tick).sort((a, b) => a.tick - b.tick)[0];
  if (!next) return 0;
  const hours = next.tick - state.tick;
  return hours <= 24 ? 1 : hours <= 72 ? 0.4 : 0;
}

export function nextRelease(state: State): Release | null {
  return state.releases.filter((r) => !r.published && r.tick >= state.tick).sort((a, b) => a.tick - b.tick)[0] ?? null;
}
