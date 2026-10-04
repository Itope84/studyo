/**
 * Condense tuning loop, stage 1: score a skills folder.
 *
 *   pnpm loop score [--skills <dir>] [--topics id,id | --role tune|held|regression] [--label name]
 *
 * For each topic: copy it into a scratch library (never `library/`), generate with the production CLI and model,
 * have a different-family reader answer the frozen quiz from the guide alone, have the judge grade everything,
 * and combine the numbers by the weights in config.json. Output lands in `_loop/<label>/`.
 * See docs in the design notes; the quiz keys never leave this script and the judge.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { agyAdapter } from '../../apps/server/src/adapters/agy.ts';
import { claudeAdapter } from '../../apps/server/src/adapters/claude.ts';
import { opencodeAdapter } from '../../apps/server/src/adapters/opencode.ts';
import type { CliAdapter, RunRequest } from '../../apps/server/src/adapters/types.ts';
import { SYSTEM } from '../../apps/server/src/jobs/prompts.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CFG = JSON.parse(readFileSync(join(ROOT, 'scripts/condense-loop/config.json'), 'utf8'));
const FIX = join(ROOT, 'fixtures/condense-loop');
const LIB = join(ROOT, 'library');

type Role =
  | 'generator'
  | 'reader'
  | 'judge'
  | 'editor'
  | 'generator-deep'
  | 'judge-deep'
  | 'editor-deep';
interface Question {
  level: string;
  default: boolean;
  q: string;
  key: string;
}
interface Quiz {
  topic: string;
  concepts: { id: string; name: string; questions: Question[] }[];
}
interface TopicCfg {
  id: string;
  role: string;
  depth: 'default' | 'longer';
  profile: string;
  /** Override the skill name. Default is `condense`; use `condense-deep` for longer-depth runs. */
  skill?: string;
}

let REUSE: string | undefined;
const usage: { role: string; costUsd: number | null }[] = [];
const adapters: Record<string, CliAdapter> = {
  claude: claudeAdapter(),
  opencode: opencodeAdapter(),
  agy: agyAdapter(),
};

/** Run one CLI session and return its final text. */
async function ask(
  role: Role,
  cwd: string,
  prompt: string,
  opts: {
    policy: RunRequest['policy'];
    system?: string;
    minutes: number;
    log?: (s: string) => void;
  },
): Promise<{ text: string; costUsd: number | null }> {
  const m = CFG.models[role];
  let result: {
    ok: boolean;
    text: string | null;
    error: string | null;
    costUsd: number | null;
  } | null = null;
  await adapters[m.cli].run(
    {
      cwd,
      prompt,
      system:
        opts.system ??
        'You are running unattended. Nobody is watching this terminal. Reply as the message asks.',
      resume: null,
      model: m.model,
      policy: opts.policy,
      signal: AbortSignal.timeout(opts.minutes * 60_000),
    },
    (e) => {
      if (e.type === 'result') result = e;
      else if (opts.log && (e.type === 'tool' || e.type === 'stderr'))
        opts.log(e.type === 'tool' ? e.summary : e.text);
    },
  );
  const r = result as typeof result;
  if (!r?.ok) throw new Error(`${role} run failed: ${r?.error ?? 'no result'}`);
  usage.push({ role, costUsd: r.costUsd });
  return { text: r.text ?? '', costUsd: r.costUsd };
}

function extractJson<T>(text: string): T {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(s, e + 1)) as T;
}

function loadQuiz(id: string): Quiz | null {
  const f = join(FIX, 'quizzes', `${id}.json`);
  if (!existsSync(f)) return null;
  const quiz = JSON.parse(readFileSync(f, 'utf8')) as Quiz & { draft?: boolean };
  return quiz.draft ? null : quiz; // drafts wait for the user's review
}

