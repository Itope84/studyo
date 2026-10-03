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
    if (await accessExpired(c)) {
      throw new ApiError(
        401,
        'access_expired',
        'Your Cloudflare Access sign-in has expired. Sign in again to continue.',
      );
    }
    throw new ApiError(0, 'offline', "Can't reach the server.");
  }
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
      throw new ApiError(
        res.status,
        'access',
        'Cloudflare Access refused the request. Check the service token in Settings.',
      );
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'http',
      err?.message ?? `The server answered ${res.status}.`,
    );
  }
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
  upload: (id: string, form: FormData) =>
    request<Resource>('POST', `/topics/${enc(id)}/resources`, form),
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

/**
 * Behind Cloudflare Access, an expired sign-in turns every API call into a redirect to the login page, which
 * fetch reports as a network error. When the app and API share an origin, a quick probe of a static file
 * tells the two apart: a redirect means the session expired, not that the server is down.
 */
async function accessExpired(c: Connection): Promise<boolean> {
  if (typeof window === 'undefined' || !window.location?.origin) return false;
  if (!c.url.startsWith(window.location.origin)) return false;
  try {
    const probe = await fetch(`${window.location.origin}/manifest.json?probe=${Date.now()}`, {
      redirect: 'manual',
    });
    return (
      probe.type === 'opaqueredirect' ||
      probe.status === 302 ||
      probe.status === 401 ||
      probe.status === 403
    );
  } catch {
    return false;
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
