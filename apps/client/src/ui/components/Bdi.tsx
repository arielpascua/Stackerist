/**
 * Player names are user input. A name written in a right-to-left script must not reorder the text
 * around it, so every rendered name sits inside a `<bdi>` (bidirectional isolation). `NameSchema` also
 * rejects the invisible direction controls (security review F7), so this is the second layer.
 */
import { Fragment, type ReactNode } from 'react';

/** One player name as a node. */
export function Bdi({ children }: { readonly children: string }) {
  return <bdi>{children}</bdi>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `text` with every occurrence of one of `names` wrapped in `<bdi>`. The visible and copied text is
 * unchanged (only elements are added), so a sentence built by `COPY` stays one sentence.
 */
export function withNames(text: string, names: readonly string[]): ReactNode {
  const unique = [...new Set(names.filter((name) => name !== ''))].sort(
    (a, b) => b.length - a.length,
  );
  if (unique.length === 0) return text;
  const parts = text.split(new RegExp(`(${unique.map(escapeRegExp).join('|')})`));
  return parts.map((part, index) =>
    // Odd indexes are the captured names.
    index % 2 === 1 ? <bdi key={index}>{part}</bdi> : <Fragment key={index}>{part}</Fragment>,
  );
}
