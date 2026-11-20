import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { getFirebaseAuthSafe } from './firebase';
import { ensureCloudUserProfile } from './firestoreStore';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
// Access token is strictly kept in memory (never in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedFolderId: string | null = null;

export const initGoogleDriveAuth = (
  onAuthState?: (user: User | null, hasDriveToken: boolean) => void
) => {
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    onAuthState?.(null, false);
    return () => {};
  }
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (!cachedAccessToken && !isSigningIn) {
        cachedFolderId = null;
      }
      onAuthState?.(user, Boolean(cachedAccessToken));
    } else {
      cachedAccessToken = null;
      cachedFolderId = null;
      onAuthState?.(null, false);
    }
  });
};

export const signInWithGoogleDrive = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    throw new Error(
      'Google sign-in requires opening the website over HTTPS (such as GitHub Pages or your hosted URL), not a local file:// path.'
    );
  }
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    throw new Error('Google authentication is unavailable in this environment.');
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Drive access. Please try signing in again.');
    }
    cachedAccessToken = credential.accessToken;
    cachedFolderId = null;
    void ensureCloudUserProfile(result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getDriveAccessToken = (): string | null => cachedAccessToken;

export const getFirebaseSignedInUser = (): User | null => {
  const auth = getFirebaseAuthSafe();
  return auth ? auth.currentUser : null;
};

export const getDriveUser = (): User | null => {
  const auth = getFirebaseAuthSafe();
  return cachedAccessToken && auth ? auth.currentUser : null;
};

export const signOutGoogleDrive = async (): Promise<void> => {
  const auth = getFirebaseAuthSafe();
  if (auth) {
    await auth.signOut().catch(() => {});
  }
  cachedAccessToken = null;
  cachedFolderId = null;
};

export function getDriveDirectDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

export function getDriveImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w1600`;
}

export function getDriveVideoPreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

export function isDrivePreviewUrl(url: string): boolean {
  return Boolean(url && /drive\.google\.com\/file\/d\/[^/]+\/preview/i.test(url));
}

async function getOrCreateDroidVaultFolder(accessToken: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  const query = encodeURIComponent(
    "name='DroidVault Uploads' and mimeType='application/vnd.google-apps.folder' and trashed=false"
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (searchRes.ok) {
    const data = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (data.files && data.files.length > 0) {
      cachedFolderId = data.files[0].id;
      return cachedFolderId;
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'DroidVault Uploads',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    throw new Error('Could not create "DroidVault Uploads" folder in Google Drive.');
  }

  const folder = (await createRes.json()) as { id: string };
  cachedFolderId = folder.id;
  return folder.id;
}

async function makeDriveFilePublic(fileId: string, accessToken: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  );
  if (!res.ok) {
    throw new Error('Uploaded to Google Drive, but failed to enable public link sharing.');
  }
}

export async function uploadFileToGoogleDrive(
  file: File,
  options?: {
    mimeTypeOverride?: string;
    onProgress?: (percent: number) => void;
  }
): Promise<{ fileId: string; name: string; size: number }> {
  const accessToken = getDriveAccessToken();
  if (!accessToken) {
    throw new Error('Please connect your Google Drive account first.');
  }

  const folderId = await getOrCreateDroidVaultFolder(accessToken);
  const mimeType =
    options?.mimeTypeOverride ||
    file.type ||
    (file.name.toLowerCase().endsWith('.apk')
      ? 'application/vnd.android.package-archive'
      : 'application/octet-stream');

  // Step 1: Initiate resumable upload session (supports large APKs & videos cleanly)
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(file.size),
      },
      body: JSON.stringify({
        name: file.name,
        parents: [folderId],
      }),
    }
  );

  if (initRes.status === 401) {
    cachedAccessToken = null;
    throw new Error('Your Google Drive session expired. Please sign in with Google again.');
  }

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '');
    throw new Error(errText || 'Failed to start Google Drive upload.');
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive did not return an upload session URL.');
  }

  // Step 2: Upload binary file with progress reporting via XMLHttpRequest
  const uploaded = await new Promise<{ id: string; name: string; size?: string }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', mimeType);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && options?.onProgress) {
          const pct = Math.min(98, Math.round((evt.loaded / evt.total) * 100));
          options.onProgress(pct);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as { id: string; name: string; size?: string });
          } catch {
            reject(new Error('Invalid response from Google Drive upload.'));
          }
        } else {
          reject(new Error(`Google Drive upload failed (HTTP ${xhr.status}).`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error while uploading to Google Drive.'));
      xhr.send(file);
    }
  );

  // Step 3: Set public reader permission so visitors can view/download without signing in
  await makeDriveFilePublic(uploaded.id, accessToken);
  options?.onProgress?.(100);

  return {
    fileId: uploaded.id,
    name: uploaded.name || file.name,
    size: Number(uploaded.size) || file.size,
  };
}

export async function deleteFilesFromGoogleDrive(fileIds: string[]): Promise<void> {
  const accessToken = getDriveAccessToken();
  if (!accessToken || fileIds.length === 0) return;

  for (const fileId of fileIds) {
    if (!fileId) continue;
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }
}

export async function computeBrowserSha256(file: File): Promise<string> {
  try {
    if (!crypto?.subtle || file.size > 150 * 1024 * 1024) return '';
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}
