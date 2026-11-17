# 交接文档（给下一个 AI）

> 更新时间：2026-11-17 11:10（Asia/Shanghai）
> 项目：`D:\红果短剧`
> 当前版本：**1.1.2**（代码里已含"自动下一集"修复，**还没打包**成 1.1.3）
> 产物：
> - 安装器 `apps/desktop/release/HorunDrama Setup 1.1.2.exe`（138MB，NSIS one-click，未签名）
> - 绿色包 `apps/desktop/release/HorunDrama-1.1.2-win64-portable.zip`（180MB）
> 当前**未解决**的问题：无。**自动下一集已找到真因并修好**（见第 5 节），
> 剩下的只是"重新打包 1.1.3"。

这篇写的是**当前真实状态**。旧交接里过时的结论（对标账号=用户抖音号、0.29.1、1.0.0 打包、
"高清靠限流自愈"等）都不要再照做。

---

## 0. 接手先看这几件事

1. `pnpm -r --parallel run typecheck` → `pnpm --filter @horun/web-next run build`，确认能过。
2. 起 core（开发）：`$env:HORUN_DATA_DIR='D:\红果短剧\data'; $env:HORUN_PORT='5881'; node apps/core/src/index.ts`
   （默认端口 5880；开发常用 5881 避开已安装版本）。
3. 前端由 core 静态托管：`http://127.0.0.1:5881`，路由是 hash（`#/feed`、`#/play/<seriesId>/<episodeId>/<no>`）。
4. **写带中文的文件只能用 `write`/`edit` 工具**，不要用 `Add-Content` / `Out-File` / PowerShell 里的
   `-replace` 拼模板字符串 —— 已经多次把文件写成乱码或把 `${x}` 吃掉。
   需要脚本化的批量改动用 `.cjs`（CommonJS，避免 ESM/`require` 混用）跑 Node，且**改完立刻 typecheck**。
5. 打包前先 `Get-Process HorunDramaCore | Stop-Process -Force`，否则 electron-builder 删
   `win-unpacked` 会报 `EBUSY`。
6. 这台机器到 GitHub 的下载经常卡死（electron 151MB zip）。**先把 zip 放好再打包**：
   `%LOCALAPPDATA%\electron\Cache\electron-v45.3.2-win32-x64.zip`
   （取自 `https://npmmirror.com/mirrors/electron/45.3.2/...`），并设
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

---

## 1. 项目是什么

短剧桌面客户端 **HorunDrama**：Electron + React + 无头 Node core。内容、播放、评论协议大量参考开源项目。

- Electron 45 / React 19 / TypeScript / Vite 7 / zustand / pnpm workspaces
- SQLite 用 **Node 内置 `node:sqlite`**（别引第三方 native）
- 内容 SDK：`openhongguo@0.3.0`（Go/WASM，红果源：目录/播放/弹幕/推荐/上新）
- 账号签名：`hgsigner`（本地 `127.0.0.1:8791`）

| 路径 | 作用 |
|---|---|
| `apps/core` | 无头 HTTP 服务（5880）：内容聚合、取流/转码、账号、SQLite |
| `apps/web-next` | React 前端；`dist` 由 core 托管；`public/reward/` 是打赏二维码 |
| `apps/desktop` | Electron 壳、C# 启动器、ffmpeg/hgsigner、NSIS 配置 |
| `apps/desktop/release` | 打包产物（不进 git） |
| `docs/进度.md` | **按时间追加的主日志**，最新结论在最后 |
| `docs/交接-给下一个AI.md` | 本文件 |
| `.tmp` | CDP / 抓包 / 反编译 / 验证脚本（不提交） |
| `data` | 开发数据（缓存、设置、会话） |

**架构铁律**

1. 渲染进程只走 `/api/*`，不直接读文件/上游。
2. Electron main 只做窗口与系统能力。
3. 账号接口必须「会话 Cookie + 签发它的账号设备」成对，否则 `100107 network err`。
4. 19 位 ID 在 JSON 里当字符串处理，别用 JS Number。

---

## 2. 快速命令

```powershell
# 类型检查 / 构建前端
pnpm -r --parallel run typecheck
pnpm --filter @horun/web-next run build

# 起后端（开发）
$env:HORUN_DATA_DIR='D:\红果短剧\data'; $env:HORUN_PORT='5881'; node apps/core/src/index.ts

# 打包（安装器 / 仅目录）
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; $env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
pnpm --filter @horun/desktop run dist    # NSIS -> release/HorunDrama Setup x.y.z.exe
pnpm --filter @horun/desktop run pack    # 仅 release/win-unpacked

# 绿色包（含便携标记与说明）
Set-Content release\win-unpacked\portable.txt "..."
Copy-Item apps\desktop\resources\使用说明.txt release\win-unpacked\ -Force
tar -a -c -f release\HorunDrama-1.1.2-win64-portable.zip -C release\win-unpacked .
```

