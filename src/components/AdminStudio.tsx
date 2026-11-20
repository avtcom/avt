import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  Upload,
  Package,
  Users,
  ExternalLink,
  LogOut,
  Trash2,
  Pencil,
  Star,
  Image as ImageIcon,
  Film,
  X,
  CheckCircle2,
  Smartphone,
  HardDrive,
  AlertTriangle,
  Link2,
  Cloud,
} from 'lucide-react';
import type {
  AdminUserRecord,
  AppRelease,
  DriveFileIds,
  Language,
  StorageProvider,
} from '../types';
import { t } from '../i18n';
import {
  deleteAppRelease,
  fetchAdminUsers,
  formatBytes,
  formatDateShort,
  logoutAuth,
  setFeaturedApp,
  uploadAppWithProgress,
} from '../lib/api';
import {
  detectStorageHostLabel,
  inferFileNameFromUrl,
  isEmbeddableVideoUrl,
  normalizeApkDownloadUrl,
  normalizeImageUrl,
  normalizeVideoUrl,
} from '../lib/cloudLinks';
import {
  deleteCloudAppRelease,
  fetchCloudAdminUsers,
  saveCloudAppRelease,
  setCloudFeaturedApp,
} from '../lib/firestoreStore';
import {
  computeBrowserSha256,
  deleteFilesFromGoogleDrive,
  getDriveAccessToken,
  getDriveDirectDownloadUrl,
  getDriveImageUrl,
  getDriveVideoPreviewUrl,
  getFirebaseSignedInUser,
  initGoogleDriveAuth,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  uploadFileToGoogleDrive,
} from '../lib/googleDrive';

interface AdminStudioProps {
  lang: Language;
  apps: AppRelease[];
  onRefreshApps: () => Promise<void>;
  onViewStore: (appId?: string) => void;
  onLogout: () => void;
}

type AdminTab = 'upload' | 'apps' | 'users';

interface PendingConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

function collectDriveFileIds(appItem: AppRelease): string[] {
  const ids: string[] = [];
  if (appItem.driveFileIds?.apk) ids.push(appItem.driveFileIds.apk);
  if (appItem.driveFileIds?.icon) ids.push(appItem.driveFileIds.icon);
  if (appItem.driveFileIds?.video) ids.push(appItem.driveFileIds.video);
  if (Array.isArray(appItem.driveFileIds?.screenshots)) {
    for (const id of appItem.driveFileIds.screenshots) {
      if (id) ids.push(id);
    }
  }
  return ids;
}

function parseFriendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Operation failed.');
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error) {
      if (/permission|insufficient/i.test(parsed.error)) {
        return 'Permission denied by Firebase Cloud Database. Please sign in with your owner Google account (dilanytwon@gmail.com).';
      }
      return parsed.error;
    }
  } catch {
    // plain message
  }
  return raw;
}

