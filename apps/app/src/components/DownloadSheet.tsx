import type { Resource } from '@studyo/api';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { type DownloadFormat, downloadDoc } from '@/lib/download';
import { useOnline, useServerInfo } from '@/lib/hooks';
import { space } from '@/theme';
import { Sheet } from './Sheet';
import { Icon, Notice, Row, T } from './ui';

/** Save a pack or condensed doc as PDF (for NotebookLM, printing) or as its Markdown source. */
export function DownloadSheet({
  open,
  onClose,
  topicId,
  resource,
}: {
  open: boolean;
  onClose: () => void;
  topicId: string;
  resource: Resource | null;
}) {
  const server = useServerInfo();
  const { online } = useOnline();
  const [busy, setBusy] = useState<DownloadFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = server.data?.file_token;

  const go = async (format: DownloadFormat) => {
    if (!resource || !token) return;
    setBusy(format);
    setError(null);
    try {
      await downloadDoc(topicId, resource, token, format);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Download">
      {resource ? (
        <T variant="bodySmall" tone="lead" style={{ marginBottom: space.sm }}>
          {resource.title}
        </T>
      ) : null}
      <Row
        title={busy === 'pdf' ? 'Preparing the PDF…' : 'PDF'}
        subtitle="Best for NotebookLM, printing and sharing. Keeps diagrams, maths and source links."
        leading={<Icon name="picture-as-pdf" size={22} tone="primary" />}
        onPress={() => void go('pdf')}
        disabled={!online || !!busy}
        disabledReason={online ? null : 'Needs the server'}
      />
      <Row
        title={busy === 'md' ? 'Preparing…' : 'Markdown'}
        subtitle="The plain text the skills wrote. NotebookLM accepts it too."
        leading={<Icon name="description" size={22} tone="sage" />}
        onPress={() => void go('md')}
        disabled={!online || !!busy}
        disabledReason={online ? null : 'Needs the server'}
      />
      {error ? (
        <View style={{ marginTop: space.sm }}>
          <Notice tone="danger" icon="error-outline" title="Couldn't download" body={error} />
        </View>
      ) : null}
    </Sheet>
  );
}
