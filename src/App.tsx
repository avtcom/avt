import { useCallback, useEffect, useState } from 'react';
import type { AppRelease, AuthUser, Language, PageView } from './types';
import { fetchApps, fetchCurrentUser } from './lib/api';
import { isFirebaseAvailable } from './lib/firebase';
import { subscribeCloudApps } from './lib/firestoreStore';
import { t } from './i18n';
import { Header } from './components/Header';
import { Storefront } from './components/Storefront';
import { AuthView } from './components/AuthView';
import { AdminStudio } from './components/AdminStudio';

export default function App() {
  const lang: Language = 'en';
  const [view, setView] = useState<PageView>('store');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cloudApps, setCloudApps] = useState<AppRelease[] | null>(null);
  const [fallbackApps, setFallbackApps] = useState<AppRelease[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [loadingApps, setLoadingApps] = useState(true);

  // Prefer live Cloud Firestore apps whenever at least 1 app is published in the cloud;
  // otherwise gracefully display the built-in showcase / server apps so the store is never blank.
  const apps = cloudApps && cloudApps.length > 0 ? cloudApps : fallbackApps;

  const loadFallbackApps = useCallback(async () => {
    try {
      const list = await fetchApps();
      setFallbackApps(list);
      setSelectedAppId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        const featured = list.find((a) => a.featured) || list[0];
        return featured ? featured.id : null;
      });
    } catch {
      // keep existing state
    } finally {
      setLoadingApps(false);
    }
  }, []);

  useEffect(() => {
    void loadFallbackApps();
    fetchCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {});
  }, [loadFallbackApps]);

  // Real-time Firebase Firestore listener (works across GitHub Pages, AI Studio & all mobile devices)
  useEffect(() => {
    if (!isFirebaseAvailable()) return;
    const unsubscribe = subscribeCloudApps(
      (liveList) => {
        setCloudApps(liveList);
        if (liveList.length > 0) {
          setSelectedAppId((prev) => {
            if (prev && liveList.some((a) => a.id === prev)) return prev;
            const featured = liveList.find((a) => a.featured) || liveList[0];
            return featured ? featured.id : null;
          });
        }
        setLoadingApps(false);
      },
      () => {
        setLoadingApps(false);
      }
    );
    return unsubscribe;
  }, []);

  const handleNavigate = (nextView: PageView, sectionId?: string) => {
    if (nextView === 'admin' && user?.role !== 'admin') {
      setView('account');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setView(nextView);

    if (nextView === 'store' && sectionId) {
      requestAnimationFrame(() => {
        if (sectionId === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          const el = document.getElementById(sectionId);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAuthSuccess = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser);
    if (authenticatedUser.role === 'admin') {
      setView('admin');
    } else {
      setView('account');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = () => {
    setUser(null);
    setView('store');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownloadTriggered = (appItem: AppRelease) => {
    // Optimistically update download counter locally
    if (appItem.source === 'firestore') {
      setCloudApps((prev) =>
        prev
          ? prev.map((a) => (a.id === appItem.id ? { ...a, downloads: a.downloads + 1 } : a))
          : prev
      );
    } else {
      setFallbackApps((prev) =>
        prev.map((a) => (a.id === appItem.id ? { ...a, downloads: a.downloads + 1 } : a))
      );
      setTimeout(() => {
        void loadFallbackApps();
      }, 900);
    }
    if (user?.role === 'user') {
      setTimeout(() => {
        fetchCurrentUser()
          .then((u) => {
            if (u) setUser(u);
          })
          .catch(() => {});
      }, 900);
    }
  };

  const strings = t(lang);

  return (
    <div className="min-h-screen flex flex-col bg-[#fafafa] text-zinc-950">
      <Header lang={lang} view={view} user={user} onNavigate={handleNavigate} />

      <div className="flex-1">
        {view === 'store' && (
          <Storefront
            lang={lang}
            apps={apps}
            loading={loadingApps}
            selectedAppId={selectedAppId}
            onSelectApp={(id) => setSelectedAppId(id)}
            onDownloadTriggered={handleDownloadTriggered}
          />
        )}

        {view === 'account' && (
          <AuthView
            lang={lang}
            user={user}
            onAuthSuccess={handleAuthSuccess}
            onLogout={handleLogout}
            onBackToStore={() => handleNavigate('store', 'top')}
          />
        )}

        {view === 'admin' && user?.role === 'admin' && (
          <AdminStudio
            lang={lang}
            apps={apps}
            onRefreshApps={loadFallbackApps}
            onViewStore={(appId) => {
              if (appId) setSelectedAppId(appId);
              handleNavigate('store', 'top');
            }}
            onLogout={handleLogout}
          />
        )}
      </div>

      {view !== 'admin' && (
        <footer className="border-t border-zinc-200 bg-white mt-20">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-zinc-500">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-display font-semibold text-zinc-900">{strings.brand}</span>
              <span aria-hidden="true">·</span>
              <span>{strings.footerRights}</span>
            </div>

            <p className="text-xs text-zinc-400">
              © {new Date().getFullYear()} {strings.brand}. All rights reserved.
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