export function AdminStudio({
  lang,
  apps,
  onRefreshApps,
  onViewStore,
  onLogout,
}: AdminStudioProps) {
  const strings = t(lang);
  const [tab, setTab] = useState<AdminTab>('upload');
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Unified Google Auth (unlocks both Firebase Firestore Cloud DB & Google Drive 15 GB upload)
  const [cloudUser, setCloudUser] = useState<FirebaseUser | null>(() => getFirebaseSignedInUser());
  const [driveConnected, setDriveConnected] = useState<boolean>(() =>
    Boolean(getDriveAccessToken())
  );
  const [cloudConnecting, setCloudConnecting] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [storageProvider, setStorageProvider] = useState<StorageProvider>('cloud-link');

  // Edit mode state
  const [editingApp, setEditingApp] = useState<AppRelease | null>(null);

  // Form metadata fields
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [packageId, setPackageId] = useState('');
  const [category, setCategory] = useState('Utilities & Productivity');
  const [minAndroid, setMinAndroid] = useState('Android 8.0+');
  const [developer, setDeveloper] = useState('Sasindu Studios');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [whatsNew, setWhatsNew] = useState('');
  const [featured, setFeatured] = useState(true);

  // Mode 1: Free Cloud Links (GitHub Releases / Google Drive share link / Dropbox / YouTube / Direct URL)
  const [apkLinkInput, setApkLinkInput] = useState('');
  const [apkSizeMbInput, setApkSizeMbInput] = useState('');
  const [apkShaInput, setApkShaInput] = useState('');
  const [iconLinkInput, setIconLinkInput] = useState('');
  const [shotLinkInputs, setShotLinkInputs] = useState<[string, string, string, string]>([
    '',
    '',
    '',
    '',
  ]);
  const [videoLinkInput, setVideoLinkInput] = useState('');

  // Mode 2 & 3: Direct File Pickers (Google Drive Direct Upload / Direct Server Upload)
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState('');

  const [shotFiles, setShotFiles] = useState<
    [File | null, File | null, File | null, File | null]
  >([null, null, null, null]);
  const [shotPreviews, setShotPreviews] = useState<[string, string, string, string]>([
    '',
    '',
    '',
    '',
  ]);
  const [clearedShots, setClearedShots] = useState<[boolean, boolean, boolean, boolean]>([
    false,
    false,
    false,
    false,
  ]);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState('');
  const [clearVideoFlag, setClearVideoFlag] = useState(false);

  // Upload status
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStepLabel, setUploadStepLabel] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Custom confirmation dialog (mandatory before mutating/deleting Drive files or releases)
  const [confirmModal, setConfirmModal] = useState<PendingConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const multiShotInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsubscribe = initGoogleDriveAuth((user, hasDriveToken) => {
      setCloudUser(user);
      setDriveConnected(hasDriveToken);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    setUsersLoading(true);
    Promise.all([fetchCloudAdminUsers().catch(() => []), fetchAdminUsers().catch(() => [])])
      .then(([cloudList, localList]) => {
        if (!active) return;
        const mergedMap = new Map<string, AdminUserRecord>();
        for (const u of [...cloudList, ...localList]) {
          const key = u.email.toLowerCase() || u.id;
          if (!mergedMap.has(key)) mergedMap.set(key, u);
        }
        setUsers(Array.from(mergedMap.values()));
      })
      .finally(() => {
        if (active) setUsersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, cloudUser]);

  const handleConnectGoogle = async () => {
    setCloudError('');
    setCloudConnecting(true);
    try {
      const result = await signInWithGoogleDrive();
      setCloudUser(result.user);
      setDriveConnected(true);
    } catch (err) {
      setCloudError(
        err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.'
      );
    } finally {
      setCloudConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    await signOutGoogleDrive();
    setCloudUser(null);
    setDriveConnected(false);
  };

  const resetForm = () => {
    setEditingApp(null);
    setName('');
    setVersion('1.0.0');
    setPackageId('');
    setCategory('Utilities & Productivity');
    setMinAndroid('Android 8.0+');
    setDeveloper('Sasindu Studios');
    setTagline('');
    setDescription('');
    setWhatsNew('');
    setFeatured(true);
    setApkLinkInput('');
    setApkSizeMbInput('');
    setApkShaInput('');
    setIconLinkInput('');
    setShotLinkInputs(['', '', '', '']);
    setVideoLinkInput('');
    setApkFile(null);
    setIconFile(null);
    setIconPreview('');
    setShotFiles([null, null, null, null]);
    setShotPreviews(['', '', '', '']);
    setClearedShots([false, false, false, false]);
    setVideoFile(null);
    setVideoPreview('');
    setClearVideoFlag(false);
    setFormError('');
    setUploadPercent(0);
    setUploadStepLabel('');
  };

  const startEditing = (appItem: AppRelease) => {
    setEditingApp(appItem);
    setName(appItem.name);
    setVersion(appItem.version);
    setPackageId(appItem.packageId);
    setCategory(appItem.category);
    setMinAndroid(appItem.minAndroid);
    setDeveloper(appItem.developer);
    setTagline(appItem.tagline);
    setDescription(appItem.description);
    setWhatsNew(appItem.whatsNew);
    setFeatured(appItem.featured);
    setStorageProvider(appItem.storageProvider || 'cloud-link');
    setApkLinkInput(appItem.apkUrl.startsWith('https://') ? appItem.apkUrl : '');
    setApkSizeMbInput(
      appItem.apkSizeBytes > 0 ? (appItem.apkSizeBytes / (1024 * 1024)).toFixed(2) : ''
    );
    setApkShaInput(appItem.apkSha256 || '');
    setIconLinkInput(appItem.iconUrl.startsWith('https://') ? appItem.iconUrl : '');
    setShotLinkInputs([
      appItem.screenshots[0] || '',
      appItem.screenshots[1] || '',
      appItem.screenshots[2] || '',
      appItem.screenshots[3] || '',
    ]);
    setVideoLinkInput(appItem.videoUrl || '');
    setApkFile(null);
    setIconFile(null);
    setIconPreview(appItem.iconUrl || '');
    setShotFiles([null, null, null, null]);
    setShotPreviews([...appItem.screenshots] as [string, string, string, string]);
    setClearedShots([false, false, false, false]);
    setVideoFile(null);
    setVideoPreview(appItem.videoUrl || '');
    setClearVideoFlag(false);
    setFormError('');
    setFormSuccess('');
    setTab('upload');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleIconChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const handleSingleShotChange = (slotIdx: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const nextFiles = [...shotFiles] as [File | null, File | null, File | null, File | null];
    const nextPreviews = [...shotPreviews] as [string, string, string, string];
    const nextCleared = [...clearedShots] as [boolean, boolean, boolean, boolean];
    nextFiles[slotIdx] = file;
    nextPreviews[slotIdx] = URL.createObjectURL(file);
    nextCleared[slotIdx] = false;
    setShotFiles(nextFiles);
    setShotPreviews(nextPreviews);
    setClearedShots(nextCleared);
  };

  const handleMultiShotsChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).slice(0, 4);
    if (selected.length === 0) return;
    const nextFiles = [...shotFiles] as [File | null, File | null, File | null, File | null];
    const nextPreviews = [...shotPreviews] as [string, string, string, string];
    const nextCleared = [...clearedShots] as [boolean, boolean, boolean, boolean];
    selected.forEach((file, idx) => {
      nextFiles[idx] = file;
      nextPreviews[idx] = URL.createObjectURL(file);
      nextCleared[idx] = false;
    });
    setShotFiles(nextFiles);
    setShotPreviews(nextPreviews);
    setClearedShots(nextCleared);
  };

  const removeShot = (slotIdx: number) => {
    const nextFiles = [...shotFiles] as [File | null, File | null, File | null, File | null];
    const nextPreviews = [...shotPreviews] as [string, string, string, string];
    const nextCleared = [...clearedShots] as [boolean, boolean, boolean, boolean];
    nextFiles[slotIdx] = null;
    nextPreviews[slotIdx] = '';
    nextCleared[slotIdx] = true;
    setShotFiles(nextFiles);
    setShotPreviews(nextPreviews);
    setClearedShots(nextCleared);
  };

  const handleVideoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setClearVideoFlag(false);
  };

  const removeVideo = () => {
    setVideoFile(null);
    setVideoPreview('');
    setClearVideoFlag(true);
  };

  const executePublish = async () => {
    setFormError('');
    setFormSuccess('');
    setUploading(true);
    setUploadPercent(10);
    setUploadStepLabel('');

    try {
      // MODE 1: FREE CLOUD LINKS -> SAVES DIRECTLY TO FIREBASE CLOUD DATABASE (WORKS EVERYWHERE!)
      if (storageProvider === 'cloud-link') {
        const normalizedApk = normalizeApkDownloadUrl(apkLinkInput);
        if (!normalizedApk.startsWith('https://')) {
          throw new Error('Please paste a valid https:// APK download link.');
        }

        const normalizedIcon = normalizeImageUrl(iconLinkInput);
        const normalizedShots: [string, string, string, string] = [
          normalizeImageUrl(shotLinkInputs[0]),
          normalizeImageUrl(shotLinkInputs[1]),
          normalizeImageUrl(shotLinkInputs[2]),
          normalizeImageUrl(shotLinkInputs[3]),
        ];
        const normalizedVideo = normalizeVideoUrl(videoLinkInput);
        const sizeMb = parseFloat(apkSizeMbInput);
        const sizeBytes =
          Number.isFinite(sizeMb) && sizeMb > 0 ? Math.round(sizeMb * 1024 * 1024) : 0;

        setUploadStepLabel('Publishing app release to Firebase Cloud Database...');
        setUploadPercent(60);

        await saveCloudAppRelease(
          {
            name: name.trim(),
            tagline: tagline.trim(),
            description: description.trim(),
            whatsNew: whatsNew.trim(),
            version: version.trim() || '1.0.0',
            packageId: packageId.trim() || 'com.droidvault.app',
            category: category.trim() || 'Utilities & Productivity',
            minAndroid: minAndroid.trim() || 'Android 8.0+',
            developer: developer.trim() || 'Sasindu Studios',
            iconUrl: normalizedIcon,
            apkUrl: normalizedApk,
            apkFileName: inferFileNameFromUrl(normalizedApk, `${name.trim()}-v${version.trim()}`),
            apkSizeBytes: sizeBytes,
            apkSha256: apkShaInput.trim(),
            screenshots: normalizedShots,
            videoUrl: normalizedVideo,
            videoFileName: normalizedVideo ? 'Promo Video' : '',
            featured,
            storageProvider: 'cloud-link',
          },
          editingApp
        );

        setUploadPercent(100);
      } else if (storageProvider === 'google-drive') {
        // MODE 2: GOOGLE DRIVE DIRECT UPLOAD (15 GB FREE) -> SAVES METADATA TO FIREBASE CLOUD DATABASE
        if (!getDriveAccessToken()) {
          throw new Error(
            'Please connect your Google account using "Sign in with Google" first.'
          );
        }

        const driveFileIds: DriveFileIds = {
          apk: editingApp?.driveFileIds?.apk || '',
          icon: editingApp?.driveFileIds?.icon || '',
          screenshots: editingApp?.driveFileIds?.screenshots
            ? ([...editingApp.driveFileIds.screenshots] as [string, string, string, string])
            : ['', '', '', ''],
          video: editingApp?.driveFileIds?.video || '',
        };

        const oldDriveIdsToDelete: string[] = [];

        let apkUrl = editingApp?.apkUrl || '';
        let apkFileName = editingApp?.apkFileName || '';
        let apkSizeBytes = editingApp?.apkSizeBytes || 0;
        let apkSha256 = editingApp?.apkSha256 || '';
        let iconUrl = editingApp?.iconUrl || '';
        const screenshots: [string, string, string, string] = editingApp
          ? ([...editingApp.screenshots] as [string, string, string, string])
          : ['', '', '', ''];
        let videoUrl = editingApp?.videoUrl || '';
        let videoFileName = editingApp?.videoFileName || '';

        if (apkFile) {
          setUploadStepLabel(`Uploading APK (${apkFile.name}) to Google Drive...`);
          apkSha256 = await computeBrowserSha256(apkFile);
          const uploaded = await uploadFileToGoogleDrive(apkFile, {
            mimeTypeOverride: 'application/vnd.android.package-archive',
            onProgress: (p) => setUploadPercent(p),
          });
          if (editingApp?.driveFileIds?.apk) {
            oldDriveIdsToDelete.push(editingApp.driveFileIds.apk);
          }
          driveFileIds.apk = uploaded.fileId;
          apkUrl = getDriveDirectDownloadUrl(uploaded.fileId);
          apkFileName = apkFile.name;
          apkSizeBytes = apkFile.size;
        }

        if (iconFile) {
          setUploadStepLabel('Uploading app icon to Google Drive...');
          const uploaded = await uploadFileToGoogleDrive(iconFile, {
            onProgress: (p) => setUploadPercent(p),
          });
          if (editingApp?.driveFileIds?.icon) {
            oldDriveIdsToDelete.push(editingApp.driveFileIds.icon);
          }
          driveFileIds.icon = uploaded.fileId;
          iconUrl = getDriveImageUrl(uploaded.fileId);
        }

        for (let i = 0; i < 4; i++) {
          const shot = shotFiles[i];
          if (shot) {
            setUploadStepLabel(`Uploading screenshot ${i + 1} of 4 to Google Drive...`);
            const uploaded = await uploadFileToGoogleDrive(shot, {
              onProgress: (p) => setUploadPercent(p),
            });
            if (editingApp?.driveFileIds?.screenshots?.[i]) {
              oldDriveIdsToDelete.push(editingApp.driveFileIds.screenshots[i]);
            }
            if (!driveFileIds.screenshots) driveFileIds.screenshots = ['', '', '', ''];
            driveFileIds.screenshots[i] = uploaded.fileId;
            screenshots[i] = getDriveImageUrl(uploaded.fileId);
          } else if (editingApp && clearedShots[i]) {
            if (editingApp.driveFileIds?.screenshots?.[i]) {
              oldDriveIdsToDelete.push(editingApp.driveFileIds.screenshots[i]);
            }
            if (driveFileIds.screenshots) driveFileIds.screenshots[i] = '';
            screenshots[i] = '';
          }
        }

        if (videoFile) {
          setUploadStepLabel(`Uploading demo video (${videoFile.name}) to Google Drive...`);
          const uploaded = await uploadFileToGoogleDrive(videoFile, {
            onProgress: (p) => setUploadPercent(p),
          });
          if (editingApp?.driveFileIds?.video) {
            oldDriveIdsToDelete.push(editingApp.driveFileIds.video);
          }
          driveFileIds.video = uploaded.fileId;
          videoUrl = getDriveVideoPreviewUrl(uploaded.fileId);
          videoFileName = videoFile.name;
        } else if (editingApp && clearVideoFlag) {
          if (editingApp.driveFileIds?.video) {
            oldDriveIdsToDelete.push(editingApp.driveFileIds.video);
          }
          driveFileIds.video = '';
          videoUrl = '';
          videoFileName = '';
        }

        setUploadStepLabel('Saving release to Firebase Cloud Database...');
        await saveCloudAppRelease(
          {
            name: name.trim(),
            tagline: tagline.trim(),
            description: description.trim(),
            whatsNew: whatsNew.trim(),
            version: version.trim() || '1.0.0',
            packageId: packageId.trim() || 'com.droidvault.app',
            category: category.trim() || 'Utilities & Productivity',
            minAndroid: minAndroid.trim() || 'Android 8.0+',
            developer: developer.trim() || 'Sasindu Studios',
            iconUrl,
            apkUrl,
            apkFileName,
            apkSizeBytes,
            apkSha256,
            screenshots,
            videoUrl,
            videoFileName,
            featured,
            storageProvider: 'google-drive',
            driveFileIds,
          },
          editingApp
        );

        if (oldDriveIdsToDelete.length > 0) {
          await deleteFilesFromGoogleDrive(oldDriveIdsToDelete);
        }
        setUploadPercent(100);
      } else {
        // MODE 3: DIRECT SERVER UPLOAD (Node/Express backend fallback)
        const fd = new FormData();
        fd.append('name', name.trim());
        fd.append('version', version.trim() || '1.0.0');
        fd.append('packageId', packageId.trim());
        fd.append('category', category.trim());
        fd.append('minAndroid', minAndroid.trim());
        fd.append('developer', developer.trim());
        fd.append('tagline', tagline.trim());
        fd.append('description', description.trim());
        fd.append('whatsNew', whatsNew.trim());
        fd.append('featured', featured ? 'true' : 'false');
        fd.append('storageProvider', 'server');

        if (apkFile) fd.append('apk', apkFile);
        if (iconFile) fd.append('icon', iconFile);
        for (let i = 0; i < 4; i++) {
          if (shotFiles[i]) {
            fd.append(`screenshot${i}`, shotFiles[i] as File);
          } else if (editingApp && clearedShots[i]) {
            fd.append(`clearScreenshot${i}`, 'true');
          }
        }
        if (videoFile) {
          fd.append('video', videoFile);
        } else if (editingApp && clearVideoFlag) {
          fd.append('clearVideo', 'true');
        }

        setUploadStepLabel('Uploading files to server...');
        await uploadAppWithProgress(fd, {
          editAppId: editingApp?.id || null,
          onProgress: (pct) => setUploadPercent(pct),
        });
        await onRefreshApps();
      }

      const wasEditing = Boolean(editingApp);
      resetForm();
      setFormSuccess(wasEditing ? strings.updateSuccess : strings.uploadSuccess);
    } catch (err) {
      setFormError(parseFriendlyError(err));
    } finally {
      setUploading(false);
      setUploadStepLabel('');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!name.trim()) {
      setFormError('Please enter the app name.');
      return;
    }

    if (storageProvider === 'cloud-link') {
      if (!cloudUser) {
        setFormError(
          'Please click "Sign in with Google" above first so your release can be saved to Firebase Cloud Database.'
        );
        return;
      }
      if (!apkLinkInput.trim()) {
        setFormError(
          'Please paste your free APK download link (GitHub Releases, Google Drive, Dropbox, or MediaFire).'
        );
        return;
      }
    } else if (storageProvider === 'google-drive') {
      if (!driveConnected) {
        setFormError(
          'Please click "Sign in with Google" above to connect your Google Drive account.'
        );
        return;
      }
      if (!editingApp && !apkFile) {
        setFormError('Please select an Android APK file (.apk).');
        return;
      }
    } else if (!editingApp && !apkFile) {
      setFormError('Please select an Android APK file (.apk).');
      return;
    }

    // Require explicit confirmation before replacing/removing existing Google Drive files
    if (editingApp && editingApp.storageProvider === 'google-drive' && storageProvider === 'google-drive') {
      const affectedItems: string[] = [];
      if (apkFile && editingApp.driveFileIds?.apk) affectedItems.push(`APK (${editingApp.apkFileName})`);
      if (iconFile && editingApp.driveFileIds?.icon) affectedItems.push('App Icon');
      for (let i = 0; i < 4; i++) {
        if ((shotFiles[i] || clearedShots[i]) && editingApp.driveFileIds?.screenshots?.[i]) {
          affectedItems.push(`Screenshot 0${i + 1}`);
        }
      }
      if ((videoFile || clearVideoFlag) && editingApp.driveFileIds?.video) {
        affectedItems.push(`Demo Video (${editingApp.videoFileName || 'video'})`);
      }

      if (affectedItems.length > 0) {
        setConfirmModal({
          title: 'Update Google Drive files?',
          description: `This will replace or remove ${affectedItems.length} existing file(s) stored in your Google Drive: ${affectedItems.join(', ')}. Do you want to continue?`,
          confirmLabel: 'Confirm Update',
          danger: false,
          onConfirm: executePublish,
        });
        return;
      }
    }

    await executePublish();
  };

  const handleSetFeatured = async (appItem: AppRelease) => {
    try {
      if (appItem.source === 'firestore') {
        await setCloudFeaturedApp(appItem.id);
      } else {
        await setFeaturedApp(appItem.id);
        await onRefreshApps();
      }
    } catch (err) {
      setFormError(parseFriendlyError(err));
    }
  };

  const requestDeleteApp = (appItem: AppRelease) => {
    const driveIds = collectDriveFileIds(appItem);
    const hasDriveFiles = driveIds.length > 0;
    const canDeleteDrive = hasDriveFiles && driveConnected;

    setConfirmModal({
      title: `Delete "${appItem.name}"?`,
      description: canDeleteDrive
        ? `This will permanently delete "${appItem.name}" from the storefront and remove ${driveIds.length} associated file(s) from your Google Drive ("DroidVault Uploads" folder). This action cannot be undone.`
        : hasDriveFiles
        ? `This will remove "${appItem.name}" from the storefront. Sign in with Google first if you also want to delete its ${driveIds.length} hosted file(s) from Google Drive.`
        : `This will permanently delete "${appItem.name}" from the storefront. This action cannot be undone.`,
      confirmLabel: 'Delete Permanently',
      danger: true,
      onConfirm: async () => {
        if (canDeleteDrive) {
          await deleteFilesFromGoogleDrive(driveIds);
        }
        if (appItem.source === 'firestore') {
          await deleteCloudAppRelease(appItem.id);
        } else {
          await deleteAppRelease(appItem.id);
          await onRefreshApps();
        }
        if (editingApp?.id === appItem.id) resetForm();
      },
    });
  };

  const handleConfirmModalProceed = async () => {
    if (!confirmModal) return;
    setConfirmBusy(true);
    try {
      const action = confirmModal.onConfirm;
      setConfirmModal(null);
      await action();
    } catch (err) {
      setFormError(parseFriendlyError(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleSignOut = async () => {
    await logoutAuth();
    onLogout();
  };

  const totalDownloads = apps.reduce((sum, a) => sum + (a.downloads || 0), 0);
  const previewApkNormalized = normalizeApkDownloadUrl(apkLinkInput);
  const previewIconNormalized = normalizeImageUrl(iconLinkInput);
  const previewVideoNormalized = normalizeVideoUrl(videoLinkInput);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-zinc-50 flex flex-col lg:flex-row">
      {/* Left Sidebar (256px desktop) */}
      <aside className="lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-zinc-200 shrink-0 flex flex-col justify-between">
        <div className="p-5">
          <div className="pb-5 border-b border-zinc-100">
            <p className="font-display text-base font-bold text-zinc-950">{strings.adminBrand}</p>
            <p className="text-xs font-mono text-zinc-500 mt-0.5 truncate">sasindu#@gmail.com</p>
          </div>

          <nav className="mt-5 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible">
            <button
              type="button"
              onClick={() => setTab('upload')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === 'upload'
                  ? 'bg-zinc-950 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
              }`}
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>{strings.adminNavUpload}</span>
            </button>

            <button
              type="button"
              onClick={() => setTab('apps')}
              className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === 'apps'
                  ? 'bg-zinc-950 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Package className="w-4 h-4 shrink-0" />
                <span>{strings.adminNavApps}</span>
              </span>
              <span
                className={`font-mono text-xs tabular-nums ${
                  tab === 'apps' ? 'text-zinc-300' : 'text-zinc-400'
                }`}
              >
                {apps.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('users')}
              className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === 'users'
                  ? 'bg-zinc-950 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Users className="w-4 h-4 shrink-0" />
                <span>{strings.adminNavUsers}</span>
              </span>
              <span
                className={`font-mono text-xs tabular-nums ${
                  tab === 'users' ? 'text-zinc-300' : 'text-zinc-400'
                }`}
              >
                {users.length}
              </span>
            </button>
          </nav>
        </div>

        <div className="p-5 border-t border-zinc-100 flex lg:flex-col gap-2">
          <button
            type="button"
            onClick={() => onViewStore()}
            className="flex-1 lg:flex-none inline-flex items-center justify-center lg:justify-start gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 transition-colors whitespace-nowrap cursor-pointer"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span>{strings.adminViewStore}</span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex-1 lg:flex-none inline-flex items-center justify-center lg:justify-start gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{strings.signOut}</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 min-w-0 p-5 sm:p-8 lg:p-10 max-w-[1120px]">
        {/* Top Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 bg-white border border-zinc-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 mb-8">
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-500">{strings.statTotalApps}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-zinc-950 tabular-nums">
              {apps.length}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-500">{strings.statTotalDownloads}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {totalDownloads.toLocaleString()}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-500">{strings.statTotalUsers}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-zinc-950 tabular-nums">
              {users.length}
            </p>
          </div>
        </div>

        {/* TAB 1: UPLOAD / EDIT ANDROID APP */}
        {tab === 'upload' && (
          <div className="space-y-6">
            {/* Cloud Database & Storage Destination Card */}
            <section className="bg-white border border-zinc-200 rounded-2xl p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                    <Cloud className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Cloud Publishing & Free File Storage</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    App details sync live across every visitor&apos;s phone via Firebase Cloud
                    Database. Choose how you want to host your APK, screenshots, and video:
                  </p>
                </div>

                {/* Segmented Storage Selector */}
                <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg shrink-0 self-start lg:self-auto">
                  <button
                    type="button"
                    onClick={() => setStorageProvider('cloud-link')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      storageProvider === 'cloud-link'
                        ? 'bg-white text-zinc-950 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    Free Cloud Links
                  </button>
                  <button
                    type="button"
                    onClick={() => setStorageProvider('google-drive')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      storageProvider === 'google-drive'
                        ? 'bg-white text-zinc-950 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    Google Drive Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setStorageProvider('server')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      storageProvider === 'server'
                        ? 'bg-white text-zinc-950 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-950'
                    }`}
                  >
                    Direct Server
                  </button>
                </div>
              </div>

              {/* Unified Google Sign-In Bar for Firestore Cloud Sync + Google Drive */}
              {storageProvider !== 'server' && (
                <div className="mt-5 pt-5 border-t border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {cloudUser ? (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-emerald-700 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>
                            Cloud Sync Active
                            {driveConnected ? ' · Google Drive Ready' : ''}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">
                          Signed in as {cloudUser.email}
                          {storageProvider === 'google-drive' && !driveConnected
                            ? ' — Re-connect Google to enable direct Drive file uploads'
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {storageProvider === 'google-drive' && !driveConnected && (
                          <button
                            type="button"
                            disabled={cloudConnecting}
                            onClick={handleConnectGoogle}
                            className="px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Reconnect Drive
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleDisconnectGoogle}
                          className="px-3.5 py-2 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900">
                          Sign in with Google to publish live to all devices
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Authorizes Firebase Cloud Database writes and optional 15 GB Google Drive
                          uploads.
                        </p>
                      </div>

                      {/* Official Google GSI Material Sign-In Button */}
                      <button
                        type="button"
                        disabled={cloudConnecting}
                        onClick={handleConnectGoogle}
                        className="inline-flex items-center justify-center gap-3 h-10 px-4 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-50 hover:border-zinc-400 text-sm font-medium text-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          className="w-5 h-5 shrink-0 block"
                          aria-hidden="true"
                        >
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                          <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                        <span>{cloudConnecting ? 'Connecting...' : 'Sign in with Google'}</span>
                      </button>
                    </>
                  )}
                </div>
              )}

              {cloudError && (
                <div
                  role="alert"
                  className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {cloudError}
                </div>
              )}
            </section>

            {/* Upload / Edit Form Card */}
            <section className="bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-100">
                <h1 className="font-display text-xl sm:text-2xl font-bold text-zinc-950">
                  {editingApp ? strings.adminEditHeading : strings.adminUploadHeading}
                </h1>
                {editingApp && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3.5 py-2 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {strings.adminCancelEdit}
                  </button>
                )}
              </div>

              {formSuccess && (
                <div
                  role="status"
                  className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between gap-4"
                >
                  <span className="inline-flex items-center gap-2 font-medium">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{formSuccess}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onViewStore()}
                    className="text-xs font-semibold underline hover:text-emerald-950 whitespace-nowrap cursor-pointer"
                  >
                    {strings.adminViewStore}
                  </button>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-7 space-y-8">
                {/* SECTION A: APK & ICON (Cloud Links OR Direct File Pickers) */}
                {storageProvider === 'cloud-link' ? (
                  <div className="space-y-6">
                    <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-600 leading-relaxed">
                      <p className="font-semibold text-zinc-900 flex items-center gap-1.5 mb-1">
                        <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Free Hosting — Paste Any Cloud Link</span>
                      </p>
                      <p>
                        Upload your <code className="font-mono">.apk</code> to{' '}
                        <strong>GitHub Releases</strong> (2 GB free per file, fastest),{' '}
                        <strong>Google Drive</strong> (set &ldquo;Anyone with the link&rdquo;),{' '}
                        <strong>Dropbox</strong>, or <strong>MediaFire</strong> and paste the link
                        below. Share links are converted automatically to direct downloads.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                      <div className="md:col-span-8 space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label className="block text-sm font-semibold text-zinc-900">
                              APK Download Link *
                            </label>
                            {previewApkNormalized && (
                              <span className="text-xs font-mono text-emerald-700">
                                {detectStorageHostLabel(previewApkNormalized, 'cloud-link')}
                              </span>
                            )}
                          </div>
                          <input
                            type="url"
                            required
                            value={apkLinkInput}
                            onChange={(e) => setApkLinkInput(e.target.value)}
                            placeholder="https://github.com/user/repo/releases/download/v1.0/app.apk or Google Drive link"
                            className="w-full h-11 px-3.5 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-zinc-700 mb-1">
                              File Size (MB, optional)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={apkSizeMbInput}
                              onChange={(e) => setApkSizeMbInput(e.target.value)}
                              placeholder="e.g. 24.5"
                              className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-zinc-700 mb-1">
                              SHA-256 Checksum (optional)
                            </label>
                            <input
                              type="text"
                              value={apkShaInput}
                              onChange={(e) => setApkShaInput(e.target.value)}
                              placeholder="Optional verification hash"
                              className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Icon Link + Preview */}
                      <div className="md:col-span-4">
                        <label className="block text-sm font-semibold text-zinc-900 mb-1.5">
                          App Icon URL
                        </label>
                        <input
                          type="url"
                          value={iconLinkInput}
                          onChange={(e) => setIconLinkInput(e.target.value)}
                          placeholder="https://... (PNG/JPG or Drive link)"
                          className="w-full h-10 px-3 rounded-lg border border-zinc-300 text-xs font-mono text-zinc-950 focus:outline-none focus:border-emerald-600 mb-3"
                        />
                        <div className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 bg-zinc-50">
                          {previewIconNormalized ? (
                            <img
                              src={previewIconNormalized}
                              alt="App icon preview"
                              referrerPolicy="no-referrer"
                              className="w-14 h-14 rounded-xl object-cover border border-zinc-200 shrink-0"
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-xl bg-white border border-zinc-200 flex items-center justify-center shrink-0">
                              <Smartphone className="w-6 h-6 text-zinc-400" />
                            </div>
                          )}
                          <p className="text-xs text-zinc-500">
                            Paste an image URL or public Google Drive image link.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* APK Dropzone */}
                    <div className="md:col-span-8">
                      <label className="block text-sm font-semibold text-zinc-900 mb-2">
                        {strings.apkUploadTitle} {!editingApp && '*'}
                      </label>
                      <label className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-zinc-300 hover:border-emerald-500 bg-zinc-50 hover:bg-emerald-50/30 transition-colors cursor-pointer text-center min-h-[144px]">
                        <Upload className="w-6 h-6 text-emerald-600 mb-2" />
                        {apkFile ? (
                          <>
                            <p className="text-sm font-semibold text-zinc-950 break-all">
                              {apkFile.name}
                            </p>
                            <p className="text-xs font-mono text-emerald-700 mt-1 tabular-nums">
                              {formatBytes(apkFile.size)}
                            </p>
                          </>
                        ) : editingApp ? (
                          <>
                            <p className="text-sm font-medium text-zinc-800">
                              {strings.apkCurrentFile}: {editingApp.apkFileName}
                            </p>
                            <p className="text-xs text-zinc-500 mt-1">{strings.apkUploadHint}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-zinc-800">
                              {strings.apkUploadHint}
                            </p>
                            <p className="text-xs text-zinc-500 mt-1">
                              .apk ·{' '}
                              {storageProvider === 'google-drive'
                                ? 'Uploads directly to Google Drive'
                                : 'Uploads to direct server'}
                            </p>
                          </>
                        )}
                        <input
                          type="file"
                          accept=".apk,application/vnd.android.package-archive"
                          onChange={(e) => setApkFile(e.target.files?.[0] || null)}
                          className="sr-only"
                        />
                      </label>
                    </div>

                    {/* App Icon Upload */}
                    <div className="md:col-span-4">
                      <label className="block text-sm font-semibold text-zinc-900 mb-2">
                        {strings.iconUploadTitle}
                      </label>
                      <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-zinc-300 hover:border-emerald-500 bg-zinc-50 transition-colors cursor-pointer min-h-[144px] text-center">
                        {iconPreview ? (
                          <img
                            src={iconPreview}
                            alt="App icon preview"
                            referrerPolicy="no-referrer"
                            className="w-20 h-20 rounded-2xl object-cover border border-zinc-200 mb-2"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-2xl bg-white border border-zinc-200 flex items-center justify-center mb-2">
                            <Smartphone className="w-7 h-7 text-zinc-400" />
                          </div>
                        )}
                        <span className="text-xs text-zinc-600">{strings.iconUploadHint}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleIconChange}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* SECTION B: App Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-6 border-t border-zinc-100">
                  <div className="sm:col-span-2 lg:col-span-1">
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.appNameField}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={strings.appNamePlaceholder}
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.versionField}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={40}
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="1.0.0"
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.packageField}
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      value={packageId}
                      onChange={(e) => setPackageId(e.target.value)}
                      placeholder="com.sasindu.myapp"
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.categoryField}
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.minAndroidField}
                    </label>
                    <input
                      type="text"
                      maxLength={40}
                      value={minAndroid}
                      onChange={(e) => setMinAndroid(e.target.value)}
                      placeholder="Android 8.0+"
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.developerField}
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={developer}
                      onChange={(e) => setDeveloper(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                      {strings.taglineField}
                    </label>
                    <input
                      type="text"
                      maxLength={240}
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder={strings.taglinePlaceholder}
                      className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                        {strings.descriptionField}
                      </label>
                      <textarea
                        rows={4}
                        maxLength={5000}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={strings.descriptionPlaceholder}
                        className="w-full p-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600 resize-y"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-800 mb-1.5">
                        {strings.whatsNewField}
                      </label>
                      <textarea
                        rows={4}
                        maxLength={3000}
                        value={whatsNew}
                        onChange={(e) => setWhatsNew(e.target.value)}
                        placeholder={strings.whatsNewPlaceholder}
                        className="w-full p-3.5 rounded-lg border border-zinc-300 text-sm text-zinc-950 focus:outline-none focus:border-emerald-600 resize-y"
                      />
                    </div>
                  </div>
                </div>

                {/* SECTION C: 4 Dedicated Screenshot Slots */}
                <div className="pt-6 border-t border-zinc-100">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-950">
                        {strings.screenshotsUploadTitle}
                      </h2>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {storageProvider === 'cloud-link'
                          ? 'Paste up to 4 image links (GitHub, Google Drive, Dropbox, ImgBB, or direct PNG/JPG URL).'
                          : strings.screenshotsUploadHint}
                      </p>
                    </div>

                    {storageProvider !== 'cloud-link' && (
                      <>
                        <button
                          type="button"
                          onClick={() => multiShotInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>{strings.selectAll4Shots}</span>
                        </button>
                        <input
                          ref={multiShotInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleMultiShotsChange}
                          className="sr-only"
                        />
                      </>
                    )}
                  </div>

                  {storageProvider === 'cloud-link' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[0, 1, 2, 3].map((slotIdx) => {
                        const rawVal = shotLinkInputs[slotIdx];
                        const previewSrc = normalizeImageUrl(rawVal);
                        return (
                          <div
                            key={slotIdx}
                            className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-2.5"
                          >
                            <div className="flex items-center justify-between text-xs font-mono text-zinc-600">
                              <span>Screenshot 0{slotIdx + 1}</span>
                              {rawVal && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = [...shotLinkInputs] as [
                                      string,
                                      string,
                                      string,
                                      string,
                                    ];
                                    next[slotIdx] = '';
                                    setShotLinkInputs(next);
                                  }}
                                  className="text-zinc-400 hover:text-red-600 cursor-pointer"
                                  aria-label={`Clear screenshot ${slotIdx + 1}`}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <input
                              type="url"
                              value={rawVal}
                              onChange={(e) => {
                                const next = [...shotLinkInputs] as [
                                  string,
                                  string,
                                  string,
                                  string,
                                ];
                                next[slotIdx] = e.target.value;
                                setShotLinkInputs(next);
                              }}
                              placeholder={`Image URL 0${slotIdx + 1}`}
                              className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 bg-white text-xs font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                            />
                            <div className="aspect-[9/16] rounded-lg overflow-hidden border border-zinc-200 bg-white flex items-center justify-center">
                              {previewSrc ? (
                                <img
                                  src={previewSrc}
                                  alt={`Screenshot ${slotIdx + 1} preview`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="w-6 h-6 text-zinc-300" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {[0, 1, 2, 3].map((slotIdx) => {
                        const preview = shotPreviews[slotIdx];
                        return (
                          <div
                            key={slotIdx}
                            className="relative aspect-[9/16] rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 overflow-hidden flex flex-col items-center justify-center group"
                          >
                            {preview ? (
                              <>
                                <img
                                  src={preview}
                                  alt={`Screenshot ${slotIdx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeShot(slotIdx)}
                                  aria-label={`Remove screenshot ${slotIdx + 1}`}
                                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-zinc-950/80 text-white hover:bg-red-600 transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                                <label className="absolute bottom-2 inset-x-2 py-1.5 rounded-lg bg-zinc-950/75 text-white text-xs font-medium text-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                                  Change
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleSingleShotChange(slotIdx, e)}
                                    className="sr-only"
                                  />
                                </label>
                              </>
                            ) : (
                              <label className="w-full h-full flex flex-col items-center justify-center p-3 text-center cursor-pointer hover:bg-emerald-50/30 transition-colors">
                                <ImageIcon className="w-6 h-6 text-zinc-400 mb-2" />
                                <span className="text-xs font-medium text-zinc-700">
                                  {strings.screenshotLabel} 0{slotIdx + 1}
                                </span>
                                <span className="text-[11px] text-zinc-400 mt-0.5">
                                  Click to add
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleSingleShotChange(slotIdx, e)}
                                  className="sr-only"
                                />
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SECTION D: Demo Video */}
                <div className="pt-6 border-t border-zinc-100">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-950">
                        {strings.videoUploadTitle}
                      </h2>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {storageProvider === 'cloud-link'
                          ? 'Paste a YouTube link, Google Drive video share link, or direct .mp4 URL.'
                          : strings.videoUploadHint}
                      </p>
                    </div>
                    {storageProvider !== 'cloud-link' && videoPreview && (
                      <button
                        type="button"
                        onClick={removeVideo}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Remove video</span>
                      </button>
                    )}
                  </div>

                  {storageProvider === 'cloud-link' ? (
                    <div className="space-y-4">
                      <input
                        type="url"
                        value={videoLinkInput}
                        onChange={(e) => setVideoLinkInput(e.target.value)}
                        placeholder="https://youtube.com/watch?v=... or Google Drive video link or .mp4 URL"
                        className="w-full h-10 px-3.5 rounded-lg border border-zinc-300 text-sm font-mono text-zinc-950 focus:outline-none focus:border-emerald-600"
                      />
                      {previewVideoNormalized && (
                        <div className="rounded-xl overflow-hidden border border-zinc-200 bg-black aspect-video max-w-xl">
                          {isEmbeddableVideoUrl(previewVideoNormalized) ? (
                            <iframe
                              src={previewVideoNormalized}
                              title="Demo video preview"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                              allowFullScreen
                              className="w-full h-full border-0"
                            />
                          ) : (
                            <video
                              src={previewVideoNormalized}
                              controls
                              className="w-full h-full object-contain"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ) : videoPreview ? (
                    <div className="rounded-xl overflow-hidden border border-zinc-200 bg-black aspect-video max-w-xl">
                      {isEmbeddableVideoUrl(videoPreview) ? (
                        <iframe
                          src={videoPreview}
                          title="Demo video preview"
                          allow="autoplay; fullscreen"
                          allowFullScreen
                          className="w-full h-full border-0"
                        />
                      ) : (
                        <video
                          src={videoPreview}
                          controls
                          className="w-full h-full object-contain"
                        />
                      )}
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-zinc-300 hover:border-emerald-500 bg-zinc-50 hover:bg-emerald-50/30 transition-colors cursor-pointer text-center">
                      <Film className="w-6 h-6 text-zinc-400 mb-2" />
                      <span className="text-sm font-medium text-zinc-800">
                        {strings.videoUploadTitle}
                      </span>
                      <span className="text-xs text-zinc-500 mt-1">MP4, WebM, MOV</span>
                      <input
                        type="file"
                        accept="video/*"
                        onChange={handleVideoChange}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>

                {/* Featured Checkbox + Progress + Submit */}
                <div className="pt-6 border-t border-zinc-100 space-y-5">
                  <label className="inline-flex items-center gap-2.5 text-sm text-zinc-800 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={featured}
                      onChange={(e) => setFeatured(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300 accent-emerald-600"
                    />
                    <span>{strings.featuredToggleLabel}</span>
                  </label>

                  {uploading && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-zinc-600">
                        <span className="truncate">
                          {uploadStepLabel || strings.uploadingProgress}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">{uploadPercent}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-zinc-200 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 transition-all duration-150"
                          style={{ width: `${uploadPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={uploading}
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>
                        {uploading
                          ? `${strings.uploadingProgress} ${uploadPercent}%`
                          : editingApp
                          ? strings.saveChangesButton
                          : strings.publishButton}
                      </span>
                    </button>

                    {editingApp && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-5 py-3 rounded-xl bg-white border border-zinc-200 hover:border-zinc-400 text-sm font-medium text-zinc-700 cursor-pointer"
                      >
                        {strings.adminCancelEdit}
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </section>
          </div>
        )}

        {/* TAB 2: PUBLISHED APPS TABLE */}
        {tab === 'apps' && (
          <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between gap-4">
              <h1 className="font-display text-xl font-bold text-zinc-950">
                {strings.adminNavApps}
              </h1>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setTab('upload');
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{strings.adminNavUpload}</span>
              </button>
            </div>

            {apps.length === 0 ? (
              <div className="p-12 text-center text-sm text-zinc-500">{strings.noAppsDesc}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                      <th className="py-3 px-5 font-medium">{strings.colApp}</th>
                      <th className="py-3 px-4 font-medium">{strings.colVersion}</th>
                      <th className="py-3 px-4 font-medium">Storage</th>
                      <th className="py-3 px-4 font-medium">{strings.colSize}</th>
                      <th className="py-3 px-4 font-medium">{strings.colDownloads}</th>
                      <th className="py-3 px-5 font-medium text-right">{strings.colActions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {apps.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50/70">
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3 min-w-[200px]">
                            <div className="w-10 h-10 rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100 shrink-0 flex items-center justify-center">
                              {item.iconUrl ? (
                                <img
                                  src={item.iconUrl}
                                  alt={item.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Smartphone className="w-5 h-5 text-zinc-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-950 truncate">{item.name}</p>
                              <p className="text-xs text-zinc-500 font-mono truncate">
                                {item.packageId}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-zinc-700 whitespace-nowrap">
                          v{item.version}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-xs text-zinc-600">
                          <span className="inline-flex items-center gap-1.5">
                            {item.source === 'firestore' ? (
                              <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <HardDrive className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            )}
                            <span>{detectStorageHostLabel(item.apkUrl, item.storageProvider)}</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-zinc-600 whitespace-nowrap">
                          {item.apkSizeBytes > 0 ? formatBytes(item.apkSizeBytes) : '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-emerald-700 font-medium whitespace-nowrap">
                          {item.downloads.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {item.featured ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-md">
                                <Star className="w-3 h-3 fill-emerald-600 text-emerald-600" />
                                <span>{strings.featuredNow}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetFeatured(item)}
                                className="px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
                              >
                                {strings.setFeatured}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onViewStore(item.id)}
                              title={strings.adminViewStore}
                              className="p-1.5 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditing(item)}
                              title={strings.editBtn}
                              className="p-1.5 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteApp(item)}
                              title={strings.deleteBtn}
                              className="p-1.5 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 3: REGISTERED MEMBERS TABLE */}
        {tab === 'users' && (
          <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-100">
              <h1 className="font-display text-xl font-bold text-zinc-950">
                {strings.adminNavUsers}
              </h1>
            </div>

            {usersLoading ? (
              <div className="p-10 text-center text-sm text-zinc-500">Loading...</div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center text-sm text-zinc-500">{strings.noUsersYet}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                      <th className="py-3 px-5 font-medium">{strings.colName}</th>
                      <th className="py-3 px-4 font-medium">{strings.colEmail}</th>
                      <th className="py-3 px-4 font-medium">{strings.colJoined}</th>
                      <th className="py-3 px-5 font-medium text-right">{strings.colDownloads}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-zinc-50/70">
                        <td className="py-3.5 px-5 font-medium text-zinc-950">{u.name}</td>
                        <td className="py-3.5 px-4 font-mono text-xs text-zinc-600">{u.email}</td>
                        <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-zinc-500">
                          {formatDateShort(u.createdAt)}
                        </td>
                        <td className="py-3.5 px-5 font-mono text-xs tabular-nums text-zinc-700 text-right">
                          {u.downloadsCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Custom Confirmation Modal */}
      {confirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !confirmBusy && setConfirmModal(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmModal.danger
                    ? 'bg-red-50 text-red-600'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-zinc-950">
                  {confirmModal.title}
                </h2>
                <p className="mt-1.5 text-sm text-zinc-600 leading-relaxed">
                  {confirmModal.description}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={handleConfirmModalProceed}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-60 ${
                  confirmModal.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmBusy ? 'Processing...' : confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
