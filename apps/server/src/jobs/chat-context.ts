import type { Topic } from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import { type Courses, chapterState } from '../courses.ts';
import type { Library } from '../library.ts';
import { readProfile } from '../profile.ts';

/**
 * A short note about the learner, put in front of a chat question so the model does not have to go
 * looking: what they know, where they are reading, what they have finished. It sets the level, not the depth.
 */
export async function chatContext(
  library: Library,
  courses: Courses,
  scope: string,
  topic: Topic | null,
): Promise<string | null> {
  const lines: string[] = [];
  const profile = readProfile(library.root);
  const knows = profile.knows.filter((k) => k.via !== 'forgot').map((k) => k.term);
  if (knows.length) lines.push(`- Says they know: ${knows.slice(0, 40).join('; ')}`);
  if (profile.notes.trim())
    lines.push(`- Notes they wrote about themselves: ${profile.notes.trim().slice(0, 600)}`);

  if (isCourseScope(scope)) {
    const manifest = await courses.readManifest(courseIdOf(scope));
    const done: string[] = [];
    const reading: string[] = [];
    for (const c of manifest.chapters) {
      if (!(await library.exists(c.id))) continue;
      const t = await library.readTopic(c.id, { persist: false });
      const state = chapterState(t, await library.readProgress(c.id), false);
      if (state === 'done') done.push(c.title);
      else if (state === 'in_progress') reading.push(c.title);
    }
    if (done.length) lines.push(`- Chapters marked done: ${done.join('; ')}`);
    if (reading.length) lines.push(`- Chapters in progress: ${reading.join('; ')}`);
  } else if (topic) {
    const progress = await library.readProgress(scope);
    const titleOf = (id: string) => topic.resources.find((r) => r.id === id)?.title ?? id;
    const last = progress.last;
    if (last) {
      const item = progress.items[last.resource_id];
      const where = item?.section ? `, in the section "${item.section}"` : '';
      const pct =
        item && item.position > 0 && item.position <= 1
          ? `, about ${Math.round(item.position * 100)}% through`
          : '';
      lines.push(`- Last reading: ${titleOf(last.resource_id)}${where}${pct}`);
    }
    const done = Object.entries(progress.items)
      .filter(([, i]) => i.done)
      .map(([id]) => titleOf(id));
    if (done.length) lines.push(`- Marked as read: ${done.join('; ')}`);
  }
  if (!lines.length) return null;
  return [
    'About the learner (use it to judge level; a question means they have not got it yet, even if they read it):',
    ...lines,
  ].join('\n');
}
