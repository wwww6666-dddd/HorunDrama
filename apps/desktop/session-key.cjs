const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 读取/生成会话加密密钥。
 *
 * 为什么不直接抛错：
 *   - DPAPI 密文可能因为改密码、换用户/换机、权限变化而无法解密；旧实现会让
 *     `boot()` 抛异常，应用启动即退（用户看到的是无提示闪退）。
 *   - 数据目录不可写（例如在受限沙箱里运行、磁盘只读）时，旧实现同样抛错；
 *     现在退化成“本次不加密会话”，让应用仍能启动。
 * 重新生成密钥只会让旧账号会话失效（需要重新登录），不影响播放/本地数据。
 * 覆盖写用截断写而不是“先删再建”：Windows 杀软可能短暂锁住刚读过的文件，
 * 先删再以 `wx` 创建会撞 EEXIST 然后误判为并发、退化成空密钥。
 */
function getOrCreateSessionKey({ safeStorage, filePath, randomBytes = crypto.randomBytes, warn = console.warn }) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return '';

  const readKey = () => safeStorage.decryptString(fs.readFileSync(filePath));
  const newKey = () => randomBytes(32).toString('hex');
  const persist = (key, flag) => fs.writeFileSync(filePath, safeStorage.encryptString(key), flag ? { flag } : {});

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (err) {
    warn('[session-key] 无法创建数据目录，会话密钥将不加密:', err.message);
    return '';
  }

  if (fs.existsSync(filePath)) {
    try {
      return readKey();
    } catch (err) {
      warn('[session-key] 旧会话密钥无法解密，将重新生成:', err.message);
      const key = newKey();
      try {
        persist(key); // 覆盖写：DPAPI 密文不可用时直接换新密钥
        return key;
      } catch (writeErr) {
        warn('[session-key] 会话密钥重写失败，本次不加密:', writeErr.message);
        return '';
      }
    }
  }

  const key = newKey();
  try {
    persist(key, 'wx');
    return key;
  } catch (err) {
    if (err.code !== 'EEXIST') {
      warn('[session-key] 会话密钥写入失败，本次不加密:', err.message);
      return '';
    }
    // 另一进程刚创建：优先用它的；读不出来（损坏）则覆盖重写。
    try {
      return readKey();
    } catch (readErr) {
      warn('[session-key] 并发创建的会话密钥无法解密，将覆盖重写:', readErr.message);
      try {
        persist(key);
        return key;
      } catch (writeErr) {
        warn('[session-key] 会话密钥重写失败，本次不加密:', writeErr.message);
        return '';
      }
    }
  }
}

module.exports = { getOrCreateSessionKey };
