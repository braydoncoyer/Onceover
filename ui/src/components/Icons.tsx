import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function Svg({ size = 'var(--size-icon)', children, ...rest }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ width: size, height: size, flexShrink: 0 }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBranch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5" r="1.5" />
    <path d="M4.5 5v6M11.5 6.5c0 2.5-2 3.5-4.5 3.8-1.3.2-2.1.6-2.5 1.2" />
  </Svg>
);

export const IconRepo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.5V3.2c0-.66.54-1.2 1.2-1.2h7.8v9.5H4.8c-.72 0-1.3.58-1.3 1.3 0 .72.58 1.2 1.3 1.2h7.7" />
    <path d="M6 2v5.2l1.25-.9 1.25.9V2" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 4l4 4-4 4" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5l4 4 4-4" />
  </Svg>
);

export const IconCaretDown = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M4.6 6.5h6.8c.4 0 .6.47.33.76l-3.4 3.6a.45.45 0 0 1-.66 0l-3.4-3.6c-.27-.29-.07-.76.33-.76Z" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p} strokeWidth="1.6">
    <path d="M3.5 8.4 6.6 11.4 12.5 4.8" />
  </Svg>
);

export const IconComment = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.75 4.25c0-.83.67-1.5 1.5-1.5h7.5c.83 0 1.5.67 1.5 1.5v5.5c0 .83-.67 1.5-1.5 1.5H7l-2.75 2.25v-2.25h0c-.83 0-1.5-.67-1.5-1.5v-5.5Z" />
  </Svg>
);

export const IconSidebar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="2" />
    <path d="M6 2.75v10.5" />
  </Svg>
);

export const IconUnified = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5 6h6M5 8.5h6M5 11h4" />
  </Svg>
);

export const IconSplit = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M8 2.5v11" />
  </Svg>
);

export const IconExpand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
  </Svg>
);

export const IconCollapse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l3 3 3-3M5 13l3-3 3 3" />
  </Svg>
);

export const IconPlusCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5.5v5M5.5 8h5" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <circle cx="6" cy="6.5" r="1" />
    <path d="m3 11.5 3.2-2.8 2.3 1.8 1.8-1.4 3.2 2.4" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.13 2.75a1 1 0 0 1 1.74 0l5.2 9.25a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5l5.2-9.25Z" />
    <path d="M8 6.5v2.75M8 11.25h0" />
  </Svg>
);

export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5 9.2 6.8 13.5 8l-4.3 1.2L8 13.5 6.8 9.2 2.5 8l4.3-1.2L8 2.5Z" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.25 3.25" />
  </Svg>
);

/** Status glyph for a changed file: a rounded square with a mark inside. */
export function IconStatus({
  status,
  ...p
}: IconProps & { status: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary' | 'generated' }) {
  return (
    <Svg {...p}>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" />
      {status === 'added' && <path d="M8 5.75v4.5M5.75 8h4.5" />}
      {status === 'deleted' && <path d="M5.75 8h4.5" />}
      {status === 'renamed' && <path d="M5.5 8h5M8.75 6l1.75 2-1.75 2" />}
      {(status === 'modified' || status === 'binary' || status === 'generated') && (
        <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      )}
    </Svg>
  );
}

/** Small language badge in the spirit of the Linear mockup's TS icon. */
export function FileTypeIcon({ path, size = 'var(--size-icon)' }: { path: string; size?: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png' || ext === 'jpg' || ext === 'gif' || ext === 'webp') return <IconImage size={size} />;
  if (path.endsWith('lock.json') || path.endsWith('.lock') || path.endsWith('lock.yaml')) {
    return <IconLock size={size} />;
  }
  const label = ext === 'tsx' ? 'TSX' : ext === 'ts' ? 'TS' : ext === 'json' ? '{}' : ext.slice(0, 3).toUpperCase();
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="currentColor" />
      <text
        x="13"
        y="12.6"
        textAnchor="end"
        fontFamily="var(--font-ui)"
        fontSize={label.length > 2 ? 4.6 : 5.6}
        fontWeight="700"
        letterSpacing="-0.02em"
        fill="var(--color-surface)"
      >
        {label}
      </text>
    </svg>
  );
}
