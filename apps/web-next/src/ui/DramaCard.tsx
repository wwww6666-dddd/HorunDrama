import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { coverOf, type Drama } from '../api.ts';
import { useApp } from '../store.ts';

interface Props {
  drama: Drama;
  rank?: number;
  score?: string;
}

export function DramaCard({ drama, rank, score }: Props): JSX.Element {
  const openDetail = useApp((s) => s.openDetail);
  const ref = useRef<HTMLElement>(null);
  // 搜索接口不给封面：退回按 seriesId 补取（后端带缓存）
  const cover = drama.cover !== '' ? coverOf(drama) : `/api/poster/${drama.seriesId}`;
  const meta = score !== '' && score !== undefined ? score : drama.heatText;

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // 悬停 150ms 预取详情，点开时后端缓存已热
    let prefetchTimer: number | null = null;
    const prefetch = (): void => {
      prefetchTimer = window.setTimeout(() => {
        prefetchTimer = null;
        if (drama.seriesId === '') return;
        void fetch(`/api/series/${drama.seriesId}`).catch(() => undefined);
      }, 150);
    };
    const cancelPrefetch = (): void => {
      if (prefetchTimer !== null) window.clearTimeout(prefetchTimer);
      prefetchTimer = null;
    };

    const onMove = (event: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(1, rect.width);
      const y = (event.clientY - rect.top) / Math.max(1, rect.height);
      el.style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
      el.style.setProperty('--ry', `${(x - 0.5) * 11}deg`);
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
    };
    const onLeave = (): void => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      cancelPrefetch();
    };

    el.addEventListener('pointerenter', prefetch);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelPrefetch();
      el.removeEventListener('pointerenter', prefetch);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <article
      ref={ref}
      className="drama-card"
      tabIndex={0}
      role="button"
      aria-label={drama.title}
      onClick={() => openDetail(drama.seriesId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(drama.seriesId);
        }
      }}
    >
      <div className="drama-card__poster">
        {cover !== '' ? (
          <img src={cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="drama-card__empty" />
        )}
        {rank !== undefined && rank > 0 && <span className="drama-card__rank">{rank}</span>}
        {drama.finished && <span className="drama-card__badge">完结</span>}
      </div>
      <h3 className="drama-card__title">{drama.title}</h3>
      <p className="drama-card__meta">
        {drama.episodeCount > 0 ? `${drama.episodeCount} 集` : '短剧'}
        {meta !== '' && <span> · {meta}</span>}
      </p>
    </article>
  );
}
