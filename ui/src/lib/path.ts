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
 * Shortens the folders between the first and last segments so a path fits
 * in `budget` characters, keeping the file name whole:
 * `app/src/ui/lib/list/section-list.tsx` → `app/src/…/section-list.tsx`.
 */
export function shortenMiddle(path: string, budget: number): SplitPath {
  const { dir, name } = splitPath(path);
  if (path.length <= budget || !dir) return { dir, name };

  const folders = dir.split('/').filter(Boolean);
  const kept: string[] = [];
  let length = name.length + '…/'.length;
  for (const folder of folders.slice(0, -1)) {
    if (length + folder.length + 1 > budget) break;
    kept.push(folder);
    length += folder.length + 1;
  }
  if (kept.length === 0) kept.push(folders[0]);
  if (kept.length === folders.length) return { dir, name };
  return { dir: `${kept.join('/')}/…/`, name };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
