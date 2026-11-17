/**
 * 编译启动器：用 Windows 自带的 C# 编译器（.NET Framework 4.x 的 csc.exe），
 * 目标机器不需要装任何运行时。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const src = path.join(desktopDir, 'launcher', 'HorunDramaLauncher.cs');
const outDir = path.join(desktopDir, 'resources', 'launcher');
const outFile = path.join(outDir, 'HorunDrama.exe');

const CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

const csc = CANDIDATES.find((p) => fs.existsSync(p));
if (!csc) {
  console.error('[launcher] 找不到 csc.exe（.NET Framework 4.x 编译器），跳过启动器编译');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const ico = path.join(outDir, '..', 'icon.ico');
const res = spawnSync(csc, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${ico}`, `/out:${outFile}`, src], {
  encoding: 'utf8',
  timeout: 120_000,
});
if (res.status !== 0) {
  console.error('[launcher] 编译失败:');
  console.error((res.stdout ?? '') + (res.stderr ?? ''));
  process.exit(1);
}
const size = fs.statSync(outFile).size;
console.log(`[launcher] 已生成 ${path.relative(desktopDir, outFile)} (${(size / 1024).toFixed(0)} KB)`);
