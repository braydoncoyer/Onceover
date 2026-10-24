import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiRequestError, getBranches, type BranchesResponse } from '../lib/api';
import { IconBranch, IconCheck, IconSearch } from './Icons';
import { Skeleton } from './ui';
import s from './BasePicker.module.css';

interface BasePickerProps {
  /** The base in use, or null when none was found. */
  base: string | null;
  /** The base detection picks. Choosing it goes back to detection rather than pinning it. */
  defaultBase: string | null;
  /** The branch under review, left out of the list. */
  branch: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Switches to `base` (null for the detected one). Rejects with a message to show in the menu. */
  onPick: (base: string | null) => Promise<void>;
  /** The button's contents. */
  children: ReactNode;
  triggerClassName?: string;
  /** Classes for the wrapper, which is the flex item when the picker sits in a row. */
  className?: string;
  /** Where the menu lines up under the button. */
  align?: 'start' | 'center';
}

interface Option {
  ref: string;
  group: 'remote' | 'local';
}

/** A searchable menu of branches to diff against, under the button that opens it. */
export function BasePicker({
  base,
  defaultBase,
  branch,
  open,
  onOpenChange,
  onPick,
  children,
  triggerClassName,
  className,
  align = 'start',
}: BasePickerProps) {
  const [branches, setBranches] = useState<BranchesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Branches are read fresh each time the menu opens.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setQuery('');
    setPickError(null);
    setLoadError(null);
    getBranches(controller.signal)
      .then(setBranches)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    inputRef.current?.focus();
    return () => controller.abort();
  }, [open]);

  const close = useCallback(
    (refocus: boolean) => {
      onOpenChange(false);
      if (refocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  // Clicking anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const options = useMemo(() => {
    if (!branches) return [];
    const needle = query.trim().toLowerCase();
    const keep = (ref: string) => ref !== branch && (!needle || ref.toLowerCase().includes(needle));
    const all: Option[] = [
      ...branches.remote.filter(keep).map((ref) => ({ ref, group: 'remote' as const })),
      ...branches.local.filter(keep).map((ref) => ({ ref, group: 'local' as const })),
    ];
    // The detected base leads its group, so it's easy to go back to.
    return all.sort((a, b) => {
      if (a.group !== b.group) return a.group === 'remote' ? -1 : 1;
      return Number(b.ref === defaultBase) - Number(a.ref === defaultBase);
    });
  }, [branches, query, branch, defaultBase]);

  // Start on the current base, else the first match.
  useEffect(() => {
    const current = options.findIndex((option) => option.ref === base);
    setActive(query || current === -1 ? 0 : current);
  }, [options, base, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = async (ref: string) => {
    if (pending) return;
    if (ref === base) {
      close(true);
      return;
    }
    setPending(ref);
    setPickError(null);
    try {
      await onPick(ref === defaultBase ? null : ref);
      close(true);
    } catch (error) {
      setPickError(pickErrorMessage(ref, error));
    } finally {
      setPending(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) void pick(option.ref);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <span ref={rootRef} className={className ? `${s.root} ${className}` : s.root}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        title="Change base branch (B)"
      >
        {children}
      </button>

      {open && (
        <div className={`${s.menu} ${align === 'center' ? s.center : ''}`} onKeyDown={onKeyDown}>
          <label className={s.search}>
            <IconSearch className={s.searchIcon} size="var(--size-icon-sm)" />
            <input
              ref={inputRef}
              className={s.input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Compare against…"
              aria-label="Find a branch"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={options[active] ? optionId(active) : undefined}
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <div ref={listRef} id={listId} className={s.list} role="listbox" aria-label="Branches">
            {!branches && !loadError && <LoadingRows />}
            {loadError && <p className={s.note}>{loadError}</p>}
            {branches && options.length === 0 && (
              <p className={s.note}>{query ? `No branch matches “${query}”.` : 'No other branches.'}</p>
            )}
            {options.map((option, index) => {
              const first = index === 0 || options[index - 1].group !== option.group;
              return (
                <div key={`${option.group}:${option.ref}`} role="presentation">
                  {first && (
                    <div className={s.group} role="presentation">
                      {option.group === 'remote' ? 'Remote' : 'Local'}
                    </div>
                  )}
                  <div
                    id={optionId(index)}
                    role="option"
                    data-index={index}
                    aria-selected={option.ref === base}
                    className={`${s.option} ${index === active ? s.active : ''}`}
                    onPointerMove={() => setActive(index)}
                    onClick={() => void pick(option.ref)}
                  >
                    <IconBranch className={s.optionIcon} size="var(--size-icon-sm)" />
                    <span className={s.ref}>{option.ref}</span>
                    {option.ref === defaultBase && <span className={s.tag}>Default</span>}
                    <span className={s.check}>
                      {pending === option.ref ? (
                        <span className={s.pending} aria-label="Switching" />
                      ) : (
                        option.ref === base && <IconCheck size="var(--size-icon-sm)" />
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {pickError && (
            <p className={s.error} role="alert">
              {pickError}
            </p>
          )}
          <div className={s.footer}>Your choice is kept for this worktree.</div>
        </div>
      )}
    </span>
  );
}

function LoadingRows() {
  return (
    <div className={s.loading} aria-busy="true">
      {['62%', '48%', '70%', '40%'].map((width) => (
        <div key={width} className={s.loadingRow}>
          <Skeleton width="var(--size-icon-sm)" />
          <Skeleton width={width} />
        </div>
      ))}
    </div>
  );
}

function pickErrorMessage(ref: string, error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'no-merge-base') return `${ref} shares no history with this branch.`;
    if (error.code === 'base-not-found') return `${ref} no longer exists.`;
  }
  return error instanceof Error ? error.message : `Couldn't switch to ${ref}.`;
}
