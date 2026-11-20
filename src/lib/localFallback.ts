import type { AdminUserRecord, AppRelease, AuthUser } from '../types';

const ADMIN_EMAIL = 'sasindu#@gmail.com';
const ADMIN_PASSWORD = 'dilan1';

const APPS_KEY = 'dv_fallback_apps_v1';
const USERS_KEY = 'dv_fallback_users_v1';
const SESSION_KEY = 'dv_fallback_session_v1';
const IDB_NAME = 'droidvault_blobs_v1';
const IDB_STORE = 'blobs';

interface StoredLocalUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: 'user';
  createdAt: string;
  downloadHistory: Array<{
    appId: string;
    appName: string;
    version: string;
    downloadedAt: string;
  }>;
}

const DEFAULT_DEMO_APP: AppRelease = {
  id: 'app-novadroid-demo',
  name: 'NovaDroid Smart Suite',
  tagline: 'Fast, secure, and lightweight Android utility suite built for everyday productivity.',
  description:
    'NovaDroid Smart Suite brings daily activity tracking, device usage analytics, quick system shortcuts, and encrypted cloud sync into one clean Android experience. Download the signed APK directly with zero ads or bloat.',
  whatsNew:
    '• Added Dark Vault security controls with biometric lock support\n• Reduced battery and background data usage with a refreshed interface\n• Full compatibility for Android 14 and Android 15 devices',
  version: '2.4.0',
  packageId: 'com.droidvault.novadroid',
  category: 'Utilities & Productivity',
  minAndroid: 'Android 10.0+',
  developer: 'Sasindu Studios',
  iconUrl: './src/assets/images/app_icon_main_1795134477355.jpg',
  apkUrl: 'idb://sample-apk',
  apkFileName: 'NovaDroid-Toolkit-v2.4.0.apk',
  apkSizeBytes: 65645,
  apkSha256: '4b9c8d0f6e2a1f3c5b7d9e1a3c5e7f9b2d4f6a8c0e2a4c6e8f0a2b4d6f8a0c2e',
  screenshots: [
    './src/assets/images/screenshot_1_home_1795134478331.jpg',
    './src/assets/images/screenshot_2_analytics_1795134479546.jpg',
    './src/assets/images/screenshot_3_tools_1795134484184.jpg',
    './src/assets/images/screenshot_4_settings_1795134480533.jpg',
  ],
  videoUrl: '',
  videoFileName: '',
  downloads: 1248,
  featured: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const blobObjectUrlCache = new Map<string, string>();
const memoryStore = new Map<string, string>();

function safeGetItem(key: string): string | null {
  try {
    const val = localStorage.getItem(key);
    if (val !== null) return val;
  } catch {
    // fallback to memory store
  }
  return memoryStore.get(key) ?? null;
}

function safeSetItem(key: string, value: string): void {
  memoryStore.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures on strict file:// origins
  }
}

function safeRemoveItem(key: string): void {
  memoryStore.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlob(key: string, file: Blob): Promise<string> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(file, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // On restricted file:// origins where IndexedDB is blocked, keep blob URL in memory for the session
  }
  const url = URL.createObjectURL(file);
  blobObjectUrlCache.set(key, url);
  return `idb://${key}`;
}

async function getBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openBlobDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function resolveMediaUrl(url: string): Promise<string> {
  if (!url || !url.startsWith('idb://')) return url;
  const key = url.slice(6);
  const cached = blobObjectUrlCache.get(key);
  if (cached) return cached;
  const blob = await getBlob(key);
  if (!blob) return '';
  const objUrl = URL.createObjectURL(blob);
  blobObjectUrlCache.set(key, objUrl);
  return objUrl;
}

function readRawApps(): AppRelease[] {
  try {
    const raw = safeGetItem(APPS_KEY);
    if (raw) return JSON.parse(raw) as AppRelease[];
  } catch {
    // ignore
  }
  const initial = [DEFAULT_DEMO_APP];
  writeRawApps(initial);
  return initial;
}

