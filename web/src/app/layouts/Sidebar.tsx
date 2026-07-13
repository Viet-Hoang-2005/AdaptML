import { Bell, BrainCircuit, Boxes, ChartNoAxesCombined, ChevronsLeft, ChevronsRight, Home, LogOut, Rocket, Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { routes } from '@/app/router/paths';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { cn } from '@/shared/lib/cn';

interface DashboardSidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onCloseMobile: () => void;
}

const lifecycleItems = [
  { key: 'overview', label: 'Overview', to: routes.overview, icon: Home, match: '/dashboard/home' },
  { key: 'buildDeploy', label: 'Build & Deploy', to: routes.buildDeploy, icon: Rocket, match: routes.buildDeploy },
  { key: 'training', label: 'Training', to: routes.training, icon: BrainCircuit, match: routes.training },
  { key: 'registry', label: 'Registry', to: routes.registry, icon: Boxes, match: routes.registry },
  { key: 'monitoring', label: 'Monitoring', to: routes.monitoring, icon: ChartNoAxesCombined, match: routes.monitoring },
] as const;

const utilityItems = [
  { key: 'notifications', label: 'Notifications', to: routes.notifications, icon: Bell, match: routes.notifications },
  { key: 'settings', label: 'Settings', to: routes.profile, icon: Settings, match: '/dashboard/settings' },
] as const;

export default function Sidebar({ collapsed, mobileOpen, onToggle, onCloseMobile }: DashboardSidebarProps) {
  const location = useLocation();
  const { logout } = useAuth();
  const { t } = useTranslation();

  const itemClass = (match: string) => cn(
    'group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
    location.pathname.startsWith(match)
      ? 'bg-primary text-primary-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    collapsed && 'xl:justify-center xl:px-0',
  );

  const renderItem = (item: (typeof lifecycleItems)[number] | (typeof utilityItems)[number]) => {
    const Icon = item.icon;
    return (
      <NavLink key={item.key} to={item.to} onClick={onCloseMobile} className={itemClass(item.match)} title={collapsed ? item.label : undefined}>
        <Icon className="h-5 w-5 shrink-0" />
        <span className={cn('truncate', collapsed && 'xl:hidden')}>{t(`navigation.${item.key}`, item.label)}</span>
      </NavLink>
    );
  };

  return (
    <>
      {mobileOpen && <button type="button" className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm md:hidden" onClick={onCloseMobile} aria-label="Close navigation overlay" />}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-200 md:static md:z-20 md:w-18 md:translate-x-0 xl:w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        collapsed && 'xl:w-18',
      )}>
        <div className="flex h-16 items-center justify-between border-b border-border px-3 md:hidden">
          <span className="text-sm font-semibold text-foreground">Lifecycle navigation</span>
          <button type="button" onClick={onCloseMobile} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close navigation"><X className="h-5 w-5" /></button>
        </div>

        <div className="hidden h-12 items-center border-b border-border px-3 md:flex md:justify-center xl:justify-between">
          <span className={cn('text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden xl:block', collapsed && 'xl:hidden')}>Model lifecycle</span>
          <button type="button" onClick={onToggle} className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground xl:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto p-3" aria-label="Primary navigation">
          <div className="space-y-1.5">{lifecycleItems.map(renderItem)}</div>
          <div className="space-y-1.5 border-t border-border pt-3">
            {utilityItems.map(renderItem)}
            <button type="button" onClick={logout} className={cn('flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-danger-subtle hover:text-danger', collapsed && 'xl:justify-center xl:px-0')} title={collapsed ? 'Sign out' : undefined}>
              <LogOut className="h-5 w-5 shrink-0" />
              <span className={cn(collapsed && 'xl:hidden')}>Sign out</span>
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}