> 版本号在 `apps/desktop/package.json` 的 `version`，改完才重新打包。

---

## 3. 当前功能状态

### 内容 / 浏览
推荐流、剧场、新剧、榜单、分类、搜索、追剧、下载——都有。首页接口缓存见 `sources/*.ts`。

### 播放（重点，理解这条链才能改）

清晰度顺序：用户偏好默认 **1080p**（`settings.defaultQuality`），上游没有就自动降级
`1080p→720p→480p→360p`（`sources/playback.ts` 的 `QUALITY_CHAIN`）。

三级取流（`sources/playback.ts`）：

1. **App 源**（`sources/appplay.ts`）：自己实现的匿名设备 + 签名，拿 HEVC + CENC + 内容密钥。
2. **SDK 兜底**：`client.resolvePlayback`（现在多数时候返回空）。
3. **官网 360p 直连**（`sources/webplay.ts`）：H.264 明文，`/api/stream/:episodeId` 同源代理。

播放模式（`media/jobs.ts`）：

- `mode: 'file'`：转码/搬运后的本地 mp4，`/api/media/<file>`，可拖动、可缓存；
- `mode: 'direct'`：`/api/stream/<ep>`（官网 360p）或 `/api/live/<ep>`（秒开流）。

**一集没缓存时的优先级（`startEpisode`，2026-11-17 两次调整，改动前先看这里）**：

| 调用方 | 顺序 |
|---|---|
| **播放页**（`wait=1`） | 本地缓存（同档 → 任意更低档）→ **等 App 源转码出本地文件**（前端轮询进度）→ 转码失败/上游起不来才退 360p 直连 |
| 推荐页 / 其它 | 本地缓存 → 官网 360p 直连 `/api/stream/<ep>`（先播起来，后台转高清再换源）→ 秒开流兜底 |

- 播放页**不再**先给 360p/秒开流：只有本地 mp4 才有完整时长和真正能拖的进度条（用户明确要求）；
- `wait=1` 只在**指定档位**（`1080p/720p/480p`）时生效；清晰度选「自动/流畅」仍走 360p 先播；
- 已缓存低档时仍然"先播低档文件 + 后台升档"，本来就是可拖的本地文件，没必要等；
- 秒开流（`/api/live`）现在只是兜底：fMP4 管道没有 moov 总时长，
  duration 随数据增长 → 进度条自己涨、拖不动，**不要**再当首选。

**秒开流**（`media/live.ts`，`/api/live/:episodeId`）：
`ffmpeg -decryption_key K -i <上游> -c copy -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1`
直接推 fMP4 给浏览器。首帧约 0.2~2s；流末尾浏览器**会**正常触发 `ended`（实测 t=dur）。

**HEVC 直接搬运**：前端探测 `CAN_PLAY_HEVC`（`src/media-support.ts`），请求带 `hevc=1`；
源是 HEVC 就 `-c copy`（**不重编码**），产物 `<id>-<quality>-hevc.mp4`，1080p 准备 1.8~2.4s。
注意：**画质增强（enhanceVideo≠off）会禁用搬运**，一律重编码 —— 实测 1080p + strong 约 **80s/集**，
关掉增强则 7~20s/集（或 hevc 搬运 2s）。"等准备好再播"的第一集要等多久就看这个。

**预加载**：`/api/preload`，以当前集为中心**前后各 N 集**（设置 `preloadCount` 默认 5，0=关闭），
顺序是"下一集优先"（+1、-1、+2、-2…），串行执行（`media/preload.ts`）。
播放页**等当前集 ready 之后才排**，避免和当前集转码抢 CPU；播到 25s 时还有一次下一集预转码。
2026-11-17 修过一个死锁：老代码"已在跑就 return"导致 `running` 卡死、之后再也不预加载（第 8.6 节 32 条）。

**转码闸门**（`jobs.ts` 的 `acquireTranscode`）：前台任务（`/api/play?wait=1` 来的）永远立刻开；
后台任务（预加载/预热/升档）必须等**没有别的转码**在跑，且一次只放一个。
没有这道闸，开画质增强时会有 3 路 ffmpeg 一起跑，CPU 被抢死（实测 3 个 0 字节 `.part.mp4`）。

### 播放器（`ui/DramaPlayer.tsx` 统一两个页面）

