export interface SplitPath {
  dir: string;
  name: string;
}

export function splitPath(path: string): SplitPath {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dir: '', name: path };
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

/**
 * Collapses the folders between the first folder and the file name once a
 * path runs past `budget` characters, keeping the file name whole:
 * `app/src/ui/lib/list/section-list.tsx` → `app/…/section-list.tsx`.
 */
export function shortenMiddle(path: string, budget: number): SplitPath {
  const { dir, name } = splitPath(path);
  if (path.length <= budget || !dir) return { dir, name };
  const folders = dir.split('/').filter(Boolean);
  if (folders.length < 2) return { dir, name };
  return { dir: `${folders[0]}/…/`, name };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
