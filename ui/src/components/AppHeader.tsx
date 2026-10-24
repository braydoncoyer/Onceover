import type { ReviewMeta } from '../fixtures/diff';
import type { DiffStyle } from '../theme/diffs';
import {
  IconArrowRight,
  IconBranch,
  IconCaretDown,
  IconChevronRight,
  IconComment,
  IconRepo,
  IconSplit,
  IconUnified,
} from './Icons';
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
}

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function AppHeader({
  meta,
  additions,
  deletions,
  viewed,
  total,
  comments,
  diffStyle,
  onDiffStyleChange,
}: AppHeaderProps) {
  const progress = total === 0 ? 0 : viewed / total;

  return (
    <header className={s.header}>
      <div className={s.left}>
        <span className={s.crumb}>
          <IconRepo className={s.repoIcon} />
          {meta.repo}
        </span>
        <IconChevronRight className={s.chevron} size="var(--size-icon-sm)" />
        <span className={s.crumb}>
          <IconBranch className={s.branchIcon} />
          <span className={s.branchName}>{meta.branch}</span>
        </span>
        <IconArrowRight className={s.arrow} size="var(--size-icon-sm)" />
        <button type="button" className={s.basePicker} title="Change base branch">
          {meta.base}
          <IconCaretDown size="var(--size-icon-xs)" />
        </button>
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
            { value: 'unified', label: <IconUnified />, title: 'Unified' },
            { value: 'split', label: <IconSplit />, title: 'Split' },
          ]}
        />
        <span className={s.divider} />
        <span className={s.progress} aria-label={`${viewed} of ${total} files viewed`}>
          <svg className={s.ring} viewBox="0 0 16 16" aria-hidden="true">
            <circle className={s.ringTrack} cx="8" cy="8" r={RING_RADIUS} fill="none" strokeWidth="2" />
            <circle
              className={s.ringValue}
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
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