- 剧场页 `views/Play.tsx`、推荐页 `views/Feed.tsx` 共用 `DramaPlayer` + `ui/XgPlayer.tsx`；
- 全屏作用在**页面容器**（`.play` / `.feedv`）上，不是播放器本身 —— 否则右侧点赞/评论/收藏栏、
  弹幕层都在播放器子树外，全屏后会消失；`XgPlayer` 的 `fullscreenTarget` 也指向同一容器；
- 闲置 2.6s 自动隐藏操作栏 + 控制条（弹幕保留），鼠标移动恢复（`data-chrome-hidden`）；
- 画中画：保留同一个 `<video>` 元素，切集换 `media.src`（不销毁播放器），PiP 不会被打断；
  `navigator.mediaSession` 支持 next/prev/play/pause。

### 账号 / 评论 / 弹幕
手机号登录、签到、评论列表/回复/点赞/删除、弹幕拉取与发送都有实现；
细节见第 6 节和第 8 节的协议坑。

### UI
玻璃风格设计系统 `design/*.css`；主题 `tokens.css`（`:root` / `:root[data-theme='light']`）。
打赏弹窗 `ui/RewardDialog.tsx`（微信/支付宝二维码 + 联系方式，可复制；作者署名 `Horun`）。

版本号只认一个来源：`apps/desktop/package.json` 的 `version` → `vite.config.ts` 的
`define.__APP_VERSION__` → `src/app-info.ts` 的 `APP_VERSION`（关于页显示它）。
**不要**再拿 `/api/health` 的版本号当客户端版本（那是内核的 `0.1.0`）；
作者名统一用 `app-info.ts` 的 `APP_AUTHOR`。

---

## 4. 取流与签名（本项目最硬的部分）

### 4.1 结论先行

- 上游接口（`/novel/player/multi_video_model/player/v1`）要求 **六个签名头**，
  其中真正会被校验的是 **`x-gorgon` / `x-helios` / `x-medusa`**；
  `x-argus` / `x-ladon` 用 4 字节时间戳占位即可（对标客户端也是这么干的）。
- 触发条件：请求体 gzip、`x-ss-dp:8662`、`x-xs-from-web:0`、query 含 `_rticket`/`ts` 等。
- **缺这三个头 = HTTP 200 + 0 字节**（最坑的失败形态：不报错、不 4xx，纯空响应）。

### 4.2 关键常量（反编译得来）

- `x-helios` 明文格式：`fmt.Sprintf("%d-%d-%d", ts, license, aid)`，其中
  **license = `646637794`**、aid = `8662`（`core/pure-sign.js` 的 `heliosWith`）。
  用块密码可逆性从客户端真实 x-helios 解密出来的（`.tmp/helios-decrypt.mjs`）。
- `x-medusa` 依赖 **SM3**；**Electron 的 Node（BoringSSL）没有 sm3**，
  所以 `core/sm3.js` 提供纯 JS 实现，`pure-sign.js` / `playback-sign.js` 都走它。
  用系统 Node 跑 dev 不会暴露这个问题，**必须在 Electron 运行时下验证**：
  `$env:ELECTRON_RUN_AS_NODE=1; .\HorunDramaCore.exe script.mjs`。

### 4.3 已排除的尝试（别再重复）

两条 path、HTTP/1.1 与 h2、真签名 vs 占位签名、新老匿名设备/对标设备/账号会话、
gzip 与未压缩正文、带不带 `x-tt-dt`（注册返回的 `klink_egdi`）/`odin_tt`/`install_id`/`ttreq`
—— 全部仍是 `200 + 0`，直到补齐 gorgon/helios/medusa 才通。

### 4.4 相关文件

| 文件 | 说明 |
|---|---|
| `apps/core/src/upstream/hongguoweb/` | 从 MIT 项目移过来的签名/取流实现（含 LICENSE 与 NOTICE） |
| `core/pure-sign.js` | gorgon/helios/medusa（helios license 已修正） |
| `core/playback-sign.js` | argus/ladon（真实现） |
| `core/sm3.js` | SM3：原生优先，Electron 下降级纯 JS |
| `core/spade.js` | `spade_a` → 内容密钥（CENC AES-CTR） |
| `service/app-source.js` | 组 query/body/六个头并发请求（**我们的改动：补发 gorgon/helios/medusa**） |
| `sources/appplay.ts` | 设备/缓存/熔断/清晰度链，对外只暴露 `resolveAppStream` |
| `sources/webplay.ts` | 官网 360p 直连（`/api/video/protected/fallback-play-info`，`x-xs-from-web:1`） |

---

## 5. 自动下一集（真因已找到、已修好，dev 已验证；就差打包 1.1.3）

