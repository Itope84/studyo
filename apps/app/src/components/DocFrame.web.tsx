import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import type { DocFrameHandle, DocFrameProps } from './DocFrame.types';

/** The rendered document in an iframe. Messages cross origins with postMessage. */
export const DocFrame = forwardRef<DocFrameHandle, DocFrameProps>(function DocFrame(
  { url, onMessage },
  ref,
) {
  const frame = useRef<HTMLIFrameElement | null>(null);

  useImperativeHandle(ref, () => ({
    post: (msg) => frame.current?.contentWindow?.postMessage(msg, '*'),
  }));

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
      {createElement('iframe', {
        ref: frame,
        src: url,
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
