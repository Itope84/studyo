import { View } from 'react-native';
import type { UploadProgress } from '@/lib/api';
import { radius, space, useTheme } from '@/theme';
import { Button, Icon, ProgressBar, T } from './ui';

/** A file on its way to the server: progress, speed and a way to stop. */
export function UploadCard({
  name,
  size,
  progress,
  controller,
}: {
  name: string;
  size: number;
  progress: UploadProgress | null;
  controller: AbortController;
}) {
  const { c } = useTheme();
  const total = progress?.total || size;
  const fraction = progress && total ? progress.sent / total : 0;
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const status = !progress
    ? 'Starting…'
    : fraction >= 0.999
      ? 'Saving on the server…'
      : `${Math.round(fraction * 100)}% · ${mb(progress.sent)} of ${mb(total)} · ${mb(progress.rate)}/s`;
  return (
    <View
      style={{
        marginTop: space.md,
        borderRadius: radius.base,
        backgroundColor: c.surface,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="upload-file" size={18} tone="primary" />
        <T variant="label" numberOfLines={1} style={{ flex: 1 }}>
          Uploading {name}
        </T>
        <Button kind="ghost" label="Cancel" onPress={() => controller.abort()} />
      </View>
      <ProgressBar value={fraction} height={3} />
      <T variant="meta" tone="lead">
        {status}
      </T>
    </View>
  );
}
