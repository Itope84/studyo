import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

export interface Picked {
  name: string;
  /** Bytes, when the picker knows. */
  size: number;
  form: FormData;
}

/** Let the person pick a file and wrap it as multipart form data under `file`. */
export async function pickFile(
  types: string[],
  extra: Record<string, string> = {},
): Promise<Picked | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: types,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const form = new FormData();
  if (Platform.OS === 'web' && asset.file) form.append('file', asset.file, asset.name);
  else {
    // React Native's FormData accepts a { uri, name, type } descriptor for files.
    form.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);
  }
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return { name: asset.name, size: asset.size ?? 0, form };
}

/**
 * Audio and video the server accepts. On the web the picker's filter is built from this list, and iPhone
 * Safari greys out most audio files under a bare `audio/*`, so the exact types and extensions are listed.
 * Android's picker only understands MIME types, so it gets the wildcards.
 */
export const MEDIA_TYPES =
  Platform.OS === 'web'
    ? [
        'audio/*',
        'video/*',
        '.mp3',
        'audio/mpeg',
        '.m4a',
        'audio/mp4',
        'audio/x-m4a',
        'audio/m4a',
        '.aac',
        'audio/aac',
        '.wav',
        'audio/wav',
        'audio/x-wav',
        '.ogg',
        '.oga',
        'audio/ogg',
        '.opus',
        'audio/opus',
        '.flac',
        'audio/flac',
        '.mp4',
        'video/mp4',
        '.m4v',
        '.mov',
        'video/quicktime',
        '.webm',
        'video/webm',
        '.mkv',
      ]
    : ['audio/*', 'video/*'];
export const PDF_TYPES = ['application/pdf'];
