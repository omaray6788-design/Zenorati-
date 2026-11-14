import React from 'react';
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Users,
  Boxes,
  Wallet,
  Megaphone,
  Lightbulb,
  Bot,
  FileBarChart2,
  Workflow,
  Store,
  User,
  Ticket,
  Settings,
  X,
} from 'lucide-react';
import type { NavSection } from '../types/zenorati';
import { useI18n } from '../i18n/I18nContext';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  businessName: string;
  isCloudMode: boolean;
  lowStockCount: number;
  isAdmin?: boolean;
}

export const SIDEBAR_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'Core' | 'Growth' | 'Platform';
  adminOnly?: boolean;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Core' },
  { id: 'products', label: 'Products', icon: Package, group: 'Core' },
  { id: 'orders', label: 'Orders', icon: ShoppingBag, group: 'Core' },
  { id: 'customers', label: 'Customers', icon: Users, group: 'Core' },
  { id: 'inventory', label: 'Inventory', icon: Boxes, group: 'Core' },
  { id: 'finance', label: 'Finance & Profit', icon: Wallet, group: 'Core' },
  { id: 'marketing', label: 'Marketing', icon: Megaphone, group: 'Growth' },
  { id: 'research', label: 'Product Research', icon: Lightbulb, group: 'Growth' },
  { id: 'assistant', label: 'AI Assistant', icon: Bot, group: 'Growth' },
  { id: 'reports', label: 'Reports', icon: FileBarChart2, group: 'Growth' },
  { id: 'automations', label: 'Automations', icon: Workflow, group: 'Platform' },
  { id: 'integrations', label: 'Store Integrations', icon: Store, group: 'Platform' },
  { id: 'profile', label: 'Profile', icon: User, group: 'Platform' },
  { id: 'invitations', label: 'Invitations', icon: Ticket, group: 'Platform', adminOnly: true },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'Platform' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  mobileOpen,
  onCloseMobile,
  businessName,
  isCloudMode,
  lowStockCount,
  isAdmin = false,
}) => {
  const { t, tNav } = useI18n();
  const visibleItems = SIDEBAR_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const renderNavContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectSection('dashboard');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-start cursor-pointer"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-sm shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6H20L8 18H20"
                stroke="white"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            {t('brandName')}
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label={t('closeNavAria')}
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Primary Sidebar Navigation">
        {visibleItems.map((item, idx) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          const prevGroup = idx > 0 ? visibleItems[idx - 1].group : null;
          const showDivider = prevGroup !== null && prevGroup !== item.group;

          return (
            <React.Fragment key={item.id}>
              {showDivider && (
                <div className="my-2.5 border-t border-slate-200/80 dark:border-slate-800/80" />
              )}
              <button
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600/15 via-indigo-600/10 to-cyan-500/10 text-blue-600 dark:text-cyan-300 border border-blue-500/25'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-blue-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <span className="truncate">{tNav(item.id)}</span>
                </span>
                {item.id === 'inventory' && lowStockCount > 0 && (
                  <span className="font-mono tabular-nums text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    {lowStockCount}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Active Workspace Footer */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 shrink-0">
        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
          {businessName}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
          {isCloudMode ? t('cloudTenantLabel') : t('localWorkspaceLabel')}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-e border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#070D1D]">
        {renderNavContent()}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full bg-white dark:bg-[#070D1D] border-e border-slate-200 dark:border-slate-800 shadow-2xl">
            {renderNavContent()}
          </aside>
        </div>
      )}
    </>
  );
};
