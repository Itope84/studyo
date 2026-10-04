import type {
  AnswerSet,
  AssignInbox,
  Assignment,
  AssignmentList,
  AssignmentWithJob,
  BuildChapters,
  ChatHistory,
  ChatTurn,
  Course,
  CourseDetail,
  CourseList,
  CourseWithJob,
  CreateAssignment,
  CreateCourse,
  CreateJob,
  CreateQuiz,
  CreateSubmission,
  CreateTopic,
  InboxItem,
  InboxList,
  Job,
  JobDetail,
  JobList,
  Pdf,
  Profile,
  Progress,
  ProgressUpdate,
  Quiz,
  QuizAttempt,
  QuizList,
  QuizWithJob,
  Rendered,
  Resource,
  ServerInfo,
  Settings,
  SubmitAttempt,
  Topic,
  TopicDetail,
  TopicList,
  TopicWithJob,
  UpdateCourse,
  UpdateTopic,
} from '@studyo/api';
import { type Connection, usePrefs } from './prefs';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

export function authHeaders(conn: Connection): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${conn.token}` };
  if (conn.cfClientId && conn.cfClientSecret) {
    h['CF-Access-Client-Id'] = conn.cfClientId;
    h['CF-Access-Client-Secret'] = conn.cfClientSecret;
  }
  if (conn.cfToken) h['CF-Access-Token'] = conn.cfToken;
  return h;
}

function conn(): Connection {
  const c = usePrefs.getState().connection;
  if (!c) throw new ApiError(0, 'not_configured', 'Connect to your Studyo server first.');
  return c;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  c: Connection = conn(),
): Promise<T> {
  const headers = authHeaders(c);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, { method, headers, body: payload });
  } catch {
    if (await accessBlocks(c)) throw accessError(c);
    throw new ApiError(0, 'offline', "Can't reach the server.");
  }
  // Native fetch follows Access's redirect and lands on its login page instead of failing.
  if (res.url?.includes('cloudflareaccess.com')) throw accessError(c);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: a proxy or login page in the way.
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    if (!err && (res.status === 302 || res.status === 403 || text.includes('cloudflareaccess'))) {
      throw accessError(c);
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'http',
      err?.message ?? `The server answered ${res.status}.`,
    );
  }
  if (json === null && text.includes('cloudflareaccess')) throw accessError(c);
  if (json === null && text)
    throw new ApiError(res.status, 'bad_response', 'The server sent something unexpected.');
  return json as T;
}

const enc = encodeURIComponent;

export const api = {
  health: (c: Connection) =>
    request<{ ok: boolean; name: string; version: string }>('GET', '/health', undefined, c),
  server: (c?: Connection) => request<ServerInfo>('GET', '/server', undefined, c ?? conn()),
  settings: () => request<Settings>('GET', '/settings'),
  saveSettings: (s: Settings) => request<Settings>('PUT', '/settings', s),

  topics: (includeArchived = false) =>
    request<TopicList>('GET', `/topics${includeArchived ? '?include_archived=true' : ''}`),
  topic: (id: string) => request<TopicDetail>('GET', `/topics/${enc(id)}`),
  createTopic: (body: CreateTopic) => request<TopicWithJob>('POST', '/topics', body),
  createTopicFromPdf: (
    form: FormData,
    onProgress?: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ) => upload<TopicWithJob>('/topics', form, onProgress, signal),
  updateTopic: (id: string, body: UpdateTopic) =>
    request<Topic>('PATCH', `/topics/${enc(id)}`, body),
  upload: (
    id: string,
    picked: { form: FormData; blob?: Blob; uri?: string; size?: number },
    madeWith: string,
    onProgress?: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ) => uploadResource(id, picked, madeWith, onProgress, signal),
  rendered: (id: string, rid: string) =>
    request<Rendered>('GET', `/topics/${enc(id)}/resources/${enc(rid)}/rendered`),
  addBookmark: (id: string, body: { resource_id: string; position: number; note?: string }) =>
    request<Progress>('POST', `/topics/${enc(id)}/bookmarks`, body),
  deleteBookmark: (id: string, bid: string) =>
    request<Progress>('DELETE', `/topics/${enc(id)}/bookmarks/${enc(bid)}`),
  renameInbox: (name: string, newName: string) =>
    request<InboxItem>('PATCH', `/inbox/${enc(name)}`, { name: newName }),
  deleteInbox: (name: string) => request<void>('DELETE', `/inbox/${enc(name)}`),
  pdf: (id: string, rid: string) =>
    request<Pdf>('GET', `/topics/${enc(id)}/resources/${enc(rid)}/pdf`),
  markRead: (id: string) => request<Profile>('POST', `/topics/${enc(id)}/mark-read`),

  progress: (id: string) => request<Progress>('GET', `/topics/${enc(id)}/progress`),
  saveProgress: (id: string, u: ProgressUpdate) =>
    request<Progress>('PUT', `/topics/${enc(id)}/progress`, u),

  startJob: (id: string, body: CreateJob) => request<Job>('POST', `/topics/${enc(id)}/jobs`, body),
  jobs: (q: { active?: boolean; topic_id?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.active) params.set('active', 'true');
    if (q.topic_id) params.set('topic_id', q.topic_id);
    if (q.limit) params.set('limit', String(q.limit));
    return request<JobList>('GET', `/jobs?${params}`);
  },

  job: (id: string) => request<JobDetail>('GET', `/jobs/${enc(id)}`),
  answer: (id: string, answers: AnswerSet) =>
    request<Job>('POST', `/jobs/${enc(id)}/answers`, answers),
  cancel: (id: string) => request<Job>('POST', `/jobs/${enc(id)}/cancel`),

  chat: (id: string) => request<ChatHistory>('GET', `/topics/${enc(id)}/chat`),
  send: (id: string, text: string) =>
    request<ChatTurn>('POST', `/topics/${enc(id)}/chat`, { text }),

  courses: (includeArchived = false) =>
    request<CourseList>('GET', `/courses${includeArchived ? '?include_archived=true' : ''}`),
  course: (id: string) => request<CourseDetail>('GET', `/courses/${enc(id)}`),
  createCourse: (body: CreateCourse) => request<CourseWithJob>('POST', '/courses', body),
  createCourseFromPdf: (
    form: FormData,
    onProgress?: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ) => upload<CourseWithJob>('/courses', form, onProgress, signal),
  updateCourse: (id: string, body: UpdateCourse) =>
    request<Course>('PATCH', `/courses/${enc(id)}`, body),
  redoOutline: (id: string) => request<Job>('POST', `/courses/${enc(id)}/outline`),
  buildChapters: (id: string, body: BuildChapters) =>
    request<JobList>('POST', `/courses/${enc(id)}/build`, body),
  completeChapter: (id: string, chapter: string, done: boolean) =>
    request<CourseDetail>('POST', `/courses/${enc(id)}/chapters/${enc(chapter)}/complete`, {
      done,
    }),

  quizzes: (scope: string) => request<QuizList>('GET', `/topics/${enc(scope)}/quizzes`),
  quiz: (scope: string, id: string) =>
    request<Quiz>('GET', `/topics/${enc(scope)}/quizzes/${enc(id)}`),
  createQuiz: (scope: string, body: CreateQuiz) =>
    request<QuizWithJob>('POST', `/topics/${enc(scope)}/quizzes`, body),
  deleteResource: (topicId: string, resourceId: string) =>
    request<void>('DELETE', `/topics/${enc(topicId)}/resources/${enc(resourceId)}`),
  deleteQuiz: (scope: string, id: string) =>
    request<void>('DELETE', `/topics/${enc(scope)}/quizzes/${enc(id)}`),
  submitAttempt: (scope: string, id: string, body: SubmitAttempt) =>
    request<QuizAttempt>('POST', `/topics/${enc(scope)}/quizzes/${enc(id)}/attempts`, body),

  assignments: (topic: string) =>
    request<AssignmentList>('GET', `/topics/${enc(topic)}/assignments`),
  assignment: (topic: string, id: string) =>
    request<Assignment>('GET', `/topics/${enc(topic)}/assignments/${enc(id)}`),
  createAssignment: (topic: string, body: CreateAssignment | FormData) =>
    request<AssignmentWithJob>('POST', `/topics/${enc(topic)}/assignments`, body),
  deleteAssignment: (topic: string, id: string) =>
    request<void>('DELETE', `/topics/${enc(topic)}/assignments/${enc(id)}`),
  submitAssignment: (topic: string, id: string, body: CreateSubmission | FormData) =>
    request<Assignment>('POST', `/topics/${enc(topic)}/assignments/${enc(id)}/submissions`, body),

  inbox: () => request<InboxList>('GET', '/inbox'),
  uploadInbox: (form: FormData) => request<InboxItem>('POST', '/inbox', form),
  assign: (body: AssignInbox) => request<TopicWithJob>('POST', '/inbox/assign', body),

  profile: () => request<Profile>('GET', '/profile'),
  saveProfile: (p: Profile) => request<Profile>('PUT', '/profile', p),

  pushKey: () => request<{ public_key: string }>('GET', '/push/key'),
  subscribePush: (sub: unknown) => request<void>('POST', '/push/subscriptions', sub),
};

/** URL for a library file that media elements and iframes can load without headers. */
export function fileUrl(fileToken: string, libraryPath: string): string {
  const c = conn();
  return `${c.url}/f/${fileToken}/${libraryPath.split('/').map(enc).join('/')}`;
}

/** Access wants a sign-in: a first one (`access_required`) or a fresh one (`access_expired`). */
function accessError(c: Connection): ApiError {
  return c.cfToken
    ? new ApiError(
        401,
        'access_expired',
        'Your Cloudflare Access sign-in has expired. Sign in again to continue.',
      )
    : new ApiError(
        401,
        'access_required',
        'This server is protected by Cloudflare Access. Sign in to continue.',
      );
}

/**
 * Behind Cloudflare Access, a missing or expired sign-in turns API calls into redirects to the login page,
 * which a browser reports as a network error, the same as a server that is down. What can be known:
 * - With an Access token: it carries its own expiry.
 * - Same origin as the page: a probe that doesn't follow redirects sees Access's redirect.
 * - Another origin, in a browser: nothing (browsers hide cross-origin redirects). The connect screen offers
 *   the sign-in when the server can't be reached. Native fetch follows the redirect instead, which `request`
 *   spots by the login page it lands on.
 */
async function accessBlocks(c: Connection): Promise<boolean> {
  if (c.cfToken) return tokenExpired(c.cfToken);
  if (
    typeof window === 'undefined' ||
    !window.location?.origin ||
    !c.url.startsWith(window.location.origin)
  ) {
    return false;
  }
  try {
    const probe = await fetch(`${c.url}/health?probe=${Date.now()}`, { redirect: 'manual' });
    return probe.type === 'opaqueredirect' || probe.status === 302;
  } catch {
    return false;
  }
}

/** True when a JWT's `exp` has passed (or it can't be read). */
export function tokenExpired(jwt: string): boolean {
  try {
    const part = jwt.split('.')[1] ?? '';
    const json = JSON.parse(
      atob(
        part
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(Math.ceil(part.length / 4) * 4, '='),
      ),
    );
    return typeof json.exp === 'number' ? json.exp * 1000 < Date.now() : false;
  } catch {
    return true;
  }
}

/** When the web app is served by a Studyo server, its API is on the same origin under /api. */
export async function sameOriginServer(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.location?.origin?.startsWith('http')) return null;
  try {
    const res = await fetch(`${window.location.origin}/api/health`);
    const body = (await res.json()) as { name?: string };
    return body.name === 'studyo' ? `${window.location.origin}/api` : null;
  } catch {
    return null;
  }
}

export interface UploadProgress {
  sent: number;
  total: number;
  /** Bytes per second, averaged since the upload began. */
  rate: number;
}

/**
 * Multipart upload with progress (fetch can't report upload progress; XMLHttpRequest can, on web and native).
 * `onProgress` is first called once bytes start leaving the device, so a long wait before that means the
 * device is still reading the file (for example downloading it from iCloud).
 */
export function upload<T>(
  path: string,
  form: FormData | Blob | ArrayBufferView,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
  contentType?: string,
): Promise<T> {
  const c = conn();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${c.url}${path}`);
    for (const [k, v] of Object.entries(authHeaders(c))) xhr.setRequestHeader(k, v);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    const started = Date.now();
    xhr.upload.onprogress = (e) => {
      const secs = Math.max(0.25, (Date.now() - started) / 1000);
      onProgress?.({
        sent: e.loaded,
        total: e.lengthComputable ? e.total : 0,
        rate: e.loaded / secs,
      });
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(json as T);
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      reject(
        new ApiError(
          xhr.status,
          err?.code ?? 'http',
          err?.message ?? `The server answered ${xhr.status}.`,
        ),
      );
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          0,
          'offline',
          'The upload was cut off before it finished. Keep Studyo open while it uploads, and check the connection.',
        ),
      );
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form as unknown as XMLHttpRequestBodyInit);
  });
}

