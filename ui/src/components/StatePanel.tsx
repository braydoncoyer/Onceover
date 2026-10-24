import type { ReactNode } from 'react';
import s from './StatePanel.module.css';

export function StatePanel({
  icon,
  tone = 'default',
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  tone?: 'default' | 'warning';
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={s.panel} role={tone === 'warning' ? 'alert' : 'status'}>
      <span className={`${s.glyph} ${tone === 'warning' ? s.warning : ''}`}>{icon}</span>
      <h2 className={s.title}>{title}</h2>
      <p className={s.body}>{children}</p>
      {actions && <div className={s.actions}>{actions}</div>}
    </div>
  );
}
