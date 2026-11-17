# HorunDrama

Windows 桌面短剧播放器（Electron + React + 无头 Node 核心）。个人业余维护、开源发布，
所有内容都来自上游公开接口，程序本身不提供内容、也不做任何破解。

![HorunDrama](红果短剧PC版.png)

## 功能

- **推荐 / 剧场 / 新剧 / 榜单 / 分类 / 搜索 / 追剧 / 下载**：一整套浏览与检索
- **播放器**：xgplayer 内核 + 自绘外壳，全屏（作用在页面容器）、画中画（换集不打断）、
  倍速、清晰度切换（1080p/720p/480p/流畅）、闲置自动隐藏操作栏
- **进度条可信**：默认"等这一集转成本地文件再播"，所以时长准确、可以随便拖
- **预加载**：以当前集为中心，前后各 5 集（可设置），下一集优先转
- **弹幕 / 评论**：拉取、发送、点赞、回复、删除（需要登录）
- **分享续播**：一键复制红果原始分享链接（额外带 `no`/`t`），
  别人把链接粘回软件会先弹「剧名 / 第几集 / 共几集 / 从哪开始」的卡片，确认后再播
- **账号**：手机号登录、签到、追更/收藏同步
- **关于页**：版本、作者、数据目录、GitHub 源码 / Releases / 反馈入口

## 快速开始（开发）

```bash
pnpm install

# 一键开发：核心 + 前端（Vite 代理 /api）
pnpm dev

# 只跑核心（Node 直接跑 TS，Node ≥ 22.6）
pnpm start            # http://127.0.0.1:5880

# 只构建前端
pnpm build
```

数据目录默认 `%APPDATA%\HorunDrama`，可以用 `HORUN_DATA_DIR` 覆盖。

桌面壳：

```bash
cd apps/desktop
node launch.mjs       # 会自己拉起核心
```

## 打包

需要自备两样东西（不进仓库，避免体积和许可证麻烦）：

| 依赖 | 放哪 | 说明 |
|---|---|---|
| `ffmpeg.exe` | `apps/desktop/resources/ffmpeg/ffmpeg.exe` | 转码/解密。用你自己编译或发行版（本机实测 2018 的 N-92722 也能跑） |
| `hgsigner.exe` | `apps/desktop/resources/hgsigner/hgsigner.exe` | 本地签名服务（`127.0.0.1:8791`）。**没有它账号接口不可用，播放不受影响** |

`openhongguo`（Go/WASM 内容 SDK）是 npm 依赖，`pnpm install` 就装好了；
`apps/desktop/scripts/prepare-vendor.mjs` 在打包前把它实体化到 `vendor/`。

```bash
pnpm build                                  # 前端产物
cd apps/desktop
node scripts/prepare-vendor.mjs
node scripts/build-launcher.mjs             # 需要系统 csc.exe（.NET Framework）
pnpm exec electron-builder --win nsis       # → release/HorunDrama Setup x.y.z.exe
```

绿色版：`electron-builder --win --dir` 后，在 `win-unpacked` 里放一个 `portable.txt`
（程序据此把数据写在 exe 同目录的 `data\`），再整目录打包成 zip。

> 这台开发机连 GitHub 下 Electron 会卡死，实际做法是先把
> `electron-v45.3.2-win32-x64.zip` 放进 `%LOCALAPPDATA%\electron\Cache`，并设
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 结构

```
apps/
├ core/       无头核心（Node/TS + node:sqlite）：上游取流/转码、目录/搜索/榜单、进度/收藏、设置、图片代理
├ web-next/   前端（Vite + React + zustand）：设计系统、页面、播放器封装
└ desktop/    Electron 壳：窗口、启动器、单实例、拉起核心、打包配置
docs/         方案、逆向记录、交接与进度日志
scripts/      开发脚本
```

**架构约定**：渲染进程只通过 `/api/*` 和核心说话，不直连上游；主进程只管窗口与系统能力。

## 分享续播是怎么工作的

红果官方分享链接的参数含义容易搞反（这一点踩过坑）：

```
https://novelquickapp.com/hongguo/ug/pages/video-animation-share
  ?video_id=<剧（book）id>      ← 是"剧"，不是"集"
  &vid=<分集 id>
  &share_toast_vid=<分集 id>
```

本软件解析时同时兼容两种形态：

1. 官方：`video_id` = 剧、`vid`/`share_toast_vid` = 集；
2. 老式：`book_id` = 剧、`video_id` = 集；

链接里只有剧号（整部剧分享）时，会挑"上次看到的那一集"，没有就第一集。
我们自己生成的分享链接在上述官方参数之外，额外挂 `no`（集号）和 `t`（秒），
红果网页会忽略它们，而本软件读到就能从那一秒接着播。

## 更新与反馈

- 更新：设置 → 关于 → 「检查更新」（查本仓库的 Releases），或直接看
  [Releases](https://github.com/wwww6666-dddd/HorunDrama/releases)
- 反馈：顶栏 ✎ 直接打开 [Issues](https://github.com/wwww6666-dddd/HorunDrama/issues/new)

## 许可证

本项目以 **GPL-3.0** 发布，见 [LICENSE](LICENSE)。
第三方组件与其许可证见 [NOTICE.md](NOTICE.md)。

## 免责声明

- 本项目是**第三方客户端**，仅供个人学习与技术研究；
- 所有视频、图片、评论内容均来自上游公开接口，版权归原方所有；喜欢哪部剧请去官方 App 支持正版；
- 不提供、不存储任何内容，不做破解/去水印/批量下载站；
- 请勿用于商业用途或二次分发；因使用本程序产生的一切后果由使用者自负。
