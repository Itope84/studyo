import { Text } from 'react-native';
import { fonts } from '@/theme';
import type { MathTextProps } from './MathText.types';

/** On Android, maths shows as its LaTeX source until a native renderer is added. */
export function MathText({ tex, display, color }: MathTextProps) {
  return (
    <Text style={{ fontFamily: fonts.mono, fontSize: 13, color }}>
      {display ? `\n${tex}\n` : tex}
    </Text>
  );
}
