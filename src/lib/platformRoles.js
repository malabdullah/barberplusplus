// Preserve existing Auth identities: persisted admin is Super Admin; agent is Admin.
const persistedRoles = { admin: 'super_admin', agent: 'admin', manager: 'manager', barber: 'barber' };
export const normalizeStaffRole = role => Object.hasOwn(persistedRoles, role) ? persistedRoles[role] : null;
export const isPlatformAdmin = role => role === 'super_admin' || role === 'admin';
export const platformRoleKey = role => role === 'super_admin' ? 'common.superAdmin' : role === 'admin' ? 'common.admin' : role === 'customer' ? 'bookings.customer' : `common.${role}`;
export const persistedRoleKey = role => platformRoleKey(normalizeStaffRole(role) || role);
