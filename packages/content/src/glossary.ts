/** The glossary is generated from the cards: every term with its definition and the level it first appears in. */
import { CARDS } from "./cards";

export interface GlossaryEntry { term: string; definition: string; level: number; cardId: string }

export function glossary(): GlossaryEntry[] {
  const map = new Map<string, GlossaryEntry>();
  for (const c of [...CARDS].sort((a, b) => a.level - b.level)) {
    for (const t of c.terms) if (!map.has(t.term.toLowerCase())) map.set(t.term.toLowerCase(), { term: t.term, definition: t.definition, level: c.level, cardId: c.id });
  }
  return [...map.values()].sort((a, b) => a.term.localeCompare(b.term));
}
