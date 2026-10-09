export function canonicalPanelPath(href: string): string;
export function isPanelPath(href: string): boolean;
export const panelRedirects: { source: string; destination: string; kind: 'owner' | 'admin' }[];
export function panelRoute(href: string, kind: 'owner' | 'admin'): { tab: string; id?: string };
