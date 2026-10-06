# Offline (web app)

Goal: on a flight, open the installed web app with no connection, read the docs of topics made available offline, and play their downloaded audio. Positions and done marks made offline reach the server when it is back.

## What works offline

- The app opens (its files are cached by the service worker).
- Anything already opened while online: topic list, topics, docs, progress. Shown as last seen.
- Topics marked **Available offline**: every doc (pack, condensed docs) with its images, maths and diagrams, and every audio file, downloaded in full ahead of time.
- Reading and listening save positions and done marks on the device and send them when the server answers again.
- Not offline: making anything (jobs), chat, quizzes being graded, uploads. These stay greyed out as they are today when the server is offline.

## Cache invalidation (one rule per kind of data)

1. **App files.** Expo names its JS by content hash, so those never change. A build step writes `dist/sw.js` with a build id and the list of files to keep. Each deploy changes `sw.js`, the browser installs the new worker, it caches the new files and deletes the old cache. `index.html` is fetched network first, so an online launch always gets the newest app.
2. **Server data (API GETs and `/f/` files).** Network first; every good answer is saved; the saved copy is used only when the network fails or takes longer than a few seconds (plane Wi-Fi). Online, nothing is ever stale. Saved copies served offline carry `x-studyo-offline: 1`, so the app marks the server offline and greys out actions.
3. **Downloads.** Saved under the library path without the file token (the token changes with the access token). The app keeps the size of each download; when the server's size differs (regenerated audio, re-rendered doc), it downloads again.

## Pieces

- `apps/app/public/sw.js`: push (as now), app shell precache, network-first data cache, range requests for cached audio (Safari needs `206 Partial Content`).
- `scripts/build-sw.mjs`: run after `expo export`; writes the build id and file list into `dist/sw.js`.
- Reader (web): fetches the HTML and shows it with `srcdoc` plus a `<base>` to its folder. A cross-origin iframe is outside the app's service worker; a srcdoc frame is inside it. AI-written HTML blocks stay in their own sandboxed frames.
- `apps/app/src/lib/offline.ts`: register the worker, make a topic available offline (fetch its data, docs, assets and audio into the cache), list and remove downloads.
- Progress outbox: failed progress saves are queued on the device (latest per doc or audio), shown in place of the server's copy, and sent when the server answers. The server already keeps the newest by `updated`.

## Limits

- iPhone can clear web storage when the device runs out of space. The topic screen shows what is downloaded, so a missing download is visible before boarding.
- Audio is about 30 MB an hour.
