import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 新前端只认新核心（apps/core）。旧服务端 5878 冻结，不再对接。
const CORE = process.env.HORUN_CORE ?? 'http://127.0.0.1:5880';

/**
 * 版本号只认一个来源：`apps/desktop/package.json`（打包时 electron-builder 用的就是这个）。
 * 以前关于页显示的是核心的 0.1.0，和安装包版本对不上。
 */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  server: {
    port: 5274,
    strictPort: false,
    proxy: {
      '/api': { target: CORE, changeOrigin: false },
      '/media': { target: CORE, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
});