### 5.1 真因：播放器只创建一次，回调却停在"第一次渲染"

用户说的是"**以前的版本都能自动切集**，现在播完停在重播"。这句话就是线索。

- `ui/XgPlayer.tsx` 里播放器**只创建一次**（`useEffect(..., [])`），
  `player.on('ended', () => onEnded?.())` 拿到的是挂载那一刻那次渲染的 props；
- `Play.tsx` 的 `onEnded` 调 `neighbor(1)`，`neighbor` 依赖 `route.episodeId`；
  旧闭包里永远是"进页面那一集"，所以从第二集开始 `neighbor(1)` 算出的目标**就是当前集** →
  把 hash 设成当前集 → 路由不变 → 结束状态不解除 → 只剩「重播」；
- 结果：**每次进播放页只能自动切一次**。第 1 集播完正常，第 2 集播完就卡住；
- `onTime`（25 秒预热下一集、跳片尾）也是同一份旧闭包，同样只在第一集生效过。

为什么以前是好的、什么时候坏的：

| 版本 | 切集时的行为 | 结果 |
|---|---|---|
| v1.0.0 及更早 | 切集 `setJob(null); setStartReady(false)` → 播放器**卸载重建** | 每次都是新闭包，一直正常 |
| commit `1108be9`（"画中画切集不再取消"）起 | 为了保住画中画/全屏，去掉了这两行，改原地换源 | **回归**：回调永久停在第一集 |

为什么上一版没测出来：所有 CDP 脚本每轮都 `Page.navigate` 重新加载页面，
测到的永远是"第一次切集"。**回归测试必须连着测两轮以上。**

### 5.2 现在的实现（改这些地方之前先看这里）

1. **回调走 ref**：`ui/XgPlayer.tsx` 里 `cbs = useRef({rate, onReady, onTime, onEnded, onPlaying, onError})`，
   每次渲染赋值，事件里读 `cbs.current.xxx`。播放器仍然只创建一次（画中画/全屏靠这个）。
2. **换源方式**：`player.pause() → media.src = url → media.load() → player.play() + media.play()`；
   **不要**改回 `player.src = url`（ended 状态下 xgplayer 会忽略它）。
3. **onEnded**：只有 `prefs?.autoPlayNext === false` 才不切，`null` 按开处理；
   剧集列表三级兜底（detail → 内存/`localStorage` → 现拉）、过渡层、准备失败退 360p 都保留。
4. **转码产物唯一写者**：`INFLIGHT`（`jobs.ts`）+ `WRITING`（`transcode.ts`）两道闸门，
   同一份产物只许一个 ffmpeg 写；坏文件（重复 moov / 截断）由 `usableMedia` / `mp4IsSane` 挡掉并重转。

### 5.3 验证（dev：5881 + headless Edge 9338）

| 场景 | 脚本 | 结果 |
|---|---|---|
| 已缓存集，拖到结尾自然播完 × 5 轮（6→11 集） | `.tmp/probe-rounds.mjs` | 5/5 自动切集 |
| **纯自然播放**（不 seek，8 倍速）× 3 轮（25→28 集） | `.tmp/probe-natural.mjs` | 3/3 自动切集，新集 `currentSrc` 已是新集 |
| 未缓存集（秒开流）起播再播完（29、60 集） | `.tmp/probe-natural.mjs` | 正常切下一集 |
| `/api/live` 流末尾到底会不会 `ended` | `.tmp/probe-live2.mjs` | 会：duration 随数据增长，末尾 `t=52.3=dur` 触发 ended |
| `/api/play` + `/api/upgrade` + `/api/preload` 同时打同一集 | 见进度.md | 只有 1 次取流 + 1 次转码，产物结构正常 |
| `mp4IsSane` 单测（12 个真实文件 + 截断/拼接/过小） | `.tmp/check-mp4sane.mjs` | 真实文件全过，坏样本全拒 |

### 5.4 已知的剩余小坑

1. 换集瞬间旧画面会短暂停在 ended 帧（过渡层盖着），新集源到了才换 —— 属于设计，不是 bug；
2. 转码失败时前端会提示"播放失败：<ffmpeg 或上游原话>"，用户能点几集重试；
3. 若 `autoPlayNext` 被设置成 false，现在的代码是**故意不切**的（`data/settings.json` 可查）。

---

## 6. 借鉴过的项目（以及各自提供了什么）

