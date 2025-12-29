import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Layout from './components/Layout/Layout';
import BarberLayout from './components/Layout/BarberLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import AcceptInvite from './pages/AcceptInvite';
import Dashboard from './pages/Dashboard';
import Branches from './pages/Branches';
import AddBranch from './pages/AddBranch';
import EditBranch from './pages/EditBranch';
import BranchDetails from './pages/BranchDetails';
import Services from './pages/Services';
import Barbers from './pages/Barbers';
import AddBarber from './pages/AddBarber';
import EditBarber from './pages/EditBarber';
import Bookings from './pages/Bookings';
import Settings from './pages/Settings';
import BarberDashboard from './pages/barber/BarberDashboard';
import MyBookings from './pages/barber/MyBookings';
import MyAvailability from './pages/barber/MyAvailability';
import MyProfile from './pages/barber/MyProfile';
import Logs from './pages/Logs';
import MyLogs from './pages/barber/MyLogs';

function ProtectedRoute({ children, allowedRole }) {
  const { isAuthenticated, userRole, loading } = useApp();

  // Show loading while auth state is being determined
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0D0B09)',
        color: 'var(--text-primary, #fff)'
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Only check role if userRole is set (not null)
  if (allowedRole && userRole && userRole !== allowedRole) {
    return <Navigate to={userRole === 'barber' ? '/barber' : '/'} replace />;
  }

  return children;
}

function AppRoutes() {
  const { isAuthenticated, userRole, loading } = useApp();

  const getDefaultRoute = () => {
    if (!isAuthenticated) return '/login';
    return userRole === 'barber' ? '/barber' : '/';
  };

  // Show loading while auth state is being determined
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0D0B09)',
        color: 'var(--text-primary, #fff)'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={getDefaultRoute()} replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={isAuthenticated ? <Navigate to={getDefaultRoute()} replace /> : <Signup />}
      />
      <Route
        path="/forgot-password"
        element={isAuthenticated ? <Navigate to={getDefaultRoute()} replace /> : <ForgotPassword />}
      />
      <Route
        path="/accept-invite"
        element={<AcceptInvite />}
      />

      {/* Manager Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute allowedRole="manager">
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="branches" element={<Branches />} />
        <Route path="branches/new" element={<AddBranch />} />
        <Route path="branches/:branchId/edit" element={<EditBranch />} />
        <Route path="branches/:branchId" element={<BranchDetails />} />
        <Route path="services" element={<Services />} />
        <Route path="barbers" element={<Barbers />} />
        <Route path="barbers/new" element={<AddBarber />} />
        <Route path="barbers/:barberId/edit" element={<EditBarber />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Barber Routes */}
      <Route
        path="/barber"
        element={
          <ProtectedRoute allowedRole="barber">
            <BarberLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<BarberDashboard />} />
        <Route path="bookings" element={<MyBookings />} />
        <Route path="availability" element={<MyAvailability />} />
        <Route path="profile" element={<MyProfile />} />
        <Route path="logs" element={<MyLogs />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  );
}
