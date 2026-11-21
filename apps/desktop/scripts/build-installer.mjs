// 用自己写的 NSIS 脚本打安装包（scripts/../installer/setup.nsi）。
//
// 不用 electron-builder 自带 NSIS 模板的原因见 setup.nsi 顶部注释与
// docs/踩坑与错误报告.md §6.8：oneClick 目录算错、assisted 模式会强行走 per-machine、
// 它的"程序还在运行"检查用 StartsWith($INSTDIR)（空串时恒真）会卡死安装。
//
// 用法：node scripts/build-installer.mjs [--version x.y.z]
//   前置：`pnpm --filter @horun/desktop run pack` 生成 release/win-unpacked（exe 已签名），
//         且 win-unpacked 里**没有** portable.txt / 使用说明.txt。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const release = join(desktop, 'release');
const payload = join(release, 'win-unpacked');
const script = join(desktop, 'installer', 'setup.nsi');
const icon = join(desktop, 'resources', 'icon.ico');

const vi = process.argv.indexOf('--version');
const version =
  vi >= 0 && process.argv[vi + 1] !== undefined
    ? process.argv[vi + 1]
    : JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version;
const outFile = join(release, `HorunDrama Setup ${version}.exe`);

if (!existsSync(payload)) throw new Error(`payload missing: ${payload}（先跑 pnpm --filter @horun/desktop run pack）`);
for (const forbidden of ['portable.txt', '使用说明.txt']) {
  if (existsSync(join(payload, forbidden))) {
    throw new Error(`win-unpacked 里有 ${forbidden}：安装包不能带便携标记/说明书，先删掉`);
  }
}

/** makensis 用 electron-builder 缓存里的那份（打包机不一定单独装了 NSIS）。 */
function findMakensis() {
  const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
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

rmSync(outFile, { force: true });
const started = Date.now();
const res = spawnSync(
  makensis,
  ['/INPUTCHARSET', 'UTF8', `/DPAYLOAD=${payload}`, `/DVERSION=${version}`, `/DOUTFILE=${outFile}`, `/DICON=${icon}`, script],
  { stdio: 'inherit', cwd: desktop },
);
if (res.status !== 0) throw new Error(`makensis failed: ${res.status}`);
if (!existsSync(outFile)) throw new Error(`makensis 说成功了但没产物：${outFile}`);
const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`[installer] ok → ${outFile}（${sizeMb}MB，${((Date.now() - started) / 1000).toFixed(0)}s）`);
console.log(`[installer] 记得签名：powershell -File scripts/sign-release.ps1 -Version ${version}`);
