import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

export interface Picked {
  name: string;
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
  return { name: asset.name, form };
}

export const MEDIA_TYPES = ['audio/*', 'video/*'];
export const PDF_TYPES = ['application/pdf'];
