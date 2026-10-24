import { Fragment } from 'react';
import { MOD_LABEL } from '../lib/keys';
import { Dialog } from './Dialog';
import { Kbd } from './ui';
import s from './ShortcutsHelp.module.css';

/** What each key does, grouped as in the review. Keys in a row are alternatives or a pair. */
export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: 'Move around',
    items: [
      { keys: ['J', 'K'], label: 'Next and previous file' },
      { keys: ['N', 'P'], label: 'Next and previous change' },
      { keys: ['U'], label: 'Next updated file' },
      { keys: [MOD_LABEL, 'K'], label: 'Jump to a file' },
    ],
  },
  {
    title: 'Review',
    items: [
      { keys: ['V'], label: 'Mark file as viewed' },
      { keys: ['Z'], label: 'Fold or unfold file' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['S'], label: 'Switch unified and split' },
      { keys: ['['], label: 'Show or hide the file list' },
      { keys: ['B'], label: 'Change base branch' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} className={s.panel}>
      <div className={s.head}>
        <h2 className={s.title}>Keyboard shortcuts</h2>
        <Kbd cap>esc</Kbd>
      </div>
      <div className={s.body}>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className={s.group}>
            <h3 className={s.groupTitle}>{group.title}</h3>
            <dl className={s.list}>
              {group.items.map((item) => (
                <Fragment key={item.label}>
                  <dt className={s.label}>{item.label}</dt>
                  <dd className={s.keys}>
                    {item.keys.map((key) => (
                      <Kbd key={key} cap>
                        {key}
                      </Kbd>
                    ))}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
