import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import Player from 'xgplayer';
import 'xgplayer/dist/index.min.css';

export interface XgPlayerProps {
  url: string;
  startAt: number;
  rate: number;
  /** xgplayer 自带倍速菜单改动后回传，避免只改播放器内部、React 仍停在旧速率 */
  onRate?: (value: number) => void;
  onReady?: (player: Player) => void;
  onTime?: (time: number, duration: number) => void;
  onEnded?: () => void;
  onPlaying?: (playing: boolean) => void;
  onError?: (message: string) => void;
  /** xgplayer 自带全屏按钮作用的目标（页面容器）；不传就是播放器本身 */
  fullscreenTarget?: () => HTMLElement | null;
}

/**
 * 播放器内核：直接用 xgplayer 的控制条/进度条/音量/倍速/画中画/全屏。
 * 我们只保留自己的外层壳（标题、右侧操作栏、弹幕层）。
 */
export function XgPlayer({
  url,
  startAt,
  rate,
  onRate,
  onReady,
  onTime,
  onEnded,
  onPlaying,
  onError,
  fullscreenTarget,
}: XgPlayerProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const startRef = useRef(startAt);
  startRef.current = startAt;

  // 回调全部走 ref 转发**最新一次渲染**的版本。
  // 播放器实例只在挂载时创建一次（换集不重建，画中画/全屏才保得住），
  // 事件监听里如果直接用创建时的闭包，就会一直调用"第一集那次渲染"的函数：
  // 自动下一集用它算 `当前集 + 1`，永远算回第一集的下一集，
  // 从第二集开始播完就再也切不动（只剩「重播」）。
  const cbs = useRef({ rate, onRate, onReady, onTime, onEnded, onPlaying, onError });
  cbs.current = { rate, onRate, onReady, onTime, onEnded, onPlaying, onError };

  /** 首次创建时用的地址；之后的换集走 src 原地切换 */
  const firstUrl = useRef(url);
  const created = useRef(false);
  /** 换源后需要恢复起播位置/倍速（只做一次，且必须对应当前这次换源） */
  const loadSeq = useRef(0);
  const pendingSeq = useRef(0);

  useEffect(() => {
    if (host.current === null || firstUrl.current === '' || created.current) return;
    created.current = true;
    const player = new Player({
      el: host.current,
      url: firstUrl.current,
      width: '100%',
      height: '100%',
      autoplay: false,
      playsinline: true,
      pip: true,
      download: false,
      mini: false,
      screenShot: false,
      rotate: false,
      playbackRate: [0.75, 1, 1.25, 1.5, 2],
      fullscreen: true,
      cssFullscreen: true,
      // 全屏作用在页面容器上：右侧点赞/评论/收藏栏、弹幕层、简介都在容器里，
      // 否则它们会在播放器子树外面，一全屏就消失
      ...(fullscreenTarget?.() ? { fullscreenTarget: fullscreenTarget() as HTMLElement } : {}),
      keyShortcut: true,
      volume: 0.9,
      lang: 'zh',
      closeVideoClick: true,
      closeVideoDblclick: true,
    });
    playerRef.current = player;
    const mediaEl = player.media as HTMLVideoElement | null;

    /**
     * 换源时 media 会重新加载，部分浏览器/内核会把 playbackRate 归到 1x。
     * 不能只依赖 xgplayer 的 canplay 回调（它有时先于我们的恢复逻辑触发），
     * 所以直接在 media 的 loadedmetadata/canplay/playing 三个阶段补一次。
     * 只在 pendingSeq（刚换集且 seq 对应）期间做，避免用户手动切倍速后被覆盖。
     */
    const restorePendingRate = (): void => {
      if (pendingSeq.current === 0 || pendingSeq.current !== loadSeq.current || mediaEl === null) return;
      const next = cbs.current.rate;
      try {
        mediaEl.defaultPlaybackRate = next;
        mediaEl.playbackRate = next;
      } catch {
        /* 忽略倍速恢复失败 */
      }
    };
    mediaEl?.addEventListener('loadedmetadata', restorePendingRate);
    mediaEl?.addEventListener('canplay', restorePendingRate);
    mediaEl?.addEventListener('playing', restorePendingRate);

    /** xgplayer 自带倍速菜单修改的是 player.playbackRate，必须回传给 React 状态。 */
    const reportRate = (): void => {
      // 换源加载期间可能短暂触发 ratechange（默认速率），此时不能把它当成用户操作。
      if (pendingSeq.current !== 0) return;
      const media = player.media as HTMLVideoElement | null;
      const next = media?.playbackRate;
      if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return;
      if (Math.abs(next - cbs.current.rate) > 0.001) cbs.current.onRate?.(next);
    };
    player.on('ratechange', reportRate);

    // 注意：单击/双击不在这里处理。DramaPlayer 已经在容器上做了
    // （带 target 过滤），两边都绑会导致"双击进全屏又立刻退出/暂停"。
    // 这里只保留音量滚轮。
    let wheelBound = false;
    const onWheel = (event: WheelEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target === null || target.closest('.xgplayer-volume, .xgplayer-slider') === null) return;
      event.preventDefault();
      event.stopPropagation();
      const media = player.media as HTMLVideoElement | null;
      if (media === null) return;
      const current = media.muted ? 0 : media.volume;
      const next = Math.min(1, Math.max(0, current + (event.deltaY < 0 ? 0.05 : -0.05)));
      media.muted = next === 0;
      media.volume = next;
    };
    const bindWheel = (): void => {
      if (wheelBound || player.root === null) return;
      wheelBound = true;
      player.root.addEventListener('wheel', onWheel, { passive: false });
    };

    const applyPlayback = (): void => {
      const at = startRef.current;
      if (at > 1) {
        try {
          player.currentTime = at;
        } catch {
          /* 忽略 seek 失败 */
        }
      }
      try {
        player.playbackRate = cbs.current.rate;
      } catch {
        /* 忽略倍速失败 */
      }
      void player.play().catch(() => undefined);
    };

    let started = false;
    const seekStart = (): void => {
      if (started) return;
      started = true;
      pendingSeq.current = 0;
      applyPlayback();
      cbs.current.onReady?.(player);
      bindWheel();
    };

    // 只在两种情况下恢复起播位置：首次 canplay、换源后的第一次 canplay。
    // 不能每次 canplay 都 seek，否则用户拖进度条会被拉回去。
    // 快速连切时，旧 URL 的 canplay 可能晚到；用 loadSeq 校验，避免它
    // 消费掉新集的 pendingApply，导致新集不 seek / 不自动播放。
    const onCanPlay = (): void => {
      if (started) {
        if (pendingSeq.current !== 0 && pendingSeq.current === loadSeq.current) {
          pendingSeq.current = 0;
          applyPlayback();
        }
        return;
      }
      seekStart();
    };

    // 新源真正开始加载时才把序号落到 pendingSeq；旧源的 canplay 早于
    // loadstart，因此不会消费新集的恢复状态。
    const onLoadStart = (): void => {
      if (loadSeq.current !== 0) pendingSeq.current = loadSeq.current;
    };
    mediaEl?.addEventListener('loadstart', onLoadStart);

    player.on('canplay', onCanPlay);
    player.on('timeupdate', () => {
      const onTime = cbs.current.onTime;
      onTime?.(player.currentTime, Number.isFinite(player.duration) ? player.duration : 0);
    });
    player.on('ended', () => cbs.current.onEnded?.());
    player.on('play', () => cbs.current.onPlaying?.(true));
    player.on('pause', () => cbs.current.onPlaying?.(false));
    player.on('error', () => {
      const media = player.media as HTMLVideoElement | null;
      cbs.current.onError?.(media?.error?.message ?? '播放失败');
    });

    return () => {
      player.root?.removeEventListener('wheel', onWheel, false);
      mediaEl?.removeEventListener('loadstart', onLoadStart);
      mediaEl?.removeEventListener('loadedmetadata', restorePendingRate);
      mediaEl?.removeEventListener('canplay', restorePendingRate);
      mediaEl?.removeEventListener('playing', restorePendingRate);
      player.off('ratechange', reportRate);
      playerRef.current = null;
      try {
        player.destroy();
      } catch {
        /* 已销毁 */
      }
      // React StrictMode（开发态）会把 effect 跑两遍：setup → cleanup → setup。
      // 如果这里不把 created 复位，第二次 setup 会以为"已经创建过"直接 return，
      // 结果就是开发环境播放器永远不出现（生产构建不会双跑，所以以前没暴露）。
      created.current = false;
    };
    // 只在卸载时销毁；换集不会走到这里
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 换集：原地换**媒体元素**的 src，元素本身不重建 → 画中画、全屏都保留。
  // 之前用的是 player.src 赋值，但播放器已经处于 ended 状态时它会忽略这次赋值，
  // 表现就是"自动下一集切了路由，画面却停在上一集的『重播』按钮上"。
  useEffect(() => {
    const player = playerRef.current;
    if (player === null || url === '') return;
    const media = player.media as HTMLVideoElement | null;
    if (media === null) return;
    const current = media.getAttribute('src') ?? '';
    if (current === url) return;
    // 换源序号在 loadstart 时才落到 pendingSeq：旧源的 canplay 可能晚到，
    // 但它一定早于新源的 loadstart，这样就不会消费新集的恢复状态。
    loadSeq.current += 1;
    // 先把 defaultPlaybackRate 设好，再 load；否则新 media 的默认速率可能回到 1x。
    try {
      const nextRate = cbs.current.rate;
      media.defaultPlaybackRate = nextRate;
      media.playbackRate = nextRate;
    } catch {
      /* 忽略 */
    }
    try {
      player.pause();
    } catch {
      /* 忽略 */
    }
    try {
      media.src = url;
      media.load();
      // 同时驱动播放器状态机：否则 ended 状态里的"重播"浮层可能还留着
      try {
        player.play();
      } catch {
        /* 忽略 */
      }
      void media.play().catch(() => undefined);
    } catch {
      /* 忽略 */
    }
  }, [url]);

  useEffect(() => {
    const player = playerRef.current;
    if (player !== null) {
      try {
        player.playbackRate = rate;
      } catch {
        /* 忽略 */
      }
    }
  }, [rate]);

  return <div className="xg-host" ref={host} />;
}
