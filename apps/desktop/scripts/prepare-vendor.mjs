/**
 * 打包前把运行时要用的第三方包「实体化」到 apps/desktop/vendor 下。
 *
 * 为什么需要：pnpm 的 node_modules 是符号链接结构，electron-builder 很难稳定地
 * 把 .pnpm 里的真实目录塞进 asar。这里把解析到的目录整份复制（跟随符号链接），
 * 打包配置再把它映射到 app.asar/node_modules/openhongguo，服务端里的
 * `import 'openhongguo'` 就能正常解析。
 *
 * 不用 fs.cpSync({dereference:true})：在本机 Node 24 上对 .pnpm 里的链接目录会
 * 直接 fast-fail（0xC0000409）。手写递归复制是稳的。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
// 依赖解析基准改成 apps/core（旧的 apps/server 已删除）
const coreRequire = createRequire(path.join(repoRoot, 'apps', 'core', 'package.json'));

const packages = ['openhongguo'];
const vendorDir = path.join(desktopDir, 'vendor');

function copyDir(from, to, depth = 0) {
  if (depth > 12) throw new Error(`目录层级过深: ${from}`);
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest, depth + 1);
    } else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(src);
      if (fs.statSync(real).isDirectory()) copyDir(real, dest, depth + 1);
      else fs.copyFileSync(real, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorDir, { recursive: true });

for (const name of packages) {
  let entry;
  try {
    // 该包的 exports 只暴露 "."，所以不能 resolve(`${name}/package.json`)
    entry = coreRequire.resolve(name);
  } catch {
    console.error(`[vendor] 找不到 ${name}，先在 apps/core 里 pnpm add ${name}`);
    process.exit(1);
  }
  let src = path.dirname(entry);
  let guard = 0;
  while (!fs.existsSync(path.join(src, 'package.json')) && guard++ < 12) {
    const parent = path.dirname(src);
    if (parent === src) break;
    src = parent;
  }
  const dest = path.join(vendorDir, name);
  copyDir(src, dest);
  console.log(`[vendor] ${name} → vendor/${name} (${(dirSize(dest) / 1048576).toFixed(1)} MiB)`);
}
