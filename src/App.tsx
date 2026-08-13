/** Routing, route guards and lazy-loaded pages. */

import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PageLoader } from './components/ui';
import { AppLayout } from './components/layout';
import { useReminders } from './components/notifications';
import { useSession } from './lib/hooks';
import Landing from './pages/Landing';

// Everything except the landing page is lazy-loaded to keep the first paint small.
const Calculator = lazy(() => import('./pages/Calculator'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Recover = lazy(() => import('./pages/Recover'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Planner = lazy(() => import('./pages/Planner'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseDetail = lazy(() => import('./pages/CourseDetail'));
const AcademicRecord = lazy(() => import('./pages/AcademicRecord'));
const Performance = lazy(() => import('./pages/Performance'));
const Goals = lazy(() => import('./pages/Goals'));
const Profile = lazy(() => import('./pages/Profile'));
const SharedSnapshot = lazy(() => import('./pages/SharedSnapshot'));
const Admin = lazy(() => import('./pages/Admin'));
const NotFound = lazy(() => import('./pages/NotFound'));

/** Requires a signed-in, non-suspended account. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, onboarded } = useSession();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.status !== 'ACTIVE') return <Navigate to="/login" replace />;
  if (!onboarded && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

/** Owner-only. The API repeats this check on every admin request. */
function RequireOwner({ children }: { children: ReactNode }) {
  const { user, isOwner } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold">403 — Unauthorized</h1>
        <p className="mt-2 text-sm text-muted">
          The AcadMap admin dashboard is restricted to the product owner.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return user ? <Navigate to="/app" replace /> : <>{children}</>;
}

export default function App() {
  useReminders();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/share/:token" element={<SharedSnapshot />} />

        <Route
          path="/login"
          element={
            <GuestOnly>
              <Login />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <Register />
            </GuestOnly>
          }
        />
        <Route
          path="/recover"
          element={
            <GuestOnly>
              <Recover />
            </GuestOnly>
          }
        />

        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <Onboarding />
            </RequireAuth>
          }
        />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="planner" element={<Planner />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/:courseId" element={<CourseDetail />} />
          <Route path="record" element={<AcademicRecord />} />
          <Route path="performance" element={<Performance />} />
          <Route path="goals" element={<Goals />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireOwner>
              <Admin />
            </RequireOwner>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
