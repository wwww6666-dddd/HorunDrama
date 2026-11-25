import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ROUTES } from '../routes.ts';
import { useApp } from '../store.ts';
import {
  IconCategory,
  IconDownload,
  IconFeed,
  IconLibrary,
  IconRank,
  IconSearch,
  IconSettings,
  IconSpark,
  IconTheater,
} from './icons.tsx';

const ICONS = {
  theater: IconTheater,
  feed: IconFeed,
  newreleases: IconSpark,
  rank: IconRank,
  category: IconCategory,
  library: IconLibrary,
  downloads: IconDownload,
  search: IconSearch,
  settings: IconSettings,
} as const;

export function Dock(): JSX.Element {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const [hidden, setHidden] = useState(false);
  /** 推荐页是沉浸式看片，dock 浮在画面上挡内容：闲置自动收起 */
  const [idle, setIdle] = useState(false);
  const dockRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ x: 0, y: 7, w: 0, h: 0, visible: false });

  /** 选中底色用一块独立的滑动胶囊，而不是给每个 item 直接换背景。 */
  const measure = useCallback((): void => {
    const dock = dockRef.current;
    const item = itemRefs.current.get(view);
    if (dock === null || item === undefined) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }
    setIndicator({
      x: item.offsetLeft,
      y: item.offsetTop,
      w: item.offsetWidth,
      h: item.offsetHeight,
      visible: true,
    });
  }, [view]);

  useLayoutEffect(() => {
    measure();
    const dock = dockRef.current;
    if (dock === null) return;
    const raf = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    setHidden(false);
  }, [view]);

  useEffect(() => {
    if (view !== 'feed') {
      setIdle(false);
      return;
    }
    let timer: number | null = null;
    const arm = (): void => {
      setIdle(false);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    arm();
    window.addEventListener('pointermove', arm, { passive: true });
    window.addEventListener('pointerdown', arm, { passive: true });
    window.addEventListener('wheel', arm, { passive: true });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('pointermove', arm);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('wheel', arm);
    };
  }, [view]);

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.app__main');
    if (main === null) return;
    let last = main.scrollTop;
    const onScroll = (): void => {
      const y = main.scrollTop;
      if (y <= 8) {
        setHidden(false);
      } else if (y > last + 6) {
        setHidden(true);
      } else if (y < last - 6) {
        setHidden(false);
      }
      last = y;
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className="dock" aria-label="主导航" data-hidden={hidden} data-idle={idle} ref={dockRef}>
      {indicator.visible && (
        <span
          className="dock__indicator"
          aria-hidden="true"
          style={{
            left: `${indicator.x}px`,
            top: `${indicator.y}px`,
            width: `${indicator.w}px`,
            height: `${indicator.h}px`,
          }}
        />
      )}
      {ROUTES.map((route) => {
        const Icon = ICONS[route.view];
        const active = route.view === view;
        return (
          <button
            key={route.view}
            ref={(el) => {
              if (el === null) itemRefs.current.delete(route.view);
              else itemRefs.current.set(route.view, el);
            }}
            type="button"
            className="dock__item"
            data-active={active}
            aria-current={active ? 'page' : undefined}
            onClick={() => setView(route.view)}
            title={route.label}
          >
            <Icon size={18} />
            <span>{route.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