/** The questions this depth runs, with ids like C3.apply. */
function questionsFor(quiz: Quiz, depth: string) {
  return quiz.concepts.flatMap((c) =>
    c.questions
      .filter((q) => depth === 'longer' || q.default)
      .map((q) => ({
        id: `${c.id}.${q.level}`,
        concept: c.id,
        level: q.level,
        q: q.q,
        key: q.key,
      })),
  );
}

/** Copy the topic (without earlier outputs or big files) into a scratch library with the candidate skills. */
function prepareWorkspace(
  work: string,
  t: TopicCfg,
  skillsDir: string,
): { lib: string; topicPath: string; coursePath: string | null } {
  const lib = join(work, 'library');
  mkdirSync(lib, { recursive: true });
  const skip = new Set(['outputs', 'chat', 'quizzes', 'assignments', '_job']);
  const filter = (src: string) => {
    const name = src.split('/').pop() ?? '';
    if (skip.has(name)) return false;
    try {
      const st = statSync(src);
      if (st.isFile() && st.size > 3_000_000) return false;
    } catch {}
    return true;
  };
  const topicPath = join(lib, 'topics', t.id);
  cpSync(join(LIB, 'topics', t.id), topicPath, { recursive: true, filter });
  mkdirSync(join(topicPath, 'outputs'), { recursive: true });
  let coursePath: string | null = null;
  const topic = JSON.parse(readFileSync(join(topicPath, 'topic.json'), 'utf8')) as {
    course?: { id?: string } | string;
  };
  const courseId = typeof topic.course === 'string' ? topic.course : topic.course?.id;
  if (courseId) {
    coursePath = join(lib, 'courses', courseId);
    cpSync(join(LIB, 'courses', courseId), coursePath, { recursive: true, filter });
  }
  cpSync(join(FIX, 'profiles', `${t.profile}.md`), join(lib, 'profile.md'));
  cpSync(skillsDir, join(lib, '.claude', 'skills'), { recursive: true });
  return { lib, topicPath, coursePath };
}

function newestCondensed(topicPath: string): string | null {
  const dir = join(topicPath, 'outputs');
  const files = readdirSync(dir).filter((f) => f.startsWith('condensed-') && f.endsWith('.md'));
  files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  return files[0] ? join(dir, files[0]) : null;
}

const READER_RULES = `Rules:
- Answer every question using ONLY the text of guide.md. Do not use anything you already know.
- If guide.md does not let you answer a question, set "answer" to "NOT COVERED" and "quote" to null.
- Otherwise "quote" must be a verbatim passage from guide.md (at most 40 words) that your answer relies on.
- Also keep a confusion log about reading the guide only (nothing about the questions, and not facts you simply did not know): every place you had to reread, met a term not yet explained, or could not see why a section followed the previous one. Each entry: {"where": "<heading>", "what": "<one line>", "severity": 1 to 3}.
- Reply with one JSON object and nothing else.`;

async function readerRun(
  input: { guide?: string; profile?: string; questions: { id: string; question: string }[] },
  minutes: number,
  log: (s: string) => void,
) {
  // Everything goes in the prompt: no files to find, nothing to read but the text given.
  const qs = JSON.stringify(input.questions, null, 1);
  const prompt = input.guide
    ? `You are a learner. Your background:\n\n${input.profile}\n\nRead this guide:\n\n<guide>\n${input.guide}\n</guide>\n\nThen answer these questions:\n\n${qs}\n\n${READER_RULES}\n\nShape: {"answers":[{"id":"...","answer":"...","quote":"..."|null}],"confusion_log":[...]}`
    : `Answer these questions from your own knowledge. There is no guide. Keep each answer to a few sentences.\n\n${qs}\n\nReply with one JSON object and nothing else. Shape: {"answers":[{"id":"...","answer":"..."}]}`;
  const { text } = await ask('reader', tmpdir(), prompt, { policy: 'read-only', minutes, log });
  return extractJson<{
    answers: { id: string; answer: string; quote?: string | null }[];
    confusion_log?: unknown[];
  }>(text);
}

