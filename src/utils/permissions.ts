import type {
  CanonicalRole,
  NavSection,
  PermissionAction,
  PermissionSection,
  SectionPermission,
  SectionPermissions,
  UserRole,
} from '../types/zenorati';

export const PERMISSION_SECTIONS: PermissionSection[] = [
  'products',
  'orders',
  'customers',
  'inventory',
  'finance',
  'marketing',
  'reports',
  'settings',
];

export const PERMISSION_ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'delete'];

export const CANONICAL_ROLES: CanonicalRole[] = [
  'super_admin',
  'store_owner',
  'manager',
  'staff',
  'viewer',
];

const FULL_ACCESS: SectionPermission = { view: true, create: true, edit: true, delete: true };
const EDITOR_ACCESS: SectionPermission = { view: true, create: true, edit: true, delete: false };
const VIEW_ONLY: SectionPermission = { view: true, create: false, edit: false, delete: false };
const NO_ACCESS: SectionPermission = { view: false, create: false, edit: false, delete: false };

export function normalizeCanonicalRole(
  role?: UserRole | string | null,
  context: 'admin_doc' | 'tenant' = 'tenant'
): CanonicalRole {
  if (role === 'super_admin') return 'super_admin';
  if (role === 'store_owner') return 'store_owner';
  if (role === 'manager') return 'manager';
  if (role === 'staff') return 'staff';
  if (role === 'viewer') return 'viewer';
  if (role === 'owner') return context === 'admin_doc' ? 'super_admin' : 'store_owner';
  if (role === 'admin') return 'super_admin';
  return 'store_owner';
}

export function getDefaultPermissionsForRole(role: CanonicalRole): SectionPermissions {
  switch (role) {
    case 'super_admin':
    case 'store_owner':
      return {
        products: { ...FULL_ACCESS },
        orders: { ...FULL_ACCESS },
        customers: { ...FULL_ACCESS },
        inventory: { ...FULL_ACCESS },
        finance: { ...FULL_ACCESS },
        marketing: { ...FULL_ACCESS },
        reports: { ...FULL_ACCESS },
        settings: { ...FULL_ACCESS },
      };
    case 'manager':
      return {
        products: { ...FULL_ACCESS },
        orders: { ...FULL_ACCESS },
        customers: { ...FULL_ACCESS },
        inventory: { ...FULL_ACCESS },
        finance: { ...EDITOR_ACCESS },
        marketing: { ...EDITOR_ACCESS },
        reports: { ...VIEW_ONLY },
        settings: { ...VIEW_ONLY },
      };
    case 'staff':
      return {
        products: { ...VIEW_ONLY },
        orders: { ...EDITOR_ACCESS },
        customers: { ...EDITOR_ACCESS },
        inventory: { ...EDITOR_ACCESS },
        finance: { ...NO_ACCESS },
        marketing: { ...NO_ACCESS },
        reports: { ...NO_ACCESS },
        settings: { ...NO_ACCESS },
      };
    case 'viewer':
      return {
        products: { ...VIEW_ONLY },
        orders: { ...VIEW_ONLY },
        customers: { ...VIEW_ONLY },
        inventory: { ...VIEW_ONLY },
        finance: { ...VIEW_ONLY },
        marketing: { ...VIEW_ONLY },
        reports: { ...VIEW_ONLY },
        settings: { ...NO_ACCESS },
      };
  }
}

export function sanitizePermissions(
  raw: unknown,
  fallbackRole: CanonicalRole
): SectionPermissions {
  const defaults = getDefaultPermissionsForRole(fallbackRole);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }
  const source = raw as Record<string, unknown>;
  const result = {} as SectionPermissions;

  for (const section of PERMISSION_SECTIONS) {
    const def = defaults[section];
    const secRaw = source[section];
    if (!secRaw || typeof secRaw !== 'object' || Array.isArray(secRaw)) {
      result[section] = { ...def };
      continue;
    }
    const r = secRaw as Record<string, unknown>;
    const view = typeof r.view === 'boolean' ? r.view : def.view;
    // Enforce invariant: create/edit/delete require view access
    result[section] = {
      view,
      create: view && (typeof r.create === 'boolean' ? r.create : def.create),
      edit: view && (typeof r.edit === 'boolean' ? r.edit : def.edit),
      delete: view && (typeof r.delete === 'boolean' ? r.delete : def.delete),
    };
  }

  return result;
}

export function hasSectionPermission(
  permissions: SectionPermissions | undefined,
  role: CanonicalRole | undefined,
  section: PermissionSection,
  action: PermissionAction
): boolean {
  if (role === 'super_admin' || role === 'store_owner') return true;
  if (!permissions) return false;
  return Boolean(permissions[section]?.[action]);
}

export function navSectionToPermissionSection(nav: NavSection): PermissionSection | null {
  switch (nav) {
    case 'products':
      return 'products';
    case 'orders':
      return 'orders';
    case 'customers':
      return 'customers';
    case 'inventory':
      return 'inventory';
    case 'finance':
      return 'finance';
    case 'marketing':
      return 'marketing';
    case 'reports':
    case 'assistant':
      return 'reports';
    case 'settings':
    case 'automations':
    case 'integrations':
      return 'settings';
    default:
      return null;
  }
}
