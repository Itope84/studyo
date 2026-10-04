import { randomUUID } from 'node:crypto';
import type { CliId } from '@studyo/api';
import { cliVersion, spawnJsonLines } from './spawn.ts';
import { type AdapterEvent, type CliAdapter, type RunRequest, summariseTool } from './types.ts';

/**
 * Antigravity (agy) CLI adapter.
 *
 * agy stream-json events used here:
 *   { event: "init", conversation_id, init: { permission_mode } }
 *   { event: "step_update", step_update: { conversation_id, step_index, state, step_type, text_delta? } }
 *     step_type "tool":           ACTIVE → has tool_name, tool_info.parameters; DONE → has duration_seconds
 *     step_type "agent_response": ACTIVE → has text_delta chunks; DONE → has usage (tokens, no USD cost)
 *
 * agy does not report cost in USD. costUsd is always null.
 *
 * Tool policy:
 *   work      → --dangerously-skip-permissions (all tools allowed, agent manages scope via SYSTEM prompt)
 *   read-only → --mode plan (no writes or shell; agy's plan mode suppresses edit/bash tools)
 *   chat      → --dangerously-skip-permissions, but the SYSTEM prompt restricts writes to writeScope
 *
 * Session IDs: agy uses UUIDs for conversation_id. We pass --conversation to resume.
 */
export function agyAdapter(bin = process.env.STUDYO_AGY_BIN ?? 'agy'): CliAdapter {
  return {
    id: 'agy' as unknown as CliId,
    label: 'Antigravity',
    detect: () => cliVersion(bin),
    async run(req: RunRequest, onEvent: (e: AdapterEvent) => void) {
      // Build the agy command.
      // --print / -p: non-interactive, print the response.
      // --output-format stream-json: NDJSON event stream on stdout.
      // --model: model to use (e.g. "claude-sonnet-4-6").
      const args = ['--print', req.prompt, '--output-format', 'stream-json', '--add-dir', req.cwd];

      if (req.resume) {
        args.push('--conversation', req.resume);
      }
      if (req.model) {
        args.push('--model', req.model);
      }

      // Permission / tool policy.
      // agy's --mode plan suppresses file edits and bash in its planner mode.
      // For work and chat we skip the interactive permission prompt entirely.
      if (req.policy === 'read-only') {
        args.push('--mode', 'plan');
      } else {
        // work and chat: auto-approve all permissions; the SYSTEM prompt scopes what is written.
        args.push('--dangerously-skip-permissions');
      }

      // Prepend the system framing to the prompt (agy has no separate --system flag in print mode).
      // Replace the prompt arg (last positional) with system + prompt.
      const promptIdx = args.indexOf(req.prompt);
      if (promptIdx >= 0) {
        args[promptIdx] = `${req.system}\n\n---\n\n${req.prompt}`;
      }

      let sessionId: string | null = req.resume ?? null;
      const textChunks: string[] = [];
      let sawError: string | null = null;
      let finalEmitted = false;

      const { exitCode, cancelled } = await spawnJsonLines(
        bin,
        args,
        { cwd: req.cwd, signal: req.signal },
        (msg) => {
          const event = msg.event as string | undefined;

          if (event === 'init') {
            const cid = msg.conversation_id as string | undefined;
            if (cid && cid !== sessionId) {
              sessionId = cid;
              onEvent({ type: 'session', sessionId: cid });
            }
            return;
          }

          if (event === 'step_update') {
            const su = (msg.step_update ?? {}) as {
              conversation_id?: string;
              step_index?: number;
              state?: string;
              step_type?: string;
              text_delta?: string;
              tool_name?: string;
              tool_info?: { name?: string; parameters?: Record<string, unknown>; output?: string };
              duration_seconds?: number;
              usage?: { input_tokens?: number; output_tokens?: number };
            };

            // Emit session id when it first appears (should match init, but belt-and-suspenders).
            if (su.conversation_id && su.conversation_id !== sessionId) {
              sessionId = su.conversation_id;
              onEvent({ type: 'session', sessionId: su.conversation_id });
            }

            if (su.step_type === 'tool' && su.state === 'ACTIVE' && su.tool_name) {
              onEvent({
                type: 'tool',
                name: su.tool_name,
                summary: summariseTool(su.tool_name, su.tool_info?.parameters ?? {}),
              });
            }

            if (su.step_type === 'agent_response' && su.state === 'ACTIVE' && su.text_delta) {
              onEvent({ type: 'text-delta', text: su.text_delta });
              if (req.streamText) {
                // text-delta already emitted above.
              }
              textChunks.push(su.text_delta);
            }

            // When the final agent_response step is DONE, agy has finished.
            if (su.step_type === 'agent_response' && su.state === 'DONE' && !finalEmitted) {
              finalEmitted = true;
              const fullText = textChunks.join('').trim();
              onEvent({ type: 'text', text: fullText });
              onEvent({
                type: 'result',
                ok: true,
                text: fullText || null,
                error: null,
                costUsd: null, // agy does not report USD cost
              });
            }
            return;
          }

          // Final summary event: status ERROR carries the failure (e.g. quota) with exit code 0.
          if (event === 'result') {
            const r = (msg.result ?? {}) as { status?: string; error?: string };
            if (r.status === 'ERROR') {
              sawError = r.error ?? 'agy reported an error';
              onEvent({ type: 'stderr', text: sawError });
            }
            return;
          }

          // Surface any error-like events from agy as stderr.
          if (event === 'error') {
            const msg2 = msg.error as { message?: string } | string | undefined;
            sawError = typeof msg2 === 'string' ? msg2 : (msg2?.message ?? 'agy reported an error');
            onEvent({ type: 'stderr', text: sawError });
          }
        },
        (line) => onEvent({ type: 'stderr', text: line }),
      );

      // If we never emitted a result (e.g. agy exited without a final agent_response DONE),
      // synthesise one from what we collected.
      if (!finalEmitted) {
        const ok = exitCode === 0 && !sawError && !cancelled;
        const fullText = textChunks.join('').trim();
        onEvent({
          type: 'result',
          ok,
          text: fullText || null,
          error: ok ? null : (sawError ?? `agy exited with code ${exitCode}`),
          costUsd: null,
        });
      }

      return { exitCode, sessionId, cancelled };
    },
  };
}
