import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { createServer } from '../src/app.ts';
import { deriveFileToken, REPO_ROOT } from '../src/config.ts';

export const TOKEN = 'test-token';

export async function makeServer() {
  const library = mkdtempSync(join(tmpdir(), 'studyo-lib-'));
  cpSync(join(REPO_ROOT, 'fixtures/library'), library, { recursive: true });
  const stateDir = join(library, '_studyo');
  const server = await createServer(
    {
      library,
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      fileToken: deriveFileToken(TOKEN),
      stateDir,
      skillsDir: join(REPO_ROOT, 'skills'),
      origins: '*',
      appReturns: ['https://studyo.pages.dev'],
      replayDir: join(REPO_ROOT, 'fixtures/replay'),
    },
    { watch: false, dbFile: ':memory:' },
  );
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${TOKEN}`, ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    const res = await server.app.request(path, init);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, json: json as any, text, headers: res.headers };
  };
  return { ...server, library, call };
}

/** Poll until `check` returns a truthy value (or time out). */
export async function waitFor<T>(
  check: () => Promise<T> | T,
  ms = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const spec = parse(readFileSync(resolve(REPO_ROOT, 'packages/api/openapi.yaml'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...spec, $id: 'openapi' });

/** Throws with the validation errors when `value` doesn't match the named schema. */
export function expectSchema(name: string, value: unknown) {
  const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!validate) throw new Error(`No schema ${name}`);
  if (!validate(value)) {
    throw new Error(
      `${name} does not match the contract: ${JSON.stringify(validate.errors?.slice(0, 5), null, 2)}`,
    );
  }
}
