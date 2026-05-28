import { Bell, ChevronDown, Plus, Settings, LogOut, UserCircle, Moon, Sun } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getProfile } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import MLdriftLogo from '../../assets/icons/MLdrift.png';
import type { UserProfile } from '../../types/auth';
import { useModelSelection } from '../../pages/Dashboard/modelSelection';

const getInitials = (profile: UserProfile | null) => {
  const source = profile?.full_name || profile?.email || 'User';
  return source
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
};

export default function Header() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { models, selectedModel, selectModel } = useModelSelection();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [themePreview, setThemePreview] = useState<'light' | 'dark'>('light');

  const { data: profile = null } = useQuery({
    queryKey: queryKeys.profile,
    queryFn: getProfile,
  });
  const initials = useMemo(() => getInitials(profile), [profile]);

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-gray-300 bg-white px-5">
      <div className="flex min-w-48 items-center gap-3">
        <img src={MLdriftLogo} alt="MLdrift" className="h-7 w-7" />
        <span className="text-lg font-semibold text-gray-900">ML
          <span className="italic">drift</span>
        </span>
      </div>

      <div className="absolute left-1/2 top-1/2 w-[min(420px,42vw)] -translate-x-1/2 -translate-y-1/2">
        <button
          type="button"
          onClick={() => setModelMenuOpen((open) => !open)}
          className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm hover:border-gray-300"
        >
          <span className="truncate">{selectedModel ? selectedModel.name : 'No model selected'}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </button>

        {modelMenuOpen && (
          <div className="absolute mt-2 w-full rounded-lg border border-gray-300 bg-white p-2 shadow-lg">
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  selectModel(model.id);
                  setModelMenuOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100"
              >
                <span className="font-semibold text-gray-800">{model.name}</span>
                <span className="text-xs text-gray-400">{model.status}</span>
              </button>
            ))}
            {!models.length && (
              <button
                type="button"
                onClick={() => {
                  setModelMenuOpen(false);
                  navigate('/dashboard/api-management/upload');
                }}
                className="w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-gray-500 hover:bg-gray-100 hover:text-black"
              >
                Upload your first model
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex min-w-48 items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate('/dashboard/api-management/upload')}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:border-gray-300 hover:text-black"
          aria-label="New model"
          title="New model"
        >
          <Plus className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => setThemePreview((current) => (current === 'light' ? 'dark' : 'light'))}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:border-gray-300 hover:text-black"
          aria-label={themePreview === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={themePreview === 'light' ? 'Light mode' : 'Dark mode'}
        >
          {themePreview === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={() => navigate('/dashboard/notifications')}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:border-gray-300 hover:text-black"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="relative pl-4">
          <button
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-black text-sm font-bold text-white"
            aria-label="User menu"
          >
            {profile?.avatar ? <img src={profile.avatar} alt="" className="h-full w-full object-cover" /> : initials}
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-lg border border-gray-300 bg-white p-2 shadow-lg">
              <div className="border-b border-gray-100 px-3 py-2">
                <p className="truncate text-sm font-semibold text-gray-900">{profile?.full_name || 'AI Engineer'}</p>
                <p className="truncate text-xs text-gray-500">{profile?.email || 'Signed in'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/dashboard/settings/profile');
                }}
                className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-black"
              >
                <Settings className="h-4 w-4" />
                Setting
              </button>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
        </div>

        {!profile && <UserCircle className="hidden h-0 w-0" />}
      </div>
    </header>
  );
}
