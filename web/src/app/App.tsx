import { AppRouter } from '@/app/router/AppRouter';
import { ToastContainer } from '@/shared/ui/Toast';

export default function App() {
  return (
    <>
      <ToastContainer />
      <AppRouter />
    </>
  );
}
