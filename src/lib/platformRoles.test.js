import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/teamOAuthSupabase', () => ({ teamOAuthSupabase: {}, TEAM_OAUTH_STORAGE_KEY: 'barber-team-oauth' }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: {} }));
import { isPlatformAdmin, normalizeStaffRole, persistedRoleKey } from './platformRoles';
import { validateUserRole } from '../utils/security';
import { staffDestination } from '../services/teamAuth.service';
describe('administrative role boundary', () => {
  it('maps persisted identities to distinct UI roles without upgrading managers or forged values', () => {
    expect(validateUserRole('admin').role).toBe('super_admin');
    expect(validateUserRole('agent').role).toBe('admin');
    for (const role of ['manager', 'barber']) expect(validateUserRole(role).role).toBe(role);
    for (const role of ['super_admin', 'customer', 'owner', '__proto__', 'constructor', undefined]) expect(validateUserRole(role).valid).toBe(false);
    expect(normalizeStaffRole('__proto__')).toBeNull();
    expect(isPlatformAdmin('manager')).toBe(false);
  });
  it('routes both administrators to one workspace and labels stored roles accurately', () => {
    for (const role of ['admin', 'super_admin', 'agent']) expect(staffDestination(role)).toBe('/admin');
    expect(persistedRoleKey('admin')).toBe('common.superAdmin');
    expect(persistedRoleKey('agent')).toBe('common.admin');
    expect(persistedRoleKey('customer')).toBe('bookings.customer');
  });
});
