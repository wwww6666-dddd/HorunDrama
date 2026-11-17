# 第三方组件与许可证声明（NOTICE）

本项目自身以 GPL-3.0 发布。以下第三方代码/资源有各自的许可证，分发时请一并保留。

## 代码

| 组件 | 许可证 | 用途 / 位置 |
|---|---|---|
| [sunnysky123/hongguo-web](https://github.com/sunnysky123/hongguo-web) | **MIT** | App 源取流、纯 JS 签名、内容密钥、HTTP 工具层。已移植到 `apps/core/src/upstream/hongguoweb/`，保留 `LICENSE-hongguo-web` |
| [tsukiyo-zero/hongguoTV](https://github.com/tsukiyo-zero/hongguoTV) | **GPL-3.0** | `service/playback-device.js` 里的 ttEncrypt 从这里移植；视频 tab 取流参数也参考它。**这也是本项目整体选择 GPL-3.0 的原因** |
| [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama) | 见原仓库 | 上游协议的早期来源（`app-source.js` 注释里注明） |
| [openhongguo](https://www.npmjs.com/package/openhongguo) `^0.3.0` | 见包内 `LICENSE` / `GO_LICENSE` | Go/WASM 内容 SDK：目录、推荐、弹幕、上新、评论 |
| [xgplayer](https://github.com/bytedance/xgplayer) `3.0.27` | **MIT** | 播放器内核（`apps/web-next/src/ui/XgPlayer.tsx` 封装） |
| [Electron](https://www.electronjs.org/) `45.x` | **MIT** | 桌面壳 |
| [React](https://react.dev/) `19.x` / [Vite](https://vite.dev/) `7.x` / [zustand](https://zustand.docs.pmnd.rs/) | **MIT** | 前端框架与状态 |
| [FFmpeg](https://ffmpeg.org/) | LGPL/GPL（取决于编译选项） | 转码、解密、切片。**二进制不入库**，请自行获取并遵守其许可证 |

## 资源

| 资源 | 说明 |
|---|---|
| `apps/web-next/public/reward/*.jpg` | 打赏二维码**占位图**。仓库里故意用占位图，请替换成你自己的收款码 |
| 图标 / 启动图 | 本项目自有 |

## 参考的第三方程序

`yangbin1322/hongguo-player`（闭源，仅发布二进制）：仅用于协议兼容性研究
（签名头集合、CENC 结构等）。仓库中**不包含**其任何代码。

## 内容版权

所有视频、封面、评论、弹幕内容均来自上游公开接口，版权归原平台与权利人所有。
本项目不主张任何内容权利，也不提供内容下载站服务。
