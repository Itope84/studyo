import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cliVersion, spawnJsonLines } from './spawn.ts';
import { type AdapterEvent, type CliAdapter, type RunRequest, summariseTool } from './types.ts';

/** MCP server names from the user's and the project's OpenCode config, so unattended runs can switch them off. */
function mcpServerNames(cwd: string): string[] {
  const files = [
    join(homedir(), '.config/opencode/opencode.json'),
    join(homedir(), '.config/opencode/opencode.jsonc'),
    join(cwd, 'opencode.json'),
    join(cwd, 'opencode.jsonc'),
  ];
  const names = new Set<string>();
  for (const file of files) {
    try {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"])\/\/.*$/gm, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
      const config = JSON.parse(text) as { mcp?: Record<string, unknown> };
      for (const name of Object.keys(config.mcp ?? {})) names.add(name);
    } catch {
      // Missing or unparseable config: nothing to switch off from it.
    }
  }
  return [...names];
}

/** OpenCode `run` with raw JSON events. Permissions and MCP come from an inline config. */
export function opencodeAdapter(bin = process.env.STUDYO_OPENCODE_BIN ?? 'opencode'): CliAdapter {
  return {
    id: 'opencode',
    label: 'OpenCode',
    detect: () => cliVersion(bin),
    async run(req: RunRequest, onEvent: (e: AdapterEvent) => void) {
      const permission =
        req.policy === 'work'
          ? {
              edit: 'allow',
              bash: 'allow',
              webfetch: 'allow',
              websearch: 'allow',
              external_directory: 'deny',
            }
          : {
              edit: 'deny',
              bash: 'deny',
              webfetch: 'deny',
              websearch: 'deny',
              external_directory: 'deny',
            };
      const mcp = Object.fromEntries(
        mcpServerNames(req.cwd).map((name) => [name, { enabled: false }]),
      );
      const config = { permission, mcp, instructions: [] as string[] };

      // OpenCode has no system-prompt flag; the framing goes in front of the message.
      const message = `${req.system}\n\n---\n\n${req.prompt}`;
      const args = ['run', '--format', 'json', '--agent', 'build', '--auto'];
      if (req.resume) {
        args.push('--session', req.resume);
        if (req.fork) args.push('--fork');
      }
      if (req.model) args.push('--model', req.model);
      args.push(message);

      let sessionId: string | null = req.resume && !req.fork ? req.resume : null;
      let sawError: string | null = null;
      let lastText: string[] = [];

      const { exitCode, cancelled } = await spawnJsonLines(
        bin,
        args,
        {
          cwd: req.cwd,
          signal: req.signal,
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
            OPENCODE_ENABLE_EXA: process.env.OPENCODE_ENABLE_EXA ?? '1',
          },
        },
        (msg) => {
          const sid = msg.sessionID;
          if (typeof sid === 'string' && sid !== sessionId) {
            sessionId = sid;
            onEvent({ type: 'session', sessionId: sid });
          }
          const part = (msg.part ?? {}) as {
            tool?: string;
            text?: string;
            state?: { status?: string; input?: Record<string, unknown>; error?: string };
          };
          switch (msg.type) {
            case 'tool_use':
              if (part.tool && part.state?.status === 'error') {
                onEvent({
                  type: 'stderr',
                  text: `Tool ${part.tool} failed: ${String(part.state.error ?? '').slice(0, 300)}`,
                });
              }
              if (part.tool) {
                onEvent({
                  type: 'tool',
                  name: part.tool,
                  summary: summariseTool(part.tool, part.state?.input ?? {}),
                });
                lastText = [];
              }
              break;
            case 'text':
              if (part.text?.trim()) {
                onEvent({ type: 'text', text: part.text });
                if (req.streamText) onEvent({ type: 'text-delta', text: part.text });
                lastText.push(part.text);
              }
              break;
            case 'error': {
              const err = msg.error as
                | { message?: string; data?: { message?: string } }
                | string
                | undefined;
              sawError =
                typeof err === 'string'
                  ? err
                  : (err?.data?.message ?? err?.message ?? 'OpenCode reported an error');
              onEvent({ type: 'stderr', text: sawError });
              break;
            }
          }
        },
        (line) => onEvent({ type: 'stderr', text: line }),
      );
      const ok = exitCode === 0 && !sawError && !cancelled;
      onEvent({
        type: 'result',
        ok,
        text: lastText.join('\n').trim() || null,
        error: ok ? null : (sawError ?? `OpenCode exited with code ${exitCode}`),
        costUsd: null,
      });
      return { exitCode, sessionId, cancelled };
    },
  };
}
