import type { User } from './db/queries/users';

export type Permission =
  | 'users.manage'
  | 'staff.private.read'
  | 'beds.manage'
  | 'patients.register'
  | 'admissions.manage'
  | 'clinical.doctor'
  | 'clinical.nurse';

const permissions: Record<User['job_role'], readonly Permission[]> = {
  duty_doctor: ['patients.register', 'admissions.manage', 'clinical.doctor'],
  consultant: ['patients.register', 'admissions.manage', 'clinical.doctor'],
  staff_nurse: ['clinical.nurse'],
  pharmacist: [],
  billing_insurance: [],
  bed_desk: ['beds.manage', 'patients.register', 'admissions.manage'],
  administrator: ['users.manage', 'staff.private.read', 'beds.manage', 'patients.register', 'admissions.manage', 'clinical.doctor', 'clinical.nurse'],
};

export function hasPermission(user: User, permission: Permission): boolean {
  return permissions[user.job_role].includes(permission);
}
