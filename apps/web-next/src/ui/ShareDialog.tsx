/**
 * 「分享续播」弹窗。
 *
 * 两个方向：
 *  1. 复制**红果原链接**（book_id/video_id，另挂 no/t 给本软件解析；红果网页会忽略这两个参数）；
 *  2. 粘贴别人分享的红果链接 → 解析出剧/集/秒 → 直接跳过去续播（链接没带 t 就按本地进度）。
 */
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { api } from '../api.ts';
import { copyToClipboard } from '../app-info.ts';
import { playHash, parsePlay } from '../routes.ts';
import { useApp } from '../store.ts';
import { hongguoShareLink, parseSharedLink } from '../share.ts';

export function ShareDialog(): JSX.Element | null {
  const open = useApp((s) => s.shareOpen);
  const closeShare = useApp((s) => s.closeShare);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 「当前这一集」那个只读输入框：复制被拒时用它兜底选中 */
  const linkRef = useRef<HTMLInputElement | null>(null);
  /** 当前播放页信息（在播放页打开时才能"分享这一集"） */
  const [current, setCurrent] = useState<{ seriesId: string; episodeId: string; no: number; at: number } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const route = parsePlay(location.hash);
    const video = document.querySelector('video');
    const at = video !== null && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    setCurrent(route === null ? null : { seriesId: route.seriesId, episodeId: route.episodeId, no: route.no, at });
    setText('');
    setNote('');
    setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeShare();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeShare]);

  if (!open) return null;

  const copyCurrent = (): void => {
    if (current === null) return;
    const at = current.at > 3 ? current.at : 0;
    const link = hongguoShareLink(current.seriesId, current.episodeId, current.no, at);
    void copyToClipboard(link).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
        return;
      }
      // 这个环境不让写剪贴板：选中文本让用户自己 Ctrl+C
      linkRef.current?.focus();
      linkRef.current?.select();
      setNote('这个环境不让自动复制，已选中链接，按 Ctrl+C 复制即可。');
    });
  };

  const openShared = async (): Promise<void> => {
    const parsed = parseSharedLink(text);
    if (parsed === null) {
      setNote('认不出这个链接。请粘贴红果 App 里「分享 → 复制链接」得到的那条。');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      let no = parsed.no;
      if (no <= 0) {
        // 链接里没带集号：拿剧集列表按 episodeId 反查
        const detail = await api.series(parsed.seriesId);
        const hit = detail.episodes.find((ep) => ep.episodeId === parsed.episodeId);
        if (hit === undefined) throw new Error('这部剧里找不到这一集（可能已下架）');
        no = hit.no;
      }
      closeShare();
      location.hash = playHash(parsed.seriesId, parsed.episodeId, no, parsed.startAt);
    } catch (err) {
      setNote(`打开失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const currentLink =
    current === null ? '' : hongguoShareLink(current.seriesId, current.episodeId, current.no, current.at);

  return (
    <div className="sharedlg" role="dialog" aria-modal="true" aria-label="分享续播">
      <button className="sharedlg__mask" aria-label="关闭" onClick={closeShare} />
      <div className="sharedlg__card">
        <header className="sharedlg__head">
          <div>
            <h2 className="sharedlg__title">分享续播</h2>
            <p className="sharedlg__sub">
              分享的是红果原链接；对方把链接粘回这里，就能从你看到的这一秒接着播。
            </p>
          </div>
          <button className="sharedlg__close" onClick={closeShare} aria-label="关闭">
            ✕
          </button>
        </header>

        <section className="sharedlg__block">
          <p className="sharedlg__label">当前这一集</p>
          {current === null ? (
            <p className="sharedlg__hint">先在播放页打开一集，再回来点这里。</p>
          ) : (
            <>
              <div className="sharedlg__row">
                <input
                  className="sharedlg__input"
                  ref={linkRef}
                  readOnly
                  value={currentLink}
                  onFocus={(e) => e.target.select()}
                />
                <button className="sharedlg__btn sharedlg__btn--primary" onClick={copyCurrent}>
                  {copied ? '已复制' : '复制链接'}
                </button>
              </div>
              <p className="sharedlg__hint">
                第 {current.no} 集 · 从 {fmt(current.at)} 开始；链接里的 <code>no</code>/<code>t</code> 只给本软件解析，
                红果官方打开时按原样生效。
              </p>
            </>
          )}
        </section>

        <section className="sharedlg__block">
          <p className="sharedlg__label">打开别人分享的链接</p>
          <div className="sharedlg__row">
            <input
              className="sharedlg__input"
              placeholder="粘贴红果分享链接，或 #/play/… 链接"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void openShared();
              }}
            />
            <button
              className="sharedlg__btn sharedlg__btn--primary"
              disabled={busy || text.trim() === ''}
              onClick={() => void openShared()}
            >
              {busy ? '打开中…' : '打开并续播'}
            </button>
          </div>
        </section>

        {note !== '' && <p className="sharedlg__note">{note}</p>}

        <p className="sharedlg__foot">软件本身没有服务器，链接内容和红果原生分享一致，不经过任何中转。</p>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '从头开始';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
