import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { CAN_PLAY_HEVC } from '../media-support.ts';
import { api, type CommentItem, type DanmakuItem, type FeedItem, type FeedTab, type PlayJob } from '../api.ts';
import { useApp } from '../store.ts';
import { DanmakuLayer } from '../ui/DanmakuLayer.tsx';
import { DramaPlayer } from '../ui/DramaPlayer.tsx';
import { useDanmaku } from '../hooks/useDanmaku.ts';
import { readDanmakuPrefs, writeDanmakuPrefs, type DanmakuPrefs } from '../settings/danmaku.ts';
import { IconDownload } from '../ui/icons.tsx';

function fmtCount(n: number | undefined): string {
  if (n === undefined || n <= 0) return '';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

function fmtCommentTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const TABS: Array<{ name: string; tab: FeedTab }> = [
  { name: '关注', tab: 'follow' },
  { name: '漫剧', tab: 'anime' },
  { name: '真人剧', tab: 'live' },
  { name: '推荐', tab: 'recommend' },
];

/**
 * 推荐流（对标）：一屏一条，上下滑切换，当前条自动播。
 *
 * 和旧版最大的区别：每条会真的起播第一集（core 先转码再出 mp4），
 * 右侧操作栏 / 底部信息 / 顶部推荐分类都按对标的结构摆。
 */
export function Feed(): JSX.Element {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [tab, setTab] = useState<FeedTab>('recommend');
  const [slideDir, setSlideDir] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** 推荐页容器：全屏宿主 + 闲置隐藏的挂载点 */
  const feedRootRef = useRef<HTMLDivElement | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeTimer = useRef<number | null>(null);
  /** 鼠标动一下就唤醒，闲置 2.6 秒后把操作栏/控制条一起收起来（弹幕保留） */
  const wake = useCallback((): void => {
    setChromeVisible(true);
    if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeVisible(false), 2600);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
    };
  }, [wake]);
  const cursorRef = useRef('');
  const loadingRef = useRef(false);
  const noteTimer = useRef<number | null>(null);
  const [commentTarget, setCommentTarget] = useState<FeedItem | null>(null);
  const [commentItems, setCommentItems] = useState<CommentItem[]>([]);
  const [commentCursor, setCommentCursor] = useState('');
  const [commentHasMore, setCommentHasMore] = useState(false);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [replyState, setReplyState] = useState<
    Record<string, { items: CommentItem[]; cursor: string; hasMore: boolean; loading: boolean; open: boolean }>
  >({});
  const account = useApp((s) => s.account);

  const flash = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(''), 2200);
  }, []);

  const loadComments = async (item: FeedItem, cursor = ''): Promise<void> => {
    setCommentLoading(true);
    setCommentError('');
    try {
      const page = await api.comments({
        seriesId: item.seriesId,
        episodeId: item.episodeId,
        cursor,
        count: 20,
      });
      setCommentItems((prev) => (cursor === '' ? page.items : [...prev, ...page.items]));
      setCommentCursor(page.cursor);
      setCommentHasMore(page.hasMore);
      if (cursor === '') setCommentTotal(page.total);
    } catch (err) {
      setCommentError((err as Error).message);
    } finally {
      setCommentLoading(false);
    }
  };

  const openComments = (item: FeedItem): void => {
    setCommentTarget(item);
    setCommentItems([]);
    setCommentCursor('');
    setCommentHasMore(false);
    setCommentError('');
    setCommentText('');
    setCommentTotal(item.commentCount);
    void loadComments(item, '');
  };

  const likeComment = async (item: CommentItem): Promise<void> => {
    const next = !item.liked;
    setCommentItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, liked: next, likeCount: Math.max(0, row.likeCount + (next ? 1 : -1)) }
          : row,
      ),
    );
    try {
      await api.likeComment({ commentId: item.id, liked: next });
    } catch (err) {
      setCommentItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, liked: item.liked, likeCount: item.likeCount } : row,
        ),
      );
      flash(`点赞失败：${(err as Error).message}`);
    }
  };

  const removeComment = async (item: CommentItem): Promise<void> => {
    if (commentTarget === null) return;
    try {
      await api.deleteComment({ commentId: item.id, episodeId: commentTarget.episodeId });
      setCommentItems((prev) => prev.filter((row) => row.id !== item.id));
      setCommentTotal((n) => Math.max(0, n - 1));
      flash('评论已删除');
    } catch (err) {
      setCommentError((err as Error).message);
    }
  };

  const loadReplies = async (item: CommentItem, cursor = ''): Promise<void> => {
    if (commentTarget === null) return;
    setReplyState((prev) => ({
      ...prev,
      [item.id]: {
        items: prev[item.id]?.items ?? [],
        cursor: prev[item.id]?.cursor ?? '',
        hasMore: prev[item.id]?.hasMore ?? false,
        loading: true,
        open: true,
      },
    }));
    try {
      const page = await api.replies({
        seriesId: commentTarget.seriesId,
        episodeId: commentTarget.episodeId,
        commentId: item.id,
        cursor,
      });
      setReplyState((prev) => {
        const current = prev[item.id];
        return {
          ...prev,
          [item.id]: {
            items: cursor === '' ? page.items : [...(current?.items ?? []), ...page.items],
            cursor: page.cursor,
            hasMore: page.hasMore,
            loading: false,
            open: true,
          },
        };
      });
    } catch (err) {
      setCommentError(`回复加载失败：${(err as Error).message}`);
      setReplyState((prev) => ({
        ...prev,
        [item.id]: { items: [], cursor: '', hasMore: false, loading: false, open: false },
      }));
    }
  };

  const toggleReplies = (item: CommentItem): void => {
    const current = replyState[item.id];
    if (current?.open === true) {
      setReplyState((prev) => ({ ...prev, [item.id]: { ...current, open: false } }));
      return;
    }
    if (current !== undefined && current.items.length > 0) {
      setReplyState((prev) => ({ ...prev, [item.id]: { ...current, open: true } }));
      return;
    }
    void loadReplies(item, '');
  };

  const sendComment = async (): Promise<void> => {    const target = commentTarget;
    const text = commentText.trim();
    if (target === null || text === '') return;
    setCommentSending(true);
    setCommentError('');
    try {
      const res = await api.sendComment({
        seriesId: target.seriesId,
        episodeId: target.episodeId,
        text,
      });
      const item: CommentItem = {
        id: res.commentId !== '' ? res.commentId : `local-${Date.now()}`,
        text,
        user: {
          userId: account?.userId ?? '',
          name: account?.nickname !== undefined && account.nickname !== '' ? account.nickname : '我',
          avatar: account?.avatar ?? '',
        },
        likeCount: 0,
        liked: false,
        replyCount: 0,
        createTime: Math.floor(Date.now() / 1000),
        offsetTime: 0,
      };
      setCommentItems((prev) => [item, ...prev]);
      setCommentTotal((n) => n + 1);
      setCommentText('');
    } catch (err) {
      setCommentError((err as Error).message);
    } finally {
      setCommentSending(false);
    }
  };

  const load = useCallback(
    async (reset: boolean, refresh = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (reset) setLoading(true);
      try {
        const res = await api.feed(reset ? '' : cursorRef.current, tab, refresh);
        cursorRef.current = res.cursor;
        setHasMore(res.hasMore);
        setItems((prev) => {
          if (reset) return res.items;
          const seen = new Set(prev.map((item) => item.seriesId));
          return [...prev, ...res.items.filter((item) => !seen.has(item.seriesId))];
        });
        if (reset) {
          setIndex(0);
          window.requestAnimationFrame(() => {
            scrollerRef.current?.scrollTo({ top: 0 });
          });
        }
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setLoadedOnce(true);
        setSwitching(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    setIndex(0);
    cursorRef.current = '';
    scrollerRef.current?.scrollTo({ top: 0 });
    void load(true, false);
  }, [load]);

  const scrollTo = (i: number): void => {
    const el = scrollerRef.current;
    if (el !== null) el.scrollTo({ top: i * el.clientHeight, behavior: 'smooth' });
  };

  const onScroll = (): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    if (i !== index) setIndex(i);
    if (hasMore && i >= items.length - 3) void load(false);
  };

  const next = (): void => {
    if (index + 1 < items.length) scrollTo(index + 1);
    else if (hasMore) void load(false);
  };

  const prev = (): void => {
    if (index > 0) scrollTo(index - 1);
  };

  const removeAt = (i: number): void => {
    setItems((prev) => prev.filter((_, j) => j !== i));
    if (i < index) setIndex((n) => Math.max(0, n - 1));
    flash('已减少此类推荐');
  };

  const handleTab = (next: FeedTab): void => {
    if (next === tab) {
      if (next === 'recommend') {
        void load(true, true);
        scrollerRef.current?.scrollTo({ top: 0 });
      }
      return;
    }
    setSwitching(true);
    document.querySelectorAll<HTMLVideoElement>('.feedv video').forEach((video) => video.pause());
    setSlideDir(
      TABS.findIndex((entry) => entry.tab === next) >= TABS.findIndex((entry) => entry.tab === tab)
        ? 1
        : -1,
    );
    setTab(next);
  };

  if (loading && items.length === 0 && !loadedOnce) {
    return (
      <div className="feedv feedv--state">
        <div className="feedv__spinner" />
        <p>正在准备推荐流…</p>
      </div>
    );
  }

  if (error !== null && items.length === 0 && !loadedOnce) {
    return (
      <div className="feedv feedv--state">
        <p>推荐流加载失败：{error}</p>
        <button className="btn btn--primary" onClick={() => void load(true)}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div
      className="feedv"
      ref={feedRootRef}
      data-chrome-hidden={!chromeVisible}
      onMouseMove={wake}
      onClick={wake}
      onTouchStart={wake}
    >
      <div
        className="feedv__scroller"
        key={tab}
        ref={scrollerRef}
        onScroll={onScroll}
        style={{ ['--slide-dir' as string]: slideDir }}
      >
        {items.map((item, i) => (
          <FeedSlide
            key={item.seriesId}
            item={item}
            active={i === index}
            onPrev={prev}
            onNext={next}
            onNote={flash}
            onRemove={() => removeAt(i)}
            onComments={() => openComments(item)}
            fullscreenHost={() => feedRootRef.current}
          />
        ))}
        {hasMore && (
          <div className="feedv__more">
            <div className="feedv__spinner" />
            <p>继续加载…</p>
          </div>
        )}
        {!hasMore && items.length > 0 && <div className="feedv__more">没有更多了</div>}
        {!loading && items.length === 0 && (
          <div className="feedv__more">
            {tab === 'follow' ? '还没有追更的剧，先去追几部' : '当前分类暂无内容'}
          </div>
        )}
      </div>

      {switching && error === null && (
        <div className="feedv__tab-loading">
          <div className="feedv__spinner" />
          <p>切换中…</p>
        </div>
      )}
      {error !== null && (
        <div className="feedv__tab-loading">
          <p>{error}</p>
          <button className="btn" onClick={() => void load(true)}>
            重试
          </button>
        </div>
      )}

      <div className="feedv__tabs">
        {TABS.map((entry) => (
          <button
            key={entry.tab}
            className="feedv__tab"
            data-active={entry.tab === tab}
            onClick={() => handleTab(entry.tab)}
          >
            {entry.name}
          </button>
        ))}
      </div>

      {commentTarget !== null && (
        <div className="play__comments-mask" role="presentation" onClick={() => setCommentTarget(null)}>
          <aside className="play__comments" role="dialog" aria-label="评论" onClick={(e) => e.stopPropagation()}>
            <header className="play__comments-head">
              <strong>评论</strong>
              <span>{fmtCount(commentTotal) || '0'} 条</span>
              <button className="btn btn--ghost btn--icon" onClick={() => setCommentTarget(null)} aria-label="关闭">
                ✕
              </button>
            </header>
            <div className="play__comment-compose">
              <input
                className="play__comment-input"
                placeholder="说点什么..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendComment();
                }}
              />
              <button
                className="btn btn--primary"
                disabled={commentSending || commentText.trim() === ''}
                onClick={() => void sendComment()}
              >
                {commentSending ? '发送中…' : '发送'}
              </button>
            </div>
            <div className="play__comments-body">
              {commentLoading && commentItems.length === 0 && <p className="play__comments-hint">正在加载评论…</p>}
              {commentError !== '' && <p className="play__comments-hint">加载失败：{commentError}</p>}
              {commentItems.map((item) => {
                const replies = replyState[item.id];
                return (
                  <div className="play__comment-thread" key={item.id}>
                    <article className="play__comment">
                      {item.user.avatar !== '' ? (
                        <img className="play__comment-avatar" src={item.user.avatar} alt="" loading="lazy" />
                      ) : (
                        <span className="play__comment-avatar play__comment-avatar--empty" />
                      )}
                      <div className="play__comment-main">
                        <p className="play__comment-name">{item.user.name}</p>
                        <p className="play__comment-text">{item.text}</p>
                        <p className="play__comment-meta">
                          {fmtCommentTime(item.createTime)}
                          {item.replyCount > 0 && ` · 回复 ${item.replyCount}`}
                        </p>
                        <button
                          className="play__comment-like"
                          data-on={item.liked}
                          onClick={() => void likeComment(item)}
                          aria-label={item.liked ? '取消点赞' : '点赞'}
                        >
                          <span>♥</span>
                          {fmtCount(item.likeCount) || '赞'}
                        </button>
                        {account?.userId === item.user.userId && (
                          <button className="play__comment-del" onClick={() => void removeComment(item)}>
                            删除
                          </button>
                        )}
                      </div>
                    </article>
                    {item.replyCount > 0 && (
                      <div className="play__reply-block">
                        <button className="play__reply-toggle" onClick={() => toggleReplies(item)}>
                          {replies?.open === true
                            ? '收起回复'
                            : replies?.loading === true
                              ? '加载中…'
                              : `展开 ${item.replyCount} 条回复`}
                        </button>
                        {replies?.open === true &&
                          replies.items.map((reply) => (
                            <div className="play__comment play__comment--reply" key={reply.id}>
                              {reply.user.avatar !== '' ? (
                                <img
                                  className="play__comment-avatar play__comment-avatar--small"
                                  src={reply.user.avatar}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                <span className="play__comment-avatar play__comment-avatar--small play__comment-avatar--empty" />
                              )}
                              <div className="play__comment-main">
                                <p className="play__comment-name">{reply.user.name}</p>
                                <p className="play__comment-text">{reply.text}</p>
                              </div>
                            </div>
                          ))}
                        {replies?.open === true && replies.hasMore && (
                          <button
                            className="play__reply-toggle"
                            disabled={replies.loading}
                            onClick={() => void loadReplies(item, replies.cursor)}
                          >
                            {replies.loading ? '加载中…' : '更多回复'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {commentHasMore && (
                <button
                  className="btn btn--ghost play__comments-more"
                  disabled={commentLoading}
                  onClick={() => {
                    if (commentTarget !== null) void loadComments(commentTarget, commentCursor);
                  }}
                >
                  {commentLoading ? '加载中…' : '加载更多'}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {note !== '' && <div className="feedv__toast">{note}</div>}
    </div>
  );
}

interface SlideProps {
  item: FeedItem;
  active: boolean;
  onPrev: () => void;
  onNext: () => void;
  onNote: (text: string) => void;
  onRemove: () => void;
  onComments: () => void;
  /** 全屏宿主：传推荐页容器，全屏后右侧操作栏/弹幕才不会消失 */
  fullscreenHost?: () => HTMLElement | null;
}

function FeedSlide({
  item,
  active,
  onPrev,
  onNext,
  onNote,
  onRemove,
  onComments,
  fullscreenHost,
}: SlideProps): JSX.Element {
  const openDetail = useApp((s) => s.openDetail);
  const [job, setJob] = useState<PlayJob | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [localDanmaku, setLocalDanmaku] = useState<DanmakuItem[]>([]);
  const [danmakuText, setDanmakuText] = useState('');
  const [danmakuPrefs, setDanmakuPrefs] = useState<DanmakuPrefs>(() => readDanmakuPrefs());
  const [time, setTime] = useState(0);
  const [liked, setLiked] = useState(false);
  const [digg, setDigg] = useState(item.diggCount);
  const [favorited, setFavorited] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  /** 清晰度和播放页共用同一个偏好（localStorage: horun-quality） */
  const [quality, setQuality] = useState<string>(() => localStorage.getItem('horun-quality') ?? '1080p');
  const [qualityNonce, setQualityNonce] = useState(0);

  const switchQuality = (next: string): void => {
    setQuality(next);
    setQualityNonce((n) => n + 1);
    if (next === '') localStorage.removeItem('horun-quality');
    else localStorage.setItem('horun-quality', next);
  };

  // 当前条才起播；离开就卸载播放器并取消轮询
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError('');
    setUrl('');
    setJob(null);
    setTime(0);

    void (async () => {
      try {
        let current = await api.play(item.episodeId, quality, true, CAN_PLAY_HEVC, true);
        if (cancelled) return;
        setJob(current);
        while (!cancelled && current.state !== 'ready' && current.state !== 'failed') {
          await sleep(1200);
          if (cancelled) return;
          current = await api.prepare(current.jobId);
          if (cancelled) return;
          setJob(current);
        }
        if (cancelled) return;
        if (current.state === 'ready') setUrl(current.url);
        else setError(current.error !== '' ? current.error : '这一集准备失败');

        // 先播 360p，高清就绪后无缝换源（和播放页同一套逻辑）
        const upgradeId = current.upgradeJobId ?? '';
        if (upgradeId !== '' && current.mode === 'direct') {
          for (let i = 0; i < 80; i += 1) {
            await sleep(1500);
            if (cancelled) return;
            const hd = await api.prepare(upgradeId).catch(() => null);
            if (cancelled || hd === null) return;
            if (hd.state === 'ready') {
              setJob((prev) => (prev === null ? prev : { ...prev, definition: hd.definition, upgradeJobId: '' }));
              setUrl(hd.url);
              return;
            }
            if (hd.state === 'failed') return;
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, item.episodeId, retry, quality, qualityNonce]);

  useEffect(() => {
    setDigg(item.diggCount);
  }, [item.seriesId, item.diggCount]);

  const { items: remoteDanmaku } = useDanmaku({
    seriesId: item.seriesId,
    episodeId: item.episodeId,
    enabled: danmakuPrefs.enabled,
    ready: url !== '',
    timeMs: Math.round(time * 1000),
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`horun-danmaku:${item.episodeId}`);
      setLocalDanmaku(raw === null ? [] : (JSON.parse(raw) as DanmakuItem[]));
    } catch {
      setLocalDanmaku([]);
    }
  }, [item.episodeId]);

  const shownDanmaku = useMemo(
    () => [...remoteDanmaku, ...localDanmaku],
    [remoteDanmaku, localDanmaku],
  );

  const sendDanmaku = async (): Promise<void> => {
    const text = danmakuText.trim();
    if (text === '') return;
    try {
      const res = await api.sendDanmaku({
        seriesId: item.seriesId,
        episodeId: item.episodeId,
        text,
        offsetMs: Math.round(time * 1000),
      });
      const entry: DanmakuItem = {
        id: res.commentId !== '' ? res.commentId : `remote-${Date.now()}`,
        text,
        offsetMs: Math.round(time * 1000),
        likes: 0,
      };
      setLocalDanmaku((prev) => [...prev, entry]);
      setDanmakuText('');
      onNote('弹幕已发送');
    } catch (err) {
      onNote(`弹幕发送失败：${(err as Error).message}`);
    }
  };

  useEffect(() => {
    if (!active) return;
    void api.likeFor(item.seriesId).then((r) => setLiked(r.liked)).catch(() => undefined);
    void api.favoriteFor(item.seriesId).then((r) => setFavorited(r.favorite)).catch(() => undefined);
  }, [active, item.seriesId]);

  const goPlay = (): void => {
    location.hash = `#/play/${item.seriesId}/${item.episodeId}/${item.episodeNo}`;
  };

  const toggleLike = async (): Promise<void> => {
    try {
      const res = await api.toggleLike({
        seriesId: item.seriesId,
        seriesTitle: item.title,
        cover: item.cover,
        episodeCount: item.episodeCount,
        episodeId: item.episodeId,
      });
      setLiked(res.liked);
      setDigg((n) => Math.max(0, n + (res.liked ? 1 : -1)));
    } catch (err) {
      onNote(`点赞失败：${(err as Error).message}`);
    }
  };

  const toggleFavorite = async (): Promise<void> => {
    try {
      const res = await api.toggleFavorite({
        seriesId: item.seriesId,
        seriesTitle: item.title,
        cover: item.cover,
        episodeCount: item.episodeCount,
      });
      setFavorited(res.added);
    } catch (err) {
      onNote(`收藏失败：${(err as Error).message}`);
    }
  };

  const share = async (): Promise<void> => {
    const link = `https://novelquickapp.com/hongguo/ug/pages/video-animation-share?book_id=${item.seriesId}&video_id=${item.episodeId}`;
    try {
      await navigator.clipboard.writeText(link);
      onNote('红果分享链接已复制');
    } catch {
      onNote(link);
    }
  };

  const download = async (): Promise<void> => {
    try {
      await api.addDownloads({
        seriesId: item.seriesId,
        seriesTitle: item.title,
        cover: item.cover,
        episodes: [{ episodeId: item.episodeId, no: item.episodeNo }],
      });
      onNote('已加入下载');
    } catch (err) {
      onNote(`下载失败：${(err as Error).message}`);
    }
  };

  const ready = url !== '';
  const waiting = active && !ready && error === '';

  return (
    <section className={`feedv__slide${active ? ' feedv__slide--active' : ''}`}>
      <div className="feedv__poster" style={{ backgroundImage: `url("${item.cover}")` }} aria-hidden="true" />
      {active && url !== '' && (
        <DramaPlayer
          fullscreenHost={fullscreenHost}
          url={url}
          startAt={0}
          rate={1}
          onPrev={onPrev}
          onNext={onNext}
          onTime={(t) => setTime(t)}
          onPlaying={setPlaying}
          onEnded={onNext}
          onError={(msg) => setError(msg)}
          extras={{
            episodeCount: item.episodeCount,
            qualities: job?.available ?? [],
            quality,
            definition: job?.definition,
            onEpisodes: goPlay,
            onQuality: switchQuality,
            danmakuEnabled: danmakuPrefs.enabled,
            danmakuText,
            onToggleDanmaku: () => setDanmakuPrefs(writeDanmakuPrefs({ enabled: !danmakuPrefs.enabled })),
            onDanmakuText: setDanmakuText,
            onSendDanmaku: () => void sendDanmaku(),
          }}
        />
      )}
      <div className="feedv__shade" aria-hidden="true" />

      {danmakuPrefs.enabled && (
        <DanmakuLayer
          items={shownDanmaku}
          clockMs={Math.round(time * 1000)}
          paused={!playing}
          episodeKey={item.episodeId}
          prefs={danmakuPrefs}
        />
      )}

      {waiting && (
        <div className="feedv__waiting">
          <div className="feedv__spinner" />
          <p>{job?.message ?? '正在准备这一集…'}</p>
          {job !== null && job.state !== 'failed' && (
            <div className="feedv__bar">
              <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {error !== '' && active && (
        <div className="feedv__waiting">
          <p>{error}</p>
          <button
            className="btn"
            onClick={() => {
              setError('');
              setRetry((n) => n + 1);
            }}
          >
            重试
          </button>
        </div>
      )}

      <div className="feedv__rail">
        <button className="feedv__rail-btn" onClick={() => void toggleLike()} title={liked ? '取消点赞' : '点赞'}>
          <span className="feedv__rail-icon" data-on={liked}>
            {liked ? '♥' : '♡'}
          </span>
          <span>点赞</span>
          <b className="feedv__rail-num">{fmtCount(digg)}</b>
        </button>
        <button className="feedv__rail-btn" onClick={onComments} title="评论">
          <span className="feedv__rail-icon">💬</span>
          <span>评论</span>
          <b className="feedv__rail-num">{fmtCount(item.commentCount)}</b>
        </button>
        <button className="feedv__rail-btn" onClick={() => void toggleFavorite()} title={favorited ? '取消收藏' : '收藏'}>
          <span className="feedv__rail-icon" data-on={favorited}>
            {favorited ? '★' : '☆'}
          </span>
          <span>收藏</span>
        </button>
        <button className="feedv__rail-btn" onClick={() => void share()} title="分享">
          <span className="feedv__rail-icon">↗</span>
          <span>分享</span>
        </button>
        <button className="feedv__rail-btn" onClick={() => void download()} title="下载这一集">
          <IconDownload size={20} />
          <span>下载</span>
        </button>
        <button className="feedv__rail-btn" onClick={onRemove} title="不感兴趣">
          <span className="feedv__rail-icon">⊘</span>
          <span>不感兴趣</span>
        </button>
      </div>

      <div className="feedv__info">
        <div className="feedv__badges">
          <span className="feedv__badge">第 {item.episodeNo} 集</span>
          {item.heatText !== '' && <span className="feedv__badge feedv__badge--ghost">{item.heatText}</span>}
          {item.finished && <span className="feedv__badge feedv__badge--ghost">已完结</span>}
        </div>
        <h2 className="feedv__title">{item.title}</h2>
        {item.tags.length > 0 && (
          <div className="feedv__tags">
            {item.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="feedv__tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        <p className={`feedv__intro${introOpen ? ' feedv__intro--open' : ''}`}>{item.intro}</p>
        <div className="feedv__info-actions">
          <button className="btn btn--ghost btn--sm" onClick={() => setIntroOpen((v) => !v)}>
            {introOpen ? '收起' : '展开'}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => openDetail(item.seriesId)}>
            查看详情
          </button>
        </div>
      </div>

    </section>
  );
}
