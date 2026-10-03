import { randomUUID } from 'node:crypto';
import { cliVersion, spawnJsonLines } from './spawn.ts';
import { type AdapterEvent, type CliAdapter, type RunRequest, summariseTool } from './types.ts';

const WORK_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Bash',
  'Skill',
  'Task',
  'TodoWrite',
];
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'Skill'];
const READ_DENIED = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Task',
];

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown> };

/** Claude Code in print mode with `stream-json` output. */
export function claudeAdapter(bin = process.env.STUDYO_CLAUDE_BIN ?? 'claude'): CliAdapter {
  return {
    id: 'claude',
    label: 'Claude Code',
    detect: () => cliVersion(bin),
    async run(req: RunRequest, onEvent: (e: AdapterEvent) => void) {
      const args = ['-p', req.prompt, '--output-format', 'stream-json', '--verbose'];
      // Unattended runs load no MCP servers: no connector noise, nothing the skills don't name.
      args.push('--strict-mcp-config', '--append-system-prompt', req.system);
      let sessionId: string | null = null;
      if (req.resume) {
        args.push('--resume', req.resume);
        if (req.fork) args.push('--fork-session');
        else sessionId = req.resume;
      } else {
        sessionId = randomUUID();
        args.push('--session-id', sessionId);
      }
      if (req.model) args.push('--model', req.model);
      if (req.streamText) args.push('--include-partial-messages');
      if (req.policy === 'work') {
        args.push('--permission-mode', 'acceptEdits', '--allowedTools', ...WORK_TOOLS);
      } else {
        args.push('--allowedTools', ...READ_TOOLS, '--disallowedTools', ...READ_DENIED);
      }
      if (sessionId) onEvent({ type: 'session', sessionId });

      const { exitCode, cancelled } = await spawnJsonLines(
        bin,
        args,
        { cwd: req.cwd, signal: req.signal },
        (msg) => {
          const type = msg.type as string;
          if (type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
            if (msg.session_id !== sessionId) {
              sessionId = msg.session_id;
              onEvent({ type: 'session', sessionId });
            }
          } else if (type === 'assistant') {
            // Subagent messages carry a parent id; only the main conversation is the job's output.
            if (msg.parent_tool_use_id) return;
            const content = ((msg.message as { content?: Block[] })?.content ?? []) as Block[];
            for (const block of content) {
              if (block.type === 'tool_use' && block.name) {
                onEvent({
                  type: 'tool',
                  name: block.name,
                  summary: summariseTool(block.name, block.input ?? {}),
                });
              } else if (block.type === 'text' && block.text) {
                onEvent({ type: 'text', text: block.text });
              }
            }
          } else if (type === 'user') {
            // Tool results come back as user messages; surface the failures in the job log.
            const content = ((msg.message as { content?: unknown })?.content ?? []) as Array<{
              type?: string;
              is_error?: boolean;
              content?: unknown;
            }>;
            if (!Array.isArray(content)) return;
            for (const block of content) {
              if (block.type === 'tool_result' && block.is_error) {
                const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                onEvent({ type: 'stderr', text: `Tool failed: ${text.slice(0, 300)}` });
              }
            }
          } else if (type === 'stream_event') {
            if (msg.parent_tool_use_id) return;
            const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } };
            if (
              ev?.type === 'content_block_delta' &&
              ev.delta?.type === 'text_delta' &&
              ev.delta.text
            ) {
              onEvent({ type: 'text-delta', text: ev.delta.text });
            }
          } else if (type === 'result') {
            const ok = msg.subtype === 'success' && !msg.is_error;
            onEvent({
              type: 'result',
              ok,
              text: typeof msg.result === 'string' ? msg.result : null,
              error: ok
                ? null
                : String(msg.result ?? msg.subtype ?? 'Claude Code reported an error'),
              costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
            });
          }
        },
        (line) => onEvent({ type: 'stderr', text: line }),
      );
      return { exitCode, sessionId, cancelled };
    },
  };
}