const JUDGE_PROMPT = (
  depth: string,
) => `You are the judge in a test of a teaching skill. Files in this folder:
- pack.md: the research the guide was written from. The only allowed source of facts.
- guide.md: the explanation being judged, written for the learner in profile.md.
- quiz.json: questions with answer keys (secret: never reproduce key text in your feedback).
- reader.json: a reader's answers to the questions, who saw only guide.md. "quote" is the passage it relied on.
- baseline.json: answers from a reader who saw no guide (leak detector).
- concepts.json: the concepts the guide must teach, with the target level for this run.
Depth of this run: ${depth}. Target level per concept: ${depth === 'longer' ? '3 (shown by a worked example or code)' : '2 (explained in plain words)'}.

Do these, reading carefully:
1. grounding: list every specific fact in guide.md (a number, a behaviour, a guarantee, who said what) that pack.md does not support. Quote the guide. Teaching, order and examples that add no facts are fine. A short plain-words definition of a general background term (a sentence or two, the kind a textbook entry states, with nothing specific to this subject) is NOT a violation; anything specific to the subject that the pack does not state is. Analogies are allowed if they imply nothing false about the subject.
2. quiz: for each question in quiz.json grade the reader's answer against the key: correct 1, partly 0.5, wrong 0. Then check the quote: it must appear in guide.md and support the answer; if not, set "quote_ok" false and credit 0. "NOT COVERED" gets 0 and "covered_in_guide" says whether guide.md actually does cover it (a reader miss) or not (a guide gap). Also mark "known_without_guide" true if baseline.json answered it correctly.
3. coverage: per concept, the highest level the guide reaches: 0 absent, 1 named, 2 explained, 3 shown (worked example, code, trace), 4 checked (reader is made to predict or apply). Quote the passage.
4. experience: read guide.md as the learner in profile.md. Score 0 to 5 each: opening (says what this is, why it matters, where it goes), defined_before_used, thread (each part picks up from the last), teaching_moves (uses concrete-before-general, worked cases and the like where needed; not repetitive), depth_for_goal (reader could now do or explain what the goal asks). Add the reader's confusion log from reader.json as given.
5. verdict: two sentences on whether this learner learned the material deeply enough for their goal, and up to three weaknesses, each tied to a concept id or a heading of the guide, written so an editor can improve the skill that wrote it. No key text.

Reply with one JSON object and nothing else:
{"grounding":[{"quote":"","why":""}],
 "quiz":[{"id":"C1.explain","credit":0,"quote_ok":true,"covered_in_guide":true,"known_without_guide":false}],
 "coverage":[{"id":"C1","level":0,"quote":""}],
 "experience":{"opening":0,"defined_before_used":0,"thread":0,"teaching_moves":0,"depth_for_goal":0,"notes":""},
 "verdict":{"summary":"","weaknesses":[{"where":"","problem":""}]}}`;

interface Judged {
  grounding: { quote: string; why: string }[];
  quiz: {
    id: string;
    credit: number;
    quote_ok: boolean;
    covered_in_guide: boolean;
    known_without_guide: boolean;
  }[];
  coverage: { id: string; level: number; quote: string }[];
  experience: Record<string, number | string>;
  verdict: { summary: string; weaknesses: { where: string; problem: string }[] };
}

