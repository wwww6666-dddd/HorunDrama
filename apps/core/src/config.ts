/**
 * 运行配置：单一来源，避免再出现「主进程一个目录、服务端另一个目录」的分叉。
 * 数据目录固定 %APPDATA%\HorunDrama（v2 决策 D4），可用 HORUN_DATA_DIR 覆盖（测试用）。
 */
import os from 'node:os';
import path from 'node:path';

export const VERSION = '2.0.15';
export const HOST = '127.0.0.1';
export const PORT = Number.parseInt(process.env.HORUN_PORT ?? '5880', 10);

export const DATA_ROOT =
  process.env.HORUN_DATA_DIR !== undefined && process.env.HORUN_DATA_DIR !== ''
    ? path.resolve(process.env.HORUN_DATA_DIR)
    : path.join(process.env.APPDATA ?? os.homedir(), 'HorunDrama');

export const WEB_DIST = path.resolve(import.meta.dirname, '../../web-next/dist');

/** 上游超时与最小请求间隔（防止把上游打穿）。 */
export const UPSTREAM_TIMEOUT_MS = 20_000;
export const UPSTREAM_MIN_GAP_MS = 120;

/** 封面缓存上限：按字节算，不按张数（大图会把张数限制造假）。 */
export const IMAGE_CACHE_BYTES = 96 * 1024 * 1024;
