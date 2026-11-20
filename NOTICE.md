# 第三方组件声明

本项目以 GPL-3.0 发布（见 [LICENSE](LICENSE)）。仓库内含以下第三方组件，各自保留其原始许可证：

| 组件 | 许可证 | 位置 |
|---|---|---|
| hongguo-web | MIT | `apps/core/src/upstream/hongguoweb/`（含 `LICENSE-hongguo-web`） |
| openhongguo | 见包内 `LICENSE` / `GO_LICENSE` | npm 依赖；打包时放入 `resources/core/node_modules/openhongguo` |
| xgplayer | MIT | 前端播放器内核 |
| Electron | MIT | 桌面运行时 |
| React / Vite / zustand | MIT | 前端 |
| FFmpeg | LGPL / GPL（取决于编译选项） | 打包时放入 `resources/ffmpeg`，二进制不入库 |
| hgsigner | 见其仓库/构建说明 | 打包时放入 `resources/hgsigner`，仅本机回环调用 |
| ttEncrypt（`playback-device.js` 内） | **源自 GPL-3.0 项目** | 见 [docs/第三方许可与安全审计.md](docs/第三方许可与安全审计.md) |

GPL-3.0 的部分源自本项目对上游协议兼容性实现的需要；分发时请保留上述许可证文件。

2.0.0 起项目**不随包分发任何字体文件**，界面只使用操作系统自带字体（Microsoft YaHei /
PingFang SC / Noto Sans SC / system-ui / Songti SC 等），无字体授权与包体积问题。
完整依赖许可与漏洞扫描结果见 [docs/第三方许可与安全审计.md](docs/第三方许可与安全审计.md)。

资源：`apps/web-next/public/reward/*.jpg` 是**占位图**，请替换成自己的收款码再分发。

内容版权：所有视频、封面、评论、弹幕均来自上游公开接口，版权归原平台与权利人所有，
本项目不主张任何内容权利。
