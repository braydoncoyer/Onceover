import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { splitPath } from '../lib/path';
import { hasLineCounts, type ReviewFile } from '../lib/types';
import { Dialog } from './Dialog';
import { FileTypeIcon, IconCheck, IconSearch, IconStatus } from './Icons';
import { Counts, Kbd } from './ui';
import s from './FileFinder.module.css';

interface Match {
  file: ReviewFile;
  score: number;
  /** Where the query sits in the file name, to underline it. */
  nameRange: [number, number] | null;
}

/** Ranks a file for the query: name first, then the whole path, then letters in order. */
function match(file: ReviewFile, needle: string): Match | null {
  if (!needle) return { file, score: 0, nameRange: null };
  const { name } = splitPath(file.path);
  const lowerName = name.toLowerCase();
  const lowerPath = file.path.toLowerCase();
  const at = lowerName.indexOf(needle);
  if (at !== -1) return { file, score: at === 0 ? 4 : 3, nameRange: [at, at + needle.length] };
  if (lowerPath.includes(needle)) return { file, score: 2, nameRange: null };
  let index = 0;
  for (const char of lowerPath) if (char === needle[index]) index++;
  return index === needle.length ? { file, score: 1, nameRange: null } : null;
}

/** ⌘K: a searchable list of every changed file. Picking one scrolls to it. */
export function FileFinder({
  files,
  viewed,
  currentId,
  onPick,
  onClose,
}: {
  files: ReviewFile[];
  viewed: Set<string>;
  currentId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase().replace(/\s+/g, '');
  const matches = useMemo(
    () =>
      files
        .map((file) => match(file, needle))
        .filter((item): item is Match => item !== null)
        .sort((a, b) => b.score - a.score),
    [files, needle],
  );
  const [active, setActive] = useState(() => Math.max(0, files.findIndex((file) => file.id === currentId)));
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // A new query starts from the best match.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    setActive(0);
  }, [needle]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (index: number) => {
    const item = matches[index];
    if (!item) return;
    onClose();
    onPick(item.file.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (event.ctrlKey && (event.key === 'n' || event.key === 'p'))) {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' || event.key === 'n' ? 1 : -1;
      setActive((index) => (index + step + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(active);
    }
  };

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <Dialog label="Jump to file" onClose={onClose} onKeyDown={onKeyDown}>
      <label className={s.search}>
        <IconSearch className={s.searchIcon} />
        <input
          className={s.input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to file…"
          aria-label="Find a changed file"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matches[active] ? optionId(active) : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <span className={s.total}>
          {matches.length === files.length ? `${files.length} files` : `${matches.length} of ${files.length}`}
        </span>
      </label>

      <div ref={listRef} id={listId} className={s.list} role="listbox" aria-label="Changed files">
        {matches.length === 0 && <p className={s.note}>No changed file matches “{query.trim()}”.</p>}
        {matches.map((item, index) => {
          const { file } = item;
          const { dir, name } = splitPath(file.path);
          const isViewed = viewed.has(file.id);
          return (
            <div
              key={file.id}
              id={optionId(index)}
              role="option"
              data-index={index}
              aria-selected={index === active}
              className={`${s.option} ${isViewed ? s.isViewed : ''}`}
              onPointerMove={() => setActive(index)}
              onClick={() => pick(index)}
            >
              <span className={s.icon}>
                <FileTypeIcon path={file.path} size="var(--size-icon-sm)" />
              </span>
              <span className={s.path}>
                <span className={s.name}>{highlight(name, item.nameRange)}</span>
                {dir && (
                  <span className={s.dir}>
                    <bdi>{dir.replace(/\/$/, '')}</bdi>
                  </span>
                )}
              </span>
              {file.id === currentId && <span className={s.here}>Current</span>}
              {hasLineCounts(file) && (
                <span className={s.counts}>
                  <Counts small additions={file.additions} deletions={file.deletions} />
                </span>
              )}
              <span className={`${s.status} ${isViewed ? s.viewedCheck : s[`status-${file.status}`]}`}>
                {isViewed ? (
                  <IconCheck size="var(--size-icon-sm)" />
                ) : (
                  <IconStatus status={file.status} size="var(--size-icon-sm)" />
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className={s.footer}>
        <span className={s.hint}>
          <Kbd cap>↑</Kbd>
          <Kbd cap>↓</Kbd>
          to move
        </span>
        <span className={s.hint}>
          <Kbd cap>↵</Kbd>
          to open
        </span>
        <span className={s.hint}>
          <Kbd cap>esc</Kbd>
          to close
        </span>
      </div>
    </Dialog>
  );
}

function highlight(text: string, range: [number, number] | null): ReactNode {
  if (!range) return text;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className={s.mark}>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}
