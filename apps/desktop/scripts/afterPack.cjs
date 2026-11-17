/**
 * electron-builder 的 afterPack：把打包出来的 Electron 主程序改名成 YiMuCore.exe，
 * 再用我们的小启动器顶替 YiMu.exe。
 *
 * 这样用户「双击 YiMu.exe」时，实际先跑启动器，由它带上 --no-sandbox 再拉起核心程序
 * ——解决了这台机器上不带该参数就崩在原生初始化的问题（详见 launcher/YiMuLauncher.cs）。
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productFilename; // 例如 YiMu
  const original = path.join(appOutDir, `${productName}.exe`);
  const core = path.join(appOutDir, `${productName}Core.exe`);
  const launcher = path.join(__dirname, '..', 'resources', 'launcher', 'HorunDrama.exe');

  if (!fs.existsSync(original)) {
    throw new Error(`[afterPack] 找不到主程序: ${original}`);
  }
  if (!fs.existsSync(launcher)) {
    throw new Error(`[afterPack] 找不到启动器，先跑 node scripts/build-launcher.mjs`);
  }

  // 先把真正的 Electron 主程序改名，再用启动器顶替它的位置
  if (!fs.existsSync(core)) fs.renameSync(original, core);
  else fs.rmSync(original, { force: true });

  fs.copyFileSync(launcher, original);
  const size = fs.statSync(original).size;

  console.log(`[afterPack] ${productName}.exe = 启动器 (${size} 字节)；核心程序 ${path.basename(core)}`);
};
