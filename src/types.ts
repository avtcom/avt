export type Language = 'si' | 'en';

export type PageView = 'store' | 'account' | 'admin';

export type StorageProvider = 'cloud-link' | 'google-drive' | 'server';

export interface DriveFileIds {
  apk?: string;
  icon?: string;
  screenshots?: [string, string, string, string];
  video?: string;
}

export interface AppRelease {
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
  published?: boolean;
  ownerUid?: string;
  storageProvider?: StorageProvider;
  driveFileIds?: DriveFileIds;
  source?: 'firestore' | 'server' | 'local';
  createdAt: string;
  updatedAt: string;
}

export interface DownloadHistoryItem {
  appId: string;
  appName: string;
  version: string;
  downloadedAt: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
  downloadHistory: DownloadHistoryItem[];
}

export interface AdminUserRecord {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  downloadsCount: number;
}