| 项目 | 语言/许可 | 我们借鉴了什么 |
|---|---|---|
| `sunnysky123/hongguo-web` | JS / MIT | **主要移植来源**：App 取流（`service/app-source.js`）、纯 JS 签名（`core/pure-sign.js`）、`playback-sign.js`（真正的 Argus/Ladon）、`spade.js`（内容密钥）、HTTP/util 层。目录在 `apps/core/src/upstream/hongguoweb/`，保留 LICENSE + NOTICE |
| `jackotom/hongguo-drama` | Go / 原项目 | `hongguo-web` 的 `app-source.js` 源头（注释里写明），协议细节的最初来源 |
| `tsukiyo-zero/hongguoTV` | Kotlin / 见其仓库 | `playback-device.js` 的 ttEncrypt 是从它移植进 `hongguo-web` 的（**上游是 GPL-3.0**，见第 10 节许可证风险） |
| `yangbin1322/hongguo-player` | 闭源，仅发布二进制 | 对标客户端（`D:\AAAtest\11111\短剧播放器.exe`）。**仓库里没有源码**，只有 README + 截图。我们用反编译从它身上拿到：只签名 Gorgon/Helios/Medusa（Argus/Ladon 是 4 字节占位）、helios 的 license 常量 `646637794`、CENC 结构（`schm=cenc`、`tenc` 里 KID、moov 在文件头） |
| `openhongguo@0.3.0`（vendored SDK） | Go/WASM | 目录、推荐、弹幕、上新、评论等基础接口；播放只作为兜底 |
| xgplayer 3.0.27 | MIT | 播放器内核（我们自己包了 `ui/XgPlayer.tsx` 做换源/全屏/PiP/字幕层） |

> 提醒：`hongguo-web` 是 MIT，但 `playback-device.js` 里的 ttEncrypt 源自 GPL 项目。
> 自己用没问题；**要公开分发/商用前，必须替换那段或按 GPL 开源**（`NOTICE.md` 有记录）。

---

## 7. 逆向工具链（都在 `.tmp`，可复用）

```powershell
python .tmp\go-pclntab2.py                 # 解析 Go pclntab，导出函数表到 .tmp/go-functions.txt
python .tmp\go-disasm.py 'hg-go/pkg/crypto.heliosWith'   # capstone 反汇编 + 解析 CALL/RIP 常量
node .tmp\sign-align.mjs                   # 用客户端真实请求复算签名，逐头比对
node .tmp\helios-decrypt.mjs               # 用可逆性反解 helios 明文（得出 license 常量）
node .tmp\probe-cenc.mjs                   # 解析 CENC 盒结构（schm/tenc/KID）
```

依赖：`python -m pip install capstone`（已装）。

要点：
- 二进制是 Go 程序，**符号没剥离**，`strings` 里能看到 `hg-go/pkg/crypto.*`、`hg-go/pkg/sign.*`；
- 签名对齐是最有效的定位手段：拿客户端一次真实请求的 query/body/khronos 喂给自己的实现，
  逐个头对比，差一个字节都能看出来；
- `pure-sign` 里 helios 的分组密码可逆，反解出的明文直接给出参数。

---

## 8. 踩坑清单（血泪，别重犯）

### 8.1 文件 / 编码 / 工具
1. **不要用 `Add-Content` / `Out-File` 写中文文件**，会写成 GBK 乱码；只用 `write`/`edit`。
2. PowerShell 里 `-replace` 拼 JS 模板字符串会吃掉 `${...}` 和反引号；
   批量改代码请写 `.cjs` 脚本（CommonJS）跑，不要用 `node -e "..."` 拼中文。
3. `node -e` 里出现中文/引号极易失败，改用临时 `.mjs`/`.cjs` 文件。
4. `pnpm ... | Select-Object -Last N` 会丢掉错误前几行；构建失败先看**前 20 行**。
5. 构建报 `EPERM: copyfile public/reward/alipay.jpg -> dist/reward/alipay.jpg`：
   根因是 **`public/reward/*.jpg` 带 ReadOnly 属性**（Node 的 `copyFileSync` 在 Windows 上
   连属性一起复制，覆盖只读文件就 EPERM），**不是** core 占着文件。
   已把只读属性清掉；再遇到就 `$_.IsReadOnly = $false`，不用再删 `dist/reward` 或停 core。

### 8.2 账号 / 协议
6. 账号接口必须「Cookie + 同一账号设备」，否则 `100107`。
7. 19 位 ID 走字符串；`JSON.parse` 后不要再 `Number(...)`。
8. 上游空响应（`200 + 0`）几乎都是签名问题，不是限流；先对着第 4 节检查三个头。
9. `x-tt-dt` 是注册返回的 `klink_egdi`（不是 `device_token` 字段名）。

