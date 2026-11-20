import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.resolve(__dirname, 'dist');
const USE_DIST =
  process.env.NODE_ENV === 'production' ||
  (process.env.NODE_ENV !== 'development' && fs.existsSync(path.join(DIST_DIR, 'index.html')));

// Secret admin trigger credentials requested by the user
const ADMIN_EMAIL = 'sasindu#@gmail.com';
const ADMIN_PASSWORD = 'dilan1';

const DATA_DIR = path.resolve(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const APK_DIR = path.join(UPLOADS_DIR, 'apk');
const ICON_DIR = path.join(UPLOADS_DIR, 'icons');
const SCREENSHOT_DIR = path.join(UPLOADS_DIR, 'screenshots');
const VIDEO_DIR = path.join(UPLOADS_DIR, 'videos');

for (const dir of [DATA_DIR, UPLOADS_DIR, APK_DIR, ICON_DIR, SCREENSHOT_DIR, VIDEO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

interface AppRelease {
  id: string;
  name: string;
  tagline: string;
  description: string;
  whatsNew: string;
  version: string;
  packageId: string;
  category: string;
  minAndroid: string;
  developer: string;
  iconUrl: string;
  apkUrl: string;
  apkFileName: string;
  apkSizeBytes: number;
  apkSha256: string;
  screenshots: [string, string, string, string];
  videoUrl: string;
  videoFileName: string;
  downloads: number;
  featured: boolean;
  storageProvider?: 'server' | 'google-drive';
  driveFileIds?: {
    apk?: string;
    icon?: string;
    screenshots?: [string, string, string, string];
    video?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  role: 'user';
  createdAt: string;
  downloadHistory: Array<{
    appId: string;
    appName: string;
    version: string;
    downloadedAt: string;
  }>;
}

interface StoreData {
  sessionSecret: string;
  apps: AppRelease[];
  users: UserRecord[];
}

interface SessionPayload {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  iat: number;
}

function createSampleApkFile(): { fileName: string; sizeBytes: number; sha256: string; url: string } {
  const fileName = 'NovaDroid-Toolkit-v2.4.0.apk';
  const filePath = path.join(APK_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    const header = Buffer.from(
      'PK\x03\x04DroidVault Sample Android Release Package — Replace with your own signed .apk inside the Admin Studio.\n',
      'utf8'
    );
    const padding = Buffer.alloc(64 * 1024, 0x20);
    fs.writeFileSync(filePath, Buffer.concat([header, padding]));
  }
  const fileBuf = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
  return {
    fileName,
    sizeBytes: fileBuf.length,
    sha256,
    url: `/uploads/apk/${fileName}`,
  };
}

function loadStore(): StoreData {
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as StoreData;
      if (!parsed.sessionSecret) {
        parsed.sessionSecret = crypto.randomBytes(32).toString('hex');
      }
      if (!Array.isArray(parsed.apps)) parsed.apps = [];
      if (!Array.isArray(parsed.users)) parsed.users = [];
      // Migrate initial demo release copy to English if it still contains default Sinhala text
      const demo = parsed.apps.find((a) => a.id === 'app-novadroid-demo');
      if (demo && /[\u0D80-\u0DFF]/.test(demo.tagline || '')) {
        demo.tagline =
          'Fast, secure, and lightweight Android utility suite built for everyday productivity.';
        demo.description =
          'NovaDroid Smart Suite brings daily activity tracking, device usage analytics, quick system shortcuts, and encrypted cloud sync into one clean Android experience. Download the signed APK directly with zero ads or bloat.';
        demo.whatsNew =
          '• Added Dark Vault security controls with biometric lock support\n• Reduced battery and background data usage with a refreshed interface\n• Full compatibility for Android 14 and Android 15 devices';
        saveStore(parsed);
      }
      return parsed;
    } catch {
      // Fallback to fresh store if corrupted
    }
  }

  const sampleApk = createSampleApkFile();
  const now = new Date().toISOString();
  const initialStore: StoreData = {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    apps: [
      {
        id: 'app-novadroid-demo',
        name: 'NovaDroid Smart Suite',
        tagline:
          'Fast, secure, and lightweight Android utility suite built for everyday productivity.',
        description:
          'NovaDroid Smart Suite brings daily activity tracking, device usage analytics, quick system shortcuts, and encrypted cloud sync into one clean Android experience. Download the signed APK directly with zero ads or bloat.',
        whatsNew:
          '• Added Dark Vault security controls with biometric lock support\n• Reduced battery and background data usage with a refreshed interface\n• Full compatibility for Android 14 and Android 15 devices',
        version: '2.4.0',
        packageId: 'com.droidvault.novadroid',
        category: 'Utilities & Productivity',
        minAndroid: 'Android 10.0+',
        developer: 'Sasindu Studios',
        iconUrl: '/src/assets/images/app_icon_main_1795134477355.jpg',
        apkUrl: sampleApk.url,
        apkFileName: sampleApk.fileName,
        apkSizeBytes: sampleApk.sizeBytes,
        apkSha256: sampleApk.sha256,
        screenshots: [
          '/src/assets/images/screenshot_1_home_1795134478331.jpg',
          '/src/assets/images/screenshot_2_analytics_1795134479546.jpg',
          '/src/assets/images/screenshot_3_tools_1795134484184.jpg',
          '/src/assets/images/screenshot_4_settings_1795134480533.jpg',
        ],
        videoUrl: '',
        videoFileName: '',
        downloads: 1248,
        featured: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    users: [],
  };

  saveStore(initialStore);
  return initialStore;
}

function saveStore(store: StoreData): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

const store = loadStore();

function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { salt: actualSalt, hash };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signSessionToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', store.sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', store.sessionSecret).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('dv_session', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

function getSessionFromRequest(req: Request): SessionPayload | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = verifySessionToken(authHeader.slice(7).trim());
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.dv_session as string | undefined;
  return verifySessionToken(cookieToken);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);
  if (!session || session.role !== 'admin') {
    res.status(403).json({ error: 'Unauthorized admin access required.' });
    return;
  }
  next();
}

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function safeUnlinkUploadUrl(urlPath: string | undefined): void {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const rel = urlPath.replace(/^\/uploads\//, '');
  const fullPath = path.resolve(UPLOADS_DIR, rel);
  if (!fullPath.startsWith(UPLOADS_DIR)) return;
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // ignore unlink failures
    }
  }
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === 'apk') {
      cb(null, APK_DIR);
    } else if (file.fieldname === 'icon') {
      cb(null, ICON_DIR);
    } else if (file.fieldname === 'video') {
      cb(null, VIDEO_DIR);
    } else {
      cb(null, SCREENSHOT_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    const base = path
      .basename(file.originalname || 'file', ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 48);
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 300 * 1024 * 1024, // Up to 300 MB for APK or promo video
  },
});

