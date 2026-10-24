import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { IconCheck } from './Icons';
import s from './ui.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'secondary' | 'primary';
  size?: 'md' | 'sm';
  iconOnly?: boolean;
};

export function Button({ variant = 'ghost', size = 'md', iconOnly, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(s.button, s[variant], size === 'sm' && s.small, iconOnly && s.iconOnly, className)}
      {...rest}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={s.segment}
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}

export function Counts({
  additions,
  deletions,
  small,
}: {
  additions: number;
  deletions: number;
  small?: boolean;
}) {
  return (
    <span className={cx(s.counts, small && s.countsSmall)} aria-label={`${additions} added, ${deletions} removed`}>
      <span className={s.added}>+{additions}</span>
      <span className={s.removed}>-{deletions}</span>
    </span>
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'added' | 'removed' | 'renamed' | 'muted';
}) {
  const toneClass = {
    default: undefined,
    added: s.badgeAdded,
    removed: s.badgeRemoved,
    renamed: s.badgeRenamed,
    muted: s.badgeMuted,
  }[tone];
  return <span className={cx(s.badge, toneClass)}>{children}</span>;
}

export function CountBadge({ children }: { children: ReactNode }) {
  return <span className={s.countBadge}>{children}</span>;
}

export function ViewedToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={s.viewed}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title="Mark as viewed (V)"
    >
      <span className={s.box}>
        <IconCheck size="var(--size-icon-xs)" />
      </span>
      Viewed
    </button>
  );
}

export function Skeleton({ width, style }: { width: string; style?: CSSProperties }) {
  return <span className={s.skeleton} style={{ width, ...style }} />;
}
