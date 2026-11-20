import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, ArrowLeft, LogOut, Download, Calendar, Mail } from 'lucide-react';
import type { AuthUser, Language } from '../types';
import { t } from '../i18n';
import { formatDateShort, loginAuth, logoutAuth, registerOrAuth } from '../lib/api';

interface AuthViewProps {
  lang: Language;
  user: AuthUser | null;
  onAuthSuccess: (user: AuthUser) => void;
  onLogout: () => void;
  onBackToStore: () => void;
}

export function AuthView({
  lang,
  user,
  onAuthSuccess,
  onLogout,
  onBackToStore,
}: AuthViewProps) {
  const strings = t(lang);
  // Defaults to "Create Account" so at first glance it looks like a normal account registration screen
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError(
        lang === 'si'
          ? 'කරුණාකර Gmail ලිපිනය සහ මුරපදය ඇතුළත් කරන්න.'
          : 'Please enter your email address and password.'
      );
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === 'register'
          ? await registerOrAuth({ name: name.trim(), email: trimmedEmail, password })
          : await loginAuth({ email: trimmedEmail, password });
      onAuthSuccess(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logoutAuth();
    onLogout();
  };

  // Logged-in normal member profile screen
  if (user && user.role === 'user') {
    return (
      <main className="max-w-[960px] mx-auto px-4 sm:px-6 py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBackToStore}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{strings.backToStore}</span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:text-zinc-950 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>{strings.signOut}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <section className="lg:col-span-5 bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8">
            <div className="w-14 h-14 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-display text-xl font-bold mb-5">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <h1 className="font-display text-2xl font-bold text-zinc-950 tracking-tight">
              {user.name}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">{strings.memberTitle}</p>

            <div className="mt-6 pt-6 border-t border-zinc-100 space-y-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500 inline-flex items-center gap-2">
                  <Mail className="w-4 h-4 text-zinc-400" />
                  <span>{strings.colEmail}</span>
                </span>
                <span className="font-medium text-zinc-900 truncate">{user.email}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500 inline-flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-zinc-400" />
                  <span>{strings.memberSince}</span>
                </span>
                <span className="font-mono tabular-nums text-zinc-900">
                  {formatDateShort(user.createdAt)}
                </span>
              </div>
            </div>
          </section>

          <section className="lg:col-span-7 bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-zinc-950">
              {strings.recentDownloads}
            </h2>

            {user.downloadHistory.length === 0 ? (
              <div className="mt-6 py-12 text-center border border-dashed border-zinc-200 rounded-xl px-4">
                <Download className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
                <p className="text-sm text-zinc-500">{strings.noDownloadsYet}</p>
                <button
                  type="button"
                  onClick={onBackToStore}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer"
                >
                  {strings.backToStore}
                </button>
              </div>
            ) : (
              <div className="mt-5 divide-y divide-zinc-100">
                {user.downloadHistory.map((item, idx) => (
                  <div
                    key={`${item.appId}-${idx}`}
                    className="py-3.5 flex items-center justify-between gap-4 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-950 truncate">{item.appName}</p>
                      <p className="text-xs text-zinc-500 font-mono tabular-nums mt-0.5">
                        v{item.version}
                      </p>
                    </div>
                    <span className="text-xs text-zinc-500 font-mono tabular-nums shrink-0">
                      {formatDateShort(item.downloadedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  // Normal-looking Create Account / Sign In screen (disguised gateway)
  return (
    <main className="max-w-[1120px] mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <div className="mb-8">
        <button
          type="button"
          onClick={onBackToStore}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{strings.backToStore}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
        {/* Left editorial welcome column */}
        <div className="lg:col-span-6 lg:pt-6">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950 [text-wrap:balance]">
            {mode === 'register' ? strings.accountPageTitle : strings.accountLoginTitle}
          </h1>
          <p className="mt-4 text-base text-zinc-600 leading-relaxed max-w-lg">
            {strings.accountPageSubtitle}
          </p>

          <div className="mt-10 pt-8 border-t border-zinc-200 space-y-5 max-w-md">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                {lang === 'si' ? '01. සෘජු APK බාගත කිරීම්' : '01. Direct APK Access'}
              </h2>
              <p className="text-sm text-zinc-600 mt-1">
                {lang === 'si'
                  ? 'ඔබ බාගත කළ සියලුම Android ඇප් අනුවාද එකම තැනකින් බලාගත හැක.'
                  : 'Keep a personal history of every Android build you download.'}
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                {lang === 'si' ? '02. සරල හා ආරක්ෂිත පිවිසුම' : '02. Fast & Secure Access'}
              </h2>
              <p className="text-sm text-zinc-600 mt-1">
                {lang === 'si'
                  ? 'ඔබගේ Gmail ලිපිනය සහ මුරපදය භාවිතයෙන් තත්පර කිහිපයකින් ගිණුම සාදාගන්න.'
                  : 'Create an account in seconds using your email address and password.'}
              </p>
            </div>
          </div>
        </div>

        {/* Right account registration / login card */}
        <div className="lg:col-span-6">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8 max-w-lg w-full lg:ml-auto">
            {/* Segmented Mode Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-xl mb-7">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className={`py-2.5 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'register'
                    ? 'bg-white text-zinc-950 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {strings.tabRegister}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className={`py-2.5 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white text-zinc-950 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {strings.tabLogin}
              </button>
            </div>

            {/* noValidate + type="text" intentionally allows sasindu#@gmail.com without browser blocking '#' */}
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-name"
                    className="block text-sm font-medium text-zinc-800 mb-1.5"
                  >
                    {strings.fullNameLabel}
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={strings.fullNamePlaceholder}
                    autoComplete="name"
                    className="w-full h-11 px-3.5 rounded-lg border border-zinc-300 bg-white text-zinc-950 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-colors"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-sm font-medium text-zinc-800 mb-1.5"
                >
                  {strings.emailLabel}
                </label>
                <input
                  id="auth-email"
                  type="text"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={strings.emailPlaceholder}
                  className="w-full h-11 px-3.5 rounded-lg border border-zinc-300 bg-white text-zinc-950 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-sm font-medium text-zinc-800 mb-1.5"
                >
                  {strings.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={strings.passwordPlaceholder}
                    className="w-full h-11 pl-3.5 pr-11 rounded-lg border border-zinc-300 bg-white text-zinc-950 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {loading
                  ? strings.submitting
                  : mode === 'register'
                  ? strings.submitRegister
                  : strings.submitLogin}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
