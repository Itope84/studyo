import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import type { DocFrameHandle, DocFrameProps } from './DocFrame.types';

/** The rendered document in a WebView (Android). External links open in the browser. */
export const DocFrame = forwardRef<DocFrameHandle, DocFrameProps>(function DocFrame(
  { url, onMessage },
  ref,
) {
  const view = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({
    post: (msg) => view.current?.postMessage(JSON.stringify(msg)),
  }));
  const origin = new URL(url).origin;
  return (
    <WebView
      ref={view}
      source={{ uri: url }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      onMessage={(e) => {
        try {
          onMessage(JSON.parse(e.nativeEvent.data));
        } catch {}
      }}
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(origin)) return true;
        void Linking.openURL(req.url);
        return false;
      }}
    />
  );
});
