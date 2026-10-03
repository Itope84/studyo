import katex from 'katex';
import { createElement, useEffect } from 'react';
import { fileUrl } from '@/lib/api';
import { useServerInfo } from '@/lib/hooks';
import type { MathTextProps } from './MathText.types';

let linked = false;

/** KaTeX in the browser. Its stylesheet and fonts come from the server's shared renderer assets. */
export function MathText({ tex, display, color }: MathTextProps) {
  const server = useServerInfo();
  const token = server.data?.file_token;
  useEffect(() => {
    if (linked || !token || typeof document === 'undefined') return;
    linked = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fileUrl(token, '_studyo/assets/katex/katex.min.css');
    document.head.appendChild(link);
  }, [token]);
  const html = katex.renderToString(tex, {
    displayMode: !!display,
    throwOnError: false,
    strict: 'ignore',
    output: 'html',
  });
  return createElement(display ? 'div' : 'span', {
    style: {
      color,
      overflowX: display ? 'auto' : undefined,
      padding: display ? '4px 0' : undefined,
    },
    dangerouslySetInnerHTML: { __html: html },
  });
}
