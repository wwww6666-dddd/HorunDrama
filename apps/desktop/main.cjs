/**
 * 一幕 · 桌面壳（Electron 主进程）
 *
 * 为什么是 Electron：后端本来就是一个 Node 服务（本地 HTTP + node:sqlite +
 * 子进程 ffmpeg）。Electron 45 自带 Node 24，可以直接 import 服务端的 .ts
 * （原生类型擦除 + 内置 node:sqlite），不用像 Tauri 那样再塞一个 Node sidecar。
 * 窗口只加载 127.0.0.1 上的本地服务，不碰外网。
 *
 * 这个文件是 CommonJS：Electron 的 `electron` 模块只有 CJS 入口，
 * ESM 里 `import { app } from 'electron'` 拿不到导出（踩过），
 * 所以主进程用 require，服务端用动态 import（.ts 由 Node 的类型擦除处理）。
 *
 * 启动参数：
 *   --shot=<png>    截图后退出（自测用，不需要人盯着屏幕）
 *   --dev           加载 Vite 开发服务器（热更新）
 */
const { app, BrowserWindow, shell, Menu, ipcMain, session, dialog, screen, nativeTheme, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * GUI 启动（双击 exe / 快捷方式）时没有控制台，往 stdout/stderr 写会 EPIPE。
 * 之前子进程日志直接 pipe 到 process.stderr，会抛
 * "A JavaScript error occurred in the main process: EPIPE: broken pipe" 把应用搞崩。
 * 这里：1) 吞掉流的 error 事件；2) 所有日志统一走 safeLog。
 */
for (const stream of [process.stdout, process.stderr]) {
  if (stream !== null && typeof stream.on === 'function') stream.on('error', () => {});
}

function safeLog(line, isError = false) {
  try {
    (isError ? process.stderr : process.stdout).write(`${line}\n`);
  } catch {
    /* 没有可写的控制台就算了，不能因为日志崩应用 */
  }
}

// 全文件还有很多 console.*：统一包一层，避免任何一处 EPIPE 抛到主进程
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try {
      original(...args);
    } catch {
      /* 同上 */
    }
  };
}

/**
 * 这台机器上不带 --no-sandbox 会在 Chromium 初始化阶段就崩（0x80000003），
 * 而且崩在主进程 JS 之前——所以真正兜住这件事的是 launcher/YiMuLauncher.cs，
 * 正常安装后进来的调用一定已经带了这个参数。这里只是开发期（electron .）的补充。
 */
if (!process.argv.includes('--no-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
}

const IS_DEV = process.argv.includes('--dev') || process.env.HORUN_DEV === '1';
const SHOT = process.argv.find((a) => a.startsWith('--shot='))?.slice('--shot='.length) ?? '';

/**
 * 选一个「真的能写」的数据目录。
 *
 * 受限环境（沙箱化终端、只读漫游目录、公司策略）里 mkdir 会直接 EPERM，
 * 而 Electron 拿不到 profile 目录就会崩在启动阶段。所以逐个试，谁先写通就用谁。
 */
function chooseDataRoot() {
  const candidates = [];
  if (process.env.HORUN_DATA_DIR) candidates.push(path.resolve(process.env.HORUN_DATA_DIR));
  // 便携版（压缩包解压出来的那一份）：exe 同目录放一个 portable.txt，
  // 数据就写到 exe 旁边的 data/。便携版**直接返回**，不参与后面的候选比较 ——
  // 否则机器上已有 %APPDATA%\HorunDrama 时，"复用已有数据目录"会把它抢走，
  // 表现就是"解压到 U 盘却写到了 C 盘"。
  try {
    const exeDir = path.dirname(app.getPath('exe'));
    if (fs.existsSync(path.join(exeDir, 'portable.txt'))) {
      const portableDir = path.join(exeDir, 'data');
      try {
        fs.mkdirSync(portableDir, { recursive: true });
        const probe = path.join(portableDir, '.write-probe');
        fs.writeFileSync(probe, String(Date.now()));
        fs.rmSync(probe, { force: true });
        console.log('[desktop] 便携模式，数据目录:', portableDir);
        return portableDir;
      } catch (err) {
        console.warn('[desktop] 便携目录不可写，回退到用户目录:', err.message);
      }
    }
  } catch {
    /* getPath 在极早期可能不可用，忽略 */
  }
  candidates.push(path.join(app.getPath('appData'), 'HorunDrama'));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'HorunDrama'));
  // 开发兜底：仓库内 data/（受限于某些沙箱环境，Electron 写不了 %APPDATA%）。
  // 绝不把 node_modules 或安装目录当数据目录——那是之前的坑。
  candidates.push(path.join(app.getAppPath(), '..', '..', 'data'));
  candidates.push(path.join(process.resourcesPath, '..', 'data'));

  const writable = (dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, String(Date.now()));
      fs.rmSync(probe, { force: true });
      return true;
    } catch (err) {
      console.warn(`[desktop] 数据目录不可用: ${dir} (${err.code ?? err.message})`);
      return false;
    }
  };

  // 优先复用「已经存在数据库」的目录：否则每次启动可能在两个目录间跳，
  // 表现就是进度/登录态时有时无（真实踩过的坑）。
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'yimu.db')) && writable(dir)) {
      console.log('[desktop] 复用已有数据目录:', dir);
      return dir;
    }
  }
  for (const dir of candidates) {
    if (writable(dir)) return dir;
  }
  return null;
}

