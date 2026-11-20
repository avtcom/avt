import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  increment,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import type {
  AdminUserRecord,
  AppRelease,
  DriveFileIds,
  StorageProvider,
} from '../types';
import {
  getFirebaseAuthSafe,
  getFirestoreDbSafe,
  handleFirestoreError,
  OperationType,
} from './firebase';

const APPS_COLLECTION = 'apps';
const USERS_COLLECTION = 'users';

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return new Date().toISOString();
}

function clampStr(val: string | undefined | null, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

function sanitizeScreenshots(shots: string[]): [string, string, string, string] {
  const out: [string, string, string, string] = ['', '', '', ''];
  for (let i = 0; i < 4; i++) {
    out[i] = clampStr(shots[i] || '', 2048);
  }
  return out;
}

function mapDocToAppRelease(id: string, data: Record<string, unknown>): AppRelease {
  const rawShots = Array.isArray(data.screenshots) ? data.screenshots : [];
  const screenshots: [string, string, string, string] = [
    String(rawShots[0] ?? ''),
    String(rawShots[1] ?? ''),
    String(rawShots[2] ?? ''),
    String(rawShots[3] ?? ''),
  ];

  return {
    id,
    name: String(data.name ?? 'Untitled App'),
    tagline: String(data.tagline ?? ''),
    description: String(data.description ?? ''),
    whatsNew: String(data.whatsNew ?? ''),
    version: String(data.version ?? '1.0.0'),
    packageId: String(data.packageId ?? 'com.droidvault.app'),
    category: String(data.category ?? 'Android App'),
    minAndroid: String(data.minAndroid ?? 'Android 8.0+'),
    developer: String(data.developer ?? 'Sasindu Studios'),
    iconUrl: String(data.iconUrl ?? ''),
    apkUrl: String(data.apkUrl ?? ''),
    apkFileName: String(data.apkFileName ?? 'app.apk'),
    apkSizeBytes: Number(data.apkSizeBytes ?? 0),
    apkSha256: String(data.apkSha256 ?? ''),
    screenshots,
    videoUrl: String(data.videoUrl ?? ''),
    videoFileName: String(data.videoFileName ?? ''),
    downloads: Number(data.downloads ?? 0),
    featured: Boolean(data.featured),
    published: data.published !== false,
    ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : undefined,
    storageProvider: (data.storageProvider as StorageProvider) || 'cloud-link',
    driveFileIds: data.driveFileIds as DriveFileIds | undefined,
    source: 'firestore',
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

function sortReleases(list: AppRelease[]): AppRelease[] {
  return [...list].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function subscribeCloudApps(
  onUpdate: (apps: AppRelease[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const db = getFirestoreDbSafe();
  if (!db) {
    return () => {};
  }

  const q = query(collection(db, APPS_COLLECTION), where('published', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) =>
        mapDocToAppRelease(d.id, d.data() as Record<string, unknown>)
      );
      onUpdate(sortReleases(items));
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, APPS_COLLECTION);
      }
    }
  );
}

export async function fetchCloudAppsOnce(): Promise<AppRelease[]> {
  const db = getFirestoreDbSafe();
  if (!db) return [];
  try {
    const q = query(collection(db, APPS_COLLECTION), where('published', '==', true));
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((d) =>
      mapDocToAppRelease(d.id, d.data() as Record<string, unknown>)
    );
    return sortReleases(items);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, APPS_COLLECTION);
  }
}

export interface SaveCloudAppInput {
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
  featured: boolean;
  storageProvider: StorageProvider;
  driveFileIds?: DriveFileIds;
}

export async function saveCloudAppRelease(
  input: SaveCloudAppInput,
  editApp?: AppRelease | null
): Promise<AppRelease> {
  const db = getFirestoreDbSafe();
  const auth = getFirebaseAuthSafe();
  if (!db || !auth) {
    throw new Error('Firebase Cloud Database is not available in this environment.');
  }
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error(
      'Please click "Sign in with Google" above to verify admin access before publishing to Cloud Database.'
    );
  }

  const isEditing = Boolean(editApp && editApp.source === 'firestore');
  const appId = isEditing && editApp
    ? editApp.id
    : `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const docPath = `${APPS_COLLECTION}/${appId}`;
  const safeName = clampStr(input.name, 120);
  if (!safeName) {
    throw new Error('Please enter an app name.');
  }
  const safeApkUrl = clampStr(input.apkUrl, 2048);
  if (!safeApkUrl || !safeApkUrl.startsWith('https://')) {
    throw new Error('APK download link must be a valid https:// URL.');
  }

  const safeData: Record<string, unknown> = {
    id: appId,
    name: safeName,
    tagline: clampStr(input.tagline || 'Download the official Android APK directly.', 240),
    description: clampStr(input.description, 5000),
    whatsNew: clampStr(input.whatsNew, 3000),
    version: clampStr(input.version || '1.0.0', 40),
    packageId: clampStr(input.packageId || 'com.droidvault.app', 160),
    category: clampStr(input.category || 'Utilities & Productivity', 80),
    minAndroid: clampStr(input.minAndroid || 'Android 8.0+', 40),
    developer: clampStr(input.developer || 'Sasindu Studios', 120),
    iconUrl: clampStr(input.iconUrl, 2048),
    apkUrl: safeApkUrl,
    apkFileName: clampStr(input.apkFileName || 'app.apk', 200),
    apkSizeBytes: Math.max(0, Math.min(2147483648, Number(input.apkSizeBytes) || 0)),
    apkSha256: clampStr(input.apkSha256, 128),
    screenshots: sanitizeScreenshots(input.screenshots),
    videoUrl: clampStr(input.videoUrl, 2048),
    videoFileName: clampStr(input.videoFileName, 200),
    downloads: isEditing && editApp ? Math.max(0, editApp.downloads || 0) : 0,
    featured: Boolean(input.featured),
    published: true,
    storageProvider: input.storageProvider,
    ownerUid: isEditing && editApp?.ownerUid ? editApp.ownerUid : currentUser.uid,
    updatedAt: serverTimestamp(),
  };

  if (input.driveFileIds) {
    const cleanDriveIds: DriveFileIds = {};
    if (input.driveFileIds.apk) cleanDriveIds.apk = clampStr(input.driveFileIds.apk, 256);
    if (input.driveFileIds.icon) cleanDriveIds.icon = clampStr(input.driveFileIds.icon, 256);
    if (input.driveFileIds.video) cleanDriveIds.video = clampStr(input.driveFileIds.video, 256);
    if (Array.isArray(input.driveFileIds.screenshots)) {
      cleanDriveIds.screenshots = [
        clampStr(input.driveFileIds.screenshots[0], 256),
        clampStr(input.driveFileIds.screenshots[1], 256),
        clampStr(input.driveFileIds.screenshots[2], 256),
        clampStr(input.driveFileIds.screenshots[3], 256),
      ];
    }
    safeData.driveFileIds = cleanDriveIds;
  }

  try {
    // If marking as featured, clear featured flag on other cloud apps first
    if (input.featured) {
      const existingSnap = await getDocs(
        query(collection(db, APPS_COLLECTION), where('published', '==', true))
      );
      const batch = writeBatch(db);
      let hasBatchOps = false;
      existingSnap.forEach((docSnap) => {
        if (docSnap.id !== appId && docSnap.data().featured === true) {
          batch.update(docSnap.ref, {
            featured: false,
            updatedAt: serverTimestamp(),
          });
          hasBatchOps = true;
        }
      });
      if (hasBatchOps) {
        await batch.commit();
      }
    }

    const ref = doc(db, APPS_COLLECTION, appId);
    if (isEditing) {
      const { id: _id, ownerUid: _owner, downloads: _dl, ...updateFields } = safeData;
      void _id;
      void _owner;
      void _dl;
      await updateDoc(ref, updateFields);
    } else {
      await setDoc(ref, {
        ...safeData,
        createdAt: serverTimestamp(),
      });
    }

    const saved = await getDoc(ref);
    if (saved.exists()) {
      return mapDocToAppRelease(saved.id, saved.data() as Record<string, unknown>);
    }
    return mapDocToAppRelease(appId, safeData);
  } catch (error) {
    handleFirestoreError(
      error,
      isEditing ? OperationType.UPDATE : OperationType.CREATE,
      docPath
    );
  }
}

export async function setCloudFeaturedApp(appId: string): Promise<void> {
  const db = getFirestoreDbSafe();
  if (!db) throw new Error('Cloud database unavailable.');
  try {
    const snap = await getDocs(
      query(collection(db, APPS_COLLECTION), where('published', '==', true))
    );
    const batch = writeBatch(db);
    snap.forEach((d) => {
      const shouldBeFeatured = d.id === appId;
      if (Boolean(d.data().featured) !== shouldBeFeatured) {
        batch.update(d.ref, {
          featured: shouldBeFeatured,
          updatedAt: serverTimestamp(),
        });
      }
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${APPS_COLLECTION}/${appId}`);
  }
}