function writeRawApps(apps: AppRelease[]): void {
  safeSetItem(APPS_KEY, JSON.stringify(apps));
}

function readUsers(): StoredLocalUser[] {
  try {
    const raw = safeGetItem(USERS_KEY);
    if (raw) return JSON.parse(raw) as StoredLocalUser[];
  } catch {
    // ignore
  }
  return [];
}

function writeUsers(users: StoredLocalUser[]): void {
  safeSetItem(USERS_KEY, JSON.stringify(users));
}

export async function localFetchApps(): Promise<AppRelease[]> {
  const apps = readRawApps();
  const hydrated = await Promise.all(
    apps.map(async (a) => {
      const iconUrl = await resolveMediaUrl(a.iconUrl);
      const videoUrl = await resolveMediaUrl(a.videoUrl);
      const shots = (await Promise.all(a.screenshots.map((s) => resolveMediaUrl(s)))) as [
        string,
        string,
        string,
        string,
      ];
      return { ...a, iconUrl, videoUrl, screenshots: shots };
    })
  );
  return hydrated.sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function localGetCurrentUser(): AuthUser | null {
  try {
    const raw = safeGetItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { role: 'admin' | 'user'; id: string; email: string };
    if (session.role === 'admin') {
      return {
        id: 'admin-root',
        name: 'Sasindu Admin',
        email: ADMIN_EMAIL,
        role: 'admin',
        createdAt: '',
        downloadHistory: [],
      };
    }
    const found = readUsers().find((u) => u.id === session.id);
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      email: found.email,
      role: 'user',
      createdAt: found.createdAt,
      downloadHistory: found.downloadHistory,
    };
  } catch {
    return null;
  }
}

export function localRegisterOrAuth(payload: {
  name?: string;
  email: string;
  password: string;
}): { user: AuthUser; token: string } {
  const email = payload.email.trim().toLowerCase();
  const password = payload.password;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const adminUser: AuthUser = {
      id: 'admin-root',
      name: 'Sasindu Admin',
      email: ADMIN_EMAIL,
      role: 'admin',
      createdAt: new Date().toISOString(),
      downloadHistory: [],
    };
    safeSetItem(SESSION_KEY, JSON.stringify({ role: 'admin', id: adminUser.id, email }));
    return { user: adminUser, token: 'local-admin' };
  }

  if (!email || !email.includes('@') || !email.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }
  if (password.length < 4) {
    throw new Error('Password must be at least 4 characters long.');
  }

  const users = readUsers();
  if (email === ADMIN_EMAIL || users.some((u) => u.email === email)) {
    throw new Error('An account with this email already exists. Please sign in.');
  }

  const newUser: StoredLocalUser = {
    id: `usr-${Date.now().toString(36)}`,
    name: payload.name?.trim() || email.split('@')[0],
    email,
    password,
    role: 'user',
    createdAt: new Date().toISOString(),
    downloadHistory: [],
  };
  users.unshift(newUser);
  writeUsers(users);
  safeSetItem(SESSION_KEY, JSON.stringify({ role: 'user', id: newUser.id, email }));

  return {
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: 'user',
      createdAt: newUser.createdAt,
      downloadHistory: [],
    },
    token: `local-${newUser.id}`,
  };
}

export function localLoginAuth(payload: {
  email: string;
  password: string;
}): { user: AuthUser; token: string } {
  const email = payload.email.trim().toLowerCase();
  const password = payload.password;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const adminUser: AuthUser = {
      id: 'admin-root',
      name: 'Sasindu Admin',
      email: ADMIN_EMAIL,
      role: 'admin',
      createdAt: new Date().toISOString(),
      downloadHistory: [],
    };
    safeSetItem(SESSION_KEY, JSON.stringify({ role: 'admin', id: adminUser.id, email }));
    return { user: adminUser, token: 'local-admin' };
  }

  const found = readUsers().find((u) => u.email === email && u.password === password);
  if (!found) {
    throw new Error('Invalid email address or password.');
  }
  safeSetItem(SESSION_KEY, JSON.stringify({ role: 'user', id: found.id, email }));

  return {
    user: {
      id: found.id,
      name: found.name,
      email: found.email,
      role: 'user',
      createdAt: found.createdAt,
      downloadHistory: found.downloadHistory,
    },
    token: `local-${found.id}`,
  };
}

