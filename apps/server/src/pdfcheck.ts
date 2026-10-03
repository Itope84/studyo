import { execFile } from 'node:child_process';

/**
 * Does the start of a PDF have a text layer? `false` means it looks scanned (pictures of pages), which Studyo
 * can't read the structure of. `null` means unknown (no `pdftotext` installed, or it failed), so carry on.
 * Checking here costs nothing, where finding out inside an AI run would cost tokens.
 */
export function pdfHasText(path: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile(
      'pdftotext',
      ['-l', '10', path, '-'],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.replace(/\s+/g, '').length >= 200);
      },
    );
  });
}
