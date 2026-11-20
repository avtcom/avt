import { User, Shield } from 'lucide-react';
import type { AuthUser, Language, PageView } from '../types';
import { t } from '../i18n';

interface HeaderProps {
  lang: Language;
  view: PageView;
  user: AuthUser | null;
  onNavigate: (view: PageView, sectionId?: string) => void;
}

export function Header({ lang, view, user, onNavigate }: HeaderProps) {
  const strings = t(lang);

  const handlePrimaryAction = () => {
    if (user?.role === 'admin') {
      onNavigate('admin');
    } else {
      onNavigate('account');
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-zinc-200">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single clean text wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('store')}
          className="font-display text-lg font-bold tracking-tight text-zinc-950 hover:text-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 rounded"
        >
          {strings.brand}
        </button>

        {/* Zone 2: 4 concise single-line text nav links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600">
          <button
            type="button"
            onClick={() => onNavigate('store', 'top')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              view === 'store'
                ? 'text-zinc-950 border-emerald-600'
                : 'border-transparent hover:text-zinc-950 hover:border-zinc-300'
            }`}
          >
            {strings.navHome}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('store', 'screenshots')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-zinc-950 hover:border-zinc-300 transition-colors cursor-pointer"
          >
            {strings.navScreenshots}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('store', 'video')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-zinc-950 hover:border-zinc-300 transition-colors cursor-pointer"
          >
            {strings.navVideo}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('store', 'details')}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-zinc-950 hover:border-zinc-300 transition-colors cursor-pointer"
          >
            {strings.navDetails}
          </button>
        </nav>

        {/* Zone 3: 1 primary action button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handlePrimaryAction}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-950 text-white hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            {user?.role === 'admin' ? (
              <>
                <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{strings.navAdmin}</span>
              </>
            ) : (
              <>
                <User className="w-4 h-4 shrink-0" />
                <span className="max-w-[140px] truncate">
                  {user ? user.name : strings.navAccount}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
