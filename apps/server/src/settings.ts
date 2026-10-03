import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliId, Settings } from '@studyo/api';
import { badRequest, writeJsonAtomic } from './util.ts';

export class SettingsStore {
  private cache: Settings | null = null;

  constructor(
    private stateDir: string,
    private defaultCli: CliId,
  ) {}

  private get path() {
    return join(this.stateDir, 'settings.json');
  }

  get(): Settings {
    if (this.cache) return this.cache;
    let stored: Partial<Settings> = {};
    if (existsSync(this.path)) {
      try {
        stored = JSON.parse(readFileSync(this.path, 'utf8'));
      } catch {}
    }
    this.cache = {
      cli: stored.cli === 'claude' || stored.cli === 'opencode' ? stored.cli : this.defaultCli,
      models: { claude: stored.models?.claude ?? null, opencode: stored.models?.opencode ?? null },
    };
    return this.cache;
  }

  set(input: Settings): Settings {
    if (input.cli !== 'claude' && input.cli !== 'opencode')
      throw badRequest('cli must be claude or opencode.');
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const next: Settings = {
      cli: input.cli,
      models: { claude: clean(input.models?.claude), opencode: clean(input.models?.opencode) },
    };
    writeJsonAtomic(this.path, next);
    this.cache = next;
    return next;
  }
}