const dataRoot = chooseDataRoot();
let startupMarker = '';
if (dataRoot !== null) {
  process.env.HORUN_DATA_DIR = dataRoot;
  try {
    fs.mkdirSync(path.join(dataRoot, 'chromium'), { recursive: true });
    app.setPath('userData', path.join(dataRoot, 'chromium'));
  } catch (err) {
    console.warn('[desktop] 设置 userData 失败:', err.message);
  }
  console.log('[desktop] 数据目录:', dataRoot);

  startupMarker = path.join(dataRoot, '.startup-in-progress');
  try {
    if (fs.existsSync(startupMarker)) {
      console.warn('[desktop] 上次启动没有走完，本次启用兼容模式');
      app.commandLine.appendSwitch('no-sandbox');
      app.commandLine.appendSwitch('disable-gpu');
    }
    fs.writeFileSync(startupMarker, String(Date.now()));
  } catch (err) {
    console.warn('[desktop] 启动标记写入失败:', err.message);
  }
} else {
  console.warn('[desktop] 没找到可写的数据目录，将使用默认位置（可能启动失败）');
}

function clearStartupMarker() {
  if (startupMarker === '') return;
  try {
    fs.rmSync(startupMarker, { force: true });
  } catch {
    /* 忽略 */
  }
}

// 单实例：第二次启动就聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setName('HorunDrama');
app.setAppUserModelId('com.horun.drama');

/** 定位仓库/asar 里的资源（打包与开发布局不同） */
function firstExisting(candidates) {
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* 忽略 */
    }
  }
  return candidates[0];
}

function coreEntry() {
  const appPath = app.getAppPath();
  const resources = process.resourcesPath ?? '';
  return firstExisting([
    // 打包后：extraResources 把 apps/core 放到 resources/core
    resources === '' ? '' : path.join(resources, 'core', 'src', 'index.ts'),
    path.join(appPath, 'apps', 'core', 'src', 'index.ts'),
    path.join(appPath, '..', 'core', 'src', 'index.ts'),
    path.join(appPath, '..', '..', 'apps', 'core', 'src', 'index.ts'),
  ]);
}

function webDist() {
  const appPath = app.getAppPath();
  return firstExisting([
    path.join(appPath, 'apps', 'web-next', 'dist'),
    path.join(appPath, '..', 'web-next', 'dist'),
    path.join(appPath, '..', '..', 'apps', 'web-next', 'dist'),
  ]);
}

function iconPath() {
  // 注意：Windows 的窗口图标要真实文件路径，asar 内的路径读不到（这就是之前任务栏一直是默认图标的原因）
  return firstExisting([
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(__dirname, 'resources', 'icon.ico'),
    path.join(__dirname, 'resources', 'icon.png'),
  ]);
}

/**
 * 本地签名服务（hgsigner）。
 *
 * 它复用 openhongguo 的签名实现，给登录/写操作算 x-gorgon、x-medusa 等请求头。
 * 随安装包一起分发，主进程启动时拉起；端口固定在本机回环，不对外网开放。
 */
const SIGNER_PORT = 8791;
let signerProc = null;

function startSigner() {
  const exe = firstExisting([
    path.join(process.resourcesPath, 'hgsigner', 'hgsigner.exe'),
    path.join(__dirname, 'resources', 'hgsigner', 'hgsigner.exe'),
  ]);
  if (!fs.existsSync(exe)) {
    console.warn('[signer] 没找到 hgsigner.exe，登录功能不可用');
    return;
  }
  try {
    signerProc = require('node:child_process').spawn(exe, ['-addr', `127.0.0.1:${SIGNER_PORT}`], {
      windowsHide: true,
      stdio: 'ignore',
    });
    process.env.YIMU_SIGNER_URL = `http://127.0.0.1:${SIGNER_PORT}/sign`;
    console.log('[signer] 已启动:', `127.0.0.1:${SIGNER_PORT}`);
  } catch (err) {
    console.warn('[signer] 启动失败:', err.message);
  }
}

let mainWindow = null;
let coreProc = null;
let serverOrigin = '';

/**
 * 启动新核心（apps/core）。
 *
 * 为什么用子进程而不是 in-process import：core 是纯 Node/TS，用 Electron 自带的
 * Node 跑（ELECTRON_RUN_AS_NODE=1），这样开发与打包都不用另外装 Node。
 */
