import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Bell, Check, ChevronDown, Laptop, LogOut, Menu, Moon, Plus, Search, Settings, Sun, UserCircle, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import MLdriftLogo from '@/assets/icons/MLdrift.png';
import type { ThemeMode } from '@/app/theme/theme';
import { routes } from '@/app/router/paths';
import { useTheme } from '@/app/theme/useTheme';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import { getProfile } from '@/features/settings/api/profileApi';
import { settingsQueryKeys } from '@/features/settings/queryKeys';
import type { UserProfile } from '@/features/settings/types';
import { IconButton } from '@/shared/ui/IconButton';

const getInitials = (profile: UserProfile | null) => {
  const source = profile?.full_name || profile?.email || 'User';
  return source.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
};

const themeOptions: Array<{ value: ThemeMode; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Laptop },
];

export default function Header({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { logout } = useAuth();
  const { models, selectedModel, selectModel } = useModelSelection();
  const { mode, resolvedTheme, setMode } = useTheme();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: profile = null } = useQuery({ queryKey: settingsQueryKeys.profile(), queryFn: getProfile });
  const initials = useMemo(() => getInitials(profile), [profile]);
  const visibleModels = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? models.filter((model) => model.name.toLowerCase().includes(term)) : models;
  }, [models, search]);

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-3 md:px-4 xl:px-5">
      <button type="button" onClick={onOpenNavigation} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground md:hidden" aria-label={t('actions.openNavigation')}>
        <Menu className="h-5 w-5" />
      </button>

      <button type="button" onClick={() => navigate('/dashboard/home/models')} className="hidden min-w-40 shrink-0 items-center gap-3 rounded-[8px] focus-visible:ring-2 focus-visible:ring-ring sm:flex xl:min-w-48">
        <img src={MLdriftLogo} alt="" className="h-7 w-7" />
        <span className="text-lg font-semibold text-foreground">ML<span className="italic">drift</span></span>
      </button>

      <div className="mx-3 min-w-0 flex-1 sm:max-w-md lg:absolute lg:left-1/2 lg:top-1/2 lg:w-[min(420px,42vw)] lg:-translate-x-1/2 lg:-translate-y-1/2">
        <Popover.Root open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="flex h-10 w-full items-center justify-between gap-3 rounded-[8px] border border-border bg-surface px-4 text-left text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-input focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('modelSelector.label')}>
              <span className="truncate">{selectedModel?.name || t('modelSelector.empty')}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="center" sideOffset={8} className="z-50 w-[min(92vw,26.25rem)] rounded-[8px] border border-border bg-surface p-2 shadow-[var(--shadow-overlay)] animate-fade-in">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('modelSelector.search')} className="h-10 w-full rounded-[8px] border border-input bg-surface pl-9 pr-9 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/15" autoFocus />
                {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-muted" aria-label={t('modelSelector.clearSearch')}><X className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {visibleModels.length ? visibleModels.map((model) => (
                  <button key={model.id} type="button" onClick={() => { selectModel(model.id); setModelMenuOpen(false); setSearch(''); }} className="flex min-h-10 w-full items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-left hover:bg-muted">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-foreground">{model.name}</span><span className="block truncate text-xs capitalize text-muted-foreground">{model.status || t('statuses.registered')} · {model.flavor || t('statuses.registered')}</span></span>
                    {selectedModel?.id === model.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                )) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('modelSelector.noMatches')}</p>}
              </div>
              <div className="mt-2 border-t border-border pt-2">
                <button type="button" onClick={() => { setModelMenuOpen(false); navigate(routes.uploadModel); }} className="flex h-10 w-full items-center gap-2 rounded-[6px] px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Plus className="h-4 w-4" /> {t('actions.uploadModel')}
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 sm:min-w-40 xl:min-w-48">
        <IconButton label={t('actions.createModel')} icon={<Plus className="h-5 w-5" />} variant="secondary" onClick={() => navigate(routes.uploadModel)} className="hidden sm:inline-flex" />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border bg-surface text-muted-foreground hover:text-foreground" aria-label={t('theme.current', { mode })} title={t('theme.current', { mode })}>
              {resolvedTheme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-44 rounded-[8px] border border-border bg-surface p-1.5 shadow-[var(--shadow-overlay)] animate-fade-in">
              <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('theme.appearance')}</DropdownMenu.Label>
              {themeOptions.map((option) => {
                const Icon = option.icon;
                return <DropdownMenu.Item key={option.value} onSelect={() => setMode(option.value)} className="flex h-9 items-center gap-2 rounded-[6px] px-2 text-sm text-foreground outline-none hover:bg-muted focus:bg-muted"><Icon className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{t(`theme.${option.value}`)}</span>{mode === option.value && <Check className="h-4 w-4 text-primary" />}</DropdownMenu.Item>;
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <IconButton label={t('navigation.notification')} icon={<Bell className="h-5 w-5" />} variant="secondary" onClick={() => navigate('/dashboard/notifications')} />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="ml-2 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={t('userMenu.open')}>
              {profile?.avatar ? <img src={profile.avatar} alt="" className="h-full w-full object-cover" /> : initials || <UserCircle className="h-5 w-5" />}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-[8px] border border-border bg-surface p-2 shadow-[var(--shadow-overlay)] animate-fade-in">
              <DropdownMenu.Label className="border-b border-border px-3 py-2"><p className="truncate text-sm font-semibold text-foreground">{profile?.full_name || t('profile.fallbackName')}</p><p className="truncate text-xs text-muted-foreground">{profile?.email || t('profile.signedIn')}</p></DropdownMenu.Label>
              <DropdownMenu.Item onSelect={() => navigate('/dashboard/settings/profile')} className="mt-2 flex h-10 items-center gap-2 rounded-[6px] px-2 text-sm text-foreground outline-none hover:bg-muted focus:bg-muted"><Settings className="h-4 w-4 text-muted-foreground" /> {t('navigation.setting')}</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={logout} className="flex h-10 items-center gap-2 rounded-[6px] px-2 text-sm text-danger outline-none hover:bg-danger-subtle focus:bg-danger-subtle"><LogOut className="h-4 w-4" /> {t('actions.logout')}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
