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
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${bytes} B`;
  if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** `+3.6 KB`, `−120 B`, or null when nothing changed. */
export function formatByteDelta(before: number, after: number): string | null {
  const delta = after - before;
  if (delta === 0) return null;
  return `${delta > 0 ? '+' : '\u2212'}${formatBytes(Math.abs(delta))}`;
}

const MODE_NAMES: Record<string, string> = {
  '100644': 'file',
  '100755': 'executable',
  '120000': 'symlink',
  '160000': 'submodule',
  '040000': 'folder',
};

/** A git file mode in words: `100755` → `executable`. */
export function modeName(mode: string): string {
  return MODE_NAMES[mode] ?? mode;
}
