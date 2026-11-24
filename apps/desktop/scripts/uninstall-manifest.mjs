import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function createUninstallManifest(root) {
  const files = [];
  const directories = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute);
      const normalized = rel.split(sep).join('/');
      if (normalized === 'data' || normalized.startsWith('data/')) continue;
      if (normalized === '.horundrama-uninstall.nsh') continue;
      if (/["$\r\n]/.test(rel)) throw new Error(`安装载荷包含不安全的文件名: ${rel}`);
      if (entry.isDirectory()) {
        walk(absolute);
        directories.push(rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(root);

  files.sort();
  directories.sort((a, b) => b.split(sep).length - a.split(sep).length);
  const commands = files.map((rel) => `Delete "$INSTDIR\\${rel.split(sep).join('\\')}"`);
  commands.push('Delete "$INSTDIR\\.horundrama-uninstall.nsh"');
  commands.push(...directories.map((rel) => `RMDir "$INSTDIR\\${rel.split(sep).join('\\')}"`));
  return `${commands.join('\r\n')}\r\n`;
}