/** Each piece of a big upload. Well under the 100 MB a Cloudflare request may carry. */
const CHUNK = 16 * 1024 * 1024;

/** Where a file's pieces come from: a Blob on web, a file read in order on native. */
interface Source {
  size: number;
  /** The next piece, in order. */
  next(length: number): Blob | Uint8Array;
  close(): void;
}

async function openSource(picked: {
  blob?: Blob;
  uri?: string;
  size?: number;
}): Promise<Source | null> {
  const blob = picked.blob;
  if (blob) {
    let at = 0;
    return {
      size: blob.size,
      next: (n) => {
        const piece = blob.slice(at, at + n);
        at += n;
        return piece;
      },
      close: () => {},
    };
  }
  if (picked.uri) {
    // Native: read the file in order, one piece in memory at a time.
    const { File, FileMode } = await import('expo-file-system');
    const handle = new File(picked.uri).open(FileMode.ReadOnly);
    const size = handle.size ?? picked.size ?? 0;
    if (!size) {
      handle.close();
      return null;
    }
    return { size, next: (n) => handle.readBytes(n), close: () => handle.close() };
  }
  return null;
}

/**
 * Add audio, video or a document to a topic. Big files go up in pieces, one request each, so no single request
 * hits a proxy's body limit; a piece that fails on the network is sent again (up to three tries). Small files,
 * and files that can't be read in pieces, are one request.
 */
