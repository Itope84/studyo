export type DocMessage =
  | {
      type: 'studyo:ready';
      headings: { id: string; depth: number; text: string }[];
      version?: string;
    }
  | { type: 'studyo:position'; fraction: number; section: string | null };

export interface DocFrameProps {
  url: string;
  onMessage: (msg: DocMessage) => void;
}

export interface DocFrameHandle {
  post: (msg: Record<string, unknown>) => void;
}
