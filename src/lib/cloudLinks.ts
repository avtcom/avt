/**
 * Smart Free Cloud Link Converter
 * Automatically transforms Google Drive, Dropbox, GitHub, and YouTube share links
 * into direct APK download URLs, high-res image URLs, and playable video embeds.
 */

export function extractGoogleDriveFileId(rawUrl: string): string | null {
  const url = rawUrl.trim();
  if (!url) return null;

  // https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (fileMatch) return fileMatch[1];

  // https://drive.google.com/open?id=FILE_ID or uc?id=FILE_ID
  const idParamMatch = url.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([a-zA-Z0-9_-]+)/i);
  if (idParamMatch) return idParamMatch[1];

  // https://lh3.googleusercontent.com/d/FILE_ID=w1600
  const lh3Match = url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i);
  if (lh3Match) return lh3Match[1];

  return null;
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const url = rawUrl.trim();
  if (!url) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*\bv=)([a-zA-Z0-9_-]{11})/i,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
  ];

  for (const re of patterns) {
    const match = url.match(re);
    if (match) return match[1];
  }
  return null;
}

function normalizeDropboxUrl(url: string, mode: 'download' | 'raw'): string {
  if (!/dropbox\.com/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('dl');
    parsed.searchParams.delete('raw');
    if (mode === 'download') {
      parsed.searchParams.set('dl', '1');
    } else {
      parsed.searchParams.set('raw', '1');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeGitHubRawUrl(url: string): string {
  // Convert https://github.com/user/repo/blob/branch/path -> https://raw.githubusercontent.com/user/repo/branch/path
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (match) {
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
  }
  return url;
}

export function normalizeApkDownloadUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return '';

  const driveId = extractGoogleDriveFileId(url);
  if (driveId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`;
  }

  if (/dropbox\.com/i.test(url)) {
    return normalizeDropboxUrl(url, 'download');
  }

  return normalizeGitHubRawUrl(url);
}

export function normalizeImageUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return '';

  const driveId = extractGoogleDriveFileId(url);
  if (driveId) {
    return `https://lh3.googleusercontent.com/d/${encodeURIComponent(driveId)}=w1600`;
  }

  if (/dropbox\.com/i.test(url)) {
    return normalizeDropboxUrl(url, 'raw');
  }

  return normalizeGitHubRawUrl(url);
}

export function normalizeVideoUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return '';

  const ytId = extractYouTubeVideoId(url);
  if (ytId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?rel=0`;
  }

  const driveId = extractGoogleDriveFileId(url);
  if (driveId) {
    return `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`;
  }

  if (/dropbox\.com/i.test(url)) {
    return normalizeDropboxUrl(url, 'raw');
  }

  return normalizeGitHubRawUrl(url);
}

export function isEmbeddableVideoUrl(url: string): boolean {
  if (!url) return false;
  return (
    /drive\.google\.com\/file\/d\/[^/]+\/preview/i.test(url) ||
    /youtube(?:-nocookie)?\.com\/embed\/[a-zA-Z0-9_-]{11}/i.test(url)
  );
}

export function detectStorageHostLabel(url: string, storageProvider?: string): string {
  const lower = (url || '').toLowerCase();
  if (lower.includes('github.com') || lower.includes('githubusercontent.com')) {
    return 'GitHub Releases';
  }
  if (
    lower.includes('drive.google.com') ||
    lower.includes('googleusercontent.com') ||
    storageProvider === 'google-drive'
  ) {
    return 'Google Drive';
  }
  if (lower.includes('dropbox.com')) return 'Dropbox';
  if (lower.includes('mediafire.com')) return 'MediaFire';
  if (lower.includes('catbox.moe')) return 'Catbox Cloud';
  if (lower.includes('cloudinary.com')) return 'Cloudinary';
  if (storageProvider === 'cloud-link' || lower.startsWith('https://')) {
    return 'Cloud Storage';
  }
  return 'Direct Server';
}

export function inferFileNameFromUrl(url: string, fallbackName: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (lastSegment && lastSegment.toLowerCase().endsWith('.apk')) {
      return lastSegment.slice(0, 180);
    }
  } catch {
    // ignore
  }
  const safeBase = fallbackName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safeBase || 'DroidVault-App'}.apk`;
}
