import type { ReviewMeta } from '../lib/types';
import type { DiffStyle } from '../theme/diffs';
import {
  IconArrowRight,
  IconBranch,
  IconCaretDown,
  IconChevronRight,
  IconComment,
  IconCommit,
  IconRepo,
  IconSplit,
  IconUnified,
} from './Icons';
import { BasePicker } from './BasePicker';
import { Button, Counts, Kbd, Segmented } from './ui';
import s from './AppHeader.module.css';

interface AppHeaderProps {
  meta: ReviewMeta;
  additions: number;
  deletions: number;
  viewed: number;
  total: number;
  comments: number;
  diffStyle: DiffStyle;
  onDiffStyleChange: (style: DiffStyle) => void;
  /** Switches the base. Without it (the playground), the base shows as a plain label. */
  onPickBase?: (base: string | null) => Promise<void>;
  /** The base picker's menu, opened from here or with B. */
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}

/* Linear-style progress glyph: an outer ring with a pie that fills inside it. */
const PIE_RADIUS = 1.75;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

export function AppHeader({
  meta,
  additions,
  deletions,
  viewed,
  total,
  comments,
  diffStyle,
  onDiffStyleChange,
  onPickBase,
  pickerOpen,
  onPickerOpenChange,
}: AppHeaderProps) {
  const progress = total === 0 ? 0 : viewed / total;
  const baseLabel = (
    <>
      <span className={s.baseName}>{meta.base}</span>
      <IconCaretDown className={s.caret} size="var(--size-icon-xs)" />
    </>
  );

  return (
    <header className={s.header}>
      <div className={s.left}>
        <span className={s.crumb}>
          <IconRepo className={s.repoIcon} />
          {meta.repo}
        </span>
        <IconChevronRight className={s.chevron} size="var(--size-icon-sm)" />
        <span className={s.crumb} title={meta.detached ? `Detached HEAD at ${meta.branch}` : meta.branch}>
          {meta.detached ? <IconCommit className={s.commitIcon} /> : <IconBranch className={s.branchIcon} />}
          <span className={`${s.branchName} ${meta.detached ? s.sha : ''}`}>{meta.branch}</span>
        </span>
        <IconArrowRight className={s.arrow} size="var(--size-icon-sm)" />
        {onPickBase ? (
          <BasePicker
            base={meta.base}
            defaultBase={meta.defaultBase ?? null}
            branch={meta.detached ? null : meta.branch}
            open={pickerOpen}
            onOpenChange={onPickerOpenChange}
            onPick={onPickBase}
            className={s.basePickerRoot}
            triggerClassName={s.basePicker}
          >
            {baseLabel}
          </BasePicker>
        ) : (
          <button type="button" className={`${s.basePicker} ${s.basePickerRoot}`} title="Change base branch (B)">
            {baseLabel}
          </button>
        )}
        <span className={s.totals}>
          <Counts additions={additions} deletions={deletions} />
        </span>
      </div>

      <div className={s.right}>
        <Segmented<DiffStyle>
          label="Diff layout"
          value={diffStyle}
          onChange={onDiffStyleChange}
          options={[
            { value: 'unified', label: <IconUnified />, title: 'Unified (S)' },
            { value: 'split', label: <IconSplit />, title: 'Split (S)' },
          ]}
        />
        <span className={s.divider} />
        <span className={s.progress} aria-label={`${viewed} of ${total} files viewed`}>
          <svg className={`${s.ring} ${progress > 0 ? s.ringActive : ''}`} viewBox="0 0 16 16" aria-hidden="true">
            <circle className={s.ringOuter} cx="8" cy="8" r="6.25" fill="none" strokeWidth="1.5" />
            <circle
              className={s.ringPie}
              cx="8"
              cy="8"
              r={PIE_RADIUS}
              fill="none"
              strokeWidth={PIE_RADIUS * 2}
              strokeDasharray={PIE_CIRCUMFERENCE}
              strokeDashoffset={PIE_CIRCUMFERENCE * (1 - progress)}
            />
          </svg>
          <span>
            <strong>{viewed}</strong> of {total} viewed
          </span>
        </span>
        <Button variant="ghost" title="Comments">
          <IconComment />
          <span className={s.commentCount}>{comments}</span>
        </Button>
        <Button variant="primary" title="Done reviewing (⌘⇧↵)">
          Done reviewing
          <Kbd>⌘⇧↵</Kbd>
        </Button>
      </div>
    </header>
  );
}