### 8.3 播放器 / xgplayer
10. **不要覆盖全屏的点击层**：会吃掉进度条点击，表现是"点进度条变暂停"。
11. **不要在两处同时绑单击/双击**（`XgPlayer` + `DramaPlayer`）：双击会"进全屏又退出"。
12. **全屏元素要用页面容器**（`.play` / `.feedv`），并用 `fullscreenTarget` 让 xgplayer 的 ⛶ 按钮
    也走同一个容器；否则右侧操作栏/弹幕在全屏时消失，切集还会退出全屏。
13. **换集不要用 `player.src`**（ended 状态下会被忽略）；用 `media.src + load()`，并同时
    `player.play()`，否则"重播"浮层可能残留。
14. 换源后的第一次 `canplay` 才恢复倍速/起播位置；每次 `canplay` 都 seek 会把用户拖的进度条顶回去。
15. 推荐页控制条为避让 dock 抬了 92px；**全屏时 dock 不在**，要靠
    `html.is-player-fullscreen` 把 `bottom` 改回 0。
16. 无头浏览器（headless Edge）**不支持 PiP**，PiP 相关只能在实际 Electron 窗口里验证。
17. CDP 模拟点击未必带 user-activation：`requestFullscreen` / `requestPictureInPicture`
    在 headless 下会失败，不代表代码有问题。
18. 窗口被遮挡时 Chromium 会节流定时器，2.6s 的闲置隐藏可能几十秒才触发 —— 用
    `Emulation.setFocusEmulationEnabled` 再测。

### 8.4 Feed / 布局
19. `.page` 曾因 flex 自动外边距变成 shrink-to-fit（269px），表现为"三栏 + 空白"；`width:100%` 修好。
20. dock 在浅色主题下曾用同一块深色底 + 近黑文字 → 看不见；深浅主题要分开写。
21. 推荐页信息区 `bottom` 与控制条、dock 的位置是联动的，改一个要一起看。

