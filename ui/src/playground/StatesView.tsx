import { useState } from 'react';
import { FileCard } from '../components/FileCard';
import { IconCheck, IconSparkle, IconWarning } from '../components/Icons';
import { SkeletonCard, SkeletonRail } from '../components/SkeletonCard';
import { StatePanel } from '../components/StatePanel';
import { Badge, Button, CountBadge, Counts, Kbd, Segmented, ViewedToggle } from '../components/ui';
import { files, meta, type ReviewFile } from '../fixtures/diff';
import s from './StatesView.module.css';

const byId = (id: string) => files.find((file) => file.id === id)!;

const largeFile: ReviewFile = {
  id: 'ride-fixtures',
  path: 'client/src/test/fixtures/rides.generated.ts',
  status: 'modified',
  origin: 'committed',
  additions: 1840,
  deletions: 578,
  comments: 0,
  large: true,
};

const noop = () => {};

export function StatesView() {
  const [viewed, setViewed] = useState(true);
  const [segment, setSegment] = useState<'a' | 'b'>('a');

  return (
    <div className={s.page} data-scroll-root>
      <div className={s.inner}>
        <section className={s.section}>
          <h2 className={s.label}>Loading</h2>
          <div className={s.loading}>
            <div className={s.loadingRail}>
              <SkeletonRail />
            </div>
            <SkeletonCard />
          </div>
        </section>

        <section className={s.section}>
          <h2 className={s.label}>Empty and error</h2>
          <div className={s.grid}>
            <StatePanel icon={<IconSparkle />} title={`Nothing to review against ${meta.base}`}>
              <code>{meta.branch}</code> has no commits, staged, unstaged or new files since it left{' '}
              <code>{meta.base}</code>. Changes show up here as soon as they land.
            </StatePanel>
            <StatePanel
              icon={<IconWarning />}
              tone="warning"
              title="No base branch found"
              actions={
                <>
                  <Button variant="secondary">Choose base branch</Button>
                </>
              }
            >
              Tried <code>origin/HEAD</code>, <code>origin/main</code>, <code>origin/master</code>,{' '}
              <code>main</code> and <code>master</code>. Pick the branch this work started from.
            </StatePanel>
          </div>
        </section>

        <section className={s.section}>
          <h2 className={s.label}>File cards</h2>
          <div className={s.stack}>
            {[byId('lockfile'), byId('dimmed-rows'), byId('route-map'), largeFile].map((file) => (
              <FileCard
                key={file.id}
                file={file}
                diffStyle="unified"
                viewed={false}
                collapsed={false}
                revealed={false}
                onViewedChange={noop}
                onToggleCollapsed={noop}
                onReveal={noop}
              />
            ))}
            <FileCard
              file={byId('status-card')}
              diffStyle="unified"
              viewed={viewed}
              collapsed={viewed}
              revealed={false}
              onViewedChange={setViewed}
              onToggleCollapsed={() => setViewed((value) => !value)}
              onReveal={noop}
            />
          </div>
        </section>

        <section className={s.section}>
          <h2 className={s.label}>Controls</h2>
          <div className={s.controls}>
            <Button variant="primary">
              Done reviewing <Kbd>⌘⇧↵</Kbd>
            </Button>
            <Button variant="primary" disabled>
              Done reviewing
            </Button>
            <Button variant="secondary">Show diff</Button>
            <Button variant="secondary" disabled>
              Show diff
            </Button>
            <Button variant="ghost">Clear comments</Button>
            <Segmented
              label="Example"
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'a', label: 'Unified' },
                { value: 'b', label: 'Split' },
              ]}
            />
            <ViewedToggle checked={false} onChange={noop} />
            <ViewedToggle checked onChange={noop} />
            <Counts additions={34} deletions={18} />
            <CountBadge>9</CountBadge>
            <Badge tone="added">New</Badge>
            <Badge tone="removed">Deleted</Badge>
            <Badge tone="renamed">Renamed</Badge>
            <Badge>Binary</Badge>
            <Badge tone="muted">Uncommitted</Badge>
            <Button variant="ghost" iconOnly aria-label="Viewed">
              <IconCheck />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
