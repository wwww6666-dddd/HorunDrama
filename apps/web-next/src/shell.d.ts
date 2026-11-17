/** Electron 预加载脚本暴露的能力（网页里用 window.yimu 判断是否在桌面壳里）。 */

export interface YimuBridge {
  openLogin?: () => Promise<unknown>;
  toggleFullscreen?: () => Promise<boolean>;
  isFullscreen?: () => Promise<boolean>;
  setFullscreen?: (v: boolean) => Promise<boolean>;
  pickDirectory?: (current?: string) => Promise<{ ok: boolean; path?: string }>;
  toggleMini?: () => Promise<boolean>;
  openMini?: (payload: unknown) => Promise<unknown>;
  closeMini?: () => Promise<boolean>;
  resizeMini?: (size: { w: number; h: number }) => Promise<boolean>;
  minimize?: () => Promise<void>;
  /** 用系统浏览器打开外链（反馈/GitHub/更新下载） */
  openExternal?: (url: string) => Promise<boolean>;
  /** 写剪贴板（主进程 clipboard） */
  copyText?: (text: string) => Promise<boolean>;
  toggleMaximize?: () => Promise<void>;
  close?: () => Promise<void>;
  isMaximized?: () => Promise<boolean>;
  onWindowState?: (cb: (state: { maximized: boolean; fullscreen: boolean }) => void) => () => void;
  /** 小窗打开时在主窗口触发（用于暂停主窗口播放，避免两路声音） */
  onMiniOpened?: (cb: (payload: { seriesId: string; episodeId: string; no: number }) => void) => () => void;
  /** 小窗「还原」：关掉小窗并把主窗口拉到前台 */
  focusMain?: () => Promise<boolean>;
  /** 小窗关闭后触发（主窗口据此恢复播放） */
  onMiniClosed?: (cb: () => void) => () => void;
  /** 手动拖动窗口：按下开始，松手结束（无边框窗口） */
  dragStart?: () => Promise<boolean>;
  dragEnd?: () => Promise<boolean>;
  onLoginChanged?: (cb: (payload: unknown) => void) => () => void;
  platform?: string;
}

declare global {
  interface Window {
    yimu?: YimuBridge;
  }
}

export {};
