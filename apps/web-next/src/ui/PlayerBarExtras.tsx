import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';

export interface PlayerBarExtrasProps {
  host: HTMLElement;
  episodeCount: number;
  qualities: string[];
  quality: string;
  /** 当前真正在播的画质（自动升清后会变）；不传则只显示档位名 */
  definition?: string;
  danmakuEnabled: boolean;
  danmakuText: string;
  onEpisodes: () => void;
  onQuality: (value: string) => void;
  /** 有值才显示"上一集/下一集"（控制条里和方向键、滚轮共用同一套） */
  onPrev?: () => void;
  onNext?: () => void;
  onToggleDanmaku: () => void;
  onDanmakuText: (value: string) => void;
  onSendDanmaku: () => void;
}

interface QualityOption {
  value: string;
  label: string;
  note: string;
}

/**
 * 清晰度选项。注意这里的文案就是给用户看的：不再出现一个孤零零的「自动」
 * ——播放器里那个位置用户只会理解为"清晰度"，所以按钮直接显示当前画质。
 */
const QUALITY_OPTIONS: QualityOption[] = [
  { value: '', label: '自动', note: '先秒开，高清转好后自动切换' },
  { value: 'smooth', label: '流畅 360p', note: '秒开，最省流量' },
  { value: '480p', label: '标清 480p', note: '需要转码，等一会儿' },
  { value: '720p', label: '高清 720p', note: '需要转码，画质明显更好' },
  { value: '1080p', label: '超清 1080p', note: '最清晰，转码最慢' },
];

export function qualityLabel(value: string): string {
  return QUALITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * 把选集/清晰度/弹幕嵌进 xgplayer 自己的控制条。
 *
 * 清晰度菜单**不挂在这个 portal 里**：控制条内部有 overflow/层叠上下文，
 * 而且不带遮罩时点空白处会直接穿透到视频（暂停/全屏）。所以菜单＋遮罩单独
 * portal 到 document.body，用 fixed 定位贴到按钮上方。
 */
export function PlayerBarExtras({
  host,
  episodeCount,
  qualities,
  quality,
  definition = '',
  danmakuEnabled,
  danmakuText,
  onEpisodes,
  onQuality,
  onPrev,
  onNext,
  onToggleDanmaku,
  onDanmakuText,
  onSendDanmaku,
}: PlayerBarExtrasProps): JSX.Element {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const label = definition !== '' ? definition : qualityLabel(quality);

  const openMenu = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setAnchor({
      left: rect.left,
      right: Math.max(12, window.innerWidth - rect.right),
      bottom: Math.max(12, window.innerHeight - rect.top + 10),
    });
  };

  useEffect(() => {
    if (anchor === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAnchor(null);
    };
    const onResize = (): void => setAnchor(null);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  return createPortal(
    <div className="xg-extras">
      {onPrev !== undefined && (
        <button className="xg-extras__btn" onClick={onPrev} title="上一集（↑ 或滚轮上滚）">
          上一集
        </button>
      )}
      {onNext !== undefined && (
        <button className="xg-extras__btn" onClick={onNext} title="下一集（↓ 或滚轮下滚）">
          下一集
        </button>
      )}
      <button className="xg-extras__btn" onClick={onEpisodes} title="选集">
        选集 {episodeCount > 0 ? `全${episodeCount}集` : ''}
      </button>

      {qualities.length > 0 && (
        <button
          ref={buttonRef}
          type="button"
          className="xg-extras__btn xg-extras__btn--quality"
          aria-haspopup="dialog"
          aria-expanded={anchor !== null}
          title="切换清晰度"
          onClick={() => (anchor === null ? openMenu() : setAnchor(null))}
        >
          {label}
          <span className="xg-extras__caret" aria-hidden="true">
            ⌃
          </span>
        </button>
      )}

      <button className="xg-extras__btn" onClick={onToggleDanmaku} title="弹幕">
        弹幕{danmakuEnabled ? '开' : '关'}
      </button>
      <input
        className="xg-extras__input"
        placeholder="发条弹幕..."
        value={danmakuText}
        onChange={(e) => onDanmakuText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSendDanmaku();
        }}
      />
      <button className="xg-extras__btn" onClick={onSendDanmaku}>
        发送
      </button>

      {anchor !== null &&
        createPortal(
          <>
            <div
              className="xg-quality-mask"
              role="presentation"
              onClick={(event) => {
                event.stopPropagation();
                setAnchor(null);
              }}
            />
            <div
              className="xg-quality"
              role="dialog"
              aria-label="清晰度"
              style={{ left: anchor.left, right: anchor.right, bottom: anchor.bottom }}
            >
              {QUALITY_OPTIONS.filter((o) => o.value === '' || qualities.includes(o.value)).map((option) => {
                const active = option.value === quality;
                return (
                  <button
                    key={option.value === '' ? 'auto' : option.value}
                    type="button"
                    className="xg-quality__item"
                    data-active={active}
                    onClick={() => {
                      setAnchor(null);
                      // 同一档位再点一次也重新发起（高清取不到时可以原地重试）
                      onQuality(option.value);
                    }}
                  >
                    <span className="xg-quality__label">{option.label}</span>
                    <span className="xg-quality__note">{option.note}</span>
                    {active && (
                      <span className="xg-quality__check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>,
    host,
  );
}