export async function deleteCloudAppRelease(appId: string): Promise<void> {
  const db = getFirestoreDbSafe();
  if (!db) throw new Error('Cloud database unavailable.');
  try {
    await deleteDoc(doc(db, APPS_COLLECTION, appId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${APPS_COLLECTION}/${appId}`);
  }
}

export async function recordCloudDownload(app: AppRelease): Promise<void> {
  const db = getFirestoreDbSafe();
  const auth = getFirebaseAuthSafe();
  if (!db || !auth?.currentUser || !auth.currentUser.emailVerified || app.source !== 'firestore') {
    return;
  }

  const uid = auth.currentUser.uid;
  try {
    await updateDoc(doc(db, APPS_COLLECTION, app.id), {
      downloads: increment(1),
    });
  } catch {
    // non-fatal if rules deny duplicate/unverified increment
  }

  try {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const dlId = `dl-${Date.now().toString(36)}`;
      await setDoc(doc(db, USERS_COLLECTION, uid, 'downloads', dlId), {
        userId: uid,
        appId: app.id,
        appName: clampStr(app.name, 120),
        version: clampStr(app.version, 40),
        downloadedAt: serverTimestamp(),
      });
    }
  } catch {
    // ignore download log failure
  }
}

export async function ensureCloudUserProfile(firebaseUser: FirebaseUser): Promise<void> {
  const db = getFirestoreDbSafe();
  if (!db || !firebaseUser.email || !firebaseUser.emailVerified) return;
  const userRef = doc(db, USERS_COLLECTION, firebaseUser.uid);
  try {
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      await setDoc(userRef, {
        uid: firebaseUser.uid,
        displayName: clampStr(
          firebaseUser.displayName || firebaseUser.email.split('@')[0],
          100
        ),
        email: clampStr(firebaseUser.email, 200),
        role: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // ignore if rules block profile write
  }
}

export async function fetchCloudAdminUsers(): Promise<AdminUserRecord[]> {
  const db = getFirestoreDbSafe();
  const auth = getFirebaseAuthSafe();
  if (!db || !auth?.currentUser || !auth.currentUser.emailVerified) return [];
  try {
    const snap = await getDocs(collection(db, USERS_COLLECTION));
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: String(data.displayName ?? 'Member'),
        email: String(data.email ?? ''),
        createdAt: timestampToIso(data.createdAt),
        downloadsCount: 0,
      };
    });
  } catch {
    return [];
  }
}
