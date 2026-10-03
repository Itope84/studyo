import type { Resource } from '@studyo/api';
import { Linking, Platform } from 'react-native';
import { api, fileUrl } from './api';

export type DownloadFormat = 'pdf' | 'md';

/** Hand the browser (or the OS) a file URL that the server sends as an attachment. */
function open(url: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = url;
    // Same window: the server sends an attachment, so the page stays put. A new tab opened after the
    // await below would be caught by popup blockers.
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  void Linking.openURL(url);
}

/**
 * Download a pack or condensed doc. PDF is printed on the server (first time takes a few seconds);
 * Markdown is the source file as the skills wrote it. Both work as NotebookLM sources.
 */
export async function downloadDoc(
  topicId: string,
  resource: Resource,
  fileToken: string,
  format: DownloadFormat,
) {
  if (format === 'pdf') {
    const pdf = await api.pdf(topicId, resource.id);
    open(`${fileUrl(fileToken, pdf.pdf_path)}?download=${encodeURIComponent(pdf.file_name)}`);
    return;
  }
  const name = `${resource.title
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/*?"<>|]+/g, ' ')
    .trim()}.md`;
  open(
    `${fileUrl(fileToken, `topics/${topicId}/${resource.path}`)}?download=${encodeURIComponent(name)}`,
  );
}
