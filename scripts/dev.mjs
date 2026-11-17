/**
 * 开发入口：一条命令起「新核心 + 新前端」。
 * 前端 /api /media 由 Vite 代理到核心，页面同源，不需要 CORS。
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const PORT = process.env.HORUN_PORT ?? '5880';
const env = { ...process.env, HORUN_PORT: PORT, NODE_NO_WARNINGS: '1' };
const children = [];

function run(label, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  children.push({ label, child });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] ${label} 退出，code=${code}`);
  });
  return child;
}

console.log(`[dev] 核心 → http://127.0.0.1:${PORT}`);
run('core', 'node', ['--watch', 'apps/core/src/index.ts']);

console.log('[dev] 前端 → Vite（地址见下）');
run('web', 'pnpm', ['--filter', '@horun/web-next', 'run', 'dev']);

const shutdown = () => {
  for (const { child } of children) if (!child.killed) child.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
