import { LayoutDashboard, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import MLdriftLogo from '../../assets/icons/MLdrift.png';

export default function DashboardPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={MLdriftLogo} alt="MLdrift" className="w-8 h-8" />
            <span className="text-xl font-bold text-gray-800">MLdrift</span>
          </div>
          <Button
            variant="ghost"
            size="md"
            icon={<LogOut className="w-4 h-4" />}
            onClick={logout}
            className="text-gray-500 hover:text-gray-700"
          >
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content - Placeholder */}
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 mb-6 rounded-2xl bg-blue-50 flex items-center justify-center">
            <LayoutDashboard className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-3">
            Welcome to MLdrift Dashboard
          </h1>
          <p className="text-gray-500 text-lg max-w-md">
            Your ML model management console is being built.
            Deploy, monitor, and scale your models from here.
          </p>
        </div>
      </main>
    </div>
  );
}
