import { useEffect, useRef, useState } from 'react';

/**
 * Reports whether a sticky element is currently stuck. Place the returned
 * sentinel ref on a zero-height element right above the sticky one.
 */
export function useStuck<T extends HTMLElement>(rootMargin = '0px') {
  const sentinel = useRef<T>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const root = node.closest<HTMLElement>('[data-scroll-root]');
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) + 1),
      { root, rootMargin, threshold: [0, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { sentinel, stuck };
}