function combine(
  j: Judged,
  confusion: { severity?: number }[],
  questionCount: number,
  depth: string,
) {
  const w = CFG.weights;
  const target = depth === 'longer' ? 3 : 2;
  const quiz =
    j.quiz.reduce((s, q) => s + (q.quote_ok ? q.credit : 0), 0) / Math.max(1, questionCount);
  const coverage =
    j.coverage.filter((c) => c.level >= target).length / Math.max(1, j.coverage.length);
  const exp = j.experience;
  const experience =
    (['opening', 'defined_before_used', 'thread', 'teaching_moves', 'depth_for_goal'] as const)
      .map((k) => Number(exp[k] ?? 0))
      .reduce((a, b) => a + b, 0) / 25;
  const weighted = confusion.reduce((s, c) => s + (c.severity ?? 1), 0);
  const confusionScore = 1 - Math.min(1, weighted / w.confusion_cap);
  const learning = w.learning_parts.quiz * quiz + w.learning_parts.coverage * coverage;
  const ease = w.ease_parts.experience * experience + w.ease_parts.confusion * confusionScore;
  const violations = j.grounding.length;
  const gated = violations > w.max_grounding_violations;
  const raw = 100 * (w.learning * learning + w.ease * ease);
  const total = gated ? 0 : raw;
  return {
    total: Math.round(total * 10) / 10,
    raw_total: Math.round(raw * 10) / 10,
    gated,
    violations,
    learning: Math.round(learning * 1000) / 10,
    ease: Math.round(ease * 1000) / 10,
    quiz: Math.round(quiz * 1000) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    experience: Math.round(experience * 1000) / 10,
    confusion_points: weighted,
    known_without_guide: j.quiz.filter((q) => q.known_without_guide).length,
    reader_misses: j.quiz.filter((q) => q.covered_in_guide && q.credit === 0).length,
    guide_gaps: j.quiz.filter((q) => !q.covered_in_guide).length,
  };
}

