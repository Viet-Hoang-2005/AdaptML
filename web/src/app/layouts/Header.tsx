import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Check,
  ChevronDown,
  Laptop,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  UserCircle,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import MLdriftLogo from '@/assets/icons/MLdrift.png';
import type { ThemeMode } from '@/app/theme/theme';
import { useTheme } from '@/app/theme/useTheme';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import { getProfile } from '@/features/settings/api/profileApi';
import { settingsQueryKeys } from '@/features/settings/queryKeys';
import { IconButton } from '@/shared/ui/IconButton';
import type { UserProfile } from '@/features/settings/types';

const getInitials = (profile: UserProfile | null) => {
  const source = profile?.full_name || profile?.email || 'User';
  return source.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
};

const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
];

export default function Header({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-3 shadow-sm backdrop-blur md:px-4 xl:px-5">
      <button
        type="button"
        onClick={onOpenNavigation}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button type="button" onClick={() => navigate('/dashboard/home/models')} className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-subtle">
          <img src={MLdriftLogo} alt="" className="h-6 w-6" />
        </span>
        <span className="hidden text-lg font-bold tracking-tight text-foreground sm:block">ML<span className="italic text-primary">drift</span></span>
      </button>

      <div className="mx-auto min-w-0 flex-1 sm:max-w-md lg:max-w-xl">
        <Popover.Root open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-left text-sm shadow-sm transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Select model project"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-foreground">{selectedModel?.name || 'Select a model project'}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{selectedModel ? `${selectedModel.status || 'registered'} · ${selectedModel.access_mode}` : 'Choose the active workspace context'}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="center" sideOffset={8} className="z-50 w-[min(92vw,32rem)] rounded-xl border border-border bg-surface p-2 shadow-[var(--shadow-overlay)] animate-fade-in">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search model projects"
                  className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  autoFocus
                />
                {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Clear model search"><X className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {visibleModels.length ? visibleModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => { selectModel(model.id); setModelMenuOpen(false); setSearch(''); }}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted"
                  >
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-foreground">{model.name}</span><span className="block truncate text-xs capitalize text-muted-foreground">{model.status || 'registered'} · {model.flavor || model.model_type}</span></span>
                    {selectedModel?.id === model.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                )) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching model project.</p>}
              </div>
              <div className="mt-2 border-t border-border pt-2">
                <button type="button" onClick={() => { setModelMenuOpen(false); navigate('/dashboard/api-management/upload'); }} className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/10">
                  <Plus className="h-4 w-4" /> {t('actions.createModel')}
                </button>
              </div>
              <Popover.Arrow className="fill-border" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton label="Create model" icon={<Plus className="h-5 w-5" />} variant="secondary" onClick={() => navigate('/dashboard/api-management/upload')} className="hidden sm:inline-flex" />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground" aria-label={`Theme: ${mode}`} title={`Theme: ${mode}`}>
              {resolvedTheme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-overlay)] animate-fade-in">
              <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appearance</DropdownMenu.Label>
              {themeOptions.map((option) => {
                const Icon = option.icon;
                return <DropdownMenu.Item key={option.value} onSelect={() => setMode(option.value)} className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-foreground outline-none hover:bg-muted focus:bg-muted"><Icon className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{option.label}</span>{mode === option.value && <Check className="h-4 w-4 text-primary" />}</DropdownMenu.Item>;
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <IconButton label="Notifications" icon={<Bell className="h-5 w-5" />} variant="secondary" onClick={() => navigate('/dashboard/notifications')} />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="ml-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Open user menu">
              {profile?.avatar ? <img src={profile.avatar} alt="" className="h-full w-full object-cover" /> : initials || <UserCircle className="h-5 w-5" />}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-xl border border-border bg-surface p-2 shadow-[var(--shadow-overlay)] animate-fade-in">
              <DropdownMenu.Label className="px-2 py-2"><p className="truncate text-sm font-semibold text-foreground">{profile?.full_name || 'AI Engineer'}</p><p className="truncate text-xs text-muted-foreground">{profile?.email || 'Signed in'}</p></DropdownMenu.Label>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item onSelect={() => navigate('/dashboard/settings/profile')} className="flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-foreground outline-none hover:bg-muted focus:bg-muted"><Settings className="h-4 w-4 text-muted-foreground" /> Settings</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={logout} className="flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-danger outline-none hover:bg-danger-subtle focus:bg-danger-subtle"><LogOut className="h-4 w-4" /> Sign out</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
