import { NavLink, Outlet } from 'react-router-dom';

const homeTabs = [
  { label: 'Model API', to: '/dashboard/home/model-api' },
  { label: 'Model Benchmark', to: '/dashboard/home/benchmark' },
  { label: 'Model Management', to: '/dashboard/home/model-management' },
];

export default function HomeLayout() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Home</h1>
          <p className="mt-1 text-sm text-gray-500">
            Deploy model APIs, benchmark requests, and manage connected models.
          </p>
        </div>

        <div className="inline-flex overflow-hidden rounded-xl border border-gray-300 bg-white">
          {homeTabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `px-3 py-2 text-sm font-semibold transition-colors ${
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