async function scoreTopic(t: TopicCfg, skillsDir: string, outDir: string, tag = '') {
  const quiz = loadQuiz(t.id);
  if (!quiz) throw new Error(`no frozen quiz for ${t.id}`);
  const out = join(outDir, t.id.slice(0, 60) + tag);
  mkdirSync(out, { recursive: true });
  const logFile = join(out, 'run.log');
  const log = (s: string) =>
    writeFileSync(logFile, `${new Date().toISOString()} ${s}\n`, { flag: 'a' });
  const work = join(out, 'work');
  const { lib, topicPath, coursePath } = prepareWorkspace(work, t, skillsDir);

  // 1. Generate with the production CLI, the way the job runner prompts it (but unattended).
  //    `--reuse <label>` takes the guide from an earlier run instead (to re-test the reader and judge).
  let guide: string;
  let genCost: number | null = null;
  const reused = REUSE ? join(ROOT, '_loop', REUSE, t.id.slice(0, 60), 'guide.md') : null;
  const skillName = t.skill ?? 'condense';
  const generatorRole: Role = t.depth === 'longer' ? 'generator-deep' : 'generator';
  if (reused && existsSync(reused)) {
    guide = readFileSync(reused, 'utf8');
  } else {
    log('generate');
    const lines = [
      `Run the Studyo skill \`${skillName}\`.`,
      '',
      'Parameters:',
      `- topic_path: ${topicPath}`,
      `  (inside the current working directory, the library root, as topics/${t.id}; use exactly this folder)`,
    ];
    if (coursePath) lines.push(`- course_path: ${coursePath}`);
    lines.push('- interactive: false', '- scope: all');
    if (t.depth === 'longer') lines.push('- depth: longer');
    const gen = await ask(generatorRole, lib, lines.join('\n'), {
      policy: 'work',
      system: SYSTEM,
      minutes: CFG.timeout_minutes.generate,
      log,
    });
    const guidePath = newestCondensed(topicPath);
    if (!guidePath) throw new Error('generator wrote no condensed document');
    guide = readFileSync(guidePath, 'utf8');
    writeFileSync(join(out, 'guide.md'), guide);

    genCost = gen.costUsd;
  }
  writeFileSync(join(out, 'guide.md'), guide);

  // 2. The reader sees only the guide, the profile and the questions (no keys).
  const qs = questionsFor(quiz, t.depth);
  const questions = qs.map(({ id, q }) => ({ id, question: q }));
  const profileText = readFileSync(join(FIX, 'profiles', `${t.profile}.md`), 'utf8');
  log('reader');
  const reader = await readerRun(
    { guide, profile: profileText, questions },
    CFG.timeout_minutes.reader,
    log,
  );
  writeFileSync(join(out, 'reader.json'), JSON.stringify(reader, null, 1));

  // 3. Closed-book baseline, cached per topic and question set.
  const baseFile = join(ROOT, '_loop', 'baseline', `${t.id.slice(0, 60)}-${t.depth}.json`);
  let baseline: { answers: unknown[] };
  if (existsSync(baseFile)) baseline = JSON.parse(readFileSync(baseFile, 'utf8'));
  else {
    log('baseline');
    baseline = await readerRun({ questions }, CFG.timeout_minutes.reader, log);
    mkdirSync(join(ROOT, '_loop', 'baseline'), { recursive: true });
    writeFileSync(baseFile, JSON.stringify(baseline, null, 1));
  }

  // 4. Judge: the only place the keys and the pack sit next to the guide.
  const jdir = join(work, 'judge');
  mkdirSync(jdir, { recursive: true });
  cpSync(join(topicPath, 'pack', 'pack.md'), join(jdir, 'pack.md'));
  writeFileSync(join(jdir, 'guide.md'), guide);
  writeFileSync(
    join(jdir, 'profile.md'),
    readFileSync(join(FIX, 'profiles', `${t.profile}.md`), 'utf8'),
  );
  writeFileSync(
    join(jdir, 'quiz.json'),
    JSON.stringify(
      qs.map(({ id, q, key }) => ({ id, question: q, key })),
      null,
      1,
    ),
  );
  writeFileSync(join(jdir, 'reader.json'), JSON.stringify(reader, null, 1));
  writeFileSync(join(jdir, 'baseline.json'), JSON.stringify(baseline, null, 1));
  const target = t.depth === 'longer' ? 3 : 2;
  writeFileSync(
    join(jdir, 'concepts.json'),
    JSON.stringify(
      quiz.concepts.map((c) => ({ id: c.id, name: c.name, target_level: target })),
      null,
      1,
    ),
  );
  log('judge');
  let judged: Judged | null = null;
  for (let attempt = 1; attempt <= 2 && !judged; attempt++) {
    try {
      const reply = await ask(
        t.depth === 'longer' ? 'judge-deep' : 'judge',
        jdir,
        JUDGE_PROMPT(t.depth),
        {
          policy: 'read-only',
          minutes: CFG.timeout_minutes.judge,
          log,
        },
      );
      const j = extractJson<Partial<Judged>>(reply.text);
      if (
        !Array.isArray(j.grounding) ||
        !Array.isArray(j.quiz) ||
        !Array.isArray(j.coverage) ||
        !j.experience ||
        !j.verdict
      ) {
        throw new Error('judge reply is missing a section');
      }
      const want = new Set(qs.map((q) => q.id));
      const got = new Set((j.quiz as { id: string }[]).map((q) => q.id));
      if (want.size !== got.size || [...want].some((id) => !got.has(id))) {
        throw new Error('judge graded different questions than it was given');
      }
      j.verdict.weaknesses ??= [];
      judged = j as Judged;
    } catch (e) {
      log(`judge attempt ${attempt} failed: ${(e as Error).message}`);
      if (attempt === 2) throw e;
    }
  }
  if (!judged) throw new Error('no judge result');
  writeFileSync(join(out, 'judge.json'), JSON.stringify(judged, null, 1));

  const confusion = (reader.confusion_log ?? []) as { severity?: number }[];
  const score = {
    topic: t.id,
    role: t.role,
    depth: t.depth,
    words: guide.split(/\s+/).length,
    generator_cost: genCost,
    ...combine(judged, confusion, qs.length, t.depth),
  };
  writeFileSync(join(out, 'score.json'), JSON.stringify(score, null, 1));
  return { score, judged };
}

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (x: T) => Promise<R>,
): Promise<(R | Error)[]> {
  const results: (R | Error)[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i] as T);
        } catch (e) {
          results[i] = e as Error;
        }
      }
    }),
  );
  return results;
}

