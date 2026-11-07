import { Fragment, type ReactNode } from 'react';

/** Renders a sentence that strings.ts returns in parts (text with amounts inside). */
export function parts(nodes: ReactNode[]): ReactNode {
  return nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}