async function boot() {
  const entry = coreEntry();
  const port = Number(process.env.HORUN_PORT ?? 5880);
  const origin = `http://127.0.0.1:${port}`;

  // 打包后 ffmpeg 在 resources/ffmpeg；显式传给核心，免得它去猜路径
  const packagedFfmpeg = path.join(process.resourcesPath ?? '', 'ffmpeg', 'ffmpeg.exe');
  const ffmpegEnv = fs.existsSync(packagedFfmpeg) ? { HORUN_FFMPEG: packagedFfmpeg } : {};

  coreProc = require('node:child_process').spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HORUN_PORT: String(port),
      ...ffmpegEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  coreProc.stdout.on('data', (d) => safeLog(`[core] ${String(d).trimEnd()}`));
  coreProc.stderr.on('data', (d) => safeLog(`[core] ${String(d).trimEnd()}`, true));
  coreProc.on('exit', (code) => {
    if (code !== 0) console.error(`[desktop] 核心退出，code=${code}`);
    coreProc = null;
  });

  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        serverOrigin = origin;
        console.log('[desktop] 核心已就绪:', origin, '| webDist:', webDist());
        return origin;
      }
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('核心启动超时（检查 apps/core 是否能直接 node 跑起来）');
}

// ---------------------------------------------------------------- 登录

/** 这些 Cookie 出现就说明护照登录完成了（ttwid / gfkadpd 是匿名设备也会有的） */
const LOGIN_COOKIE_RE = /^(sessionid|sessionid_ss|sid_tt|sid_guard|uid_tt|uid_tt_ss|sid_ucp_v1|ssid_ucp_v1)$/;

/**
 * 打开内嵌的官方登录页，用户扫码后自动把 Cookie 交给本地服务。
 *
 * 为什么不是让用户自己复制 Cookie：那一步是给开发者用的。
 * 这里登录完全发生在官方页面里（我们不碰账号密码/验证码），
 * 只是把登录后产生的会话 Cookie 转交给本机服务。
 */