export function localLogout(): void {
  safeRemoveItem(SESSION_KEY);
}

export function localFetchAdminUsers(): AdminUserRecord[] {
  return readUsers().map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt,
    downloadsCount: u.downloadHistory.length,
  }));
}

export async function localUploadApp(
  formData: FormData,
  options: { editAppId?: string | null; onProgress?: (percent: number) => void }
): Promise<AppRelease> {
  options.onProgress?.(25);
  const apps = readRawApps();
  const now = new Date().toISOString();
  const existing = options.editAppId ? apps.find((a) => a.id === options.editAppId) : null;

  const apkFile = formData.get('apk') instanceof File ? (formData.get('apk') as File) : null;
  const iconFile = formData.get('icon') instanceof File ? (formData.get('icon') as File) : null;
  const videoFile = formData.get('video') instanceof File ? (formData.get('video') as File) : null;
  const externalApkUrl = String(formData.get('apkUrl') ?? '').trim();

  if (!existing && !apkFile && !externalApkUrl) {
    throw new Error('Please select an Android APK file (.apk).');
  }

  const id = existing ? existing.id : `app-${Date.now().toString(36)}`;

  let apkUrl = existing?.apkUrl || '';
  let apkFileName = existing?.apkFileName || '';
  let apkSizeBytes = existing?.apkSizeBytes || 0;
  let apkSha256 = existing?.apkSha256 || DEFAULT_DEMO_APP.apkSha256;
  if (apkFile) {
    apkUrl = await saveBlob(`${id}-apk-${Date.now()}`, apkFile);
    apkFileName = apkFile.name;
    apkSizeBytes = apkFile.size;
  } else if (externalApkUrl) {
    apkUrl = externalApkUrl;
    apkFileName = String(formData.get('apkFileName') ?? '').trim() || apkFileName || 'app.apk';
    apkSizeBytes = Number(formData.get('apkSizeBytes')) || apkSizeBytes;
    const extSha = String(formData.get('apkSha256') ?? '').trim();
    if (extSha) apkSha256 = extSha;
  }

  let iconUrl = existing?.iconUrl || '';
  const externalIconUrl = String(formData.get('iconUrl') ?? '').trim();
  if (iconFile) {
    iconUrl = await saveBlob(`${id}-icon-${Date.now()}`, iconFile);
  } else if (externalIconUrl) {
    iconUrl = externalIconUrl;
  }

  options.onProgress?.(60);

  const screenshots: [string, string, string, string] = existing
    ? ([...existing.screenshots] as [string, string, string, string])
    : ['', '', '', ''];
  for (let i = 0; i < 4; i++) {
    const shot = formData.get(`screenshot${i}`);
    const externalShotUrl = String(formData.get(`screenshotUrl${i}`) ?? '').trim();
    if (shot instanceof File) {
      screenshots[i] = await saveBlob(`${id}-shot${i}-${Date.now()}`, shot);
    } else if (externalShotUrl) {
      screenshots[i] = externalShotUrl;
    } else if (existing && formData.get(`clearScreenshot${i}`) === 'true') {
      screenshots[i] = '';
    }
  }

  let videoUrl = existing?.videoUrl || '';
  let videoFileName = existing?.videoFileName || '';
  const externalVideoUrl = String(formData.get('videoUrl') ?? '').trim();
  if (videoFile) {
    videoUrl = await saveBlob(`${id}-video-${Date.now()}`, videoFile);
    videoFileName = videoFile.name;
  } else if (externalVideoUrl) {
    videoUrl = externalVideoUrl;
    videoFileName = String(formData.get('videoFileName') ?? '').trim() || videoFileName;
  } else if (existing && formData.get('clearVideo') === 'true') {
    videoUrl = '';
    videoFileName = '';
  }

  const isFeatured = String(formData.get('featured') ?? 'true') !== 'false';
  if (isFeatured) {
    for (const a of apps) a.featured = false;
  }

  let driveFileIds = existing?.driveFileIds;
  const rawDriveIds = String(formData.get('driveFileIds') ?? '').trim();
  if (rawDriveIds) {
    try {
      driveFileIds = JSON.parse(rawDriveIds) as AppRelease['driveFileIds'];
    } catch {
      // ignore
    }
  }

  const rawProvider = String(formData.get('storageProvider') ?? '');
  const storageProvider: AppRelease['storageProvider'] =
    rawProvider === 'google-drive' || rawProvider === 'cloud-link' || rawProvider === 'server'
      ? rawProvider
      : existing?.storageProvider || 'server';

  const record: AppRelease = {
    id,
    name: String(formData.get('name') ?? existing?.name ?? 'Untitled App').trim(),
    tagline:
      String(formData.get('tagline') ?? existing?.tagline ?? '').trim() ||
      'Download the official Android APK directly.',
    description: String(formData.get('description') ?? existing?.description ?? '').trim(),
    whatsNew: String(formData.get('whatsNew') ?? existing?.whatsNew ?? '').trim(),
    version: String(formData.get('version') ?? existing?.version ?? '1.0.0').trim() || '1.0.0',
    packageId:
      String(formData.get('packageId') ?? existing?.packageId ?? '').trim() || 'com.droidvault.app',
    category:
      String(formData.get('category') ?? existing?.category ?? '').trim() || 'Android App',
    minAndroid:
      String(formData.get('minAndroid') ?? existing?.minAndroid ?? '').trim() || 'Android 8.0+',
    developer:
      String(formData.get('developer') ?? existing?.developer ?? '').trim() || 'Sasindu Studios',
    iconUrl,
    apkUrl,
    apkFileName,
    apkSizeBytes,
    apkSha256,
    screenshots,
    videoUrl,
    videoFileName,
    downloads: existing?.downloads || 0,
    featured: isFeatured || apps.length === 0,
    storageProvider,
    driveFileIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existing) {
    const idx = apps.findIndex((a) => a.id === existing.id);
    apps[idx] = record;
  } else {
    apps.unshift(record);
  }
  writeRawApps(apps);
  options.onProgress?.(100);
  return record;
}

