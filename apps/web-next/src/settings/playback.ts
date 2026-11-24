/**
 * 播放器偏好：倍速必须跨集、跨页面重建保持。
 *
 * 只依赖 React state 不够：切集时 xgplayer 会换 media.src，页面重建时
 * 初始化又会回到 1x；这里用 localStorage 做同步兜底，服务端 settings
 * 仍作为跨设备/设置页的最终来源。
 */
const KEY = 'horun-playback-rate';
const MIN_RATE = 0.5;
const MAX_RATE = 4;

/** 规范倍速；非法值回到 1x，避免把 NaN/Infinity 写进 video.playbackRate。 */
export function normalizePlaybackRate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(n * 100) / 100));
}

/** 读取本机最近一次倍速；没有存过返回 null，让调用方回落到服务端默认值。 */
export function readPlaybackRate(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return normalizePlaybackRate(n);
  } catch {
    return null;
  }
}

/** 同步写入本机倍速并返回规范化后的值。 */
export function writePlaybackRate(value: number): number {
  const rate = normalizePlaybackRate(value);
  try {
    localStorage.setItem(KEY, String(rate));
  } catch {
    /* 存储不可用就只在当前页面生效 */
  }
  return rate;
}
