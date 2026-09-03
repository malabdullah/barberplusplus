import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Layout from './components/Layout/Layout';
import BarberLayout from './components/Layout/BarberLayout';
import AdminLayout from './components/Layout/AdminLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AcceptInvite from './pages/AcceptInvite';
import MFASetup from './pages/MFASetup';
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
import Notifications from './pages/Notifications';
import MyLogs from './pages/barber/MyLogs';
// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import UserManagement from './pages/admin/UserManagement';
import ManagersList from './pages/admin/ManagersList';
import BarbersList from './pages/admin/BarbersList';
import PlatformAnalytics from './pages/admin/PlatformAnalytics';
import SystemConfiguration from './pages/admin/SystemConfiguration';
import LocationsConfig from './pages/admin/LocationsConfig';
import NotificationTemplates from './pages/admin/NotificationTemplates';
import GlobalSettings from './pages/admin/GlobalSettings';
import AuditCompliance from './pages/admin/AuditCompliance';
import ActivityLogs from './pages/admin/ActivityLogs';
import SecurityEvents from './pages/admin/SecurityEvents';
import WhatsAppManagement from './pages/admin/WhatsAppManagement';
import WhatsAppConversations from './pages/admin/WhatsAppConversations';
import WhatsAppMessages from './pages/admin/WhatsAppMessages';
import WhatsAppLogs from './pages/admin/WhatsAppLogs';
// Agent Pages
import AgentLayout from './components/Layout/AgentLayout';
import AgentDashboard from './pages/agent/AgentDashboard';
import AgentBookings from './pages/agent/AgentBookings';
import AgentNewBooking from './pages/agent/AgentNewBooking';
import AgentEditBooking from './pages/agent/AgentEditBooking';
import AgentCustomers from './pages/agent/AgentCustomers';
import AgentConversations from './pages/agent/AgentConversations';
import EnvironmentBanner from './components/EnvironmentBanner';

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

  // Missing or mismatched trusted roles must never enter a protected route.
  if (allowedRole && userRole !== allowedRole) {
    // Redirect to role-appropriate dashboard
    const defaultRoutes = {
      admin: '/admin',
      manager: '/dashboard',
      barber: '/barber',
      agent: '/agent'
    };
    return <Navigate to={defaultRoutes[userRole] || '/login'} replace />;
  }

  return children;
}

function AppRoutes() {
  const { isAuthenticated, userRole, loading } = useApp();

  const getDefaultRoute = () => {
    if (!isAuthenticated) return '/';
    const routes = {
      admin: '/admin',
      manager: '/dashboard',
      barber: '/barber',
      agent: '/agent'
    };
    return routes[userRole] || '/dashboard';
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
      {/* Landing Page - Public */}
      <Route
        path="/"
        element={<Landing />}
      />

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
      <Route
        path="/reset-password"
        element={<ResetPassword />}
      />
      <Route
        path="/mfa-setup"
        element={<MFASetup />}
      />

      {/* Manager Routes */}
      <Route
        path="/dashboard"
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
        <Route path="notifications" element={<Notifications />} />
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
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Admin Routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRole="admin">
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="users/managers" element={<ManagersList />} />
        <Route path="users/barbers" element={<BarbersList />} />
        <Route path="analytics" element={<PlatformAnalytics />} />
        <Route path="configuration" element={<SystemConfiguration />} />
        <Route path="configuration/locations" element={<LocationsConfig />} />
        <Route path="configuration/templates" element={<NotificationTemplates />} />
        <Route path="configuration/settings" element={<GlobalSettings />} />
        <Route path="audit" element={<AuditCompliance />} />
        <Route path="audit/activity" element={<ActivityLogs />} />
        <Route path="audit/security" element={<SecurityEvents />} />
        <Route path="whatsapp" element={<WhatsAppManagement />} />
        <Route path="whatsapp/conversations" element={<WhatsAppConversations />} />
        <Route path="whatsapp/messages" element={<WhatsAppMessages />} />
        <Route path="whatsapp/logs" element={<WhatsAppLogs />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Agent Routes */}
      <Route
        path="/agent"
        element={
          <ProtectedRoute allowedRole="agent">
            <AgentLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<AgentDashboard />} />
        <Route path="bookings" element={<AgentBookings />} />
        <Route path="bookings/new" element={<AgentNewBooking />} />
        <Route path="bookings/:id/edit" element={<AgentEditBooking />} />
        <Route path="customers" element={<AgentCustomers />} />
        <Route path="conversations" element={<AgentConversations />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <EnvironmentBanner />
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </>
  );
}