type Score = Awaited<ReturnType<typeof scoreTopic>>['score'];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Score the topics of one role, `n` generations each, and average. Weaknesses come from every run. */
async function scoreSet(topics: TopicCfg[], skillsDir: string, outDir: string, n: number) {
  const jobs = topics.flatMap((t) => Array.from({ length: n }, (_, k) => ({ t, k })));
  const results = await pool(jobs, CFG.parallel, (j) =>
    scoreTopic(j.t, skillsDir, outDir, n > 1 ? `-g${j.k + 1}` : ''),
  );
  const ok = results.filter(
    (r): r is Awaited<ReturnType<typeof scoreTopic>> => !(r instanceof Error),
  );
  for (const r of results) if (r instanceof Error) console.log(`  run error: ${r.message}`);
  if (!ok.length) throw new Error('every scoring run failed');
  const scores: Score[] = ok.map((r) => r.score);
  return {
    raw: mean(scores.map((s) => s.raw_total)),
    violations: mean(scores.map((s) => s.violations)),
    learning: mean(scores.map((s) => s.learning)),
    ease: mean(scores.map((s) => s.ease)),
    words: mean(scores.map((s) => s.words)),
    runs: scores.length,
    weaknesses: ok.flatMap((r) => r.judged.verdict.weaknesses),
    notes: ok.map((r) => String(r.judged.experience.notes ?? '')).filter(Boolean),
    grounding: ok.flatMap((r) =>
      r.judged.grounding.map((g) => `${g.quote.slice(0, 120)} (${g.why.slice(0, 120)})`),
    ),
  };
}
type Set = Awaited<ReturnType<typeof scoreSet>>;
const fmt = (s: Set) =>
  `raw ${s.raw.toFixed(1)}  ungrounded ${s.violations.toFixed(1)}  learn ${s.learning.toFixed(1)}  ease ${s.ease.toFixed(1)}  words ${Math.round(s.words)}`;

function claudeUsd() {
  return usage
    .filter((u) => CFG.models[u.role as Role].cli === 'claude')
    .reduce((a, u) => a + (u.costUsd ?? 0), 0);
}
function usageReport() {
  const by: Record<string, { calls: number; usd: number }> = {};
  for (const u of usage) {
    const b = (by[u.role] ??= { calls: 0, usd: 0 });
    b.calls++;
    b.usd += u.costUsd ?? 0;
  }
  return by;
}

function diffDirs(a: string, b: string): string {
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', a, b], {
      encoding: 'utf8',
      maxBuffer: 20_000_000,
    });
    return '';
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '');
  }
}

const EDITOR_PROMPT = (
  feedback: string,
  history: string,
  skill = 'condense',
) => `You are improving a teaching skill for Studyo. The skill folder is the current directory: \`${skill}/SKILL.md\` is the skill, \`_shared/teaching-craft.md\` is a shared list of teaching moves it reads. Another model runs this skill on a topic, then a judge scores the result. Below is the judge's latest feedback on the skill's output.

Make ONE focused change that you expect to raise the score: a rule added, tightened, removed or reworded in \`${skill}/SKILL.md\`, or a move improved in \`_shared/teaching-craft.md\`. Rules:
- Edit only those two files. Keep the file's voice and density; short, direct instructions beat long ones. Prefer fixing the cause in a rule over adding a new rule.
- Do not name or hint at any particular subject (no examples taken from the topics under test). The skill must improve for any material.
- Never loosen the grounding rules: facts come only from the pack, with the basic-definition exception that is already there. Never remove the self-checks.
- You must change a file in this run. If several weaknesses apply, pick the one you expect to matter most and do it now; do not defer.
- Do not repeat a change listed under "tried before".
- Then reply with one line: what you changed and why. Nothing else.

## Judge feedback
${feedback}

## Tried before
${history || '(nothing yet)'}`;