const uploadFields = upload.fields([
  { name: 'apk', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'screenshot0', maxCount: 1 },
  { name: 'screenshot1', maxCount: 1 },
  { name: 'screenshot2', maxCount: 1 },
  { name: 'screenshot3', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]);

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  app.use('/src/assets', express.static(path.resolve(__dirname, 'src/assets'), { maxAge: '1h' }));

  // Serve uploaded media with proper headers & range streaming for videos
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      acceptRanges: true,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.apk')) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        }
      },
    })
  );

  // ---------- AUTH ROUTES (Disguised Admin Trigger + Normal User Accounts) ----------

  app.get('/api/auth/me', (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.json({ user: null });
      return;
    }
    if (session.role === 'admin') {
      res.json({
        user: {
          id: 'admin-root',
          email: ADMIN_EMAIL,
          name: 'Sasindu Admin',
          role: 'admin',
          createdAt: '',
          downloadHistory: [],
        },
      });
      return;
    }
    const found = store.users.find((u) => u.id === session.id);
    if (!found) {
      res.json({ user: null });
      return;
    }
    res.json({
      user: {
        id: found.id,
        email: found.email,
        name: found.name,
        role: found.role,
        createdAt: found.createdAt,
        downloadHistory: found.downloadHistory,
      },
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const rawEmail = String(req.body?.email ?? '').trim();
    const email = rawEmail.toLowerCase();
    const password = String(req.body?.password ?? '');
    const rawName = String(req.body?.name ?? '').trim();

    // Secret trigger: if exact admin email & password are entered even on the Create Account screen,
    // immediately route straight into the Admin page.
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const payload: SessionPayload = {
        id: 'admin-root',
        email: ADMIN_EMAIL,
        name: 'Sasindu Admin',
        role: 'admin',
        iat: Date.now(),
      };
      const token = signSessionToken(payload);
      setSessionCookie(req, res, token);
      res.json({
        user: {
          id: 'admin-root',
          email: ADMIN_EMAIL,
          name: 'Sasindu Admin',
          role: 'admin',
          createdAt: new Date().toISOString(),
          downloadHistory: [],
        },
        token,
      });
      return;
    }

    if (!email || !email.includes('@') || !email.includes('.')) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      return;
    }

    if (email === ADMIN_EMAIL || store.users.some((u) => u.email === email)) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      return;
    }

    const displayName = rawName || email.split('@')[0];
    const { salt, hash } = hashPassword(password);
    const newUser: UserRecord = {
      id: `usr-${crypto.randomBytes(6).toString('hex')}`,
      name: displayName,
      email,
      passwordSalt: salt,
      passwordHash: hash,
      role: 'user',
      createdAt: new Date().toISOString(),
      downloadHistory: [],
    };
    store.users.unshift(newUser);
    saveStore(store);

    const payload: SessionPayload = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: 'user',
      iat: Date.now(),
    };
    const token = signSessionToken(payload);
    setSessionCookie(req, res, token);

    res.status(201).json({
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: 'user',
        createdAt: newUser.createdAt,
        downloadHistory: newUser.downloadHistory,
      },
      token,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const rawEmail = String(req.body?.email ?? '').trim();
    const email = rawEmail.toLowerCase();
    const password = String(req.body?.password ?? '');

    // Secret trigger: exact admin credentials go straight to Admin page
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const payload: SessionPayload = {
        id: 'admin-root',
        email: ADMIN_EMAIL,
        name: 'Sasindu Admin',
        role: 'admin',
        iat: Date.now(),
      };
      const token = signSessionToken(payload);
      setSessionCookie(req, res, token);
      res.json({
        user: {
          id: 'admin-root',
          email: ADMIN_EMAIL,
          name: 'Sasindu Admin',
          role: 'admin',
          createdAt: new Date().toISOString(),
          downloadHistory: [],
        },
        token,
      });
      return;
    }

    if (!email || !password) {
      res.status(400).json({ error: 'Please enter your email address and password.' });
      return;
    }

    const found = store.users.find((u) => u.email === email);
    if (!found || !verifyPassword(password, found.passwordSalt, found.passwordHash)) {
      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    const payload: SessionPayload = {
      id: found.id,
      email: found.email,
      name: found.name,
      role: 'user',
      iat: Date.now(),
    };
    const token = signSessionToken(payload);
    setSessionCookie(req, res, token);

    res.json({
      user: {
        id: found.id,
        email: found.email,
        name: found.name,
        role: 'user',
        createdAt: found.createdAt,
        downloadHistory: found.downloadHistory,
      },
      token,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('dv_session', {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      path: '/',
    });
    res.json({ ok: true });
  });

  // ---------- PUBLIC APPS & DOWNLOAD ROUTES ----------

  app.get('/api/apps', (_req, res) => {
    const sorted = [...store.apps].sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    res.json({ apps: sorted });
  });

  app.get('/api/apps/:id/download', (req, res) => {
    const appItem = store.apps.find((a) => a.id === req.params.id);
    if (!appItem || !appItem.apkUrl) {
      res.status(404).json({ error: 'APK file not found.' });
      return;
    }

    const recordDownload = () => {
      appItem.downloads += 1;
      const session = getSessionFromRequest(req);
      if (session && session.role === 'user') {
        const user = store.users.find((u) => u.id === session.id);
        if (user) {
          user.downloadHistory.unshift({
            appId: appItem.id,
            appName: appItem.name,
            version: appItem.version,
            downloadedAt: new Date().toISOString(),
          });
          user.downloadHistory = user.downloadHistory.slice(0, 25);
        }
      }
      saveStore(store);
    };

    // External storage URL (e.g., Google Drive free storage direct download link)
    if (appItem.apkUrl.startsWith('https://') || appItem.apkUrl.startsWith('http://')) {
      recordDownload();
      res.redirect(302, appItem.apkUrl);
      return;
    }

    const rel = appItem.apkUrl.replace(/^\/uploads\//, '');
    const filePath = path.resolve(UPLOADS_DIR, rel);
    if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'APK file is missing on the server.' });
      return;
    }

    recordDownload();

    const safeDownloadName =
      appItem.apkFileName && appItem.apkFileName.toLowerCase().endsWith('.apk')
        ? appItem.apkFileName
        : `${appItem.name.replace(/[^a-zA-Z0-9._-]/g, '_')}-v${appItem.version}.apk`;

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.download(filePath, safeDownloadName);
  });

  // ---------- ADMIN ROUTES ----------

  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    const safeUsers = store.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      downloadsCount: u.downloadHistory.length,
    }));
    res.json({ users: safeUsers });
  });

  app.post('/api/admin/apps', requireAdmin, (req, res) => {
    uploadFields(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'File upload failed.' });
        return;
      }

      try {
        const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
        const apkFile = files.apk?.[0];
        const externalApkUrl = String(req.body?.apkUrl ?? '').trim();
        if (!apkFile && !externalApkUrl) {
          res.status(400).json({ error: 'Please select an Android APK file (.apk).' });
          return;
        }

        const name = String(req.body?.name ?? '').trim();
        if (!name) {
          res.status(400).json({ error: 'Please enter the app name.' });
          return;
        }

        const iconFile = files.icon?.[0];
        const videoFile = files.video?.[0];
        const screenshots: [string, string, string, string] = ['', '', '', ''];
        for (let i = 0; i < 4; i++) {
          const shot = files[`screenshot${i}`]?.[0];
          const externalShotUrl = String(req.body?.[`screenshotUrl${i}`] ?? '').trim();
          if (shot) {
            screenshots[i] = `/uploads/screenshots/${shot.filename}`;
          } else if (externalShotUrl) {
            screenshots[i] = externalShotUrl;
          }
        }

        const sha256 = apkFile
          ? await computeFileSha256(apkFile.path)
          : String(req.body?.apkSha256 ?? '').trim();
        const now = new Date().toISOString();
        const isFeatured = String(req.body?.featured ?? 'true') !== 'false';

        if (isFeatured) {
          for (const existing of store.apps) {
            existing.featured = false;
          }
        }

        let parsedDriveFileIds: AppRelease['driveFileIds'] = undefined;
        if (typeof req.body?.driveFileIds === 'string' && req.body.driveFileIds.trim()) {
          try {
            parsedDriveFileIds = JSON.parse(req.body.driveFileIds) as AppRelease['driveFileIds'];
          } catch {
            // ignore invalid JSON
          }
        }

        const storageProvider: 'server' | 'google-drive' =
          req.body?.storageProvider === 'google-drive' ? 'google-drive' : 'server';

        const newApp: AppRelease = {
          id: `app-${crypto.randomBytes(6).toString('hex')}`,
          name,
          tagline: String(req.body?.tagline ?? '').trim() || 'Download the official Android APK directly.',
          description: String(req.body?.description ?? '').trim() || '',
          whatsNew: String(req.body?.whatsNew ?? '').trim() || '',
          version: String(req.body?.version ?? '').trim() || '1.0.0',
          packageId: String(req.body?.packageId ?? '').trim() || `com.app.${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'android'}`,
          category: String(req.body?.category ?? '').trim() || 'Android App',
          minAndroid: String(req.body?.minAndroid ?? '').trim() || 'Android 8.0+',
          developer: String(req.body?.developer ?? '').trim() || 'Sasindu Studios',
          iconUrl: iconFile
            ? `/uploads/icons/${iconFile.filename}`
            : String(req.body?.iconUrl ?? '').trim(),
          apkUrl: apkFile ? `/uploads/apk/${apkFile.filename}` : externalApkUrl,
          apkFileName: apkFile
            ? apkFile.originalname || apkFile.filename
            : String(req.body?.apkFileName ?? '').trim() || `${name}.apk`,
          apkSizeBytes: apkFile ? apkFile.size : Number(req.body?.apkSizeBytes) || 0,
          apkSha256: sha256,
          screenshots,
          videoUrl: videoFile
            ? `/uploads/videos/${videoFile.filename}`
            : String(req.body?.videoUrl ?? '').trim(),
          videoFileName: videoFile
            ? videoFile.originalname || videoFile.filename
            : String(req.body?.videoFileName ?? '').trim(),
          downloads: 0,
          featured: isFeatured || store.apps.length === 0,
          storageProvider,
          driveFileIds: parsedDriveFileIds,
          createdAt: now,
          updatedAt: now,
        };

        store.apps.unshift(newApp);
        saveStore(store);

        res.status(201).json({ app: newApp });
      } catch (e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: 'Failed to save the uploaded app.' });
      }
    });
  });

  app.put('/api/admin/apps/:id', requireAdmin, (req, res) => {
    const existing = store.apps.find((a) => a.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'App release not found.' });
      return;
    }

    uploadFields(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Failed to update files.' });
        return;
      }

      try {
        const files = (req.files || {}) as Record<string, Express.Multer.File[]>;

        if (typeof req.body?.name === 'string' && req.body.name.trim()) {
          existing.name = req.body.name.trim();
        }
        if (typeof req.body?.tagline === 'string') existing.tagline = req.body.tagline.trim();
        if (typeof req.body?.description === 'string') existing.description = req.body.description.trim();
        if (typeof req.body?.whatsNew === 'string') existing.whatsNew = req.body.whatsNew.trim();
        if (typeof req.body?.version === 'string' && req.body.version.trim()) {
          existing.version = req.body.version.trim();
        }
        if (typeof req.body?.packageId === 'string' && req.body.packageId.trim()) {
          existing.packageId = req.body.packageId.trim();
        }
        if (typeof req.body?.category === 'string' && req.body.category.trim()) {
          existing.category = req.body.category.trim();
        }
        if (typeof req.body?.minAndroid === 'string' && req.body.minAndroid.trim()) {
          existing.minAndroid = req.body.minAndroid.trim();
        }
        if (typeof req.body?.developer === 'string' && req.body.developer.trim()) {
          existing.developer = req.body.developer.trim();
        }

        const apkFile = files.apk?.[0];
        const externalApkUrl = String(req.body?.apkUrl ?? '').trim();
        if (apkFile) {
          safeUnlinkUploadUrl(existing.apkUrl);
          existing.apkUrl = `/uploads/apk/${apkFile.filename}`;
          existing.apkFileName = apkFile.originalname || apkFile.filename;
          existing.apkSizeBytes = apkFile.size;
          existing.apkSha256 = await computeFileSha256(apkFile.path);
        } else if (externalApkUrl) {
          safeUnlinkUploadUrl(existing.apkUrl);
          existing.apkUrl = externalApkUrl;
          if (req.body?.apkFileName) existing.apkFileName = String(req.body.apkFileName).trim();
          if (req.body?.apkSizeBytes) existing.apkSizeBytes = Number(req.body.apkSizeBytes) || existing.apkSizeBytes;
          if (req.body?.apkSha256) existing.apkSha256 = String(req.body.apkSha256).trim();
        }

        const iconFile = files.icon?.[0];
        const externalIconUrl = String(req.body?.iconUrl ?? '').trim();
        if (iconFile) {
          safeUnlinkUploadUrl(existing.iconUrl);
          existing.iconUrl = `/uploads/icons/${iconFile.filename}`;
        } else if (externalIconUrl) {
          safeUnlinkUploadUrl(existing.iconUrl);
          existing.iconUrl = externalIconUrl;
        }

        for (let i = 0; i < 4; i++) {
          const shot = files[`screenshot${i}`]?.[0];
          const externalShotUrl = String(req.body?.[`screenshotUrl${i}`] ?? '').trim();
          const clearFlag = String(req.body?.[`clearScreenshot${i}`] ?? '') === 'true';
          if (shot) {
            safeUnlinkUploadUrl(existing.screenshots[i]);
            existing.screenshots[i] = `/uploads/screenshots/${shot.filename}`;
          } else if (externalShotUrl) {
            safeUnlinkUploadUrl(existing.screenshots[i]);
            existing.screenshots[i] = externalShotUrl;
          } else if (clearFlag) {
            safeUnlinkUploadUrl(existing.screenshots[i]);
            existing.screenshots[i] = '';
          }
        }

        const videoFile = files.video?.[0];
        const externalVideoUrl = String(req.body?.videoUrl ?? '').trim();
        const clearVideo = String(req.body?.clearVideo ?? '') === 'true';
        if (videoFile) {
          safeUnlinkUploadUrl(existing.videoUrl);
          existing.videoUrl = `/uploads/videos/${videoFile.filename}`;
          existing.videoFileName = videoFile.originalname || videoFile.filename;
        } else if (externalVideoUrl) {
          safeUnlinkUploadUrl(existing.videoUrl);
          existing.videoUrl = externalVideoUrl;
          if (req.body?.videoFileName) existing.videoFileName = String(req.body.videoFileName).trim();
        } else if (clearVideo) {
          safeUnlinkUploadUrl(existing.videoUrl);
          existing.videoUrl = '';
          existing.videoFileName = '';
        }

        if (req.body?.storageProvider === 'google-drive' || req.body?.storageProvider === 'server') {
          existing.storageProvider = req.body.storageProvider;
        }
        if (typeof req.body?.driveFileIds === 'string' && req.body.driveFileIds.trim()) {
          try {
            existing.driveFileIds = JSON.parse(req.body.driveFileIds) as AppRelease['driveFileIds'];
          } catch {
            // ignore
          }
        }

        if (String(req.body?.featured ?? '') === 'true') {
          for (const a of store.apps) a.featured = false;
          existing.featured = true;
        }

        existing.updatedAt = new Date().toISOString();
        saveStore(store);

        res.json({ app: existing });
      } catch (e) {
        console.error('Update error:', e);
        res.status(500).json({ error: 'Failed to update the app release.' });
      }
    });
  });

  app.post('/api/admin/apps/:id/feature', requireAdmin, (req, res) => {
    const found = store.apps.find((a) => a.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'App release not found.' });
      return;
    }
    for (const a of store.apps) a.featured = false;
    found.featured = true;
    saveStore(store);
    res.json({ app: found });
  });

  app.delete('/api/admin/apps/:id', requireAdmin, (req, res) => {
    const idx = store.apps.findIndex((a) => a.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'App release not found.' });
      return;
    }
    const [removed] = store.apps.splice(idx, 1);
    safeUnlinkUploadUrl(removed.apkUrl);
    safeUnlinkUploadUrl(removed.iconUrl);
    safeUnlinkUploadUrl(removed.videoUrl);
    for (const s of removed.screenshots) safeUnlinkUploadUrl(s);

    if (removed.featured && store.apps.length > 0) {
      store.apps[0].featured = true;
    }
    saveStore(store);
    res.json({ ok: true });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ---------- VITE DEV MIDDLEWARE / STATIC DIST ----------
  if (!USE_DIST) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: disableHmr ? false : undefined,
        hmr: !disableHmr,
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DroidVault server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
