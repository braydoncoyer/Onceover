import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { FileCard } from '../components/FileCard';
import { FileRail } from '../components/FileRail';
import { files, meta, totals } from '../fixtures/diff';
import type { DiffStyle } from '../theme/diffs';
import s from './ReviewView.module.css';

const reviewable = files.filter((file) => file.status !== 'generated');

interface ReviewViewProps {
  initialViewed?: string[];
  initialDiffStyle?: DiffStyle;
  initialRailCollapsed?: boolean;
  initialFile?: string;
}

export function ReviewView({
  initialViewed = [],
  initialDiffStyle = 'unified',
  initialRailCollapsed = false,
  initialFile,
}: ReviewViewProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(initialDiffStyle);
  const [viewed, setViewed] = useState<Set<string>>(() => new Set(initialViewed));
  const [manualCollapsed, setManualCollapsed] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [railCollapsed, setRailCollapsed] = useState(initialRailCollapsed);
  const [currentId, setCurrentId] = useState(files[0].id);
  const scrollRef = useRef<HTMLElement>(null);

  const viewedCount = useMemo(
    () => reviewable.filter((file) => viewed.has(file.id)).length,
    [viewed],
  );

  const setFileViewed = useCallback((id: string, isViewed: boolean) => {
    setViewed((prev) => {
      const next = new Set(prev);
      if (isViewed) next.add(id);
      else next.delete(id);
      return next;
    });
    setManualCollapsed((prev) => ({ ...prev, [id]: isViewed }));
  }, []);

  const select = useCallback((id: string) => {
    setCurrentId(id);
    document.getElementById(`file-${id}`)?.scrollIntoView({ block: 'start' });
  }, []);

  useEffect(() => {
    if (!initialFile) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`file-${initialFile}`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [initialFile]);

  // Highlight the file whose header is at the top of the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top;
      let current = files[0].id;
      for (const file of files) {
        const node = document.getElementById(`file-${file.id}`);
        if (node && node.getBoundingClientRect().top - top <= 48) current = file.id;
      }
      setCurrentId(current);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <AppHeader
        meta={meta}
        additions={totals.additions}
        deletions={totals.deletions}
        viewed={viewedCount}
        total={reviewable.length}
        comments={totals.comments}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
      />
      <div className={s.body}>
        <FileRail
          files={files}
          currentId={currentId}
          viewed={viewed}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((value) => !value)}
          onSelect={select}
        />
        <main ref={scrollRef} className={s.scroll} data-scroll-root>
          <div className={s.stack}>
            {files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                diffStyle={diffStyle}
                viewed={viewed.has(file.id)}
                collapsed={manualCollapsed[file.id] ?? viewed.has(file.id)}
                revealed={revealed.has(file.id)}
                onViewedChange={(value) => setFileViewed(file.id, value)}
                onToggleCollapsed={() =>
                  setManualCollapsed((prev) => ({
                    ...prev,
                    [file.id]: !(prev[file.id] ?? viewed.has(file.id)),
                  }))
                }
                onReveal={() => setRevealed((prev) => new Set(prev).add(file.id))}
              />
            ))}
          </div>
          <div className={s.fade} aria-hidden="true" />
        </main>
      </div>
    </>
  );
}