function feedbackText(s: Set): string {
  const w = [...new Map(s.weaknesses.map((x) => [`${x.where}|${x.problem}`, x])).values()];
  return [
    `Scores: ${fmt(s)} (ungrounded = facts in the guide the pack does not support; any above 0 fails the gate)`,
    '',
    'Weaknesses:',
    ...w.map((x) => `- ${x.where}: ${x.problem}`),
    '',
    'Ungrounded facts found:',
    ...(s.grounding.length ? s.grounding.map((g) => `- ${g}`) : ['- none']),
    '',
    'Reader and experience notes:',
    ...s.notes.map((n) => `- ${n.slice(0, 900)}`),
  ].join('\n');
}

/** Better = fewer ungrounded facts first, then a higher raw score by at least the margin. */
function better(c: Set, b: Set, margin: number) {
  if (c.violations < b.violations - 0.01) return true;
  if (c.violations > b.violations + 0.01) return false;
  return c.raw > b.raw + margin;
}

async function loop(label: string, apply: boolean, from?: string, deep = false) {
  const st = CFG.stopping;
  const depth = deep ? 'longer' : 'default';
  const editorRole: Role = deep ? 'editor-deep' : 'editor';
  const tune: TopicCfg[] = CFG.topics.filter(
    (t: TopicCfg) => t.role === 'tune' && t.depth === depth && loadQuiz(t.id),
  );
  const held: TopicCfg[] = CFG.topics.filter(
    (t: TopicCfg) => t.role !== 'tune' && t.depth === depth && loadQuiz(t.id),
  );
  const root = join(ROOT, '_loop', label);
  mkdirSync(root, { recursive: true });
  const bestDir = join(root, 'best-skills');
  cpSync(from ? resolve(ROOT, from) : join(ROOT, 'skills'), bestDir, { recursive: true });
  const log: string[] = [];
  const say = (m: string) => {
    console.log(m);
    log.push(m);
    writeFileSync(join(root, 'loop.log'), `${log.join('\n')}\n`);
  };

  say(`baseline: tune ${tune.length} topic(s) x${st.generations}, held-out ${held.length}`);
  let bestTune = await scoreSet(tune, bestDir, join(root, 'iter-0-tune'), st.generations);
  let bestHeld = await scoreSet(held, bestDir, join(root, 'iter-0-held'), st.held_generations);
  say(`  tune ${fmt(bestTune)}\n  held ${fmt(bestHeld)}`);
  const history: string[] = [];
  let stale = 0;
  let stoppedBy = `${st.max_iterations} iterations`;

  for (let i = 1; i <= st.max_iterations; i++) {
    if (claudeUsd() >= CFG.budget_usd) {
      stoppedBy = `Claude budget $${CFG.budget_usd}`;
      break;
    }
    const candDir = join(root, `iter-${i}-skills`);
    cpSync(bestDir, candDir, { recursive: true });
    say(`iteration ${i}: editing`);
    const reason =
      (
        await ask(
          editorRole,
          candDir,
          EDITOR_PROMPT(
            feedbackText(bestTune),
            history.join('\n'),
            deep ? 'condense-deep' : 'condense',
          ),
          {
            policy: 'work',
            minutes: 15,
          },
        )
      ).text
        .trim()
        .split('\n')
        .pop() ?? '';
    const patch = diffDirs(bestDir, candDir);
    writeFileSync(join(root, `iter-${i}.patch`), patch);
    if (!patch) {
      say('  editor changed nothing');
      history.push(`- (no change made) ${reason}`);
      if (++stale >= st.patience) {
        stoppedBy = `${st.patience} iterations without a kept change`;
        break;
      }
      continue;
    }
    say(`  change: ${reason}`);
    const t = await scoreSet(tune, candDir, join(root, `iter-${i}-tune`), st.generations);
    say(`  tune ${fmt(t)}   (best ${fmt(bestTune)})`);
    let verdict = 'rejected: not better on the tune topic';
    if (better(t, bestTune, st.margin)) {
      const h = await scoreSet(held, candDir, join(root, `iter-${i}-held`), st.held_generations);
      say(`  held ${fmt(h)}   (best ${fmt(bestHeld)})`);
      const heldOk = h.violations <= bestHeld.violations + 1.5 && h.raw >= bestHeld.raw - st.margin;
      if (heldOk) {
        cpSync(candDir, bestDir, { recursive: true });
        bestTune = t;
        bestHeld = h;
        verdict = 'KEPT';
        stale = 0;
      } else verdict = 'rejected: held-out topics got worse';
    }
    if (verdict !== 'KEPT') stale++;
    say(`  ${verdict}`);
    history.push(`- ${reason} -> ${verdict}`);
    if (stale >= st.patience) {
      stoppedBy = `${st.patience} iterations without a kept change`;
      break;
    }
  }

  const report = usageReport();
  const claude = claudeUsd();
  writeFileSync(
    join(root, 'usage.json'),
    JSON.stringify({ claude_usd: claude, by_role: report }, null, 1),
  );
  const finalPatch = diffDirs(join(ROOT, 'skills'), bestDir);
  writeFileSync(join(root, 'final.patch'), finalPatch);
  say(`\nstopped: ${stoppedBy}`);
  say(`final tune ${fmt(bestTune)}\nfinal held ${fmt(bestHeld)}`);
  say(
    `Claude usage: $${claude.toFixed(2)} (judge and editor). Calls: ${Object.entries(report)
      .map(([r, v]) => `${r} ${v.calls}`)
      .join(', ')}. OpenCode runs report no cost.`,
  );
  say(`winner: ${bestDir}\npatch against skills/: ${join(root, 'final.patch')}`);
  if (apply && finalPatch) {
    cpSync(bestDir, join(ROOT, 'skills'), { recursive: true });
    say('applied to skills/ (uncommitted)');
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const label = arg('label') ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (cmd === 'run') {
    await loop(label, rest.includes('--apply'), arg('from'), rest.includes('--deep'));
    return;
  }
  if (cmd !== 'score') {
    console.log(
      'usage: loop score [--skills <dir>] [--topics id,id | --role tune|held|regression] [--depth default|longer] [--label name] [--reuse label]\n       loop run [--label name] [--apply] [--deep]',
    );
    process.exit(cmd ? 1 : 0);
  }
  REUSE = arg('reuse');
  const genModel = arg('gen-model');
  if (genModel) {
    CFG.models.generator.model = genModel;
    CFG.models['generator-deep'].model = genModel;
  }
  const skillsDir = resolve(ROOT, arg('skills') ?? 'skills');
  const ids = arg('topics')?.split(',');
  const role = arg('role');
  const depthFilter = arg('depth') as 'default' | 'longer' | undefined;
  const topics: TopicCfg[] = CFG.topics.filter((t: TopicCfg) => {
    if (ids) return ids.includes(t.id);
    if (role && t.role !== role) return false;
    if (depthFilter && t.depth !== depthFilter) return false;
    return true;
  });
  const outDir = join(ROOT, '_loop', label);
  mkdirSync(outDir, { recursive: true });
  console.log(`scoring ${topics.length} topic(s) with ${skillsDir} -> ${outDir}`);
  const results = await pool(
    topics,
    CFG.parallel,
    async (t) => (await scoreTopic(t, skillsDir, outDir)).score,
  );
  const rows = results.map((r, i) =>
    r instanceof Error ? { topic: topics[i]?.id, error: r.message } : r,
  );
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(rows, null, 1));
  for (const r of rows) {
    if ('error' in r) console.log(`${String(r.topic).slice(0, 28).padEnd(28)} ERROR ${r.error}`);
    else
      console.log(
        `${r.topic.slice(0, 28).padEnd(28)} ${r.role.padEnd(10)} raw ${String(r.raw_total).padStart(5)}${r.gated ? ` (gated: ${r.violations} ungrounded)` : ''}  learn ${r.learning}  ease ${r.ease}  quiz ${r.quiz}  cov ${r.coverage}  words ${r.words}`,
      );
  }
  console.log(`Claude usage: $${claudeUsd().toFixed(2)}`);
}

main();