async function openLoginWindow(hintSeriesId) {
  const parent = mainWindow ?? undefined;
  const win = new BrowserWindow({
    width: 460,
    height: 760,
    parent,
    modal: parent !== undefined,
    show: false,
    autoHideMenuBar: true,
    title: '登录红果账号',
    backgroundColor: '#0A0908',
    webPreferences: {
      // 单独的持久化分区：官方站点的 Cookie 只留在这里，和主窗口隔离
      partition: 'persist:yimu-login',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);

  // 实测：登录入口在**首页**，点「登录」后官网会加载字节 passport JS SDK，
  // 请求 /passport/web/get_qrcode/ 拿 token，再轮询 /passport/web/check_qrconnect/，
  // 扫码确认后 Set-Cookie 下发 sessionid。所以这里必须停在首页，不要去 player 子页。
  const target = 'https://hongguoduanju.com/';
  void win.loadURL(target);

  win.once('ready-to-show', () => win.show());

  const ses = win.webContents.session;
  let closed = false;
  win.on('closed', () => {
    closed = true;
  });

  const startedAt = Date.now();
  let clickedLogin = false;
  while (!closed && Date.now() - startedAt < 5 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 1500));

    // 帮用户点一下「登录」：官网的入口是 div/span，不是 a，而且要用 MouseEvent 派发才触发
    if (!clickedLogin) {
      const hit = await win.webContents
        .executeJavaScript(
          `(() => {
            const el = [...document.querySelectorAll('div,span,a,button')]
              .find((e) => (e.textContent || '').trim() === '登录' && e.offsetParent !== null);
            if (!el) return false;
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
          })()`,
          true,
        )
        .catch(() => false);
      if (hit === true) clickedLogin = true;
    }

    const cookies = await ses.cookies.get({ domain: 'hongguoduanju.com' }).catch(() => []);
    const logged = cookies.filter((c) => LOGIN_COOKIE_RE.test(c.name));
    if (logged.length > 0) {
      const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      try {
        const res = await fetch(`${serverOrigin}/api/account/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookie: header }),
        });
        if (!res.ok) throw new Error(`保存会话失败 HTTP ${res.status}`);
        if (!closed) win.close();
        mainWindow?.webContents.send('yimu:login-changed', { loggedIn: true });
        return { ok: true, cookieCount: cookies.length };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    }
  }

  if (!closed) win.close();
  return { ok: false, reason: closed ? 'cancelled' : 'timeout' };
}

ipcMain.handle('yimu:open-login', async (_event, hintSeriesId) => {
  try {
    return await openLoginWindow(hintSeriesId);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.handle('yimu:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('yimu:set-fullscreen', (_e, value) => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(value === true);
  return mainWindow.isFullScreen();
});

ipcMain.handle('yimu:set-theater', (_e, value) => {
  if (!mainWindow) return false;
  // 影院 = 窗口内最大化但不进系统全屏（保留标题栏区域）
  if (value === true) mainWindow.maximize();
  return mainWindow.isMaximized();
});

let miniMode = false;

/** 小窗模式：置顶 + 缩小 + 贴右下角，方便边工作边看 */
ipcMain.handle('yimu:toggle-mini', () => {
  if (!mainWindow) return false;
  miniMode = !miniMode;
  if (miniMode) {
    const { workArea } = require('electron').screen.getPrimaryDisplay();
    const w = 420;
    const h = 300;
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setResizable(true);
    mainWindow.setSize(w, h);
    mainWindow.setPosition(workArea.x + workArea.width - w - 24, workArea.y + workArea.height - h - 24);
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSize(1360, 880);
    mainWindow.center();
  }
  return miniMode;
});

let miniPlayerWin = null;

/**
 * 真正的「播放小窗」：一个独立的、竖屏的、置顶无边框窗口，只渲染播放器。
 *
 * 之前那个「小窗」只是把主窗口缩小置顶，整个界面还在，不算小窗。
 */
ipcMain.handle('yimu:open-mini', (_e, payload) => {
  const { seriesId, episodeId, no, startAt } = payload ?? {};
  if (!seriesId || !episodeId) return { ok: false, reason: 'no_playing' };

  if (miniPlayerWin !== null && !miniPlayerWin.isDestroyed()) {
    miniPlayerWin.close();
    miniPlayerWin = null;
  }

  // 成熟项目的小窗是「迷你播放器」：小、无边框、置顶、右下角、只有画面 + 悬浮微控制。
  // 尺寸先给 16:9 的 360×203，页面拿到真实宽高后再按比例校正（yimu:mini-size）。
  const area = screen.getPrimaryDisplay().workArea;
  const width = 360;
  const height = 203;
  const x = area.x + area.width - width - 24;
  const y = area.y + area.height - height - 24;

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    // 小窗固定尺寸：无边框窗口的边缘自带 resize 热区，
    // 用户从边上按下会被系统当成"拉伸"，再叠加我们的拖动就表现为"越拖越大"。
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    title: 'HorunDrama 小窗',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  // 盖在普通窗口之上，但不抢全屏应用的焦点
  win.setAlwaysOnTop(true, 'floating');
  miniPlayerWin = win;

  const t = Number(startAt);
  const suffix = Number.isFinite(t) && t > 0 ? `?t=${t.toFixed(1)}` : '';
  const url = `${serverOrigin}/?mini=1#/mini/${seriesId}/${episodeId}/${no ?? 1}${suffix}`;
  void win.loadURL(url);
  win.once('ready-to-show', () => {
    win.showInactive(); // 不抢焦点，方便边工作边看
  });
  win.on('closed', () => {
    miniPlayerWin = null;
    // 小窗关掉后通知主窗口恢复播放（它当初是被小窗暂停的）
    mainWindow?.webContents.send('yimu:mini-closed');
  });

  // 通知主窗口暂停，避免两路声音
  mainWindow?.webContents.send('yimu:mini-opened', { seriesId, episodeId, no });
  return { ok: true };
});

/** 小窗按视频比例校正尺寸：固定宽度 380，高度按宽高比算；缩放时保持右下角不动。 */
ipcMain.handle('yimu:mini-size', (e, size) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win === mainWindow) return false;
  const w = Number(size?.w ?? 0);
  const h = Number(size?.h ?? 0);
  if (!(w > 0) || !(h > 0)) return false;

  const ratio = w / h;
  const width = 380;
  const height = Math.round(Math.min(680, Math.max(140, width / ratio)));
  const bounds = win.getBounds();
  if (bounds.width === width && bounds.height === height) return true;

  // 保持右下角位置不变，窗口"从右下往左上"长，不会跑出屏幕
  win.setBounds({
    x: bounds.x + bounds.width - width,
    y: bounds.y + bounds.height - height,
    width,
    height,
  });
  return true;
});

/** 小窗「还原」：关掉小窗并把主窗口拉到前台 */
ipcMain.handle('yimu:focus-main', () => {
  if (miniPlayerWin !== null && !miniPlayerWin.isDestroyed()) miniPlayerWin.close();
  miniPlayerWin = null;
  mainWindow?.show();
  mainWindow?.focus();
  return true;
});

/**
 * 手动拖动窗口。
 *
 * 为什么不用 CSS `-webkit-app-region: drag`：它只在设了该属性的一块矩形内生效，
 * 而且会把鼠标事件吞掉——播放页没有顶栏（无处可拖）、小窗只有 22px 的条，
 * 更麻烦的是会跟"点画面暂停/双击还原"抢事件。
 * 这里改成渲染进程按下时发 IPC，主进程按光标位置持续 setPosition，松手即停。
 */
let dragTimer = null;
let dragOffset = null;

ipcMain.handle('yimu:drag-start', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragOffset = { dx: cursor.x - x, dy: cursor.y - y };
  if (dragTimer !== null) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (dragOffset === null || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    win.setPosition(p.x - dragOffset.dx, p.y - dragOffset.dy);
  }, 16);
  return true;
});

