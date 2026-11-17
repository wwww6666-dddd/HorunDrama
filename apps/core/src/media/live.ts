/**
 * 直播式"边解密边封装"：把上游的 CENC(HEVC) 源实时解出来，转成 fMP4 直接推给浏览器。
 *
 * 为什么这么做：
 *  - 上游给的是**非分片** mp4（moov + 大 mdat + senc），Chrome 的 MSE 只吃 fMP4，
 *    而 fMP4 又不能保留 CENC 加密样本，所以 MSE + ClearKey 这条路对这种文件走不通；
 *  - 但本机 Chromium 能硬解 HEVC，所以只要把"解密 + 重封装成 fMP4"实时做掉，
 *    浏览器就能边收边播 —— 首帧 0.2~1s，不用等整集下载。
 *
 * 成本对比（1080p 一集）：
 *  - 旧：下载整集(40MB, 3~10s) + x264 重编码(6~10s)
 *  - 新：首帧 ~0.5s 开始播，后台同时落一份完整缓存用于拖动/续播
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type http from 'node:http';
import { findFfmpeg } from './transcode.ts';
import type { StreamChoice } from '../sources/playback.ts';
import { createLogger } from '../util/log.ts';

const log = createLogger('live');

/** ffmpeg 输出 fMP4 需要的参数：空 moov + 每个关键帧一个 fragment */
const FRAG_FLAGS = 'frag_keyframe+empty_moov+default_base_moof';

/**
 * 把一集的加密源实时转成 fMP4 写进 HTTP 响应。
 * 客户端断开时杀掉 ffmpeg，避免泄漏。
 */
export function streamLiveMp4(stream: StreamChoice, res: http.ServerResponse): void {
  const ffmpeg = findFfmpeg();
  const args: string[] = ['-hide_banner', '-loglevel', 'error'];
  if (stream.protected && stream.decryptionKey !== '') {
    args.push('-decryption_key', stream.decryptionKey);
  }
  args.push(
    '-i',
    stream.url,
    '-c',
    'copy',
    '-movflags',
    FRAG_FLAGS,
    '-f',
    'mp4',
    'pipe:1',
  );

  res.writeHead(200, {
    'content-type': 'video/mp4',
    'cache-control': 'no-store',
    // 不支持 Range：拖动由"后台落盘完成后换源"来解决
    'accept-ranges': 'none',
  });

  let child: ChildProcess | null = null;
  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (child !== null && child.exitCode === null) {
      try {
        child.kill();
      } catch {
        /* 已经退出 */
      }
    }
  };

  try {
    child = spawn(ffmpeg, args, { windowsHide: true });
  } catch (err) {
    log.warn(`live 启动 ffmpeg 失败：${(err as Error).message}`);
    res.end();
    return;
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    if (!res.writableEnded) res.write(chunk);
  });
  child.stderr?.on('data', (data: Buffer) => {
    const text = String(data).trim();
    if (text !== '') log.debug(`ffmpeg: ${text.slice(0, 200)}`);
  });
  child.on('error', (err) => {
    log.warn(`live ffmpeg 错误：${err.message}`);
    cleanup();
    if (!res.writableEnded) res.end();
  });
  child.on('close', (code) => {
    if (code !== 0 && !closed) log.debug(`live ffmpeg 退出 code=${code}`);
    if (!res.writableEnded) res.end();
  });

  res.on('close', cleanup);
  res.on('error', cleanup);
}
