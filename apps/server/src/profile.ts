import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowsEntry, Profile } from '@studyo/api';
import { parse, stringify } from 'yaml';
import { today } from './util.ts';

const FRONT = /^---\n([\s\S]*?)\n---\n?/;

export function profilePath(library: string) {
  return join(library, 'profile.md');
}

export function readProfile(library: string): Profile {
  const path = profilePath(library);
  if (!existsSync(path)) return { knows: [], notes: '' };
  const text = readFileSync(path, 'utf8');
  const match = FRONT.exec(text);
  const front = match ? ((parse(match[1] ?? '') as { knows?: KnowsEntry[] } | null) ?? {}) : {};
  const notes = match ? text.slice(match[0].length) : text;
  return { knows: Array.isArray(front.knows) ? front.knows : [], notes: notes.replace(/^\n+/, '') };
}

export function writeProfile(library: string, profile: Profile) {
  const knows = profile.knows.map((k) => Object.fromEntries(Object.entries(k).filter(([, v]) => v != null)));
  const front = stringify({ knows }).trimEnd();
  writeFileSync(profilePath(library), `---\n${front}\n---\n\n${profile.notes.trim()}\n`);
}

/** Record that the person read a topic: its gap concepts become known with `via: read`. */
export function markRead(library: string, topicId: string, terms: string[]): Profile {
  const profile = readProfile(library);
  const known = new Set(profile.knows.filter((k) => k.via !== 'forgot').map((k) => k.term.toLowerCase()));
  for (const raw of terms) {
    // Gaps may carry a note in brackets: "hash functions (basis for Merkle trees)".
    const term = raw.replace(/\s*\(.*\)\s*$/, '').trim();
    if (!term || known.has(term.toLowerCase())) continue;
    profile.knows.push({ term, via: 'read', topic: topicId, date: today() });
    known.add(term.toLowerCase());
  }
  writeProfile(library, profile);
  return profile;
}
