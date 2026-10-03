# Live events and resuming

The server holds all state. `GET /events` only announces changes, so a client that misses events loses nothing it can't fetch again.

## The stream

`GET /events` returns `text/event-stream`:

```
id: 412
event: job.updated
data: {"id":412,"type":"job.updated","at":"2026-10-03T09:12:01Z","data":{"job":{...}}}

: ping
```

- Ids are increasing integers, global to the server.
- A `: ping` comment is sent every 20 seconds so proxies (Cloudflare) keep the connection open.
- The server keeps the last 5,000 events (and at least 24 hours). A client asking to replay from an id older than that gets a `resync` event first, meaning "your snapshots may be stale, refetch them".
- Clients read the stream with streaming `fetch`, because `EventSource` can't send `Authorization` or Cloudflare Access headers.

## Event types

| Type | Data | Meaning |
| --- | --- | --- |
| `job.updated` | `{job}` | Created, started, new activity line, needs input, finished. Always the whole job. |
| `job.log` | `{job_id, line}` | One log line. Only for screens showing the log. |
| `chat.delta` | `{topic_id, message_id, text}` | Text to append to a streaming assistant message. |
| `chat.message` | `{topic_id, message}` | A chat message was created or finished (whole message). |
| `topic.updated` | `{topic_id}` | Manifest, status or progress changed. Refetch the topic. |
| `topic.removed` | `{topic_id}` | Topic folder gone. |
| `inbox.updated` | `{}` | Inbox contents changed. |
| `resync` | `{}` | Replay not possible; refetch everything on screen. |

## What the app does on start and on every resume

Resume means the tab became visible again (`visibilitychange`) or the Android app came to the foreground (`AppState` "active"). iOS suspends web apps in the background and the stream dies with them; that's expected.

1. `GET /jobs?active=true`. This is the source of truth for "what is the AI doing". Any job in `needs_input` shows its questions.
2. Reconnect `GET /events` with `Last-Event-ID` set to the last id seen.
3. Refetch the data for the current screen.

Steps 1 and 3 make the app correct even when replay fails. Step 2 makes it live again.

While the stream is down and a job is active, the app polls `GET /jobs?active=true` every 10 seconds, and stops when the stream is back.

## Jobs that ask questions

1. A skill run with `interactive: app` writes its questions to `<topic>/_job/questions.json` (schema `QuestionSet`), prints `[studyo] NEEDS_INPUT`, and ends its turn.
2. The CLI process exits. The server reads the file, sets the job to `needs_input` with `questions`, and emits `job.updated`. No process is held while waiting.
3. The app answers with `POST /jobs/{id}/answers`. The server writes them to `<topic>/_job/answers.json`, sets the job to `queued`, and resumes the same CLI session with a prompt that contains the answers.
4. The skill continues from where it stopped.

## Chat replies

`POST /topics/{id}/chat` creates both messages immediately. The reply is saved to `<topic>/chat/` as it streams. After a reconnect, `GET /topics/{id}/chat` returns everything so far, and later `chat.delta` events continue it.
