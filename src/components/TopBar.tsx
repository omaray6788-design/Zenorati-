import React from 'react';
import { Globe, LogIn, Menu, Moon, Search, Sun, User as UserIcon } from 'lucide-react';
import type { NavSection } from '../types/zenorati';
import { useI18n } from '../i18n/I18nContext';

interface TopBarProps {
  activeSection: NavSection;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenMobileMenu: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isCloudMode: boolean;
  userEmail: string | null;
  userDisplayName?: string | null;
  onSignInGoogle: () => Promise<void>;
  onNavigateSettings: () => void;
  onNavigateProfile?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  searchQuery,
  onSearchChange,
  onOpenMobileMenu,
  theme,
  onToggleTheme,
  isCloudMode,
  userEmail,
  userDisplayName,
  onSignInGoogle,
  onNavigateSettings,
  onNavigateProfile,
}) => {
  const { language, setLanguage, t, tNav } = useI18n();

  return (
    <header className="h-14 sm:h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#070D1D]/90 backdrop-blur-md flex items-center justify-between gap-4 shrink-0 sticky top-0 z-30">
      {/* Start: Mobile Menu + Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label={t('openNavAria')}
          className="lg:hidden p-2 -ms-1 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2 text-xs sm:text-sm whitespace-nowrap truncate">
          <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">{t('brandName')}</span>
          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
          <span className="font-semibold text-slate-900 dark:text-white truncate">
            {tNav(activeSection)}
          </span>
        </div>
      </div>

      {/* Center: Global Search */}
      <div className="relative flex-1 max-w-md hidden md:block">
        <Search
          className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('searchPlaceholderGlobal')}
          aria-label={t('searchAriaGlobal')}
          className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1328] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </div>

      {/* End: Language Switcher + Theme + Account */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        <button
          type="button"
          onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          aria-label={t('switchLanguageAria')}
          className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
          <span>{language === 'en' ? t('languageAr') : t('languageEn')}</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? t('switchLightAria') : t('switchDarkAria')}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          )}
        </button>

        {isCloudMode ? (
          <button
            type="button"
            onClick={onNavigateProfile ?? onNavigateSettings}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B1328] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-blue-500/40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserIcon className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
            <span className="max-w-[140px] truncate">{userDisplayName || userEmail}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSignInGoogle}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t('signInGoogle')}</span>
            <span className="sm:hidden">{t('signInShort')}</span>
          </button>
        )}
      </div>
    </header>
  );
};
