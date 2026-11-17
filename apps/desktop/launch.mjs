/**
 * 桌面端启动器。
 *
 * 两个必须在这里兜住的坑（都实际踩过）：
 *
 * 1. 环境里残留 `ELECTRON_RUN_AS_NODE=1` 时，Electron 会以纯 Node 身份启动，
 *    `require('electron')` 拿到的是二进制路径而不是 API，窗口一个都不会开。
 *    所以这里先把该变量删掉再拉起子进程。
 * 2. 某些受限环境（沙箱化终端 / 无 GPU 会话）里 Chromium 的沙箱初始化会直接
 *    崩在启动阶段（0xC0000003 / -2147483645），连日志都来不及打。
 *    首次启动如果在几秒内异常退出，就自动用 `--no-sandbox --disable-gpu`
 *    再试一次，并把这件事明确打印出来——不静默降级。
 *
 * 正常桌面上第一次就会成功，不会走到兼容分支。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** electron 包在 Node 里 default 导出的是可执行文件路径 */
async function electronBinary() {
  const mod = await import('electron');
  const resolved = mod?.default ?? mod;
  if (typeof resolved !== 'string' || resolved === '') {
    throw new Error('没找到 electron 可执行文件，先跑一次 pnpm install');
  }
  return resolved;
}

function baseEnv() {
  const env = { ...process.env };
  // 关键：不删掉它，Electron 只会以 Node 身份跑，窗口永远不出现
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function launch(binary, extraArgs) {
  const args = [here, ...extraArgs, ...process.argv.slice(2)];
  const child = spawn(binary, args, { stdio: 'inherit', env: baseEnv(), cwd: here });
  return child;
}

/** 启动后在 windowMs 内是否还活着。返回 { alive, code } */
function probe(child, windowMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ alive: true, code: 0 });
    }, windowMs);
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ alive: false, code: code ?? (signal ? 1 : 0) });
    });
  });
}

function waitExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const binary = await electronBinary();

const first = launch(binary, []);
const result = await probe(first, 6_000);

if (result.alive) {
  // 正常情况：窗口已经开了，等用户关掉
  const code = await waitExit(first);
  process.exit(code ?? 0);
}

if (result.code === 0) {
  // 进程自己正常退出（例如 --shot 截图模式跑完），不是失败
  process.exit(0);
}

console.warn(`[launch] Electron 启动即退出（code=${result.code}），改用兼容模式重试：--no-sandbox --disable-gpu`);
const second = launch(binary, ['--no-sandbox', '--disable-gpu']);
const secondResult = await probe(second, 8_000);
if (secondResult.alive) {
  console.warn('[launch] 兼容模式已启动窗口（沙箱禁用，仅建议在受限环境使用）');
  const code = await waitExit(second);
  process.exit(code ?? 0);
}
if (secondResult.code === 0) {
  process.exit(0);
}

console.error(`[launch] 两种模式都没能启动（code=${secondResult.code}）。`);
console.error('[launch] 可以手动排查：');
console.error('  - 确认 pnpm install 完整，apps/desktop/node_modules/electron/dist/electron.exe 存在');
console.error('  - 直接跑：apps/desktop/node_modules/electron/dist/electron.exe apps/desktop --no-sandbox');
process.exit(secondResult.code || 1);
