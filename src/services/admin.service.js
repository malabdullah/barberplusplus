import { supabase } from '../lib/supabase';
import { escapeLikeWildcards, sanitizeForCSV, sanitizeUUID, logErrorDev } from '../utils/security';
import { getToday, getWeekStart, getWeekEnd } from '../utils/dateHelpers';

/**
 * Admin Service - Platform-wide administrative operations
 * Requires admin role for all operations
 */

// Helper: Get date range for analytics periods
const getDateRange = (period) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return { start: today, end: today };
    case 'this_week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(now.getFullYear(), now.getMonth(), diff);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return {
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0]
      };
    }
    case 'this_month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        start: monthStart.toISOString().split('T')[0],
        end: monthEnd.toISOString().split('T')[0]
      };
    }
    case 'last_30_days': {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      return { start: past.toISOString().split('T')[0], end: today };
    }
    case 'last_90_days': {
      const past = new Date();
      past.setDate(past.getDate() - 90);
      return { start: past.toISOString().split('T')[0], end: today };
    }
    default:
      return { start: today, end: today };
  }
};

// Helper: Get previous period for trend comparison
const getPreviousPeriod = (period) => {
  const { start, end } = getDateRange(period);
  const startDate = new Date(start);
  const endDate = new Date(end);
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  const prevEnd = new Date(startDate);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - daysDiff + 1);

  return {
    start: prevStart.toISOString().split('T')[0],
    end: prevEnd.toISOString().split('T')[0]
  };
};

