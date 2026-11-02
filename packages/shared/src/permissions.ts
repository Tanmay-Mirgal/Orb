import type { Role } from './constants';

export type Permission =
  | 'org:read'
  | 'org:update'
  | 'org:delete'
  | 'members:read'
  | 'members:manage'
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'deployment:create'
  | 'deployment:promote'
  | 'env:read'
  | 'env:write'
  | 'domain:manage'
  | 'audit:read'
  | 'token:manage';

const VIEWER: Permission[] = ['org:read', 'members:read', 'project:read'];
const MEMBER: Permission[] = [...VIEWER, 'project:create', 'project:update', 'deployment:create', 'env:read', 'env:write', 'token:manage'];
const ADMIN: Permission[] = [...MEMBER, 'project:delete', 'deployment:promote', 'domain:manage', 'members:manage', 'org:update', 'audit:read'];
const OWNER: Permission[] = [...ADMIN, 'org:delete'];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(VIEWER),
  member: new Set(MEMBER),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

export function can(role: Role | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role as Role]?.has(permission) ?? false;
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function roleRank(role: Role | string): number {
  return RANK[role as Role] ?? -1;
}

/** An actor may only grant or change roles strictly below their own (owners can grant owner). */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true;
  return roleRank(actor) > roleRank(target);
}
