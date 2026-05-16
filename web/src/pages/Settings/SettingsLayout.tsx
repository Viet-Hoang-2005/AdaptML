import { NavLink, Outlet } from 'react-router-dom';

const settingsTabs = [
  { label: 'Profile', to: '/dashboard/settings/profile' },
  { label: 'Developer', to: '/dashboard/settings/developer' },
];

export default function SettingsLayout() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your account profile, credentials, and developer access.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1.5 gap-1">
          {settingsTabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-black text-white'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      <Outlet />
    </div>
  );
}
