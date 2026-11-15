import type {
  AccountStatus,
  AdminAuditLogEntry,
  CanonicalRole,
  EmailDeliveryInfo,
  InvitationRecord,
  PlatformUserRecord,
  RoleTemplateRecord,
  SectionPermissions,
  StoreInspectionReport,
  StoreSummaryRecord,
  SuperAdminOverviewData,
} from '../types/zenorati';
import { parseJsonOrThrow } from './authInviteClient';

export async function fetchSuperAdminOverview(idToken: string): Promise<SuperAdminOverviewData> {
  const res = await fetch('/api/admin/overview', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return parseJsonOrThrow<SuperAdminOverviewData>(res);
}

export async function fetchSuperAdminUsers(idToken: string): Promise<PlatformUserRecord[]> {
  const res = await fetch('/api/admin/users', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ users: PlatformUserRecord[] }>(res);
  return data.users ?? [];
}

export async function invitePlatformUser(
  idToken: string,
  payload: {
    email: string;
    fullName?: string;
    businessName?: string;
    role: CanonicalRole;
    tenantId?: string;
    permissions?: SectionPermissions;
    maxUses?: number;
    expiresAtIso?: string;
    label?: string;
  }
): Promise<{
  inviteCode: string;
  inviteUrl: string;
  invitation: InvitationRecord;
  emailDelivery: EmailDeliveryInfo;
}> {
  const res = await fetch('/api/admin/users/invite', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function updatePlatformUser(
  idToken: string,
  uid: string,
  patch: {
    fullName?: string;
    role?: CanonicalRole;
    tenantId?: string | null;
    businessName?: string;
    permissions?: SectionPermissions;
  }
): Promise<PlatformUserRecord> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  const data = await parseJsonOrThrow<{ user: PlatformUserRecord }>(res);
  return data.user;
}

export async function updatePlatformUserStatus(
  idToken: string,
  uid: string,
  accountStatus: AccountStatus
): Promise<PlatformUserRecord> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountStatus }),
  });
  const data = await parseJsonOrThrow<{ user: PlatformUserRecord }>(res);
  return data.user;
}

export async function deletePlatformUser(
  idToken: string,
  uid: string,
  confirmUid: string,
  confirmationText: string
): Promise<{ deletedUid: string }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmUid, confirmationText }),
  });
  return parseJsonOrThrow<{ deletedUid: string }>(res);
}

export async function fetchSuperAdminStores(idToken: string): Promise<StoreSummaryRecord[]> {
  const res = await fetch('/api/admin/stores', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ stores: StoreSummaryRecord[] }>(res);
  return data.stores ?? [];
}

export async function updateSuperAdminStoreStatus(
  idToken: string,
  tenantId: string,
  accountStatus: AccountStatus
): Promise<StoreSummaryRecord> {
  const res = await fetch(`/api/admin/stores/${encodeURIComponent(tenantId)}/status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountStatus }),
  });
  const data = await parseJsonOrThrow<{ store: StoreSummaryRecord }>(res);
  return data.store;
}

export async function inspectSuperAdminStore(
  idToken: string,
  tenantId: string
): Promise<StoreInspectionReport> {
  const res = await fetch(`/api/admin/stores/${encodeURIComponent(tenantId)}/inspect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ report: StoreInspectionReport }>(res);
  return data.report;
}

export async function fetchSuperAdminRoles(idToken: string): Promise<RoleTemplateRecord[]> {
  const res = await fetch('/api/admin/roles', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ roles: RoleTemplateRecord[] }>(res);
  return data.roles ?? [];
}

export async function updateSuperAdminRoleTemplate(
  idToken: string,
  roleId: CanonicalRole,
  payload: {
    label?: string;
    description?: string;
    permissions: SectionPermissions;
  }
): Promise<RoleTemplateRecord> {
  const res = await fetch(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonOrThrow<{ role: RoleTemplateRecord }>(res);
  return data.role;
}

export async function fetchSuperAdminAuditLogs(idToken: string): Promise<AdminAuditLogEntry[]> {
  const res = await fetch('/api/admin/audit-logs', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ logs: AdminAuditLogEntry[] }>(res);
  return data.logs ?? [];
}
