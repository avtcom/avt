import { useEffect, useState } from 'react';
import {
  Download,
  Play,
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Smartphone,
  Film,
  Image as ImageIcon,
  ShieldCheck,
} from 'lucide-react';
import type { AppRelease, Language } from '../types';
import { t } from '../i18n';
import { formatBytes, formatDateShort, triggerAppDownload } from '../lib/api';
import { detectStorageHostLabel, isEmbeddableVideoUrl } from '../lib/cloudLinks';

interface StorefrontProps {
  lang: Language;
  apps: AppRelease[];
  loading: boolean;
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onDownloadTriggered: (app: AppRelease) => void;
}

export function Storefront({
  lang,
  apps,
  loading,
  selectedAppId,
  onSelectApp,
  onDownloadTriggered,
}: StorefrontProps) {
  const strings = t(lang);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [downloadToast, setDownloadToast] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const activeApp =
    apps.find((a) => a.id === selectedAppId) || apps.find((a) => a.featured) || apps[0] || null;

  const validScreenshots = activeApp
    ? activeApp.screenshots
        .map((url, idx) => ({ url, idx }))
        .filter((item) => Boolean(item.url))
    : [];

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight' && validScreenshots.length > 0) {
        setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % validScreenshots.length));
      }
      if (e.key === 'ArrowLeft' && validScreenshots.length > 0) {
        setLightboxIndex((prev) =>
          prev === null ? 0 : (prev - 1 + validScreenshots.length) % validScreenshots.length
        );
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, validScreenshots.length]);

  const handleDownload = (app: AppRelease) => {
    setDownloadToast(true);
    setTimeout(() => setDownloadToast(false), 3200);
    onDownloadTriggered(app);
    triggerAppDownload(app);
  };

  const handleCopySha = async (hash: string) => {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const markBroken = (key: string) => {
    setBrokenImages((prev) => ({ ...prev, [key]: true }));
  };

  if (loading) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-14 space-y-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-zinc-200 animate-pulse" />
            <div className="h-12 w-3/4 rounded-lg bg-zinc-200 animate-pulse" />
            <div className="h-5 w-full rounded bg-zinc-200 animate-pulse" />
            <div className="h-12 w-48 rounded-xl bg-zinc-200 animate-pulse" />
          </div>
          <div className="lg:col-span-5 h-96 rounded-2xl bg-zinc-200 animate-pulse" />
        </div>
      </main>
    );
  }

  if (!activeApp) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center mx-auto mb-5">
          <Smartphone className="w-8 h-8 text-zinc-400" />
        </div>
        <h1 className="font-display text-2xl font-bold text-zinc-950">{strings.noAppsTitle}</h1>
        <p className="text-zinc-600 mt-2 max-w-md mx-auto">{strings.noAppsDesc}</p>
      </main>
    );
  }

  const primaryPreviewShot = activeApp.screenshots.find((s) => Boolean(s)) || '';

  return (
    <main id="top" className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-20">
      {/* Multi-app switcher when more than one app has been uploaded */}
      {apps.length > 1 && (
        <section aria-label={strings.allReleases} className="border-b border-zinc-200 pb-6">
          <p className="text-xs font-medium text-zinc-500 mb-3">{strings.allReleases}</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {apps.map((item) => {
              const isSelected = item.id === activeApp.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectApp(item.id)}
                  className={`inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-950 text-white border-zinc-950'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400 hover:text-zinc-950'
                  }`}
                >
                  <span>{item.name}</span>
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isSelected ? 'text-zinc-300' : 'text-zinc-400'
                    }`}
                  >
                    v{item.version}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Hero Split Section */}
      <section className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          {/* Left Focal Value & Download CTA */}
          <div className="lg:col-span-7 flex flex-col justify-center">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-900 shrink-0 flex items-center justify-center">
                {activeApp.iconUrl && !brokenImages[`icon-${activeApp.id}`] ? (
                  <img
                    src={activeApp.iconUrl}
                    alt={`${activeApp.name} icon`}
                    referrerPolicy="no-referrer"
                    onError={() => markBroken(`icon-${activeApp.id}`)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Smartphone className="w-9 h-9 text-emerald-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-700 truncate">
                  {activeApp.developer}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 mt-1">
                  <span>{activeApp.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">v{activeApp.version}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeApp.minAndroid}</span>
                </div>
              </div>
            </div>

            <h1 className="mt-6 font-display font-extrabold tracking-tight text-zinc-950 leading-[1.12] [text-wrap:balance] text-[clamp(2.25rem,4vw,3.5rem)]">
              {activeApp.name}
            </h1>

            <p className="mt-4 text-base sm:text-lg text-zinc-600 leading-relaxed max-w-2xl">
              {activeApp.tagline}
            </p>

            {/* Primary & Secondary Actions */}
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={() => handleDownload(activeApp)}
                className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-sm sm:text-base font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <Download className="w-5 h-5 shrink-0" />
                <span>{strings.downloadApk}</span>
                {activeApp.apkSizeBytes > 0 && (
                  <span className="font-mono text-xs opacity-85 tabular-nums">
                    ({formatBytes(activeApp.apkSizeBytes)})
                  </span>
                )}
              </button>

              <a
                href="#video"
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-white border border-zinc-200 hover:border-zinc-400 text-zinc-800 hover:text-zinc-950 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{strings.watchVideo}</span>
              </a>
            </div>

            {downloadToast && (
              <p
                role="status"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-emerald-700"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>
                  {strings.downloadedToast} — {activeApp.apkFileName}
                </span>
              </p>
            )}
          </div>

          {/* Right Showcase Visual Panel */}
          <div className="lg:col-span-5">
            <div className="h-full min-h-[340px] lg:min-h-[420px] rounded-2xl bg-zinc-100 border border-zinc-200 p-6 sm:p-8 flex items-center justify-center overflow-hidden">
              {primaryPreviewShot && !brokenImages[`hero-${activeApp.id}`] ? (
                <button
                  type="button"
                  onClick={() => setLightboxIndex(0)}
                  className="group relative w-[220px] sm:w-[248px] aspect-[9/16] rounded-[24px] overflow-hidden border border-zinc-300 bg-white shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
                >
                  <img
                    src={primaryPreviewShot}
                    alt={`${activeApp.name} preview`}
                    referrerPolicy="no-referrer"
                    onError={() => markBroken(`hero-${activeApp.id}`)}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </button>
              ) : (
                <div className="text-center px-6 py-12">
                  <Smartphone className="w-12 h-12 text-zinc-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-zinc-700">{activeApp.name}</p>
                  <p className="text-xs text-zinc-500 font-mono mt-1">v{activeApp.version}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Full-Width 4-Column Release Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 rounded-2xl divide-y lg:divide-y-0 divide-x divide-zinc-200 overflow-hidden">
          <div className="p-5 sm:p-6">
            <p className="text-xs text-zinc-500">{strings.version}</p>
            <p className="mt-1.5 font-mono text-lg sm:text-xl font-semibold text-zinc-950 tabular-nums">
              v{activeApp.version}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <p className="text-xs text-zinc-500">{strings.fileSize}</p>
            <p className="mt-1.5 font-mono text-lg sm:text-xl font-semibold text-zinc-950 tabular-nums">
              {activeApp.apkSizeBytes > 0 ? formatBytes(activeApp.apkSizeBytes) : 'Direct APK'}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <p className="text-xs text-zinc-500">{strings.minAndroid}</p>
            <p className="mt-1.5 font-display text-lg sm:text-xl font-semibold text-zinc-950">
              {activeApp.minAndroid}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <p className="text-xs text-zinc-500">{strings.downloads}</p>
            <p className="mt-1.5 font-mono text-lg sm:text-xl font-semibold text-emerald-700 tabular-nums">
              {activeApp.downloads.toLocaleString()}
            </p>
          </div>
        </div>
      </section>

      {/* 4 Screenshots Showcase Section */}
      <section id="screenshots" className="scroll-mt-24 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-7">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-950">
              {strings.screenshotsTitle}
            </h2>
            <p className="text-sm text-zinc-600 mt-1">{strings.screenshotsSubtitle}</p>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-500">
            {validScreenshots.length} / 4
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {activeApp.screenshots.map((shotUrl, slotIdx) => {
            const key = `shot-${activeApp.id}-${slotIdx}`;
            const validIdx = validScreenshots.findIndex((s) => s.idx === slotIdx);

            if (!shotUrl || brokenImages[key]) {
              return (
                <div
                  key={key}
                  className="aspect-[9/16] rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 flex flex-col items-center justify-center p-4 text-center"
                >
                  <ImageIcon className="w-7 h-7 text-zinc-300 mb-2" />
                  <p className="text-xs font-medium text-zinc-500">
                    {strings.screenshotLabel} 0{slotIdx + 1}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">{strings.noScreenshot}</p>
                </div>
              );
            }

            return (
              <button
                key={key}
                type="button"
                onClick={() => setLightboxIndex(validIdx >= 0 ? validIdx : 0)}
                className="group text-left rounded-2xl overflow-hidden border border-zinc-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 cursor-pointer"
              >
                <div className="aspect-[9/16] w-full overflow-hidden bg-zinc-100">
                  <img
                    src={shotUrl}
                    alt={`${activeApp.name} screenshot ${slotIdx + 1}`}
                    referrerPolicy="no-referrer"
                    onError={() => markBroken(key)}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between border-t border-zinc-100 text-xs text-zinc-600">
                  <span>
                    {strings.screenshotLabel} 0{slotIdx + 1}
                  </span>
                  <span className="font-mono text-zinc-400">9:16</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Demo / Promo Video Section */}
      <section id="video" className="scroll-mt-24 pt-2">
        <div className="mb-7">
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-950">
            {strings.videoTitle}
          </h2>
          <p className="text-sm text-zinc-600 mt-1">{strings.videoSubtitle}</p>
        </div>

        <div className="rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-950">
          {activeApp.videoUrl ? (
            <div className="aspect-video w-full bg-black flex items-center justify-center">
              {isEmbeddableVideoUrl(activeApp.videoUrl) ? (
                <iframe
                  key={activeApp.videoUrl}
                  src={activeApp.videoUrl}
                  title={`${activeApp.name} demo video`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
              ) : (
                <video
                  key={activeApp.videoUrl}
                  src={activeApp.videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full h-full max-h-[600px] object-contain"
                />
              )}
            </div>
          ) : (
            <div className="aspect-video w-full max-h-[460px] bg-zinc-900 flex flex-col items-center justify-center px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-4">
                <Film className="w-6 h-6 text-zinc-300" />
              </div>
              <p className="font-display text-lg font-semibold text-white">
                {strings.noVideoTitle}
              </p>
              <p className="text-sm text-zinc-400 mt-1.5 max-w-md">{strings.noVideoDesc}</p>
            </div>
          )}
        </div>
      </section>

      {/* About, Release Notes, Verification & Install Guide */}
      <section id="details" className="scroll-mt-24 pt-2">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12">
          {/* Left: Description, Changelog & Package Verification */}
          <div className="lg:col-span-7 space-y-10">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-950">
                {strings.aboutTitle}
              </h2>
              <p className="mt-4 text-[15px] sm:text-base text-zinc-700 leading-[1.7] whitespace-pre-line">
                {activeApp.description || activeApp.tagline}
              </p>
            </div>

            {activeApp.whatsNew && (
              <div className="pt-8 border-t border-zinc-200">
                <h3 className="font-display text-lg font-semibold text-zinc-950">
                  {strings.whatsNewTitle}
                </h3>
                <div className="mt-3 text-sm sm:text-[15px] text-zinc-700 leading-relaxed whitespace-pre-line">
                  {activeApp.whatsNew}
                </div>
              </div>
            )}

            <div className="pt-8 border-t border-zinc-200">
              <h3 className="font-display text-lg font-semibold text-zinc-950 mb-4">
                {strings.packageInfoTitle}
              </h3>
              <dl className="divide-y divide-zinc-200 border-y border-zinc-200 text-sm">
                <div className="py-3 flex items-center justify-between gap-4">
                  <dt className="text-zinc-500">{strings.packageIdLabel}</dt>
                  <dd className="font-mono text-zinc-900 truncate">{activeApp.packageId}</dd>
                </div>
                <div className="py-3 flex items-center justify-between gap-4">
                  <dt className="text-zinc-500">{strings.developerLabel}</dt>
                  <dd className="font-medium text-zinc-900">{activeApp.developer}</dd>
                </div>
                <div className="py-3 flex items-center justify-between gap-4">
                  <dt className="text-zinc-500">{strings.categoryLabel}</dt>
                  <dd className="font-medium text-zinc-900">{activeApp.category}</dd>
                </div>
                <div className="py-3 flex items-center justify-between gap-4">
                  <dt className="text-zinc-500">Storage Host</dt>
                  <dd className="font-medium text-zinc-900">
                    {detectStorageHostLabel(activeApp.apkUrl, activeApp.storageProvider)}
                  </dd>
                </div>
                <div className="py-3 flex items-center justify-between gap-4">
                  <dt className="text-zinc-500">{strings.updatedLabel}</dt>
                  <dd className="font-mono tabular-nums text-zinc-900">
                    {formatDateShort(activeApp.updatedAt)}
                  </dd>
                </div>
                {activeApp.apkSha256 && (
                  <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <dt className="text-zinc-500 shrink-0">{strings.sha256Label}</dt>
                    <dd className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs text-zinc-700 truncate max-w-[260px]">
                        {activeApp.apkSha256}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopySha(activeApp.apkSha256)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-950 border border-zinc-200 rounded bg-white shrink-0 cursor-pointer"
                      >
                        {copiedHash ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{strings.copied}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{strings.copyHash}</span>
                          </>
                        )}
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* Right: Android APK Installation Steps */}
          <aside className="lg:col-span-5">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8">
              <h3 className="font-display text-lg font-semibold text-zinc-950">
                {strings.howToInstallTitle}
              </h3>

              <ol className="mt-6 space-y-6">
                <li>
                  <p className="text-sm font-semibold text-zinc-950">{strings.step1Title}</p>
                  <p className="mt-1.5 text-sm text-zinc-600 leading-relaxed">
                    {strings.step1Desc}
                  </p>
                </li>
                <li className="pt-5 border-t border-zinc-100">
                  <p className="text-sm font-semibold text-zinc-950">{strings.step2Title}</p>
                  <p className="mt-1.5 text-sm text-zinc-600 leading-relaxed">
                    {strings.step2Desc}
                  </p>
                </li>
                <li className="pt-5 border-t border-zinc-100">
                  <p className="text-sm font-semibold text-zinc-950">{strings.step3Title}</p>
                  <p className="mt-1.5 text-sm text-zinc-600 leading-relaxed">
                    {strings.step3Desc}
                  </p>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => handleDownload(activeApp)}
                className="mt-8 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{strings.downloadApk}</span>
              </button>
            </div>
          </aside>
        </div>
      </section>

      {/* Fullscreen Lightbox for Screenshots */}
      {lightboxIndex !== null && validScreenshots[lightboxIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            aria-label="Close"
            className="absolute top-4 right-4 p-2.5 rounded-lg bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {validScreenshots.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(
                  (lightboxIndex - 1 + validScreenshots.length) % validScreenshots.length
                );
              }}
              aria-label="Previous screenshot"
              className="absolute left-3 sm:left-6 p-3 rounded-lg bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white cursor-pointer"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          <div
            className="max-h-[86vh] max-w-[90vw] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={validScreenshots[lightboxIndex].url}
              alt={`${activeApp.name} screenshot ${validScreenshots[lightboxIndex].idx + 1}`}
              referrerPolicy="no-referrer"
              className="max-h-[80vh] w-auto rounded-2xl object-contain border border-zinc-800"
            />
            <p className="mt-3 text-xs font-mono text-zinc-400 tabular-nums">
              {strings.screenshotLabel} 0{validScreenshots[lightboxIndex].idx + 1} / 04
            </p>
          </div>

          {validScreenshots.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((lightboxIndex + 1) % validScreenshots.length);
              }}
              aria-label="Next screenshot"
              className="absolute right-3 sm:right-6 p-3 rounded-lg bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white cursor-pointer"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      )}
    </main>
  );
}
