import { IUser, UserRole } from '../models/User';

/** Platform-wide administrator (legacy DB value `admin` was migrated to superAdmin). */
export const SUPER_ADMIN_ROLES: UserRole[] = ['superAdmin'];
/** College-scoped administrator — may access multiple assigned institutions. */
export const COLLEGE_ADMIN_ROLES: UserRole[] = ['admin', 'institutionAdmin', 'recruiter'];
/** @deprecated use COLLEGE_ADMIN_ROLES */
export const INSTITUTION_ADMIN_ROLES = COLLEGE_ADMIN_ROLES;
export const ADMIN_ROLES_ALL: UserRole[] = [...SUPER_ADMIN_ROLES, ...COLLEGE_ADMIN_ROLES];
export const STUDENT_ROLES: UserRole[] = ['student', 'candidate'];

export const normalizeRole = (role?: string | null): UserRole => {
  const r = String(role || 'student').trim();
  if (r === 'recruiter' || r === 'institutionAdmin') return 'admin';
  if (r === 'candidate') return 'student';
  if (r === 'superAdmin' || r === 'admin' || r === 'student') {
    return r as UserRole;
  }
  return 'student';
};

export const isSuperAdminRole = (role?: string | null) =>
  SUPER_ADMIN_ROLES.includes(normalizeRole(role));

export const isCollegeAdminRole = (role?: string | null) =>
  COLLEGE_ADMIN_ROLES.includes(normalizeRole(role));

/** @deprecated use isCollegeAdminRole */
export const isInstitutionAdminRole = isCollegeAdminRole;

export const isAnyAdminRole = (role?: string | null) =>
  isSuperAdminRole(role) || isCollegeAdminRole(role);

export const isSuperAdminUser = (user?: IUser | null) =>
  Boolean(user && isSuperAdminRole(user.role));

export const isCollegeAdminUser = (user?: IUser | null) =>
  Boolean(user && isCollegeAdminRole(user.role));

/** @deprecated use isCollegeAdminUser */
export const isInstitutionAdminUser = isCollegeAdminUser;

export const isAnyAdminUser = (user?: IUser | null) =>
  Boolean(user && isAnyAdminRole(user.role));

/** Roles allowed when creating/updating admin accounts. */
export const ASSIGNABLE_ROLES = ['student', 'superAdmin', 'admin'] as const;
