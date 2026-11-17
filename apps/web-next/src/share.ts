/**
 * 「分享续播」的链接工具。
 *
 * 约定：分享出去的是**红果原生落地页链接**（对标客户端里那个 video-animation-share），
 * 它能被红果官方 App/网页直接打开；我们再额外挂两个参数：
 *
 *   &no=<集号>&t=<秒>
 *
 * 红果网页会忽略不认识的 query 参数，所以链接仍然"原样可用"；
 * 而本软件粘贴解析时会读到 no/t，直接跳到那一集的对应秒数续播。
 */

export interface SharedRef {
  seriesId: string;
  episodeId: string;
  /** 集号；链接里没带就是 0（调用方自己去剧集列表里查） */
  no: number;
  /** 起播秒数；0 = 按本地进度续播 */
  startAt: number;
}

const HONGUO_SHARE = 'https://novelquickapp.com/hongguo/ug/pages/video-animation-share';

/** 生成红果原链接（带 no/t 供本软件解析）。 */
export function hongguoShareLink(seriesId: string, episodeId: string, no: number, at = 0): string {
  const params = new URLSearchParams({ book_id: seriesId, video_id: episodeId });
  if (no > 0) params.set('no', String(no));
  if (at > 0) params.set('t', at.toFixed(1));
  return `${HONGUO_SHARE}?${params.toString()}`;
}

/** 从 query 里取第一个命中的键（大小写/下划线/驼峰都容忍）。 */
function pick(params: URLSearchParams, keys: string[]): string {
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== '') return value;
  }
  return '';
}

/** 只看数字 ID：红果的 19 位 ID 必须当字符串用 */
function id(raw: string): string {
  const m = /\d{6,25}/.exec(raw);
  return m === null ? '' : m[0];
}

/**
 * 解析粘贴进来的文本，返回剧/集/位置；认不出返回 null。
 *
 * 支持三种形态：
 *  1. 红果分享链接（book_id/video_id，可带 no/t）
 *  2. 本软件自己的 hash 路由 `#/play/<sid>/<eid>/<no>?t=`
 *  3. 只有一串 `seriesId episodeId no` 的裸文本（顺手支持）
 */
export function parseSharedLink(raw: string): SharedRef | null {
  const text = raw.trim();
  if (text === '') return null;

  // 1) 我们自己的 hash 路由
  const hash = /#\/play\/(\d{6,25})\/(\d{6,25})\/(\d{1,4})(?:\?[^#]*?\bt=([\d.]+))?/.exec(text);
  if (hash !== null) {
    const t = Number.parseFloat(hash[4] ?? '0');
    return {
      seriesId: hash[1] ?? '',
      episodeId: hash[2] ?? '',
      no: Number.parseInt(hash[3] ?? '1', 10),
      startAt: Number.isFinite(t) ? Math.max(0, t) : 0,
    };
  }

  // 2) 红果分享链接（query 参数）
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : '';
  if (query !== '') {
    const params = new URLSearchParams(query.split('#')[0] ?? '');
    const seriesId = id(
      pick(params, ['book_id', 'bookId', 'series_id', 'seriesId', 'book', 'series']),
    );
    const episodeId = id(
      pick(params, ['video_id', 'videoId', 'episode_id', 'episodeId', 'video', 'episode']),
    );
    if (seriesId !== '' && episodeId !== '') {
      const noRaw = Number.parseInt(pick(params, ['no', 'episode_no', 'episodeNo', 'index']) || '0', 10);
      const tRaw = Number.parseFloat(pick(params, ['t', 'at', 'from', 'position', 'start']) || '0');
      return {
        seriesId,
        episodeId,
        no: Number.isFinite(noRaw) && noRaw > 0 ? noRaw : 0,
        startAt: Number.isFinite(tRaw) && tRaw > 0 ? tRaw : 0,
      };
    }
  }

  // 3) 裸文本：`7697… 7697… 12 45.5`
  const parts = text.split(/[\s,，]+/).filter((s) => s !== '');
  if (parts.length >= 2) {
    const seriesId = id(parts[0] ?? '');
    const episodeId = id(parts[1] ?? '');
    if (seriesId !== '' && episodeId !== '') {
      const no = Number.parseInt(parts[2] ?? '0', 10);
      const t = Number.parseFloat(parts[3] ?? '0');
      return {
        seriesId,
        episodeId,
        no: Number.isFinite(no) && no > 0 ? no : 0,
        startAt: Number.isFinite(t) && t > 0 ? t : 0,
      };
    }
  }

  return null;
}
