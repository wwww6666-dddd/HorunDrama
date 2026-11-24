function isTrustedRendererUrl(raw, origin, isDev = false) {
  try {
    const parsed = new URL(String(raw));
    if (parsed.protocol !== 'http:' || parsed.username !== '' || parsed.password !== '') return false;
    if (parsed.origin === origin) return true;
    return isDev && (parsed.origin === 'http://127.0.0.1:5274' || parsed.origin === 'http://localhost:5274');
  } catch {
    return false;
  }
}

function allowedPortableAssetName(name) {
  return /^HorunDrama-(\d+\.\d+\.\d+)-win64-portable\.zip$/i.test(String(name));
}

function isAllowedUpdateAsset(rawUrl, rawName) {
  try {
    const url = new URL(String(rawUrl));
    const name = String(rawName ?? '');
    if (
      url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
    ) return false;
    const match = url.pathname.match(
      /^\/wwww6666-dddd\/HorunDrama\/releases\/download\/v(\d+\.\d+\.\d+)\/([^/]+)$/i,
    );
    if (!match || !allowedPortableAssetName(name)) return false;
    return decodeURIComponent(match[2]) === name && name.toLowerCase() === `horundrama-${match[1]}-win64-portable.zip`.toLowerCase();
  } catch {
    return false;
  }
}

function isAllowedUpdateRedirect(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return (
      url.protocol === 'https:' && url.username === '' && url.password === '' &&
      (url.hostname === 'github.com' || url.hostname === 'release-assets.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

module.exports = { isTrustedRendererUrl, isAllowedUpdateAsset, isAllowedUpdateRedirect };