### 8.5 打包 / 发布
22. electron-builder 下载 electron 会卡死；预置 cache + `ELECTRON_MIRROR`（第 0 节）。
23. `win-unpacked` 被运行中的 `HorunDramaCore.exe` 锁住 → `EBUSY`；先杀进程。
24. `dist` 会清空 `win-unpacked\data`（缓存全没了），需要时可从 `data/cache/media` 复制回去。
25. 绿色版数据目录：exe 同目录有 `portable.txt` 就**直接**用 `data\`，
    不能只是"追加到候选列表"——否则 `%APPDATA%\HorunDrama` 会被"复用已有数据库"逻辑抢走。
26. 安装器未签名，SmartScreen 会提示"未知发布者"；说明文档里已注明。

### 8.6 数据 / 缓存
27. 上游偶尔提前关连接 → 半截文件被 ffmpeg 解成"只有几秒"的成品；必须校验
    `content-length` + 产物 mvhd 时长（第 5 节）。
28. 缓存文件名里带 `-hevc` 后缀（搬运版），查找时要能同时识别，不能给不支持 HEVC 的客户端播到。
29. `pruneMediaCache` 按 mtime 淘汰，别把 `data` 目录之外的路径传进来。
30. **同一份转码产物必须只有一个写者**。`jobs.ts` 的 `INFLIGHT` 占位要在**同步**阶段写入
    （早先是 `await resolveEpisodeStream()` 之后才 `set`，两个并发请求会各起一个 ffmpeg
    写同一个 `.part.mp4`，产物里出现两个 moov）；`transcode.ts` 的 `WRITING` 是第二道闸门。
31. 判断缓存文件能不能复用别只看大小：`usableMedia()` 会跑 `mp4IsSane()`（顶层 box 遍历），
    重复 moov / 截断的文件一律删除重转。这类文件 mvhd 时长正常、浏览器却
    `PIPELINE_ERROR_DECODE`，是最难查的一类"播放失败"。
32. **预加载的"世代 + running"一定是死锁高发区**。老实现是"已在跑就直接 return"，
    而收尾的 `finally { if (gen === generation) running = false }` 在被新计划取代时不会执行，
    `running` 永久为 true → 之后再也不预加载（用户看到的就是"预加载好像没生效"）。
    现在的写法：新计划只覆盖 `latest`，常驻循环每轮读最新计划；收尾时若发现
    `servedGen !== generation` 就补起一轮。改这段务必用"连续切 3 集"验证日志里出现
    `预加载完成（世代 N…）` 且 N 递增。
33. 画质增强（`enhanceVideo ≠ off`）会**禁用 HEVC 直接搬运**，单集 1080p 转码从 ~2s 变成 ~80s
    （x264 + hqdn3d/unsharp）。"等准备好再播"下第一集要等多久直接取决于这个设置。
34. **缓存文件名带增强后缀**：`<id>-1080p-strong.mp4` 与 `<id>-1080p.mp4` 是两份不同的文件，
    `existingMedia*` 只认**同后缀**。所以切换「画质增强」后，之前转好的缓存会全部不再命中、得重转
    （调试时临时关增强转出来的文件，恢复设置后就是死缓存，记得清）。
35. **转码并发要限流**：`jobs.ts` 的 `acquireTranscode(foreground)` —— 前台必须永远能立刻开，
    后台（预加载/预热/升档）一次只放一个、且要等没有别的转码在跑。
    不加这道闸，开增强时 `当前集 + 预加载 + 25s 预热` 会 3 路 ffmpeg 同时跑，等待时间翻 3 倍。

### 8.7 调试 / 测试
36. `.tmp/verify-*.mjs` 是成套的 CDP 脚本：`verify-feed-fixes`、`verify-quality-default`、
    `verify-pip3`、`verify-fs-chrome`、`verify-autonext*`、`verify-switching*` 等，
    改完对应功能跑一遍。
37. Windows 上 ffmpeg 退出后立刻 `rename` 会偶发 `EBUSY/EPERM`（句柄或杀软还没松手）：
    用 `transcode.ts` 的 `commitFile()` —— 重试 8 次，最后退化成 `copyFile + rm`。
38. 用 `Emulation.setDeviceMetricsOverride(1288x800)` 统一截图尺寸，便于对比。
39. 打包版验证要连 `9444`（`--remote-debugging-port=9444`），dev 版连 `9338`。
40. **回归自动下一集必须连着测两轮以上**：每轮 `Page.navigate` 重新加载页面的话，
    测到的永远是"第一次切集"，而这次的 bug 恰好只在第二次之后才暴露。
    用 `.tmp/probe-rounds.mjs` / `.tmp/probe-natural.mjs`（这两个不会重新加载页面）。
41. 页面里 `media.src` 换了以后，**旧的 `currentTime/duration` 还会留一会儿**：
    判断"新一集是否就绪"要看 `currentSrc` 里含不含新集的 `episodeId`，只看 `t > 1` 会误判。

### 8.8 React / 播放器（2026-11-17 的教训）

42. **播放器实例只创建一次的组件，所有事件回调必须经 ref 转发最新 props**。
    `useEffect(..., [])` 里 `player.on('ended', () => onEnded?.())` 捕获的是首次渲染的闭包；
    父组件换集后 `route` 变了，闭包里还是旧值 → 自动下一集/预热/跳片尾全部"只在第一集生效"，
    而且不报错、不抛异常、日志里什么也看不到。`ui/XgPlayer.tsx` 的 `cbs` ref 就是为这个。
43. 反过来，**"为了保住画中画/全屏而不重建播放器"这类改动，一定要同时检查闭包**：
    v1.0.0 之所以是对的，纯粹因为每次切集都卸载重建（副作用是画中画会被关掉）。
44. **卡片只要用了 `backdrop-filter`，卡片内的弹层（下拉/菜单）一定会被下一张卡片盖住**：
    `backdrop-filter` 给卡片建层叠上下文，子元素 `z-index` 再高也只在自己卡片内有效。
    这类弹层必须 `createPortal` 到 `body` + `position: fixed`（参考 `ui/Select.tsx`，
    它有"先藏在屏幕外量宽高 → 右对齐 → 下方放不下就向上"的完整实现）。
45. 弹层下面放不下时要**向上展开**，否则页面底部的下拉会被视口底边切掉。

---

## 9. 关键文件索引

| 主题 | 文件 |
|---|---|
| 取流决策 | `apps/core/src/sources/playback.ts`（`QUALITY_CHAIN`、`resolveEpisodeStream`） |
| App 取流 | `apps/core/src/sources/appplay.ts`（single-flight、熔断、缓存） |
| 官网直连 | `apps/core/src/sources/webplay.ts` |
| 秒开流 | `apps/core/src/media/live.ts` + `/api/live`（`http/api.ts`） |
| 任务/转码 | `apps/core/src/media/jobs.ts`、`transcode.ts`（HEVC 搬运、时长校验、`mp4DurationSec`） |
| 预加载 | `apps/core/src/media/preload.ts` + `POST /api/preload` |
| 签名 | `upstream/hongguoweb/core/{pure-sign,playback-sign,sm3,spade}.js` |
| 播放器 | `apps/web-next/src/ui/DramaPlayer.tsx`、`ui/XgPlayer.tsx`、`design/play.css` |
| 剧场页 | `apps/web-next/src/views/Play.tsx`（自动下一集、过渡层、清晰度、预加载） |
| 推荐页 | `apps/web-next/src/views/Feed.tsx`（滑动、`onEnded={onNext}`） |
| 设置 | `apps/core/src/store/settings.ts` + `views/Settings.tsx`（关于页在这里） |
| 下拉组件 | `apps/web-next/src/ui/Select.tsx`（portal + fixed，改之前先看第 8.8 节 38 条） |
| 版本 / 作者 | `apps/web-next/vite.config.ts`（`define.__APP_VERSION__`）+ `src/app-info.ts` |
| 打赏 | `apps/web-next/src/ui/RewardDialog.tsx` + `design/reward.css` + `public/reward/` |
| 打包 | `apps/desktop/package.json`（build 段）、`main.cjs`（数据目录）、`resources/使用说明.txt` |

---

## 10. 许可证 / 分发注意

- `apps/core/src/upstream/hongguoweb/` 来自 **MIT** 项目，保留 `LICENSE-hongguo-web`；
- 其中 `service/playback-device.js` 的 ttEncrypt **源自 GPL-3.0 项目**（见 `NOTICE.md`）；
  闭源商业分发前必须替换或开源；
- 内容来自上游公开接口，README/使用说明里已写免责声明；
- 安装包未签名。

---

## 11. 下一个 AI 的建议顺序

1. **打包 1.1.3**：代码里"自动下一集"的修复已经验证完（第 5 节），只是还没出包。
   改 `apps/desktop/package.json` 的 `version`，按第 0 节准备 electron 缓存后
   `pnpm --filter @horun/desktop run dist` + 绿色包，再用
   `.tmp/probe-rounds.mjs` / `.tmp/probe-natural.mjs` 在**打包版（CDP 9444）**上连测两轮以上。
2. 回归一遍其它近期改动：清晰度默认 1080p + 降级、预加载、全屏操作栏/闲置隐藏、画中画、
   打赏弹窗、便携模式数据目录。
3. 若要继续提升体验：把 `x-medusa` 也对齐客户端（现在能用但与客户端不是逐字节一致），
   或做 MSE+ClearKey 直连播加密源（注意第 4.3 节：上游是非分片 mp4，走不通，需要先转 fMP4）。
4. 任何"上游 200 + 0"的情况，先怀疑签名，再怀疑限流。

---

## 12. 测试脚本 / 环境

- 开发端口 5881，打包版 5880；CDP：headless Edge `9338`、打包版 `9444`；
- 账号：当前 `data/session.json` 可能不存在（无登录态），测账号功能先手机号登录；
- 本机 ffmpeg 是 2018 版（N-92722）：`h264_nvenc` 不可用（旧 NVENC SDK），
  `h264_qsv` 比 libx264 还慢，`h264_amf` 缺 dll → 实际用 `libx264 veryfast crf23`；
- 想快速造"短集"：直接把 `video.currentTime` 拖到 `duration-2`；想测自然结束就等它播完。
- 本轮新加的探测脚本（都在 `.tmp`，改播放链路后建议整套跑一遍）：

| 脚本 | 作用 |
|---|---|
| `probe-end.mjs <seriesId> cached\|live <no>` | 新开页面，起播 → 拖结尾 → 打印 `ended`/hash/过渡层/重播 |
| `probe-end2.mjs` / `probe-rounds.mjs` | **不重新加载页面**，连续多轮测自动下一集（关键回归） |
| `probe-natural.mjs <起始集> <轮数>` | 不 seek，纯自然播完（8 倍速），连测多轮 |
| `probe-live.mjs` / `probe-live2.mjs` | 秒开流路径 / 单喂一个 `<video>` 看 `/api/live` 末尾是否 `ended` |
| `probe-switch.mjs` / `probe-state.mjs` | 切集后新一集的 `media.error`、`readyState`、重播层状态 |
| `check-mp4sane.mjs` | 校验 `mp4IsSane`：真实缓存应全过，截断/拼接应全拒 |
| `probe-ui.mjs <集号>` | 一次跑完：起播源是否可拖 → 拖到 60s → 高清换源后位置是否保留 → 关于页 → 打赏弹窗 |
| `probe-load.mjs <url>` | 只加载页面确认能起播（不 seek、不触发切集） |
| `probe-select.mjs` / `probe-select-long.mjs` | 下拉是否被卡片遮住：对每个选项做 `elementFromPoint`、检查是否向上展开/右对齐/裁字 |
| `probe-wait.mjs <集号>` | 「等准备好再播」：等待层文案/进度 → 是否播本地文件、时长是否已知 → 拖到 60s 是否生效 |
