// 用自己写的 NSIS 脚本打安装包（scripts/../installer/setup.nsi）。
//
// 不用 electron-builder 自带 NSIS 模板的原因见 setup.nsi 顶部注释与
// docs/踩坑与错误报告.md §6.8：oneClick 目录算错、assisted 模式会强行走 per-machine、
// 它的"程序还在运行"检查用 StartsWith($INSTDIR)（空串时恒真）会卡死安装。
//
// 用法：node scripts/build-installer.mjs [--version x.y.z]
//   前置：`pnpm --filter @horun/desktop run pack` 生成 release/win-unpacked（无需代码签名）。
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUninstallManifest } from './uninstall-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repoRoot = resolve(desktop, '..', '..');
const release = join(desktop, 'release');
const payload = join(release, 'build', 'win-unpacked');
const script = join(desktop, 'installer', 'setup.nsi');
const icon = join(desktop, 'resources', 'icon.ico');
const complianceFiles = ['LICENSE', 'NOTICE.md', 'FFMPEG-SOURCE.md'];

const vi = process.argv.indexOf('--version');
const version =
  vi >= 0 && process.argv[vi + 1] !== undefined
    ? process.argv[vi + 1]
    : JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version;
const outFile = join(release, `HorunDrama Setup ${version}.exe`);

function removeTree(target) {
  if (!existsSync(target)) return;
  if (!lstatSync(target).isDirectory()) {
    unlinkSync(target);
    return;
  }
  for (const entry of readdirSync(target)) removeTree(join(target, entry));
  rmdirSync(target);
}

if (!existsSync(payload)) throw new Error(`payload missing: ${payload}（先跑 pnpm --filter @horun/desktop run pack）`);
const tempBase = process.env.HORUN_BUILD_TMP;
if (!tempBase) throw new Error('请设置 HORUN_BUILD_TMP 到非系统盘临时目录，避免安装器载荷写入系统盘缓存');
mkdirSync(tempBase, { recursive: true });
const cleanPayload = mkdtempSync(join(tempBase, 'horundrama-installer-'));

// electron-builder 的 --dir 会复用 win-unpacked，旧便携版运行数据可能残留在里面。
// 从干净副本制作安装器，确保不把本机数据库、缓存或便携标记带进安装包。
cpSync(payload, cleanPayload, {
  recursive: true,
  filter(source) {
    const relative = source.slice(payload.length).replaceAll('\\', '/').replace(/^\//, '');
    if (relative === '') return true;
    if (relative === 'data' || relative.startsWith('data/')) return false;
    if (relative === 'portable.txt' || relative === '使用说明.txt') return false;
    if (relative === 'resources/使用说明.txt') return false;
    return true;
  },
});

// GPL/FFmpeg 合规文件必须进入安装包根目录：setup.nsi 会显示 LICENSE，
// 卸载清单也会包含它们。绿色包由 build-portable.ps1 复制同一组文件。
for (const name of complianceFiles) {
  const from = join(repoRoot, name);
  if (!existsSync(from)) throw new Error(`缺少合规文件：${from}`);
  copyFileSync(from, join(cleanPayload, name));
}

// 生成仅删除安装包自带文件的卸载片段。安装路径允许指向用户已有目录，
// 因此卸载不能对 $INSTDIR 做递归删除。
writeFileSync(join(cleanPayload, '.horundrama-uninstall.nsh'), createUninstallManifest(cleanPayload), 'utf8');

/** makensis 用 electron-builder 缓存里的那份（打包机不一定单独装了 NSIS）。 */
function findMakensis() {
  const cache = process.env.ELECTRON_BUILDER_CACHE ?? join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
  if (existsSync(cache)) {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-ChildItem '${cache}' -Directory -Filter 'nsis-*' -ErrorAction SilentlyContinue | ` +
          `ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter makensis.exe -ErrorAction SilentlyContinue } | ` +
          `Select-Object -First 1 -ExpandProperty FullName`,
      ],
      { encoding: 'utf8' },
    ).trim();
    if (out !== '') return out;
  }
  const which = spawnSync('where', ['makensis.exe'], { encoding: 'utf8' });
  const hit = which.stdout?.split(/\r?\n/).find((line) => line.trim() !== '');
  if (hit) return hit.trim();
  throw new Error('找不到 makensis.exe（需要 electron-builder 缓存或单独安装 NSIS）');
}

const makensis = findMakensis();
console.log(`[installer] makensis = ${makensis}`);
console.log(`[installer] payload  = ${payload}`);
console.log(`[installer] version  = ${version}`);

try {
  rmSync(outFile, { force: true });
  const started = Date.now();
  const res = spawnSync(
    makensis,
    ['/INPUTCHARSET', 'UTF8', `/DPAYLOAD=${cleanPayload}`, `/DVERSION=${version}`, `/DOUTFILE=${outFile}`, `/DICON=${icon}`, script],
    { stdio: 'inherit', cwd: desktop },
  );
  if (res.status !== 0) throw new Error(`makensis failed: ${res.status}`);
  if (!existsSync(outFile)) throw new Error(`makensis 说成功了但没产物：${outFile}`);
  const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`[installer] ok → ${outFile}（${sizeMb}MB，${((Date.now() - started) / 1000).toFixed(0)}s）`);
  console.log('[installer] 安装包可在未签名状态下安装；Windows SmartScreen 可能显示未知发布者提示。');
} finally {
  removeTree(cleanPayload);
}
