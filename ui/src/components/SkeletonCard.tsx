import { Skeleton } from './ui';
import s from './SkeletonCard.module.css';

const LINE_WIDTHS = ['42%', '68%', '55%', '74%', '30%', '61%', '48%', '66%', '24%'];

export function SkeletonCard() {
  return (
    <div className={s.card} aria-busy="true" aria-label="Loading diff">
      <div className={s.header}>
        <Skeleton width="var(--space-4)" style={{ height: 'var(--space-4)' }} />
        <Skeleton width="18%" />
        <Skeleton width="24%" style={{ opacity: 0.6 }} />
      </div>
      <div className={s.lines}>
        {LINE_WIDTHS.map((width, index) => (
          <div className={s.line} key={index}>
            <Skeleton width="var(--space-5)" style={{ opacity: 0.5 }} />
            <Skeleton width={width} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonRail() {
  return (
    <div className={s.rail} aria-hidden="true">
      {['78%', '64%', '86%', '58%', '72%'].map((width, index) => (
        <Skeleton key={index} width={width} />
      ))}
    </div>
  );
}
