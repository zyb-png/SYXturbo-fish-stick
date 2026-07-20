'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from 'react';

interface OnDemandCollectionProps<T> {
  items: readonly T[];
  expanded: boolean;
  collapsedCount: number;
  batchSize: number;
  getKey: (item: T, index: number) => Key;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  collapsedClassName?: string;
  expandedClassName?: string;
  itemClassName?: string;
}

export function OnDemandCollection<T>({
  ...props
}: OnDemandCollectionProps<T>) {
  // Changing the mode remounts the loading session. Collapsing a long list
  // therefore releases cards that were mounted while scrolling.
  return (
    <OnDemandCollectionSession
      key={props.expanded ? 'expanded' : 'collapsed'}
      {...props}
    />
  );
}

function OnDemandCollectionSession<T>({
  items,
  expanded,
  collapsedCount,
  batchSize,
  getKey,
  renderItem,
  className = '',
  collapsedClassName = '',
  expandedClassName = '',
  itemClassName = '',
}: OnDemandCollectionProps<T>) {
  const collapsedLimit = Math.min(items.length, Math.max(0, collapsedCount));
  const expandedLimit = Math.min(items.length, Math.max(collapsedLimit, batchSize));
  const [expandedVisibleCount, setExpandedVisibleCount] = useState(expandedLimit);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleCount = expanded
    ? Math.min(items.length, Math.max(expandedVisibleCount, expandedLimit))
    : collapsedLimit;

  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  );

  const loadNextBatch = useCallback(() => {
    if (!expanded) return;
    startTransition(() => {
      setExpandedVisibleCount(current => Math.min(items.length, current + batchSize));
    });
  }, [batchSize, expanded, items.length]);

  useEffect(() => {
    if (!expanded || visibleCount >= items.length) return;
    const target = loadMoreRef.current;
    if (!target) return;

    if (typeof IntersectionObserver === 'undefined') {
      const fallbackTimer = window.setTimeout(() => {
        setExpandedVisibleCount(items.length);
      }, 0);
      return () => window.clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) loadNextBatch();
      },
      {
        root: null,
        rootMargin: '500px 0px',
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [expanded, items.length, loadNextBatch, visibleCount]);

  return (
    <div
      className={`${className} ${expanded ? expandedClassName : collapsedClassName}`.trim()}
      data-on-demand-list="true"
      data-rendered-count={visibleItems.length}
      data-total-count={items.length}
    >
      {visibleItems.map((item, index) => (
        <div key={getKey(item, index)} className={itemClassName}>
          {renderItem(item, index)}
        </div>
      ))}
      {expanded && visibleCount < items.length && (
        <div
          ref={loadMoreRef}
          className="col-span-full h-px w-full"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
