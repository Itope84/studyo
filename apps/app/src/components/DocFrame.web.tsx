import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import type { DocFrameHandle, DocFrameProps } from './DocFrame.types';

/**
 * The rendered document in an iframe. The page fetches the HTML and shows it with `srcdoc`, so the document and
 * its images, maths and diagrams load through the app's service worker and work offline (a frame loaded straight
 * from the server's hostname is outside it). A `<base>` keeps relative links pointing at the server.
 * Free-form HTML blocks inside stay in their own sandboxed frames. Messages go through postMessage.
 */
export const DocFrame = forwardRef<DocFrameHandle, DocFrameProps>(function DocFrame(
  { url, onMessage },
  ref,
) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  // null while loading; `false` when the HTML couldn't be fetched (the frame then loads the URL itself).
  const [doc, setDoc] = useState<string | false | null>(null);

  useImperativeHandle(ref, () => ({
    post: (msg) => frame.current?.contentWindow?.postMessage(msg, '*'),
  }));

  useEffect(() => {
    let live = true;
    setDoc(null);
    const u = new URL(url);
    const theme = u.searchParams.get('theme');
    u.search = '';
    fetch(u.toString(), { mode: 'cors', credentials: 'omit' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((html) => {
        if (live) setDoc(withBase(html, u.toString(), theme));
      })
      .catch(() => {
        if (live) setDoc(false);
      });
    return () => {
      live = false;
    };
  }, [url]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (d && typeof d === 'object' && typeof d.type === 'string' && d.type.startsWith('studyo:'))
        onMessage(d);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  return (
    <View style={{ flex: 1 }}>
      {doc === null
        ? null
        : createElement('iframe', {
            ref: frame,
            ...(doc === false ? { src: url } : { srcDoc: doc }),
            title: 'Document',
            style: {
              border: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              background: 'transparent',
            },
          })}
    </View>
  );
});

/** In-page links (`#id`) would follow the `<base>` to the server; scroll instead. */
const ANCHORS = `<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var el=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));if(el)el.scrollIntoView({block:'start'});});</script>`;

function withBase(html: string, fileUrl: string, theme: string | null): string {
  const dir = fileUrl.slice(0, fileUrl.lastIndexOf('/') + 1);
  const attr = theme === 'dark' || theme === 'light' ? ` data-theme="${theme}"` : '';
  return html
    .replace(/<html([^>]*)>/i, `<html$1${attr}>`)
    .replace(/<head([^>]*)>/i, `<head$1><base href="${dir.replace(/"/g, '%22')}">${ANCHORS}`);
}