export function localSetFeatured(appId: string): void {
  const apps = readRawApps();
  for (const a of apps) a.featured = a.id === appId;
  writeRawApps(apps);
}

export function localDeleteApp(appId: string): void {
  const apps = readRawApps().filter((a) => a.id !== appId);
  if (apps.length > 0 && !apps.some((a) => a.featured)) {
    apps[0].featured = true;
  }
  writeRawApps(apps);
}

export async function localTriggerDownload(app: AppRelease): Promise<void> {
  const apps = readRawApps();
  const target = apps.find((a) => a.id === app.id);
  if (target) {
    target.downloads += 1;
    writeRawApps(apps);
  }

  const directUrl = target?.apkUrl || app.apkUrl;
  if (directUrl && (directUrl.startsWith('https://') || directUrl.startsWith('http://'))) {
    const link = document.createElement('a');
    link.href = directUrl;
    link.rel = 'noopener noreferrer';
    link.download = app.apkFileName || `${app.name}.apk`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  let blob: Blob | null = null;
  if (target?.apkUrl?.startsWith('idb://') && target.apkUrl !== 'idb://sample-apk') {
    blob = await getBlob(target.apkUrl.slice(6));
  }
  if (!blob) {
    blob = new Blob(
      [
        `PK\x03\x04DroidVault Android Package (${app.name} v${app.version})\nUpload your signed .apk file inside Admin Studio.`,
      ],
      { type: 'application/vnd.android.package-archive' }
    );
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = app.apkFileName || `${app.name}.apk`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