ipcMain.handle('yimu:drag-end', () => {
  if (dragTimer !== null) clearInterval(dragTimer);
  dragTimer = null;
  dragOffset = null;
  return true;
});

ipcMain.handle('yimu:close-mini', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win !== mainWindow) win.close();
  return true;
});

ipcMain.handle('yimu:pick-dir', async (_e, current) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择一个目录',
    defaultPath: typeof current === 'string' && current !== '' ? current : undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('yimu:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);
ipcMain.handle('yimu:is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('yimu:minimize', () => mainWindow?.minimize());
/**
 * 用系统浏览器打开外链（反馈 issue、GitHub、更新下载页）。
 * 渲染进程里直接 location.href 会把应用本身导航走，所以必须走 shell.openExternal。
 * 只放行 http/https，避免被拼出 file:// 之类的协议。
 */
ipcMain.handle('yimu:open-external', async (_e, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});
/**
 * 写剪贴板。
 * 渲染进程的 navigator.clipboard 在窗口失焦/无用户手势时会被拒（"复制失败"的常见来源），
 * 走主进程的 clipboard 模块就一定成功。
 */
ipcMain.handle('yimu:copy-text', (_e, text) => {
  try {
    require('electron').clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
});
// ---------------------------------------------------------------- 自动更新
// 参考成熟客户端的做法：后台下载完整包 → 用户点“立即重启更新” → 退出后由
// 一个 cmd 脚本等待进程结束、解压覆盖程序目录、再启动新版本。数据目录不在
// 更新包里，所以设置/登录/缓存都会保留。
const UPDATE_MAX_BYTES = 420 * 1024 * 1024;

/** 更新文件放在数据目录的 updates/，不污染安装目录。 */
function updateDir() {
  const root = dataRoot ?? app.getPath('userData');
  const dir = path.join(root, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 只接受 GitHub 的 https 资源，避免把下载器变成任意文件下载器。 */
function isAllowedUpdateUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'github.com' ||
      u.hostname.endsWith('.github.com') ||
      u.hostname === 'githubusercontent.com' ||
      u.hostname.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function safeUpdateName(name) {
  const base = path.basename(String(name ?? '')).replace(/[^\w.\- ]+/g, '_').slice(-140);
  return base === '' ? `HorunDrama-update-${Date.now()}.bin` : base;
}

function unlinkQuiet(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function updaterUserAgent() {
  return `HorunDrama/${app.getVersion()} updater`;
}

/**
 * 优先用 Electron net.fetch（Chromium 网络栈，会走系统代理/系统证书），
 * 失败再退回 Node fetch（无代理环境）。
 *
 * 2.0.2 的“fetch failed”就是 Node 直连 release-assets.githubusercontent.com
 * 被网络重置；浏览器/Chromium 能走代理，但 Node 不会。
 */
async function fetchUpdate(url, init) {
  if (net !== undefined && typeof net.fetch === 'function') {
    try {
      return await net.fetch(url, init);
    } catch (err) {
      console.warn('[update] net.fetch 失败，尝试 Node fetch:', err.message);
    }
  }
  return fetch(url, init);
}

function progressSender(event, total) {
  let received = 0;
  let lastSent = 0;
  return {
    add(bytes) {
      received += bytes;
      const now = Date.now();
      if (now - lastSent > 220) {
        lastSent = now;
        event.sender.send('yimu:update-progress', {
          received,
          total,
          percent: total > 0 ? Math.min(1, received / total) : 0,
        });
      }
    },
    get received() {
      return received;
    },
  };
}

/** 单连接下载（保持原来的兜底路径）。 */
async function downloadSingle(url, part, payload, event) {
  const res = await fetchUpdate(url, {
    redirect: 'follow',
    headers: { 'user-agent': updaterUserAgent() },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!res.ok || res.body === null) throw new Error(`下载失败 HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? payload?.size ?? 0);
  const out = fs.createWriteStream(part);
  const hash = crypto.createHash('sha256');
  const progress = progressSender(event, total);
  try {
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      progress.add(buf.length);
      if (progress.received > UPDATE_MAX_BYTES) throw new Error('更新包超过大小限制');
      hash.update(buf);
      if (!out.write(buf)) await new Promise((resolve) => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => {
      out.end(resolve);
      out.on('error', reject);
    });
    return { received: progress.received, total, sha256: hash.digest('hex') };
  } catch (err) {
    out.destroy();
    unlinkQuiet(part);
    throw err;
  }
}

/**
 * 多连接 Range 下载（参考 MotrixNext/aria2 的分片方式）：
 * 把文件切成 N 段并发请求，最后按顺序拼接并算 SHA-256。
 * GitHub Release 的签名资源支持 Range，通常比单连接快 2~5 倍。
 */
async function downloadParallel(url, part, total, payload, event) {
  const connections = total > 80 * 1024 * 1024 ? 6 : 4;
  const chunkSize = Math.ceil(total / connections);
  const progress = progressSender(event, total);
  const chunkFiles = [];
  try {
    await Promise.all(
      Array.from({ length: connections }, (_, i) => {
        const start = i * chunkSize;
        const end = Math.min(total - 1, start + chunkSize - 1);
        const chunkFile = `${part}.${i}`;
        chunkFiles.push(chunkFile);
        return (async () => {
          const res = await fetchUpdate(url, {
            redirect: 'follow',
            headers: {
              range: `bytes=${start}-${end}`,
              'user-agent': updaterUserAgent(),
            },
            signal: AbortSignal.timeout(30 * 60 * 1000),
          });
          if (res.status !== 206 || res.body === null) {
            throw new Error(`分片下载失败 HTTP ${res.status}`);
          }
          const out = fs.createWriteStream(chunkFile);
          try {
            for await (const chunk of res.body) {
              const buf = Buffer.from(chunk);
              progress.add(buf.length);
              if (progress.received > UPDATE_MAX_BYTES) throw new Error('更新包超过大小限制');
              if (!out.write(buf)) await new Promise((resolve) => out.once('drain', resolve));
            }
            await new Promise((resolve, reject) => {
              out.end(resolve);
              out.on('error', reject);
            });
          } catch (err) {
            out.destroy();
            throw err;
          }
        })();
      }),
    );

    if (progress.received !== total) {
      throw new Error(`分片大小不完整（${progress.received}/${total}）`);
    }

    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    for (const chunkFile of chunkFiles) {
      for await (const chunk of fs.createReadStream(chunkFile)) {
        const buf = Buffer.from(chunk);
        hash.update(buf);
        if (!out.write(buf)) await new Promise((resolve) => out.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => {
      out.end(resolve);
      out.on('error', reject);
    });
    return { received: progress.received, total, sha256: hash.digest('hex') };
  } catch (err) {
    for (const chunkFile of chunkFiles) unlinkQuiet(chunkFile);
    unlinkQuiet(part);
    throw err;
  } finally {
    for (const chunkFile of chunkFiles) unlinkQuiet(chunkFile);
  }
}

/**
 * 下载更新包到数据目录，边下边把进度发给渲染进程。
 * 返回 { ok, path, size, sha256 }；失败返回 { ok:false, message }。
 */
ipcMain.handle('yimu:update-download', async (event, payload) => {
  const url = String(payload?.url ?? '');
  if (!isAllowedUpdateUrl(url)) return { ok: false, message: '更新地址不是 GitHub https 地址' };
  const file = path.join(updateDir(), safeUpdateName(payload?.name));
  const part = `${file}.part`;
  try {
    const knownSize = Number(payload?.size ?? 0);
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (knownSize === 0 || Math.abs(size - knownSize) <= 1024) {
        event.sender.send('yimu:update-progress', { received: size, total: size, percent: 1 });
        return { ok: true, path: file, size, sha256: '' };
      }
      unlinkQuiet(file);
    }
    unlinkQuiet(part);

    let result;
    if (knownSize >= 32 * 1024 * 1024) {
      try {
        result = await downloadParallel(url, part, knownSize, payload, event);
      } catch (parallelErr) {
        // 某些代理/CDN 不支持 Range 或返回 200：退回单连接，不要因此更新失败
        console.warn('[update] 多连接下载失败，回退单连接:', parallelErr.message);
        unlinkQuiet(part);
        result = await downloadSingle(url, part, payload, event);
      }
    } else {
      result = await downloadSingle(url, part, payload, event);
    }

    const expected = String(payload?.digest ?? '').replace(/^sha256:/i, '').toLowerCase();
    if (expected !== '' && expected !== result.sha256) {
      unlinkQuiet(part);
      return { ok: false, message: 'SHA-256 校验失败，已删除下载文件' };
    }
    const expectedSize = Number(payload?.size ?? 0);
    if (expectedSize > 0 && Math.abs(result.received - expectedSize) > 1024) {
      unlinkQuiet(part);
      return { ok: false, message: `下载不完整（${result.received}/${expectedSize} 字节）` };
    }
    unlinkQuiet(file);
    fs.renameSync(part, file);
    event.sender.send('yimu:update-progress', { received: result.received, total: result.received, percent: 1 });
    return { ok: true, path: file, size: result.received, sha256: result.sha256 };
  } catch (err) {
    unlinkQuiet(part);
    return { ok: false, message: (err).message };
  }
});

/**
 * 退出并应用更新。
 *
 * 更新包只包含程序文件（不含 data/），解压到临时目录后再 robocopy 覆盖，
 * 这样下载/解压失败时不会先把现有程序弄坏。
 */
ipcMain.handle('yimu:update-install', async (_event, payload) => {
  const file = path.resolve(String(payload?.path ?? ''));
  const dir = path.resolve(updateDir());
  const lowerFile = file.toLowerCase();
  const lowerDir = `${dir}${path.sep}`.toLowerCase();
  if (!lowerFile.startsWith(lowerDir) || !fs.existsSync(file)) {
    return { ok: false, message: '更新包路径不合法或文件不存在' };
  }
  const appDir = path.dirname(app.getPath('exe'));
  const launcher = path.join(appDir, 'HorunDrama.exe');
  const isZip = /\.zip$/i.test(file);
  const tmpDir = path.join(appDir, '.update-tmp');
  const helper = path.join(dir, 'apply-update.cmd');
  const lines = [
    '@echo off',
    'setlocal',
    `set "PID=${process.pid}"`,
    `set "APP_DIR=${appDir}"`,
    `set "PKG=${file}"`,
    `set "UPD_DIR=${dir}"`,
    `set "TMP=${tmpDir}"`,
    `set "LAUNCH=${launcher}"`,
    ':wait',
    'tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul',
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    'timeout /t 2 /nobreak >nul',
  ];
  if (isZip) {
    lines.push(
      'if exist "%TMP%" rmdir /s /q "%TMP%"',
      'mkdir "%TMP%"',
      'if exist "%SystemRoot%\\System32\\tar.exe" (',
      '  "%SystemRoot%\\System32\\tar.exe" -xf "%PKG%" -C "%TMP%"',
      ') else (',
      '  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath \'%PKG%\' -DestinationPath \'%TMP%\' -Force"',
      ')',
      'robocopy "%TMP%" "%APP_DIR%" /E /NFL /NDL /NJH /NJS /NP >nul',
      'rmdir /s /q "%TMP%"',
    );
  } else {
    lines.push('start "" /wait "%PKG%" /S');
  }
  // 更新成功/安装结束后清掉下载缓存，避免用户目录里长期堆着 100~200MB 的安装包
  lines.push(
    'del /q "%PKG%" 2>nul',
    'del /q "%UPD_DIR%\\*.zip" 2>nul',
    'del /q "%UPD_DIR%\\*.exe" 2>nul',
    'del /q "%UPD_DIR%\\*.part" 2>nul',
    'del /q "%UPD_DIR%\\*.7z" 2>nul',
    'rmdir /s /q "%TMP%" 2>nul',
  );
  lines.push('start "" "%LAUNCH%"', 'del "%~f0"', '');
  try {
    fs.writeFileSync(helper, lines.join('\r\n'), 'utf8');
    require('node:child_process')
      .spawn('cmd.exe', ['/d', '/c', `"${helper}"`], { detached: true, stdio: 'ignore', windowsHide: true })
      .unref();
    setTimeout(() => app.quit(), 500);
    return { ok: true, message: '正在退出并应用更新' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

/**
 * 让 Windows 11 的 DWM 边框跟随应用主题。
 *
 * 无边框窗口在 Win11 下系统仍会画一圈细边框，颜色来自窗口 frame 的深浅。
 * 主进程 nativeTheme 默认跟系统走，应用内切深色时边框仍是浅色，看起来就是
 * 顶部一条白线。渲染进程切主题时同步过来，边框颜色才会和窗口一致。
 */
ipcMain.handle('yimu:set-theme', (_event, theme) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  return true;
});

ipcMain.handle('yimu:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('yimu:close', () => mainWindow?.close());

// ---------------------------------------------------------------- 窗口

let splashWindow = null;

function showSplash() {
  const file = firstExisting([
    path.join(process.resourcesPath, 'splash.html'),
    path.join(__dirname, 'resources', 'splash.html'),
  ]);
  if (!fs.existsSync(file)) return;
  splashWindow = new BrowserWindow({
    width: 340,
    height: 360,
    frame: false,
    // 透明窗口在部分显卡/远程桌面下直接不显示，所以这里用不透明底 + 圆角由页面自己画
    transparent: false,
    backgroundColor: '#0a0908',
    resizable: false,
    center: true,
    show: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: { sandbox: true },
  });
  splashWindow.setMenu(null);
  void splashWindow.loadFile(file);
}

function hideSplash() {
  if (splashWindow === null) return;
  const w = splashWindow;
  splashWindow = null;
  try {
    w.destroy();
  } catch {
    /* 忽略 */
  }
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 660,
    backgroundColor: '#0A0908',
    show: false,
    autoHideMenuBar: true,
    title: 'HorunDrama',
    icon: iconPath(),
    // 去系统标题栏：右上角按钮由页面自绘（见 ui/WindowControls），
    // 这样颜色跟随深浅色、位置和登录按钮在同一套布局里，不会重叠。
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);

  // 自绘窗口按钮需要知道"当前是不是最大化"，用来切换图标
  const notifyState = () => {
    mainWindow?.webContents.send('yimu:window-state', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };
  mainWindow.on('maximize', notifyState);
  mainWindow.on('unmaximize', notifyState);
  mainWindow.on('enter-full-screen', notifyState);
  mainWindow.on('leave-full-screen', notifyState);

  // F11 全屏：走窗口全屏（不是网页全屏），这样任务栏也一起让位
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      const next = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(next);
    }
  });

  // 外链一律交给系统浏览器，窗口只留在本机
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin) && !(IS_DEV && url.startsWith('http://127.0.0.1:5274'))) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  const target = IS_DEV ? 'http://127.0.0.1:5274' : origin;

  if (SHOT !== '') {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.mkdirSync(path.dirname(SHOT), { recursive: true });
          fs.writeFileSync(SHOT, image.toPNG());
          console.log('[desktop] 截图已保存', SHOT);
        } catch (err) {
          console.error('[desktop] 截图失败', err);
        }
        app.quit();
      }, Number(process.env.YIMU_SHOT_DELAY ?? 2500));
    });
  }

  void mainWindow.loadURL(target);

  const splashShownAtUpdate = Date.now();
  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashShownAtUpdate;
    const wait = Math.max(0, 1100 - elapsed);
    setTimeout(() => {
      hideSplash();
      mainWindow?.show();
      clearStartupMarker();
    }, wait);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/**
 * 安装版自检：桌面/开始菜单快捷方式 + 卸载登记。
 *
 * 为什么放在应用里做：
 *   2.0.6/2.0.7 的安装器（electron-builder 的 NSIS）在这台机器上写不进 HKCU 和开始菜单，
 *   装完没有快捷方式、设置→应用里也看不到 HorunDrama。安装器是提权/沙箱上下文跑的，
 *   而应用本身一定以**真实用户**运行，所以由首次启动补齐最稳。
 *
 * 只对"安装版"生效：exe 同目录有 Uninstall HorunDrama.exe 才算安装版；
 * 便携版（有 portable.txt）不写注册表、不建快捷方式。
 */
function ensureInstallRecords() {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const exeDir = path.dirname(process.execPath);
    if (fs.existsSync(path.join(exeDir, 'portable.txt'))) return;
    const uninstaller = path.join(exeDir, 'Uninstall HorunDrama.exe');
    if (!fs.existsSync(uninstaller)) return;

    const userExe = fs.existsSync(path.join(exeDir, 'HorunDrama.exe'))
      ? path.join(exeDir, 'HorunDrama.exe')
      : process.execPath;
    const link = { target: userExe, args: '--no-sandbox', cwd: exeDir, icon: userExe, iconIndex: 0 };

    // 桌面 + 开始菜单（已存在就不覆盖，用户自己改过就别动）
    try {
      const desktop = path.join(app.getPath('desktop'), 'HorunDrama.lnk');
      if (!fs.existsSync(desktop)) shell.writeShortcutLink(desktop, 'create', link);
    } catch {
      /* 桌面被重定向/无权限时忽略 */
    }
    try {
      const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'HorunDrama');
      fs.mkdirSync(programs, { recursive: true });
      const menu = path.join(programs, 'HorunDrama.lnk');
      if (!fs.existsSync(menu)) shell.writeShortcutLink(menu, 'create', link);
    } catch {
      /* 忽略 */
    }

    // 卸载登记（设置 → 应用）。用 reg.exe 写，等价于用户手动写 HKCU。
    const reg = (args) => {
      try {
        require('node:child_process').execFileSync('reg.exe', args, { windowsHide: true, stdio: 'ignore' });
      } catch {
        /* 注册表写失败不影响使用 */
      }
    };
    reg(['add', 'HKCU\\Software\\HorunDrama', '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', exeDir, '/f']);
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HorunDrama';
    const set = (name, value) => reg(['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f']);
    set('DisplayName', 'HorunDrama');
    set('DisplayVersion', app.getVersion());
    set('Publisher', 'Horun');
    set('DisplayIcon', userExe);
    set('InstallLocation', exeDir);
    set('UninstallString', `"${uninstaller}"`);
    set('QuietUninstallString', `"${uninstaller}" /S`);
  } catch (err) {
    console.warn('[desktop] 安装信息自检失败', err);
  }
}

app.whenReady().then(async () => {
  showSplash();
  startSigner();
  ensureInstallRecords();
  try {
    const origin = await boot();
    createWindow(origin);
  } catch (err) {
    console.error('[desktop] 启动失败', err);
    hideSplash();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  void coreProc?.kill?.();
  try {
    signerProc?.kill();
  } catch {
    /* 忽略 */
  }
});