export async function uploadResource(
  id: string,
  picked: { form: FormData; blob?: Blob; uri?: string; size?: number },
  madeWith: string,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<Resource> {
  // The picker's size is 0 when it doesn't know; then open the file and let it say.
  const known = picked.blob?.size ?? (picked.size || Number.POSITIVE_INFINITY);
  const source = known > CHUNK ? await openSource(picked) : null;
  if (!source) {
    picked.form.append('made_with', madeWith);
    return upload<Resource>(`/topics/${enc(id)}/resources`, picked.form, onProgress, signal);
  }
  const name = (picked.form.get('file') as { name?: string } | null)?.name ?? 'file';
  const uploadId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const started = Date.now();
  let result: Resource | null = null;
  try {
    for (let offset = 0; offset < source.size; offset += CHUNK) {
      const piece = source.next(Math.min(CHUNK, source.size - offset));
      const query = new URLSearchParams({
        upload_id: uploadId,
        name,
        offset: String(offset),
        total: String(source.size),
      });
      if (madeWith) query.set('made_with', madeWith);
      for (let attempt = 1; ; attempt++) {
        try {
          const reply = await upload<Resource | { received: number }>(
            `/topics/${enc(id)}/resources/chunks?${query}`,
            piece,
            (p) =>
              onProgress?.({
                sent: offset + p.sent,
                total: source.size,
                rate: (offset + p.sent) / Math.max(0.25, (Date.now() - started) / 1000),
              }),
            signal,
            'application/octet-stream',
          );
          if ('id' in reply) result = reply;
          break;
        } catch (e) {
          const retry =
            e instanceof ApiError && (e.status === 0 || e.status >= 500) && e.code !== 'aborted';
          if (!retry || attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  } finally {
    source.close();
  }
  if (!result)
    throw new ApiError(500, 'upload_failed', 'The upload finished but nothing was added.');
  return result;
}
