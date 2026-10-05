import assert from 'node:assert/strict';

// Only the non-login role added by the exact Realtime candidate is supported.
// Source: supabase/realtime e0d1f657161f7f01e9b4be156627d974fdc6918d,
// priv/repo/tenant_db_dump_17.sql. No pg_authid, passwords or globals export.
export const realtimeRecoveryRole = Object.freeze({
  name: 'supabase_realtime_admin', superuser: false, inherit: false,
  createRole: false, createDatabase: false, login: false, replication: false,
  bypassRls: false, connectionLimit: -1, validUntil: null,
  config: ['search_path=public, extensions, realtime'],
  memberships: ['anon', 'authenticated', 'service_role'].map((role) => ({
    role, member: 'supabase_realtime_admin', grantor: 'supabase_admin',
    admin: false, inherit: false, set: true,
  })),
  parameters: [{ parameter: 'log_min_messages', grantor: 'supabase_admin', privilege: 'SET', grantable: false }],
});

export const recoveryRoleQuery = `SELECT COALESCE((SELECT jsonb_build_object(
  'name', r.rolname, 'superuser', r.rolsuper, 'inherit', r.rolinherit,
  'createRole', r.rolcreaterole, 'createDatabase', r.rolcreatedb,
  'login', r.rolcanlogin, 'replication', r.rolreplication, 'bypassRls', r.rolbypassrls,
  'connectionLimit', r.rolconnlimit, 'validUntil', r.rolvaliduntil, 'config', r.rolconfig,
  'memberships', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'role', granted.rolname, 'member', member.rolname, 'grantor', grantor.rolname,
    'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option) ORDER BY granted.rolname, member.rolname)
    FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member JOIN pg_roles grantor ON grantor.oid=m.grantor
    WHERE m.member=r.oid OR m.roleid=r.oid), '[]'::jsonb),
  'parameters', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'parameter', p.parname, 'grantor', grantor.rolname, 'privilege', a.privilege_type,
    'grantable', a.is_grantable) ORDER BY p.parname, a.privilege_type)
    FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a
    JOIN pg_roles grantor ON grantor.oid=a.grantor WHERE a.grantee=r.oid), '[]'::jsonb)
) FROM pg_roles r WHERE r.rolname='supabase_realtime_admin'), 'null'::jsonb)::text;`;

export function validateRecoveryRole(metadata) {
  if (metadata !== null) assert.deepEqual(metadata, realtimeRecoveryRole, 'Unreviewed Realtime recovery role metadata');
  return metadata;
}

export function restoreRecoveryRoleSql(metadata) {
  validateRecoveryRole(metadata);
  if (metadata === null) return '';
  // Constant SQL only. The caller verifies that this role is absent in a fresh,
  // labelled synthetic recovery target. Existing/bootstrap roles are untouched.
  return `CREATE ROLE supabase_realtime_admin WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
ALTER ROLE supabase_realtime_admin SET search_path TO 'public', 'extensions', 'realtime';
GRANT anon TO supabase_realtime_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT authenticated TO supabase_realtime_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT service_role TO supabase_realtime_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT SET ON PARAMETER log_min_messages TO supabase_realtime_admin;`;
}
