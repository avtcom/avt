import type { AdminUserRecord, AppRelease, AuthUser } from '../types';
import {
  localDeleteApp,
  localFetchAdminUsers,
  localFetchApps,
  localGetCurrentUser,
  localLoginAuth,
  localLogout,
  localRegisterOrAuth,
  localSetFeatured,
  localTriggerDownload,
  localUploadApp,
} from './localFallback';
import { recordCloudDownload } from './firestoreStore';

const TOKEN_STORAGE_KEY = 'dv_auth_token';

// Automatically switches to browser fallback on file:// or if /api/* backend returns 404 (e.g. static host)
let useStaticFallback =
  typeof window !== 'undefined' && window.location.protocol === 'file:';

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json');
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (useStaticFallback) return localGetCurrentUser();
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (res.status === 404 || !isJsonResponse(res)) {
      useStaticFallback = true;
      return localGetCurrentUser();
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser | null };
    return data.user;
  } catch {
    useStaticFallback = true;
    return localGetCurrentUser();
  }
}

export async function registerOrAuth(payload: {
  name?: string;
  email: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  if (useStaticFallback) return localRegisterOrAuth(payload);
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (res.status === 404 || !isJsonResponse(res)) {
      useStaticFallback = true;
      return localRegisterOrAuth(payload);
    }
    const data = (await res.json()) as { user?: AuthUser; token?: string; error?: string };
    if (!res.ok || !data.user) {
      throw new Error(data.error || 'Unable to create account.');
    }
    if (data.token) setStoredToken(data.token);
    return { user: data.user, token: data.token || '' };
  } catch (err) {
    if (err instanceof TypeError) {
      useStaticFallback = true;
      return localRegisterOrAuth(payload);
    }
    throw err;
  }
}

export async function loginAuth(payload: {
  email: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  if (useStaticFallback) return localLoginAuth(payload);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (res.status === 404 || !isJsonResponse(res)) {
      useStaticFallback = true;
      return localLoginAuth(payload);
    }
    const data = (await res.json()) as { user?: AuthUser; token?: string; error?: string };
    if (!res.ok || !data.user) {
      throw new Error(data.error || 'Unable to sign in.');
    }
    if (data.token) setStoredToken(data.token);
    return { user: data.user, token: data.token || '' };
  } catch (err) {
    if (err instanceof TypeError) {
      useStaticFallback = true;
      return localLoginAuth(payload);
    }
    throw err;
  }
}

export async function logoutAuth(): Promise<void> {
  if (useStaticFallback) {
    localLogout();
    setStoredToken(null);
    return;
  }
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    });
  } catch {
    // ignore
  }
  localLogout();
  setStoredToken(null);
}

export async function fetchApps(): Promise<AppRelease[]> {
  if (useStaticFallback) return localFetchApps();
  try {
    const res = await fetch('/api/apps', {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (res.status === 404 || !isJsonResponse(res)) {
      useStaticFallback = true;
      return localFetchApps();
    }
    if (!res.ok) throw new Error('Failed to load apps.');
    const data = (await res.json()) as { apps: AppRelease[] };
    return data.apps;
  } catch {
    useStaticFallback = true;
    return localFetchApps();
  }
}

export async function fetchAdminUsers(): Promise<AdminUserRecord[]> {
  if (useStaticFallback) return localFetchAdminUsers();
  const res = await fetch('/api/admin/users', {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 404 || !isJsonResponse(res)) {
    useStaticFallback = true;
    return localFetchAdminUsers();
  }
  if (!res.ok) throw new Error('Failed to load members.');
  const data = (await res.json()) as { users: AdminUserRecord[] };
  return data.users;
}

export function uploadAppWithProgress(
  formData: FormData,
  options: {
    editAppId?: string | null;
    onProgress?: (percent: number) => void;
  }
): Promise<AppRelease> {
  if (useStaticFallback) {
    return localUploadApp(formData, options);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = options.editAppId ? 'PUT' : 'POST';
    const url = options.editAppId
      ? `/api/admin/apps/${encodeURIComponent(options.editAppId)}`
      : '/api/admin/apps';

    xhr.open(method, url, true);
    xhr.withCredentials = true;
    const token = getStoredToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && options.onProgress) {
        const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
        options.onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 404) {
        useStaticFallback = true;
        localUploadApp(formData, options).then(resolve).catch(reject);
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText || '{}') as { app?: AppRelease; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && parsed.app) {
          options.onProgress?.(100);
          resolve(parsed.app);
        } else {
          reject(new Error(parsed.error || 'Upload failed.'));
        }
      } catch {
        reject(new Error('Invalid server response.'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading files.'));
    };

    xhr.send(formData);
  });
}

export async function setFeaturedApp(appId: string): Promise<void> {
  if (useStaticFallback) {
    localSetFeatured(appId);
    return;
  }
  const res = await fetch(`/api/admin/apps/${encodeURIComponent(appId)}/feature`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 404) {
    useStaticFallback = true;
    localSetFeatured(appId);
    return;
  }
  if (!res.ok) throw new Error('Failed to set primary app.');
}

export async function deleteAppRelease(appId: string): Promise<void> {
  if (useStaticFallback) {
    localDeleteApp(appId);
    return;
  }
  const res = await fetch(`/api/admin/apps/${encodeURIComponent(appId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 404) {
    useStaticFallback = true;
    localDeleteApp(appId);
    return;
  }
  if (!res.ok) throw new Error('Failed to delete app.');
}

export function triggerAppDownload(app: AppRelease): void {
  if (app.source === 'firestore' || app.apkUrl.startsWith('https://') || app.apkUrl.startsWith('http://')) {
    if (app.source === 'firestore') {
      void recordCloudDownload(app);
    }
    const link = document.createElement('a');
    link.href = app.apkUrl;
    link.rel = 'noopener noreferrer';
    link.download = app.apkFileName || `${app.name}.apk`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }
  if (useStaticFallback || app.apkUrl.startsWith('idb://')) {
    void localTriggerDownload(app);
    return;
  }
  const link = document.createElement('a');
  link.href = `/api/apps/${encodeURIComponent(app.id)}/download`;
  link.download = app.apkFileName || `${app.name}.apk`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateShort(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}
