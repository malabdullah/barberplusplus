import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  authService,
  branchesService,
  barbersService,
  servicesService,
  bookingsService,
  storageService,
} from '../services';
import { supabase } from '../lib/supabase';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [branches, setBranches] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [barberProfile, setBarberProfile] = useState(null);
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('barber-theme');
    return saved || 'dark';
  });

  // Apply theme to DOM
  const applyTheme = useCallback((newTheme) => {
    let effectiveTheme = newTheme;
    if (newTheme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme);
  }, []);

  // Set theme with persistence
  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('barber-theme', newTheme);
    applyTheme(newTheme);
  }, [applyTheme]);

  // Apply theme on mount and listen for system theme changes
  useEffect(() => {
    applyTheme(theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('system');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme, applyTheme]);

  // Initialize auth state on mount and listen for changes
  useEffect(() => {
    let subscription = null;

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
          setUserRole(session.user.user_metadata?.role || 'manager');
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error('Error getting session:', error);
      }
      setLoading(false);
    };

    initAuth();

    // Safely subscribe to auth changes
    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          setUser(session.user);
          setUserRole(session.user.user_metadata?.role || 'manager');
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setUserRole(null);
          setIsAuthenticated(false);
        }
      });
      subscription = data?.subscription;
    } catch (error) {
      console.error('Error setting up auth listener:', error);
    }

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  // Get current branch
  const selectedBranch = branches.find(b => b.id === selectedBranchId) || branches[0];

  // Filter data by selected branch
  const branchBarbers = barbers.filter(b => b.branchId === selectedBranchId);
  const branchServices = services.filter(s => s.branchId === selectedBranchId);
  const branchBookings = bookings.filter(b => b.branchId === selectedBranchId);

  // Get dashboard metrics
  const [metrics, setMetrics] = useState({
    todayTotal: 0,
    todayCompleted: 0,
    todayUpcoming: 0,
    weekRevenue: 0,
    weekBookings: 0,
    totalBarbers: 0,
    totalServices: 0,
  });

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [branchesData, barbersData, servicesData, bookingsData] = await Promise.all([
          branchesService.getAll(),
          barbersService.getAll(),
          servicesService.getAll(),
          bookingsService.getAll(),
        ]);
        setBranches(branchesData);
        setBarbers(barbersData);
        setServices(servicesData);
        setBookings(bookingsData);
        if (branchesData.length > 0) {
          setSelectedBranchId(branchesData[0].id);
        }
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (isAuthenticated) {
      loadData();
    }
    // Don't set loading=false here - auth initialization handles it
  }, [isAuthenticated]);

  // Load metrics when branch changes
  useEffect(() => {
    const loadMetrics = async () => {
      if (selectedBranchId) {
        const metricsData = await bookingsService.getMetrics(selectedBranchId);
        setMetrics(metricsData);
      }
    };
    loadMetrics();
  }, [selectedBranchId, bookings]);

  // Load barber profile when user is a barber
  useEffect(() => {
    const loadBarberProfile = async () => {
      if (userRole === 'barber' && user?.id) {
        try {
          const profile = await barbersService.getByUserId(user.id);
          if (profile) {
            setBarberProfile(profile);
            setSelectedBranchId(profile.branchId);
          }
        } catch (error) {
          console.error('Error loading barber profile:', error);
        }
      } else {
        setBarberProfile(null);
      }
    };
    loadBarberProfile();
  }, [userRole, user]);

  // Reload all data
  const reloadData = useCallback(async () => {
    try {
      const [branchesData, barbersData, servicesData, bookingsData] = await Promise.all([
        branchesService.getAll(),
        barbersService.getAll(),
        servicesService.getAll(),
        bookingsService.getAll(),
      ]);
      setBranches(branchesData);
      setBarbers(barbersData);
      setServices(servicesData);
      setBookings(bookingsData);
    } catch (error) {
      console.error('Error reloading data:', error);
    }
  }, []);

  // Branch actions
  const addBranch = useCallback(async (branchData) => {
    try {
      const { imageFile, ...data } = branchData;

      // Create branch first to get the ID
      const newBranch = await branchesService.create({
        ...data,
        managerId: user?.id,
        status: 'active',
      });

      // Upload image if provided
      if (imageFile) {
        try {
          const imageUrl = await storageService.uploadImage(imageFile, 'branches', newBranch.id);
          // Update branch with image URL
          const updatedBranch = await branchesService.update(newBranch.id, { imageUrl });
          setBranches(prev => [...prev, updatedBranch]);
          return updatedBranch;
        } catch (uploadError) {
          console.error('Error uploading branch image:', uploadError);
          // Still return the branch without image
          setBranches(prev => [...prev, newBranch]);
          return newBranch;
        }
      }

      setBranches(prev => [...prev, newBranch]);
      return newBranch;
    } catch (error) {
      console.error('Error creating branch:', error);
      throw error;
    }
  }, [user]);

  const updateBranch = useCallback(async (branchId, updates) => {
    try {
      const { imageFile, ...data } = updates;

      // Get old image URL for cleanup
      const oldBranch = branches.find(b => b.id === branchId);
      const oldImageUrl = oldBranch?.imageUrl;

      // Upload new image if provided
      if (imageFile) {
        try {
          const imageUrl = await storageService.replaceImage(imageFile, 'branches', branchId, oldImageUrl);
          data.imageUrl = imageUrl;
        } catch (uploadError) {
          console.error('Error uploading branch image:', uploadError);
        }
      }

      const updated = await branchesService.update(branchId, data);
      setBranches(prev =>
        prev.map(b => b.id === branchId ? updated : b)
      );
      return updated;
    } catch (error) {
      console.error('Error updating branch:', error);
      throw error;
    }
  }, [branches]);

  const deleteBranch = useCallback(async (branchId) => {
    try {
      await branchesService.delete(branchId);
      setBranches(prev => prev.filter(b => b.id !== branchId));
      if (selectedBranchId === branchId && branches.length > 1) {
        setSelectedBranchId(branches.find(b => b.id !== branchId)?.id || null);
      }
    } catch (error) {
      console.error('Error deleting branch:', error);
      throw error;
    }
  }, [selectedBranchId, branches]);

  // Barber actions
  const addBarber = useCallback(async (barberData) => {
    try {
      const { profilePictureFile, ...data } = barberData;

      // Create barber record first
      const newBarber = await barbersService.create({
        ...data,
        branchId: selectedBranchId,
        status: 'active',
      });

      // Upload profile picture if provided
      if (profilePictureFile) {
        try {
          const avatarUrl = await storageService.uploadImage(profilePictureFile, 'barbers', newBarber.id);
          await barbersService.update(newBarber.id, { profilePicture: avatarUrl });
          newBarber.profilePicture = avatarUrl;
          newBarber.avatarUrl = avatarUrl;
        } catch (uploadError) {
          console.error('Error uploading barber profile picture:', uploadError);
        }
      }

      // Send invite email
      try {
        await barbersService.sendInvite(
          newBarber.id,
          barberData.email,
          barberData.name,
          selectedBranchId
        );
        newBarber.inviteStatus = 'sent';
        newBarber.inviteSentAt = new Date().toISOString();
      } catch (inviteError) {
        console.error('Failed to send invite:', inviteError);
        // Barber was created, but invite failed - they can resend later
        newBarber.inviteError = inviteError.message;
      }

      setBarbers(prev => [...prev, newBarber]);
      return newBarber;
    } catch (error) {
      console.error('Error creating barber:', error);
      throw error;
    }
  }, [selectedBranchId]);

  const resendBarberInvite = useCallback(async (barberId) => {
    try {
      await barbersService.resendInvite(barberId);
      // Update barber's invite status in local state
      setBarbers(prev =>
        prev.map(b => b.id === barberId
          ? { ...b, inviteStatus: 'sent', inviteSentAt: new Date().toISOString() }
          : b
        )
      );
      return { success: true };
    } catch (error) {
      console.error('Error resending invite:', error);
      throw error;
    }
  }, []);

  const updateBarber = useCallback(async (barberId, updates) => {
    try {
      const { profilePictureFile, ...data } = updates;

      // Get old image URL for cleanup
      const oldBarber = barbers.find(b => b.id === barberId);
      const oldAvatarUrl = oldBarber?.avatarUrl || oldBarber?.profilePicture;

      // Upload new profile picture if provided
      if (profilePictureFile) {
        try {
          const avatarUrl = await storageService.replaceImage(profilePictureFile, 'barbers', barberId, oldAvatarUrl);
          data.profilePicture = avatarUrl;
        } catch (uploadError) {
          console.error('Error uploading barber profile picture:', uploadError);
        }
      }

      const updated = await barbersService.update(barberId, data);
      setBarbers(prev =>
        prev.map(b => b.id === barberId ? updated : b)
      );
      return updated;
    } catch (error) {
      console.error('Error updating barber:', error);
      throw error;
    }
  }, [barbers]);

  const deleteBarber = useCallback(async (barberId) => {
    try {
      await barbersService.delete(barberId);
      setBarbers(prev => prev.filter(b => b.id !== barberId));
    } catch (error) {
      console.error('Error deleting barber:', error);
      throw error;
    }
  }, []);

  // Service actions
  const addService = useCallback(async (serviceData) => {
    try {
      const newService = await servicesService.create({
        ...serviceData,
        branchId: selectedBranchId,
        status: 'active',
      });
      setServices(prev => [...prev, newService]);
      return newService;
    } catch (error) {
      console.error('Error creating service:', error);
      throw error;
    }
  }, [selectedBranchId]);

  const updateService = useCallback(async (serviceId, updates) => {
    try {
      const updated = await servicesService.update(serviceId, updates);
      setServices(prev =>
        prev.map(s => s.id === serviceId ? updated : s)
      );
      return updated;
    } catch (error) {
      console.error('Error updating service:', error);
      throw error;
    }
  }, []);

  const deleteService = useCallback(async (serviceId) => {
    try {
      await servicesService.delete(serviceId);
      setServices(prev => prev.filter(s => s.id !== serviceId));
    } catch (error) {
      console.error('Error deleting service:', error);
      throw error;
    }
  }, []);

  // Booking actions
  const addBooking = useCallback(async (bookingData) => {
    try {
      // Support both single serviceId and multiple serviceIds
      const serviceIds = bookingData.serviceIds || (bookingData.serviceId ? [bookingData.serviceId] : []);
      const selectedServices = services.filter(s => serviceIds.includes(s.id));
      const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
      const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

      const newBooking = await bookingsService.create({
        ...bookingData,
        branchId: selectedBranchId,
        serviceIds: serviceIds,
        duration: totalDuration || 30,
        price: totalPrice || 0,
        status: 'confirmed',
      });
      setBookings(prev => [...prev, newBooking]);
      return newBooking;
    } catch (error) {
      console.error('Error creating booking:', error);
      throw error;
    }
  }, [selectedBranchId, services]);

  const updateBooking = useCallback(async (bookingId, updates) => {
    try {
      const updated = await bookingsService.update(bookingId, updates);
      setBookings(prev =>
        prev.map(b => b.id === bookingId ? updated : b)
      );
      return updated;
    } catch (error) {
      console.error('Error updating booking:', error);
      throw error;
    }
  }, []);

  const cancelBooking = useCallback(async (bookingId) => {
    try {
      const cancelled = await bookingsService.cancel(bookingId);
      setBookings(prev =>
        prev.map(b => b.id === bookingId ? cancelled : b)
      );
      return cancelled;
    } catch (error) {
      console.error('Error cancelling booking:', error);
      throw error;
    }
  }, []);

  // Auth actions
  const login = useCallback(async (email, password) => {
    try {
      const result = await authService.login(email, password);
      if (result) {
        setUser(result.user);
        setUserRole(result.role);
        setIsAuthenticated(true);
        // Branch will be set by the barberProfile loading effect
        return result.role; // Return role for redirect logic
      }
      return null;
    } catch (error) {
      console.error('Login error:', error);
      return null;
    }
  }, []);

  const signup = useCallback(async (userData) => {
    try {
      const result = await authService.signup(userData);
      if (result.success) {
        setUser(result.user);
        setUserRole('manager'); // Signup is only for managers
        setIsAuthenticated(true);
      }
      return result;
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, error: error.message };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setUserRole(null);
      setIsAuthenticated(false);
      setBarberProfile(null);
      setBranches([]);
      setBarbers([]);
      setServices([]);
      setBookings([]);
      setSelectedBranchId(null);
    }
  }, []);

  // Manager alias for backwards compatibility
  const manager = userRole === 'manager' ? user : null;

  // Barber-specific data - use fetched profile (not raw auth user)
  const currentBarber = userRole === 'barber' ? barberProfile : null;
  const barberBookings = useMemo(() => {
    if (!currentBarber) return [];
    return bookings.filter(b => b.barberId === currentBarber.id);
  }, [currentBarber, bookings]);

  const [barberMetrics, setBarberMetrics] = useState(null);

  // Load barber metrics when barber changes
  useEffect(() => {
    const loadBarberMetrics = async () => {
      if (currentBarber) {
        const metricsData = await bookingsService.getBarberMetrics(currentBarber.id);
        setBarberMetrics(metricsData);
      } else {
        setBarberMetrics(null);
      }
    };
    loadBarberMetrics();
  }, [currentBarber, bookings]);

  const barberServices = useMemo(() => {
    if (!currentBarber) return [];
    return services.filter(s => s.branchId === currentBarber.branchId);
  }, [currentBarber, services]);

  const barberBranch = useMemo(() => {
    if (!currentBarber) return null;
    return branches.find(b => b.id === currentBarber.branchId);
  }, [currentBarber, branches]);

  const value = {
    // State
    user,
    userRole,
    manager,
    branches,
    barbers,
    services,
    bookings,
    selectedBranchId,
    selectedBranch,
    branchBarbers,
    branchServices,
    branchBookings,
    metrics,
    isAuthenticated,
    loading,
    theme,

    // Barber-specific state
    currentBarber,
    barberBookings,
    barberMetrics,
    barberServices,
    barberBranch,

    // Actions
    setTheme,
    setSelectedBranchId,
    reloadData,
    addBranch,
    updateBranch,
    deleteBranch,
    addBarber,
    updateBarber,
    deleteBarber,
    resendBarberInvite,
    addService,
    updateService,
    deleteService,
    addBooking,
    updateBooking,
    cancelBooking,
    login,
    signup,
    logout,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
