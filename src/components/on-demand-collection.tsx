'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  estimatedItemHeight?: number;
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
  estimatedItemHeight = 720,
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
        <VirtualizedCollectionItem
          key={getKey(item, index)}
          className={itemClassName}
          enabled={expanded}
          estimatedHeight={estimatedItemHeight}
          render={() => renderItem(item, index)}
        />
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

function VirtualizedCollectionItem({
  className,
  enabled,
  estimatedHeight,
  render,
}: {
  className: string;
  enabled: boolean;
  estimatedHeight: number;
  render: () => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!enabled);
  const [measuredHeight, setMeasuredHeight] = useState(estimatedHeight);

  useEffect(() => {
    if (!enabled) return;

    const target = hostRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      const fallbackTimer = window.setTimeout(() => setShouldRender(true), 0);
      return () => window.clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver(
      entries => {
        setShouldRender(entries.some(entry => entry.isIntersecting));
      },
      {
        root: null,
        rootMargin: '1400px 0px',
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled]);

  useLayoutEffect(() => {
    if (!shouldRender) return;
    const target = hostRef.current;
    if (!target) return;

    const updateHeight = () => {
      const nextHeight = Math.ceil(target.getBoundingClientRect().height);
      if (nextHeight > 0) {
        setMeasuredHeight(current => current === nextHeight ? current : nextHeight);
      }
    };

    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={shouldRender ? undefined : { height: `${measuredHeight}px` }}
      data-virtualized-item={enabled ? 'true' : 'false'}
      data-virtualized-rendered={shouldRender ? 'true' : 'false'}
    >
      {shouldRender ? render() : null}
    </div>
  );
}