export const adminService = {
  // ===========================
  // PLATFORM METRICS
  // ===========================

  /**
   * Get platform-wide metrics for admin dashboard
   */
  getPlatformMetrics: async () => {
    try {
      const today = getToday();
      const weekStart = getWeekStart();
      const weekEnd = getWeekEnd();

      // Parallel queries for efficiency
      const [
        managersResult,
        barbersResult,
        branchesResult,
        todayBookingsResult,
        weekBookingsResult,
      ] = await Promise.all([
        // Count managers (users with role=manager)
        supabase.rpc('count_users_by_role', { role_filter: 'manager' }).then(res => res.error ? { data: 0 } : res),
        // Count all barbers
        supabase.from('barbers').select('id', { count: 'exact', head: true }),
        // Count all branches
        supabase.from('branches').select('id', { count: 'exact', head: true }),
        // Today's bookings
        supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('date', today)
          .not('status', 'in', '("cancelled","no_show")'),
        // Week's completed bookings (for revenue)
        supabase
          .from('bookings')
          .select('price')
          .gte('date', weekStart)
          .lte('date', weekEnd)
          .eq('status', 'completed'),
      ]);

      // Calculate weekly revenue
      const weeklyRevenue = weekBookingsResult.data?.reduce(
        (sum, booking) => sum + (parseFloat(booking.price) || 0),
        0
      ) || 0;

      return {
        totalManagers: managersResult.data || 0,
        totalBarbers: barbersResult.count || 0,
        totalBranches: branchesResult.count || 0,
        activeBookingsToday: todayBookingsResult.count || 0,
        weeklyRevenue,
        totalBookings: todayBookingsResult.count || 0,
      };
    } catch (error) {
      logErrorDev('Error fetching platform metrics:', error);
      return {
        totalManagers: 0,
        totalBarbers: 0,
        totalBranches: 0,
        activeBookingsToday: 0,
        weeklyRevenue: 0,
        totalBookings: 0,
      };
    }
  },

  // ===========================
  // USER MANAGEMENT
  // ===========================

  /**
   * Get all managers with their branch counts and details
   */
  getAllManagers: async ({ page = 1, limit = 25, search = '', status = 'all' } = {}) => {
    try {
      // Get managers using SECURITY DEFINER function (can access auth.users)
      const { data: managersData, error: managersError } = await supabase
        .rpc('get_managers');

      if (managersError) throw managersError;

      // Get all branches for branch counts
      const { data: branches, error: branchesError } = await supabase
        .from('branches')
        .select('id, manager_id, name, status');

      if (branchesError) throw branchesError;

      // Group branches by manager_id
      const branchMap = {};
      branches?.forEach(b => {
        if (!branchMap[b.manager_id]) {
          branchMap[b.manager_id] = [];
        }
        branchMap[b.manager_id].push({
          id: b.id,
          name: b.name,
          isActive: b.status === 'active',
        });
      });

      // Combine manager data with branch info
      let managers = managersData?.map(m => ({
        id: m.id,
        name: m.name || 'Unknown',
        email: m.email || '',
        phone: m.phone || '',
        createdAt: m.created_at,
        branches: branchMap[m.id] || [],
        branchCount: branchMap[m.id]?.length || 0,
        isActive: branchMap[m.id]?.length > 0
          ? branchMap[m.id].every(b => b.isActive)
          : true,
      })) || [];

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        managers = managers.filter(m =>
          m.name?.toLowerCase().includes(searchLower) ||
          m.email?.toLowerCase().includes(searchLower)
        );
      }

      // Apply status filter
      if (status === 'active') {
        managers = managers.filter(m => m.isActive);
      } else if (status === 'inactive') {
        managers = managers.filter(m => !m.isActive);
      }

      // Sort by created date (newest first)
      managers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Calculate total before pagination
      const total = managers.length;

      // Apply pagination
      const from = (page - 1) * limit;
      managers = managers.slice(from, from + limit);

      return {
        managers,
        total,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching managers:', error);
      throw error;
    }
  },

  /**
   * Get manager details with their branches
   */
  getManagerDetails: async (managerId) => {
    try {
      // Get manager info using SECURITY DEFINER function
      const { data: managerArr, error: managerError } = await supabase
        .rpc('get_manager_by_id', { manager_id: managerId });

      if (managerError) throw managerError;
      const managerData = managerArr?.[0] || null;

      // Get branches for this manager
      const { data: branches, error: branchesError } = await supabase
        .from('branches')
        .select(`
          id, name, name_ar, address, city, governorate_id, area_id,
          phone, email, status, created_at, image_url
        `)
        .eq('manager_id', managerId);

      if (branchesError) throw branchesError;

      // Build manager object from view data
      const manager = managerData ? {
        id: managerData.id,
        name: managerData.name || 'Unknown',
        email: managerData.email || '',
        phone: managerData.phone || '',
        createdAt: managerData.created_at,
      } : null;

      return {
        manager,
        branches: branches?.map(b => ({
          id: b.id,
          name: b.name,
          nameAr: b.name_ar,
          address: b.address,
          city: b.city,
          governorateId: b.governorate_id,
          areaId: b.area_id,
          phone: b.phone,
          email: b.email,
          isActive: b.status === 'active',
          createdAt: b.created_at,
          imageUrl: b.image_url,
        })) || [],
      };
    } catch (error) {
      logErrorDev('Error fetching manager details:', error);
      throw error;
    }
  },

  /**
   * Toggle manager status (enable/disable all their branches)
   */
  toggleManagerStatus: async (managerId, newStatus) => {
    try {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: newStatus })
        .eq('manager_id', managerId);

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: newStatus ? 'manager_enabled' : 'manager_disabled',
        targetUserId: managerId,
        targetEntityType: 'manager',
        targetEntityId: managerId,
        newValues: { is_active: newStatus },
      });

      return { success: true };
    } catch (error) {
      logErrorDev('Error toggling manager status:', error);
      throw error;
    }
  },

  /**
   * Get all barbers platform-wide with pagination
   */
  getAllBarbers: async ({ page = 1, limit = 25, search = '', branchId = null, status = 'all', managerId = null } = {}) => {
    try {
      // Get managers using SECURITY DEFINER function for name lookups
      const { data: managersData } = await supabase
        .rpc('get_managers');

      const managerNameMap = {};
      managersData?.forEach(m => {
        managerNameMap[m.id] = m.name;
      });

      let query = supabase
        .from('barbers')
        .select(`
          *,
          branches:branch_id (
            id,
            name,
            manager_id
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply search filter (escape wildcards to prevent enumeration attacks)
      if (search) {
        const escapedSearch = escapeLikeWildcards(search);
        query = query.or(`name.ilike.%${escapedSearch}%,email.ilike.%${escapedSearch}%`);
      }

      // Apply branch filter
      if (branchId) {
        query = query.eq('branch_id', branchId);
      }

      // Apply status filter
      if (status === 'active') {
        query = query.eq('status', 'active');
      } else if (status === 'inactive') {
        query = query.eq('status', 'inactive');
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      let { data, count, error } = await query;

      if (error) throw error;

      // Filter by managerId in memory (since it's in the joined table)
      if (managerId && data) {
        data = data.filter(barber => barber.branches?.manager_id === managerId);
        count = data.length;
      }

      return {
        barbers: data?.map(barber => ({
          id: barber.id,
          name: barber.name,
          nameAr: barber.name_ar,
          email: barber.email,
          phone: barber.phone,
          countryCode: barber.country_code,
          status: barber.status,
          avatarUrl: barber.avatar_url,
          branchId: barber.branch_id,
          branchName: barber.branches?.name,
          managerId: barber.branches?.manager_id,
          managerName: managerNameMap[barber.branches?.manager_id] || 'Unknown',
          inviteStatus: barber.invite_status,
          createdAt: barber.created_at,
        })) || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching barbers:', error);
      throw error;
    }
  },

  /**
   * Get all branches platform-wide
   */
  getAllBranches: async ({ page = 1, limit = 25, search = '' } = {}) => {
    try {
      let query = supabase
        .from('branches')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply search filter (escape wildcards to prevent enumeration attacks)
      if (search) {
        const escapedSearch = escapeLikeWildcards(search);
        query = query.or(`name.ilike.%${escapedSearch}%,address.ilike.%${escapedSearch}%`);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        branches: data?.map(branch => ({
          id: branch.id,
          managerId: branch.manager_id,
          name: branch.name,
          nameAr: branch.name_ar,
          address: branch.address,
          city: branch.city,
          country: branch.country,
          phone: branch.phone,
          email: branch.email,
          status: branch.status,
          imageUrl: branch.image_url,
          createdAt: branch.created_at,
        })) || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching branches:', error);
      throw error;
    }
  },

  // ===========================
  // AUDIT LOGS
  // ===========================

  /**
   * Get audit logs with filtering
   */
  getAuditLogs: async ({
    page = 1,
    limit = 25,
    actionType = null,
    entityType = null,
    userId = null,
    search = null,
    startDate = null,
    endDate = null
  } = {}) => {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (actionType) {
        query = query.eq('action_type', actionType);
      }

      if (entityType) {
        query = query.eq('target_entity_type', entityType);
      }

      if (userId) {
        // Validate UUID format to prevent SQL injection
        const sanitizedUserId = sanitizeUUID(userId);
        if (sanitizedUserId) {
          query = query.or(`admin_user_id.eq.${sanitizedUserId},target_user_id.eq.${sanitizedUserId}`);
        }
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59.999Z');
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        logs: data?.map(log => ({
          id: log.id,
          adminUserId: log.admin_user_id,
          actionType: log.action_type,
          targetUserId: log.target_user_id,
          targetEntityType: log.target_entity_type,
          targetEntityId: log.target_entity_id,
          oldValues: log.old_values,
          newValues: log.new_values,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          metadata: log.metadata,
          createdAt: log.created_at,
        })) || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      logErrorDev('Error fetching audit logs:', error);
      throw error;
    }
  },

  /**
   * Create an audit log entry
   */
  createAuditLog: async ({
    actionType,
    targetUserId = null,
    targetEntityType = null,
    targetEntityId = null,
    oldValues = null,
    newValues = null,
    metadata = {},
  }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('audit_logs')
        .insert({
          admin_user_id: user?.id,
          action_type: actionType,
          target_user_id: targetUserId,
          target_entity_type: targetEntityType,
          target_entity_id: targetEntityId,
          old_values: oldValues,
          new_values: newValues,
          user_agent: navigator.userAgent,
          metadata,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logErrorDev('Error creating audit log:', error);
      // Don't throw - audit logging shouldn't break main operations
      return null;
    }
  },

  /**
   * Get audit stats for dashboard cards
   */
  getAuditStats: async (days = 7) => {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('audit_logs')
        .select('action_type, created_at')
        .gte('created_at', startDate.toISOString());

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        byActionType: {},
        byDay: {},
        userActions: 0,
        configActions: 0,
        securityEvents: 0,
      };

      data?.forEach(log => {
        // Count by action type
        stats.byActionType[log.action_type] = (stats.byActionType[log.action_type] || 0) + 1;

        // Count by day
        const day = log.created_at.split('T')[0];
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;

        // Categorize (lowercase to match DB)
        if (['user_created', 'user_updated', 'user_deleted', 'user_disabled', 'user_enabled', 'manager_enabled', 'manager_disabled', 'barber_enabled', 'barber_disabled', 'role_assigned'].includes(log.action_type)) {
          stats.userActions++;
        } else if (['settings_changed', 'template_updated', 'location_modified', 'branch_modified', 'barber_modified', 'service_modified', 'booking_modified', 'system_config'].includes(log.action_type)) {
          stats.configActions++;
        } else if (['login_success', 'login_failure', 'logout', 'password_reset_requested', 'password_reset_completed', 'permission_denied', 'suspicious_activity', 'session_expired', 'account_locked', 'account_unlocked', 'security_event'].includes(log.action_type)) {
          stats.securityEvents++;
        }
      });

      return stats;
    } catch (error) {
      logErrorDev('Error fetching audit stats:', error);
      return {
        total: 0,
        byActionType: {},
        byDay: {},
        userActions: 0,
        configActions: 0,
        securityEvents: 0,
      };
    }
  },

  /**
   * Get security events (filtered audit logs)
   */
  getSecurityEvents: async ({
    page = 1,
    limit = 25,
    eventType = null,
    severity = null,
    startDate = null,
    endDate = null
  } = {}) => {
    // Security event types (lowercase to match DB constraint)
    const securityTypes = [
      'login_success', 'login_failure', 'logout',
      'password_reset_requested', 'password_reset_completed',
      'permission_denied', 'suspicious_activity',
      'session_expired', 'account_locked', 'account_unlocked',
      'security_event'
    ];

    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .in('action_type', securityTypes)
        .order('created_at', { ascending: false });

      if (eventType) {
        query = query.eq('action_type', eventType);
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59.999Z');
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        events: data?.map(log => ({
          id: log.id,
          adminUserId: log.admin_user_id,
          actionType: log.action_type,
          targetUserId: log.target_user_id,
          targetEntityType: log.target_entity_type,
          targetEntityId: log.target_entity_id,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          metadata: log.metadata,
          createdAt: log.created_at,
        })) || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      logErrorDev('Error fetching security events:', error);
      throw error;
    }
  },

  /**
   * Get security stats for dashboard
   */
  getSecurityStats: async (days = 7) => {
    // Security event types (lowercase to match DB constraint)
    const securityTypes = [
      'login_success', 'login_failure', 'logout',
      'password_reset_requested', 'password_reset_completed',
      'permission_denied', 'suspicious_activity',
      'session_expired', 'account_locked', 'account_unlocked',
      'security_event'
    ];

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('audit_logs')
        .select('action_type, created_at')
        .in('action_type', securityTypes)
        .gte('created_at', startDate.toISOString());

      if (error) throw error;

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const stats = {
        failedLogins24h: 0,
        permissionDenied24h: 0,
        suspiciousActivity7d: 0,
        passwordResets7d: 0,
        totalEvents: data?.length || 0,
        byType: {},
        byDay: {},
      };

      data?.forEach(event => {
        const eventDate = new Date(event.created_at);

        // Count by type
        stats.byType[event.action_type] = (stats.byType[event.action_type] || 0) + 1;

        // 24h counts (lowercase to match DB)
        if (eventDate >= oneDayAgo) {
          if (event.action_type === 'login_failure') stats.failedLogins24h++;
          if (event.action_type === 'permission_denied') stats.permissionDenied24h++;
        }

        // 7d counts (lowercase to match DB)
        if (event.action_type === 'suspicious_activity') stats.suspiciousActivity7d++;
        if (event.action_type === 'password_reset_requested' || event.action_type === 'password_reset_completed') {
          stats.passwordResets7d++;
        }

        // By day
        const day = event.created_at.split('T')[0];
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;
      });

      return stats;
    } catch (error) {
      logErrorDev('Error fetching security stats:', error);
      return {
        failedLogins24h: 0,
        permissionDenied24h: 0,
        suspiciousActivity7d: 0,
        passwordResets7d: 0,
        totalEvents: 0,
        byType: {},
        byDay: {},
      };
    }
  },

  /**
   * Export audit logs (no pagination, for download)
   */
  exportAuditLogs: async ({ format = 'json', actionType = null, startDate = null, endDate = null } = {}) => {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000); // Safety limit

      if (actionType) {
        query = query.eq('action_type', actionType);
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59.999Z');
      }

      const { data, error } = await query;

      if (error) throw error;

      const logs = data?.map(log => ({
        id: log.id,
        adminUserId: log.admin_user_id,
        actionType: log.action_type,
        targetUserId: log.target_user_id,
        targetEntityType: log.target_entity_type,
        targetEntityId: log.target_entity_id,
        oldValues: log.old_values,
        newValues: log.new_values,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        metadata: log.metadata,
        createdAt: log.created_at,
      })) || [];

      if (format === 'csv') {
        // Convert to CSV with sanitization to prevent CSV injection attacks
        const headers = ['ID', 'Timestamp', 'Action', 'Admin User', 'Target Entity Type', 'Target Entity ID', 'IP Address'];
        const rows = logs.map(log => [
          sanitizeForCSV(log.id),
          sanitizeForCSV(log.createdAt),
          sanitizeForCSV(log.actionType),
          sanitizeForCSV(log.adminUserId || ''),
          sanitizeForCSV(log.targetEntityType || ''),
          sanitizeForCSV(log.targetEntityId || ''),
          sanitizeForCSV(log.ipAddress || ''),
        ]);
        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      }

      return logs;
    } catch (error) {
      logErrorDev('Error exporting audit logs:', error);
      throw error;
    }
  },

  // ===========================
  // ACTIVITY LOGS (from existing logs table)
  // ===========================

  /**
   * Get all activity logs platform-wide
   */
  getAllActivityLogs: async ({ page = 1, limit = 25, level = null, logType = null, startDate = null, endDate = null } = {}) => {
    try {
      let query = supabase
        .from('logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (level) {
        query = query.eq('level', level);
      }

      if (logType) {
        query = query.eq('log_type', logType);
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        logs: data || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      logErrorDev('Error fetching activity logs:', error);
      throw error;
    }
  },

  // ===========================
  // ADMIN SETTINGS
  // ===========================

  /**
   * Get all admin settings
   */
  getSettings: async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*')
        .order('category');

      if (error) throw error;

      // Convert to key-value object
      const settings = {};
      data?.forEach(setting => {
        settings[setting.setting_key] = {
          value: setting.setting_value,
          description: setting.description,
          category: setting.category,
        };
      });

      return settings;
    } catch (error) {
      logErrorDev('Error fetching admin settings:', error);
      throw error;
    }
  },

  /**
   * Update an admin setting
   */
  updateSetting: async (key, value) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('admin_settings')
        .update({
          setting_value: value,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('setting_key', key)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logErrorDev('Error updating setting:', error);
      throw error;
    }
  },

  // ===========================
  // ANALYTICS
  // ===========================

  /**
   * Get comprehensive analytics for a given time period
   * @param {string} period - 'today' | 'this_week' | 'this_month' | 'last_30_days' | 'last_90_days'
   */
  getAnalytics: async (period = 'this_week') => {
    try {
      const { start, end } = getDateRange(period);
      const prev = getPreviousPeriod(period);

      // Parallel queries for current and previous period data
      const [
        currentBookingsResult,
        previousBookingsResult,
        barbersResult,
        servicesResult,
      ] = await Promise.all([
        // Current period bookings
        supabase
          .from('bookings')
          .select('id, barber_id, service_ids, date, time, duration, price, status')
          .gte('date', start)
          .lte('date', end),
        // Previous period bookings (for comparison)
        supabase
          .from('bookings')
          .select('id, price, status')
          .gte('date', prev.start)
          .lte('date', prev.end),
        // Active barbers
        supabase
          .from('barbers')
          .select('id, name, status')
          .eq('status', 'active'),
        // Active services
        supabase
          .from('services')
          .select('id, name, price, duration, status')
          .eq('status', 'active'),
      ]);

      const currentBookings = currentBookingsResult.data || [];
      const previousBookings = previousBookingsResult.data || [];
      const barbers = barbersResult.data || [];
      const services = servicesResult.data || [];

      // Calculate KPIs
      const completedCurrent = currentBookings.filter(b => b.status === 'completed');
      const completedPrevious = previousBookings.filter(b => b.status === 'completed');

      const totalRevenue = completedCurrent.reduce((sum, b) => sum + parseFloat(b.price || 0), 0);
      const prevRevenue = completedPrevious.reduce((sum, b) => sum + parseFloat(b.price || 0), 0);
      const revenueTrend = prevRevenue > 0
        ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
        : 0;

      const totalBookings = currentBookings.length;
      const prevTotalBookings = previousBookings.length;
      const bookingsTrend = prevTotalBookings > 0
        ? Math.round(((totalBookings - prevTotalBookings) / prevTotalBookings) * 100)
        : 0;

      const avgBookingValue = completedCurrent.length > 0
        ? Math.round(totalRevenue / completedCurrent.length)
        : 0;

      // Bookings by status
      const bookingsByStatus = {
        completed: currentBookings.filter(b => b.status === 'completed').length,
        cancelled: currentBookings.filter(b => b.status === 'cancelled').length,
        no_show: currentBookings.filter(b => b.status === 'no_show').length,
        pending: currentBookings.filter(b => b.status === 'pending').length,
        confirmed: currentBookings.filter(b => b.status === 'confirmed').length,
      };

      // Peak hours (group by hour)
      const hourCounts = {};
      currentBookings.forEach(b => {
        const hour = parseInt(b.time?.split(':')[0] || '0', 10);
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      });
      const peakHours = Object.entries(hourCounts)
        .map(([hour, count]) => ({ hour: parseInt(hour, 10), count }))
        .sort((a, b) => a.hour - b.hour);

      // Barber performance
      const barberStats = barbers.map(barber => {
        const barberBookings = currentBookings.filter(b => b.barber_id === barber.id);
        const completed = barberBookings.filter(b => b.status === 'completed');
        const noShows = barberBookings.filter(b => b.status === 'no_show').length;
        const revenue = completed.reduce((sum, b) => sum + parseFloat(b.price || 0), 0);
        const completionRate = barberBookings.length > 0
          ? Math.round((completed.length / barberBookings.length) * 100)
          : 0;

        return {
          id: barber.id,
          name: barber.name,
          revenue,
          totalBookings: barberBookings.length,
          completedBookings: completed.length,
          noShows,
          completionRate,
        };
      }).sort((a, b) => b.revenue - a.revenue);

      // Service popularity
      const serviceCounts = {};
      const serviceRevenue = {};
      currentBookings.forEach(b => {
        (b.service_ids || []).forEach(serviceId => {
          serviceCounts[serviceId] = (serviceCounts[serviceId] || 0) + 1;
          if (b.status === 'completed') {
            // Approximate revenue per service (split evenly if multiple)
            const servicePrice = parseFloat(b.price || 0) / (b.service_ids?.length || 1);
            serviceRevenue[serviceId] = (serviceRevenue[serviceId] || 0) + servicePrice;
          }
        });
      });

      const serviceStats = services.map(service => ({
        id: service.id,
        name: service.name,
        bookings: serviceCounts[service.id] || 0,
        revenue: Math.round(serviceRevenue[service.id] || 0),
        duration: service.duration,
        price: parseFloat(service.price),
      })).sort((a, b) => b.bookings - a.bookings);

      return {
        period: { start, end },
        kpis: {
          totalRevenue,
          revenueTrend,
          totalBookings,
          bookingsTrend,
          avgBookingValue,
          activeBarbers: barbers.length,
          totalServices: services.length,
        },
        bookingsByStatus,
        peakHours,
        barberPerformance: barberStats.slice(0, 10), // Top 10
        serviceAnalysis: serviceStats.slice(0, 10),  // Top 10
      };
    } catch (error) {
      logErrorDev('Error fetching analytics:', error);
      throw error;
    }
  },

  /**
   * Get revenue over time for line chart
   * @param {string} period
   * @returns {Promise<Array<{date: string, revenue: number, bookings: number}>>}
   */
  getRevenueTimeSeries: async (period = 'this_week') => {
    try {
      const { start, end } = getDateRange(period);

      const { data, error } = await supabase
        .from('bookings')
        .select('date, price, status')
        .gte('date', start)
        .lte('date', end)
        .eq('status', 'completed')
        .order('date');

      if (error) throw error;

      // Group by date
      const byDate = {};
      (data || []).forEach(booking => {
        if (!byDate[booking.date]) {
          byDate[booking.date] = { revenue: 0, bookings: 0 };
        }
        byDate[booking.date].revenue += parseFloat(booking.price || 0);
        byDate[booking.date].bookings += 1;
      });

      // Fill in missing dates
      const result = [];
      const current = new Date(start);
      const endDate = new Date(end);

      while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0];
        result.push({
          date: dateStr,
          revenue: Math.round(byDate[dateStr]?.revenue || 0),
          bookings: byDate[dateStr]?.bookings || 0,
        });
        current.setDate(current.getDate() + 1);
      }

      return result;
    } catch (error) {
      logErrorDev('Error fetching revenue time series:', error);
      throw error;
    }
  },

  // ===========================
  // NOTIFICATION TEMPLATES
  // ===========================

  /**
   * Get all notification templates
   */
  getNotificationTemplates: async () => {
    try {
      const { data, error } = await supabase
        .from('notification_templates')
        .select('*')
        .order('template_key');

      if (error) throw error;

      return data?.map(template => ({
        id: template.id,
        templateKey: template.template_key,
        titleEn: template.title_en,
        titleAr: template.title_ar,
        messageEn: template.message_en,
        messageAr: template.message_ar,
        variables: template.variables,
        isActive: template.is_active,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      })) || [];
    } catch (error) {
      logErrorDev('Error fetching notification templates:', error);
      throw error;
    }
  },

  /**
   * Update a notification template
   */
  updateNotificationTemplate: async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('notification_templates')
        .update({
          title_en: updates.titleEn,
          title_ar: updates.titleAr,
          message_en: updates.messageEn,
          message_ar: updates.messageAr,
          is_active: updates.isActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logErrorDev('Error updating notification template:', error);
      throw error;
    }
  },

  // ===========================
  // LOCATION MANAGEMENT
  // ===========================

  /**
   * Get all governorates with their areas
   */
  getGovernorates: async () => {
    try {
      const { data, error } = await supabase
        .from('governorates')
        .select(`
          id,
          name_en,
          name_ar,
          code,
          created_at,
          areas (
            id,
            name_en,
            name_ar,
            created_at
          )
        `)
        .order('id');

      if (error) throw error;

      return data?.map(gov => ({
        id: gov.id,
        nameEn: gov.name_en,
        nameAr: gov.name_ar,
        code: gov.code,
        createdAt: gov.created_at,
        areas: gov.areas?.map(area => ({
          id: area.id,
          nameEn: area.name_en,
          nameAr: area.name_ar,
          createdAt: area.created_at,
        })) || [],
      })) || [];
    } catch (error) {
      logErrorDev('Error fetching governorates:', error);
      throw error;
    }
  },

  /**
   * Create a new governorate
   */
  createGovernorate: async ({ nameEn, nameAr, code }) => {
    try {
      // Get next ID
      const { data: maxIdData } = await supabase
        .from('governorates')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      const nextId = (maxIdData?.id || 0) + 1;

      const { data, error } = await supabase
        .from('governorates')
        .insert({
          id: nextId,
          name_en: nameEn,
          name_ar: nameAr,
          code: code?.toUpperCase() || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'location_modified',
        targetEntityType: 'governorate',
        targetEntityId: data.id,
        newValues: { nameEn, nameAr, code },
        metadata: { action: 'create' },
      });

      return {
        id: data.id,
        nameEn: data.name_en,
        nameAr: data.name_ar,
        code: data.code,
        createdAt: data.created_at,
        areas: [],
      };
    } catch (error) {
      logErrorDev('Error creating governorate:', error);
      throw error;
    }
  },

  /**
   * Update a governorate
   */
  updateGovernorate: async (id, { nameEn, nameAr, code }) => {
    try {
      const { data, error } = await supabase
        .from('governorates')
        .update({
          name_en: nameEn,
          name_ar: nameAr,
          code: code?.toUpperCase() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'location_modified',
        targetEntityType: 'governorate',
        targetEntityId: id,
        newValues: { nameEn, nameAr, code },
        metadata: { action: 'update' },
      });

      return {
        id: data.id,
        nameEn: data.name_en,
        nameAr: data.name_ar,
        code: data.code,
      };
    } catch (error) {
      logErrorDev('Error updating governorate:', error);
      throw error;
    }
  },

  /**
   * Delete a governorate (checks for dependencies first)
   */
  deleteGovernorate: async (id) => {
    try {
      // Check if any branches use this governorate
      const { count: branchCount } = await supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('governorate_id', id);

      if (branchCount > 0) {
        throw new Error(`Cannot delete: ${branchCount} branch(es) use this governorate`);
      }

      // Delete all areas first
      await supabase.from('areas').delete().eq('governorate_id', id);

      // Delete the governorate
      const { error } = await supabase
        .from('governorates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'location_modified',
        targetEntityType: 'governorate',
        targetEntityId: id,
        metadata: { action: 'delete' },
      });

      return { success: true };
    } catch (error) {
      logErrorDev('Error deleting governorate:', error);
      throw error;
    }
  },

  /**
   * Create a new area
   */
  createArea: async ({ governorateId, nameEn, nameAr }) => {
    try {
      // Get next ID
      const { data: maxIdData } = await supabase
        .from('areas')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      const nextId = (maxIdData?.id || 0) + 1;

      const { data, error } = await supabase
        .from('areas')
        .insert({
          id: nextId,
          governorate_id: governorateId,
          name_en: nameEn,
          name_ar: nameAr,
        })
        .select()
        .single();

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'location_modified',
        targetEntityType: 'area',
        targetEntityId: data.id,
        newValues: { governorateId, nameEn, nameAr },
        metadata: { action: 'create' },
      });

      return {
        id: data.id,
        governorateId: data.governorate_id,
        nameEn: data.name_en,
        nameAr: data.name_ar,
        createdAt: data.created_at,
      };
    } catch (error) {
      logErrorDev('Error creating area:', error);
      throw error;
    }
  },

  /**
   * Update an area
   */
  updateArea: async (id, { nameEn, nameAr }) => {
    try {
      const { data, error } = await supabase
        .from('areas')
        .update({
          name_en: nameEn,
          name_ar: nameAr,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'location_modified',
        targetEntityType: 'area',
        targetEntityId: id,
        newValues: { nameEn, nameAr },
        metadata: { action: 'update' },
      });

      return {
        id: data.id,
        nameEn: data.name_en,
        nameAr: data.name_ar,
      };
    } catch (error) {
      logErrorDev('Error updating area:', error);
      throw error;
    }
  },

  /**
   * Delete an area (checks for dependencies first)
   */
  deleteArea: async (id) => {
    try {
      // Check if any branches use this area
      const { count: branchCount } = await supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('area_id', id);

      if (branchCount > 0) {
        throw new Error(`Cannot delete: ${branchCount} branch(es) use this area`);
      }

      const { error } = await supabase
        .from('areas')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'location_modified',
        targetEntityType: 'area',
        targetEntityId: id,
        metadata: { action: 'delete' },
      });

      return { success: true };
    } catch (error) {
      logErrorDev('Error deleting area:', error);
      throw error;
    }
  },

  /**
   * Check location dependencies
   */
  checkLocationDependencies: async (type, id) => {
    try {
      const column = type === 'governorate' ? 'governorate_id' : 'area_id';
      const { count } = await supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq(column, id);

      return { count: count || 0 };
    } catch (error) {
      logErrorDev('Error checking location dependencies:', error);
      return { count: 0 };
    }
  },

  // ===========================
  // WHATSAPP MANAGEMENT
  // ===========================

  /**
   * Get WhatsApp conversations with filtering
   */
  getWhatsAppConversations: async ({
    page = 1,
    limit = 25,
    search = '',
    state = null,
    language = null
  } = {}) => {
    try {
      let query = supabase
        .from('whatsapp_conversations')
        .select('*', { count: 'exact' })
        .order('last_message_at', { ascending: false, nullsFirst: false });

      // Apply search filter (phone or customer name)
      if (search) {
        const escapedSearch = escapeLikeWildcards(search);
        query = query.or(`phone_number.ilike.%${escapedSearch}%,customer_name.ilike.%${escapedSearch}%`);
      }

      // Apply state filter
      if (state) {
        query = query.eq('current_state', state);
      }

      // Apply language filter
      if (language) {
        query = query.eq('language', language);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        conversations: data?.map(conv => ({
          id: conv.id,
          phoneNumber: conv.phone_number,
          phoneCountryCode: conv.phone_country_code,
          customerName: conv.customer_name,
          currentState: conv.current_state,
          context: conv.context,
          language: conv.language,
          lastMessageAt: conv.last_message_at,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
        })) || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      logErrorDev('Error fetching WhatsApp conversations:', error);
      throw error;
    }
  },

  /**
   * Get conversation details with messages
   */
  getConversationDetails: async (conversationId) => {
    try {
      // Get conversation
      const { data: conv, error: convError } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (convError) throw convError;

      // Get messages for this conversation
      const { data: messages, error: messagesError } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (messagesError) throw messagesError;

      return {
        conversation: {
          id: conv.id,
          phoneNumber: conv.phone_number,
          phoneCountryCode: conv.phone_country_code,
          customerName: conv.customer_name,
          currentState: conv.current_state,
          context: conv.context,
          language: conv.language,
          lastMessageAt: conv.last_message_at,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
        },
        messages: messages?.map(msg => ({
          id: msg.id,
          conversationId: msg.conversation_id,
          whatsappMessageId: msg.whatsapp_message_id,
          direction: msg.direction,
          messageType: msg.message_type,
          content: msg.content,
          metadata: msg.metadata,
          status: msg.status,
          createdAt: msg.created_at,
        })) || [],
      };
    } catch (error) {
      logErrorDev('Error fetching conversation details:', error);
      throw error;
    }
  },

  /**
   * Get WhatsApp messages with filtering
   */
  getWhatsAppMessages: async ({
    page = 1,
    limit = 25,
    conversationId = null,
    direction = null,
    status = null,
    messageType = null,
    phoneNumber = null
  } = {}) => {
    try {
      // If phoneNumber filter is provided, first get matching conversation IDs
      let conversationIds = null;
      if (phoneNumber) {
        const escapedPhone = escapeLikeWildcards(phoneNumber);
        const { data: convs, error: convError } = await supabase
          .from('whatsapp_conversations')
          .select('id')
          .ilike('phone_number', `%${escapedPhone}%`);

        if (convError) throw convError;
        conversationIds = convs?.map(c => c.id) || [];

        // If no conversations match, return empty result
        if (conversationIds.length === 0) {
          return {
            messages: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
          };
        }
      }

      let query = supabase
        .from('whatsapp_messages')
        .select(`
          *,
          conversation:conversation_id (
            phone_number,
            customer_name
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply phone number filter via conversation IDs
      if (conversationIds) {
        query = query.in('conversation_id', conversationIds);
      }

      // Apply conversation filter
      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      }

      // Apply direction filter
      if (direction) {
        query = query.eq('direction', direction);
      }

      // Apply status filter
      if (status) {
        query = query.eq('status', status);
      }

      // Apply message type filter
      if (messageType) {
        query = query.eq('message_type', messageType);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        messages: data?.map(msg => ({
          id: msg.id,
          conversationId: msg.conversation_id,
          whatsappMessageId: msg.whatsapp_message_id,
          direction: msg.direction,
          messageType: msg.message_type,
          content: msg.content,
          metadata: msg.metadata,
          status: msg.status,
          createdAt: msg.created_at,
          phoneNumber: msg.conversation?.phone_number,
          customerName: msg.conversation?.customer_name,
        })) || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      logErrorDev('Error fetching WhatsApp messages:', error);
      throw error;
    }
  },

  /**
   * Delete a WhatsApp message (with audit log)
   */
  deleteWhatsAppMessage: async (messageId) => {
    try {
      // Get message details first for audit log
      const { data: message, error: fetchError } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('id', messageId)
        .single();

      if (fetchError) throw fetchError;

      // Delete the message
      const { error: deleteError } = await supabase
        .from('whatsapp_messages')
        .delete()
        .eq('id', messageId);

      if (deleteError) throw deleteError;

      // Create audit log
      await adminService.createAuditLog({
        actionType: 'whatsapp_message_deleted',
        targetEntityType: 'whatsapp_message',
        targetEntityId: messageId,
        oldValues: {
          conversationId: message.conversation_id,
          direction: message.direction,
          content: message.content?.substring(0, 200), // Truncate for audit
          messageType: message.message_type,
        },
        metadata: { action: 'delete' },
      });

      return { success: true };
    } catch (error) {
      logErrorDev('Error deleting WhatsApp message:', error);
      throw error;
    }
  },

  /**
   * Delete multiple WhatsApp messages (bulk delete with audit log)
   */
  deleteWhatsAppMessages: async (messageIds) => {
    try {
      if (!messageIds || messageIds.length === 0) {
        return { success: true, deletedCount: 0 };
      }

      // Get messages for audit log
      const { data: messages, error: fetchError } = await supabase
        .from('whatsapp_messages')
        .select('id, conversation_id, direction, content, message_type')
        .in('id', messageIds);

      if (fetchError) throw fetchError;

      // Delete all messages
      const { error: deleteError } = await supabase
        .from('whatsapp_messages')
        .delete()
        .in('id', messageIds);

      if (deleteError) throw deleteError;

      // Create single audit log for bulk operation
      await adminService.createAuditLog({
        actionType: 'whatsapp_messages_bulk_deleted',
        targetEntityType: 'whatsapp_message',
        oldValues: {
          messageIds,
          count: messages?.length || 0,
          messages: messages?.map(m => ({
            id: m.id,
            conversationId: m.conversation_id,
            direction: m.direction,
            contentPreview: m.content?.substring(0, 50),
          })),
        },
        metadata: { action: 'bulk_delete', count: messages?.length || 0 },
      });

      return { success: true, deletedCount: messages?.length || 0 };
    } catch (error) {
      logErrorDev('Error bulk deleting WhatsApp messages:', error);
      throw error;
    }
  },

  /**
   * Get WhatsApp logs with filtering
   */
  getWhatsAppLogs: async ({
    page = 1,
    limit = 25,
    conversationId = null,
    logLevel = null,
    eventType = null,
    startDate = null,
    endDate = null
  } = {}) => {
    try {
      let query = supabase
        .from('whatsapp_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply conversation filter
      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      }

      // Apply log level filter
      if (logLevel) {
        query = query.eq('log_level', logLevel);
      }

      // Apply event type filter
      if (eventType) {
        query = query.eq('event_type', eventType);
      }

      // Apply date range
      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59.999Z');
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      return {
        logs: data?.map(log => ({
          id: log.id,
          conversationId: log.conversation_id,
          phoneNumber: log.phone_number,
          logLevel: log.log_level,
          eventType: log.event_type,
          message: log.message,
          inboundMessage: log.inbound_message,
          outboundMessage: log.outbound_message,
          toolName: log.tool_name,
          toolInput: log.tool_input,
          toolOutput: log.tool_output,
          errorCode: log.error_code,
          errorMessage: log.error_message,
          stackTrace: log.stack_trace,
          contextSnapshot: log.context_snapshot,
          executionTimeMs: log.execution_time_ms,
          metadata: log.metadata,
          createdAt: log.created_at,
        })) || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      logErrorDev('Error fetching WhatsApp logs:', error);
      throw error;
    }
  },

  /**
   * Get WhatsApp stats for dashboard
   */
  getWhatsAppStats: async () => {
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Parallel queries
      const [
        totalConversationsResult,
        totalMessagesResult,
        messagesTodayResult,
        errorsResult,
        messagesByDirectionResult,
      ] = await Promise.all([
        // Total conversations
        supabase
          .from('whatsapp_conversations')
          .select('id', { count: 'exact', head: true }),
        // Total messages
        supabase
          .from('whatsapp_messages')
          .select('id', { count: 'exact', head: true }),
        // Messages today
        supabase
          .from('whatsapp_messages')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', oneDayAgo.toISOString()),
        // Errors in last 7 days
        supabase
          .from('whatsapp_logs')
          .select('id', { count: 'exact', head: true })
          .eq('log_level', 'error')
          .gte('created_at', sevenDaysAgo.toISOString()),
        // Messages by direction
        supabase
          .from('whatsapp_messages')
          .select('direction'),
      ]);

      // Count messages by direction
      const directionCounts = { inbound: 0, outbound: 0 };
      messagesByDirectionResult.data?.forEach(msg => {
        if (msg.direction) {
          directionCounts[msg.direction] = (directionCounts[msg.direction] || 0) + 1;
        }
      });

      return {
        totalConversations: totalConversationsResult.count || 0,
        totalMessages: totalMessagesResult.count || 0,
        messagesToday: messagesTodayResult.count || 0,
        errorsLast7Days: errorsResult.count || 0,
        inboundMessages: directionCounts.inbound,
        outboundMessages: directionCounts.outbound,
      };
    } catch (error) {
      logErrorDev('Error fetching WhatsApp stats:', error);
      return {
        totalConversations: 0,
        totalMessages: 0,
        messagesToday: 0,
        errorsLast7Days: 0,
        inboundMessages: 0,
        outboundMessages: 0,
      };
    }
  },

  /**
   * Get distinct conversation states (for filter dropdown)
   */
  getWhatsAppConversationStates: async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('current_state');

      if (error) throw error;

      // Get unique states
      const states = [...new Set(data?.map(c => c.current_state).filter(Boolean))];
      return states.sort();
    } catch (error) {
      logErrorDev('Error fetching conversation states:', error);
      return [];
    }
  },

  /**
   * Get distinct log event types (for filter dropdown)
   */
  getWhatsAppEventTypes: async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_logs')
        .select('event_type');

      if (error) throw error;

      // Get unique event types
      const types = [...new Set(data?.map(l => l.event_type).filter(Boolean))];
      return types.sort();
    } catch (error) {
      logErrorDev('Error fetching event types:', error);
      return [];
    }
  },

  /**
   * Export WhatsApp logs (no pagination, for download)
   */
  exportWhatsAppLogs: async ({ format = 'json', logLevel = null, startDate = null, endDate = null } = {}) => {
    try {
      let query = supabase
        .from('whatsapp_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000); // Safety limit

      if (logLevel) {
        query = query.eq('log_level', logLevel);
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59.999Z');
      }

      const { data, error } = await query;

      if (error) throw error;

      const logs = data?.map(log => ({
        id: log.id,
        conversationId: log.conversation_id,
        phoneNumber: log.phone_number,
        logLevel: log.log_level,
        eventType: log.event_type,
        message: log.message,
        toolName: log.tool_name,
        errorCode: log.error_code,
        errorMessage: log.error_message,
        executionTimeMs: log.execution_time_ms,
        createdAt: log.created_at,
      })) || [];

      if (format === 'csv') {
        const headers = ['ID', 'Timestamp', 'Level', 'Event Type', 'Phone', 'Message', 'Tool', 'Error Code'];
        const rows = logs.map(log => [
          sanitizeForCSV(log.id),
          sanitizeForCSV(log.createdAt),
          sanitizeForCSV(log.logLevel),
          sanitizeForCSV(log.eventType || ''),
          sanitizeForCSV(log.phoneNumber || ''),
          sanitizeForCSV(log.message || ''),
          sanitizeForCSV(log.toolName || ''),
          sanitizeForCSV(log.errorCode || ''),
        ]);
        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      }

      return logs;
    } catch (error) {
      logErrorDev('Error exporting WhatsApp logs:', error);
      throw error;
    }
  },
};

export default adminService;
