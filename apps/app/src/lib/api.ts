import type {
  AnswerSet,
  AssignInbox,
  ChatHistory,
  ChatTurn,
  CreateJob,
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
  Rendered,
  Resource,
  ServerInfo,
  Settings,
  Topic,
  TopicDetail,
  TopicList,
  TopicWithJob,
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
  createTopicFromPdf: (form: FormData) => request<TopicWithJob>('POST', '/topics', form),
  updateTopic: (id: string, body: UpdateTopic) =>
    request<Topic>('PATCH', `/topics/${enc(id)}`, body),
  upload: (
    id: string,
    form: FormData,
    onProgress?: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ) => upload<Resource>(`/topics/${enc(id)}/resources`, form, onProgress, signal),
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
  form: FormData,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<T> {
  const c = conn();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${c.url}${path}`);
    for (const [k, v] of Object.entries(authHeaders(c))) xhr.setRequestHeader(k, v);
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
