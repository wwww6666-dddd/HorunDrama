/**
 * 预加载脚本：只暴露桌面端才有的几个能力给页面。
 * contextIsolation 开着，页面拿不到 Node，只能调这里明确列出的方法。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yimu', {
  /** 打开内嵌的官方登录窗口；成功后自动把 Cookie 交给本地服务 */
  openLogin: () => ipcRenderer.invoke('yimu:open-login'),
  /** 同步应用主题给主进程（Windows 11 DWM 边框颜色跟随，避免白边） */
  setTheme: (theme) => ipcRenderer.invoke('yimu:set-theme', theme),
  /** 切换窗口全屏（F11） */
  toggleFullscreen: () => ipcRenderer.invoke('yimu:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('yimu:is-fullscreen'),
  setFullscreen: (v) => ipcRenderer.invoke('yimu:set-fullscreen', v),
  /** 系统目录选择器（设置里的缓存/下载目录） */
  pickDirectory: (current) => ipcRenderer.invoke('yimu:pick-dir', current),
  /** 小窗模式：置顶 + 缩小到右下角 */
  toggleMini: () => ipcRenderer.invoke('yimu:toggle-mini'),
  /** 打开真正的播放小窗（独立置顶窗口，只渲染播放器） */
  openMini: (payload) => ipcRenderer.invoke('yimu:open-mini', payload),
  closeMini: () => ipcRenderer.invoke('yimu:close-mini'),
  /** 把视频宽高告诉主进程，小窗据此调整比例 */
  resizeMini: (size) => ipcRenderer.invoke('yimu:mini-size', size),
  /** 窗口控制（自绘标题栏用） */
  minimize: () => ipcRenderer.invoke('yimu:minimize'),
  /** 用系统浏览器打开外链（反馈/更新/GitHub） */
  openExternal: (url) => ipcRenderer.invoke('yimu:open-external', url),
  /** 自动更新：后台下载更新包（主进程写文件，带进度） */
  updateDownload: (payload) => ipcRenderer.invoke('yimu:update-download', payload),
  /** 自动更新：退出并解压覆盖，然后重启 */
  updateInstall: (payload) => ipcRenderer.invoke('yimu:update-install', payload),
  /** 下载进度：{ received, total, percent } */
  onUpdateProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('yimu:update-progress', handler);
    return () => ipcRenderer.removeListener('yimu:update-progress', handler);
  },
  /** 写剪贴板（主进程 clipboard，比渲染进程的 navigator.clipboard 可靠） */
  copyText: (text) => ipcRenderer.invoke('yimu:copy-text', text),
  toggleMaximize: () => ipcRenderer.invoke('yimu:toggle-maximize'),
  close: () => ipcRenderer.invoke('yimu:close'),
  /** 主进程主动通知：登录状态变了 */
  onLoginChanged: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('yimu:login-changed', handler);
    return () => ipcRenderer.removeListener('yimu:login-changed', handler);
  },
  platform: process.platform,
  /** 是否最大化（自绘窗口按钮用来切图标） */
  isMaximized: () => ipcRenderer.invoke('yimu:is-maximized'),
  /** 小窗打开时通知主窗口（主窗口据此暂停，避免两路同时出声） */
  onMiniOpened: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('yimu:mini-opened', handler);
    return () => ipcRenderer.removeListener('yimu:mini-opened', handler);
  },
  /** 小窗「还原」：关掉小窗并把主窗口拉到前台 */
  focusMain: () => ipcRenderer.invoke('yimu:focus-main'),
  /** 小窗关闭后通知主窗口（主窗口据此恢复播放） */
  onMiniClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('yimu:mini-closed', handler);
    return () => ipcRenderer.removeListener('yimu:mini-closed', handler);
  },
  /** 手动拖动窗口（无边框窗口用；按下开始，松手结束） */
  dragStart: () => ipcRenderer.invoke('yimu:drag-start'),
  dragEnd: () => ipcRenderer.invoke('yimu:drag-end'),
  /** 主进程通知窗口状态变化（最大化/全屏） */
  onWindowState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('yimu:window-state', handler);
    return () => ipcRenderer.removeListener('yimu:window-state', handler);
  },
});
