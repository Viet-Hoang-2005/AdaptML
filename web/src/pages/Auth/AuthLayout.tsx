import { Outlet } from 'react-router-dom';
import { Background } from '../../components/layout/Background';

export default function AuthLayout() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      <Background />
      <Outlet />
    </div>
  );
}
