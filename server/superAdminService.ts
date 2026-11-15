import crypto from 'node:crypto';
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
  TenantProfile,
} from '../src/types/zenorati';
import {
  CANONICAL_ROLES,
  getDefaultPermissionsForRole,
  normalizeCanonicalRole,
  sanitizePermissions,
} from '../src/utils/permissions';
import {
  AuthInviteService,
  authInviteService,
  AuthServiceError,
  computeEffectiveInvitationStatus,
  FirebaseRestBackend,
  type FirestoreJsonValue,
  permissionsToFsMap,
  type TenantMemberRecord,
  type VerifiedFirebaseUser,
} from './authInviteService';

export interface SuperAdminStoreBackend {
  getUserDoc(uid: string, idToken: string): Promise<PlatformUserRecord | null>;
  listUsersDocs(idToken: string): Promise<PlatformUserRecord[]>;
  upsertUserDocByAdmin(
    params: {
      uid: string;
      email: string;
      fullName: string;
      photoUrl?: string;
      role: Exclude<CanonicalRole, 'super_admin'>;
      accountStatus: AccountStatus;
      tenantId: string | null;
      businessName?: string;
      permissions: SectionPermissions;
      createdByUid?: string;
      exists: boolean;
    },
    idToken: string
  ): Promise<PlatformUserRecord>;
  deleteUserDocByAdmin(uid: string, idToken: string): Promise<void>;
  listTenantDocs(idToken: string): Promise<Array<TenantProfile & { tenantId: string }>>;
  getTenantDoc(tenantId: string, idToken: string): Promise<(TenantProfile & { tenantId: string }) | null>;
  updateTenantStatusByAdmin(
    tenantId: string,
    accountStatus: AccountStatus,
    idToken: string
  ): Promise<TenantProfile & { tenantId: string }>;
  listTenantMembers(tenantId: string, idToken: string): Promise<TenantMemberRecord[]>;
  upsertTenantMemberByAdmin(
    params: {
      tenantId: string;
      uid: string;
      email: string;
      fullName: string;
      role: 'manager' | 'staff' | 'viewer';
      accountStatus: AccountStatus;
      permissions: SectionPermissions;
      invitedByUid: string;
    },
    idToken: string
  ): Promise<void>;
  deleteTenantMemberByAdmin(tenantId: string, memberUid: string, idToken: string): Promise<void>;
  countCollectionDocs(relCollectionPath: string, idToken: string): Promise<number>;
  markInvitationResent(inviteId: string, idToken: string): Promise<InvitationRecord>;
  listRoleTemplatesDocs(idToken: string): Promise<RoleTemplateRecord[]>;
  upsertRoleTemplateDoc(
    template: RoleTemplateRecord & { updatedByUid: string },
    idToken: string
  ): Promise<RoleTemplateRecord>;
  createAuditLogDoc(
    entry: Omit<AdminAuditLogEntry, 'createdAt'>,
    idToken: string
  ): Promise<AdminAuditLogEntry>;
  listAuditLogsDocs(idToken: string): Promise<AdminAuditLogEntry[]>;
}

const DEFAULT_ROLE_DESCRIPTIONS: Record<CanonicalRole, { label: string; description: string }> = {
  super_admin: {
    label: 'Super Admin',
    description: 'Platform-wide governance across users, stores, invitations, role templates, and audit logs.',
  },
  store_owner: {
    label: 'Store Owner',
    description: 'Full ownership and read/write/delete control over their assigned store workspace.',
  },
  manager: {
    label: 'Manager',
    description: 'Day-to-day store management across catalog, orders, customers, inventory, and marketing.',
  },
  staff: {
    label: 'Staff',
    description: 'Operational fulfillment role for orders, customers, and stock adjustments.',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only visibility across business modules without create, edit, or delete rights.',
  },
};

export class FirestoreSuperAdminBackend implements SuperAdminStoreBackend {
  private readonly rest: FirebaseRestBackend;

  constructor(rest?: FirebaseRestBackend) {
    this.rest = rest ?? new FirebaseRestBackend();
  }

  getUserDoc(uid: string, idToken: string): Promise<PlatformUserRecord | null> {
    return this.rest.getUserDoc(uid, idToken);
  }

  listUsersDocs(idToken: string): Promise<PlatformUserRecord[]> {
    return this.rest.listUsersDocs(idToken);
  }

  async upsertUserDocByAdmin(
    params: {
      uid: string;
      email: string;
      fullName: string;
      photoUrl?: string;
      role: Exclude<CanonicalRole, 'super_admin'>;
      accountStatus: AccountStatus;
      tenantId: string | null;
      businessName?: string;
      permissions: SectionPermissions;
      createdByUid?: string;
      exists: boolean;
    },
    idToken: string
  ): Promise<PlatformUserRecord> {
    const userPath = `${this.rest.docPrefix}/users/${params.uid}`;
    const fields: Record<string, FirestoreJsonValue> = {
      fullName: { stringValue: params.fullName.slice(0, 120) },
      role: { stringValue: params.role },
      accountStatus: { stringValue: params.accountStatus },
      tenantId: params.tenantId
        ? { stringValue: params.tenantId.slice(0, 128) }
        : { nullValue: null },
      businessName: { stringValue: (params.businessName ?? '').slice(0, 100) },
      permissions: permissionsToFsMap(params.permissions),
    };
    if (params.photoUrl !== undefined) {
      fields.photoUrl = { stringValue: params.photoUrl.slice(0, 500) };
    }

    const write = params.exists
      ? {
          currentDocument: { exists: true },
          updateMask: {
            fieldPaths: [
              'fullName',
              'role',
              'accountStatus',
              'tenantId',
              'businessName',
              'permissions',
              ...(params.photoUrl !== undefined ? ['photoUrl'] : []),
            ],
          },
          update: {
            name: userPath,
            fields,
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        }
      : {
          currentDocument: { exists: false },
          update: {
            name: userPath,
            fields: {
              uid: { stringValue: params.uid },
              email: { stringValue: params.email.toLowerCase().slice(0, 160) },
              ...fields,
              ...(params.createdByUid ? { createdByUid: { stringValue: params.createdByUid } } : {}),
            },
          },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        };

    const res = await fetch(`${this.rest.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes: [write] }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(
        res.status === 403 ? 403 : 502,
        res.status === 403 ? 'SUPER_ADMIN_REQUIRED' : 'FIRESTORE_ERROR',
        `Failed to update user profile: ${text}`
      );
    }

    const fresh = await this.rest.getUserDoc(params.uid, idToken);
    if (fresh) return fresh;
    return {
      uid: params.uid,
      email: params.email,
      fullName: params.fullName,
      role: params.role,
      accountStatus: params.accountStatus,
      tenantId: params.tenantId,
      businessName: params.businessName,
      permissions: params.permissions,
      updatedAt: new Date().toISOString(),
    };
  }

  async deleteUserDocByAdmin(uid: string, idToken: string): Promise<void> {
    const res = await fetch(`${this.rest.docsBase}/users/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 404) return;
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(
        res.status === 403 ? 403 : 502,
        res.status === 403 ? 'SUPER_ADMIN_REQUIRED' : 'FIRESTORE_ERROR',
        `Failed to delete user record: ${text}`
      );
    }
  }

  listTenantDocs(idToken: string): Promise<Array<TenantProfile & { tenantId: string }>> {
    return this.rest.listTenantDocs(idToken);
  }

  getTenantDoc(tenantId: string, idToken: string): Promise<(TenantProfile & { tenantId: string }) | null> {
    return this.rest.getTenantDoc(tenantId, idToken);
  }

  async updateTenantStatusByAdmin(
    tenantId: string,
    accountStatus: AccountStatus,
    idToken: string
  ): Promise<TenantProfile & { tenantId: string }> {
    const tenantPath = `${this.rest.docPrefix}/tenants/${tenantId}`;
    const res = await fetch(`${this.rest.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: true },
            updateMask: { fieldPaths: ['accountStatus'] },
            update: {
              name: tenantPath,
              fields: {
                accountStatus: { stringValue: accountStatus },
              },
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(
        res.status === 403 ? 403 : 502,
        res.status === 403 ? 'SUPER_ADMIN_REQUIRED' : 'FIRESTORE_ERROR',
        `Failed to update store status: ${text}`
      );
    }
    const fresh = await this.rest.getTenantDoc(tenantId, idToken);
    if (!fresh) {
      throw new AuthServiceError(404, 'TENANT_NOT_FOUND', 'Store tenant not found.');
    }
    return fresh;
  }

  listTenantMembers(tenantId: string, idToken: string): Promise<TenantMemberRecord[]> {
    return this.rest.listTenantMembers(tenantId, idToken);
  }

  async upsertTenantMemberByAdmin(
    params: {
      tenantId: string;
      uid: string;
      email: string;
      fullName: string;
      role: 'manager' | 'staff' | 'viewer';
      accountStatus: AccountStatus;
      permissions: SectionPermissions;
      invitedByUid: string;
    },
    idToken: string
  ): Promise<void> {
    const existing = await this.rest.getTenantMember(params.tenantId, params.uid, idToken);
    const memberPath = `${this.rest.docPrefix}/tenants/${params.tenantId}/members/${params.uid}`;

    const write = existing
      ? {
          currentDocument: { exists: true },
          updateMask: {
            fieldPaths: ['fullName', 'role', 'accountStatus', 'permissions'],
          },
          update: {
            name: memberPath,
            fields: {
              fullName: { stringValue: params.fullName.slice(0, 120) },
              role: { stringValue: params.role },
              accountStatus: { stringValue: params.accountStatus },
              permissions: permissionsToFsMap(params.permissions),
            },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        }
      : {
          currentDocument: { exists: false },
          update: {
            name: memberPath,
            fields: {
              uid: { stringValue: params.uid },
              tenantId: { stringValue: params.tenantId },
              email: { stringValue: params.email.toLowerCase().slice(0, 160) },
              fullName: { stringValue: params.fullName.slice(0, 120) },
              role: { stringValue: params.role },
              accountStatus: { stringValue: params.accountStatus },
              permissions: permissionsToFsMap(params.permissions),
              invitedByUid: { stringValue: params.invitedByUid },
            },
          },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        };

    const res = await fetch(`${this.rest.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes: [write] }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to sync store membership: ${text}`);
    }
  }

  async deleteTenantMemberByAdmin(
    tenantId: string,
    memberUid: string,
    idToken: string
  ): Promise<void> {
    const res = await fetch(
      `${this.rest.docsBase}/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(memberUid)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      }
    );
    if (res.status === 404) return;
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to delete store membership: ${text}`);
    }
  }

  countCollectionDocs(relCollectionPath: string, idToken: string): Promise<number> {
    return this.rest.countCollectionDocs(relCollectionPath, idToken);
  }

  markInvitationResent(inviteId: string, idToken: string): Promise<InvitationRecord> {
    return this.rest.markInvitationResent(inviteId, idToken);
  }

  listRoleTemplatesDocs(idToken: string): Promise<RoleTemplateRecord[]> {
    return this.rest.listRoleTemplatesDocs(idToken);
  }

  upsertRoleTemplateDoc(
    template: RoleTemplateRecord & { updatedByUid: string },
    idToken: string
  ): Promise<RoleTemplateRecord> {
    return this.rest.upsertRoleTemplateDoc(template, idToken);
  }

  createAuditLogDoc(
    entry: Omit<AdminAuditLogEntry, 'createdAt'>,
    idToken: string
  ): Promise<AdminAuditLogEntry> {
    return this.rest.createAuditLogDoc(entry, idToken);
  }

  listAuditLogsDocs(idToken: string): Promise<AdminAuditLogEntry[]> {
    return this.rest.listAuditLogsDocs(idToken);
  }
}

export class SuperAdminService {
  private readonly authService: AuthInviteService;
  private readonly backend: SuperAdminStoreBackend;

  constructor(options?: {
    authService?: AuthInviteService;
    backend?: SuperAdminStoreBackend;
  }) {
    this.authService = options?.authService ?? authInviteService;
    this.backend = options?.backend ?? new FirestoreSuperAdminBackend();
  }

  private async logAudit(
    actor: VerifiedFirebaseUser,
    idToken: string,
    payload: {
      action: string;
      targetType: AdminAuditLogEntry['targetType'];
      targetId: string;
      targetLabel: string;
      details: string;
    }
  ): Promise<AdminAuditLogEntry> {
    const id = `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    return this.backend.createAuditLogDoc(
      {
        id,
        actorUid: actor.uid,
        actorEmail: actor.email || actor.uid,
        action: payload.action,
        targetType: payload.targetType,
        targetId: payload.targetId,
        targetLabel: payload.targetLabel,
        details: payload.details,
      },
      idToken
    );
  }

  private mergeUsersAndTenants(
    users: PlatformUserRecord[],
    tenants: Array<TenantProfile & { tenantId: string }>
  ): PlatformUserRecord[] {
    const byUid = new Map<string, PlatformUserRecord>();
    const tenantNames = new Map<string, string>();
    for (const t of tenants) {
      tenantNames.set(t.tenantId, t.businessName);
    }

    for (const u of users) {
      byUid.set(u.uid, {
        ...u,
        businessName: u.businessName || (u.tenantId ? tenantNames.get(u.tenantId) : undefined),
        source: 'users_collection',
      });
    }

    for (const t of tenants) {
      const uid = t.ownerId || t.tenantId;
      if (!byUid.has(uid)) {
        const mappedRole = normalizeCanonicalRole(t.role, 'tenant');
        byUid.set(uid, {
          uid,
          email: t.ownerEmail,
          fullName: t.fullName || t.businessName,
          ...(t.photoUrl ? { photoUrl: t.photoUrl } : {}),
          role: mappedRole === 'super_admin' ? 'store_owner' : mappedRole,
          accountStatus: t.accountStatus === 'suspended' ? 'suspended' : 'active',
          tenantId: t.tenantId,
          businessName: t.businessName,
          permissions: getDefaultPermissionsForRole(
            mappedRole === 'super_admin' ? 'store_owner' : mappedRole
          ),
          ...(t.invitationId ? { invitationId: t.invitationId } : {}),
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          source: 'legacy_tenant',
        });
      }
    }

    return Array.from(byUid.values()).sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    );
  }

  private async deliverInviteEmail(params: {
    toEmail: string;
    inviteCode?: string;
    inviteUrl: string;
    fullName?: string;
    businessName?: string;
    role: CanonicalRole;
  }): Promise<EmailDeliveryInfo> {
    const cleanEmail = params.toEmail.trim().toLowerCase();
    const subject = encodeURIComponent('Your ZENORATI Platform Invitation');
    const bodyLines = [
      `Hello${params.fullName ? ` ${params.fullName}` : ''},`,
      '',
      `You have been invited to join ZENORATI (${params.role.replace('_', ' ')}).`,
      params.businessName ? `Store Workspace: ${params.businessName}` : '',
      params.inviteCode ? `Invitation Code: ${params.inviteCode}` : '',
      `Sign Up / Activation Link: ${params.inviteUrl}`,
      '',
      'Please verify your email address when activating your account.',
    ].filter(Boolean);
    const mailtoUrl = `mailto:${encodeURIComponent(cleanEmail)}?subject=${subject}&body=${encodeURIComponent(
      bodyLines.join('\n')
    )}`;

    const resendKey = process.env.RESEND_API_KEY?.trim();
    const fromAddr = process.env.RESEND_FROM_EMAIL?.trim() || 'ZENORATI <onboarding@resend.dev>';
    if (!resendKey) {
      return {
        sent: false,
        provider: 'manual_link',
        message:
          'Automated outbound SMTP/Resend email is not configured on this server. Share the secure invitation link or open your email client below.',
        mailtoUrl,
      };
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [cleanEmail],
          subject: 'Your ZENORATI Platform Invitation',
          text: bodyLines.join('\n'),
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return {
          sent: false,
          provider: 'manual_link',
          message: `Email provider returned an error (${errText}). Share the manual invite link below.`,
          mailtoUrl,
        };
      }
      return {
        sent: true,
        provider: 'resend',
        message: `Invitation email sent to ${cleanEmail}.`,
        mailtoUrl,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Email delivery error';
      return {
        sent: false,
        provider: 'manual_link',
        message: `Could not reach email service (${msg}). Share the manual invite link below.`,
        mailtoUrl,
      };
    }
  }

  async getOverview(idToken: string): Promise<SuperAdminOverviewData> {
    await this.authService.requireSuperAdmin(idToken);
    const [usersDocs, tenantDocs, invitations, auditLogs] = await Promise.all([
      this.backend.listUsersDocs(idToken),
      this.backend.listTenantDocs(idToken),
      this.authService.listInvitations(idToken),
      this.backend.listAuditLogsDocs(idToken),
    ]);

    const mergedUsers = this.mergeUsersAndTenants(usersDocs, tenantDocs);
    const activeAccounts = mergedUsers.filter((u) => u.accountStatus === 'active').length;
    const suspendedAccounts = mergedUsers.filter((u) => u.accountStatus === 'suspended').length;
    const pendingInvitations = invitations.filter((inv) => inv.status === 'active').length;

    return {
      totalUsers: mergedUsers.length,
      totalStores: tenantDocs.length,
      activeAccounts,
      suspendedAccounts,
      pendingInvitations,
      recentAuditLogs: auditLogs.slice(0, 12),
      recentUsers: mergedUsers.slice(0, 8),
    };
  }

  async listUsers(idToken: string): Promise<PlatformUserRecord[]> {
    await this.authService.requireSuperAdmin(idToken);
    const [usersDocs, tenantDocs] = await Promise.all([
      this.backend.listUsersDocs(idToken),
      this.backend.listTenantDocs(idToken),
    ]);
    return this.mergeUsersAndTenants(usersDocs, tenantDocs);
  }

  async inviteUser(
    idToken: string,
    params: {
      email: string;
      fullName?: string;
      businessName?: string;
      role: CanonicalRole;
      tenantId?: string;
      permissions?: SectionPermissions;
      maxUses?: number;
      expiresAtIso?: string;
      label?: string;
      appOrigin?: string;
    }
  ): Promise<{
    inviteCode: string;
    inviteUrl: string;
    invitation: InvitationRecord;
    emailDelivery: EmailDeliveryInfo;
  }> {
    const actor = await this.authService.requireSuperAdmin(idToken);

    const email = (params.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@') || email.length > 160) {
      throw new AuthServiceError(400, 'INVALID_EMAIL', 'A valid recipient email address is required.');
    }

    if (params.role === 'super_admin') {
      throw new AuthServiceError(
        400,
        'ROLE_FORBIDDEN',
        'Super Admin role cannot be assigned through invitations.'
      );
    }

    const role: Exclude<CanonicalRole, 'super_admin'> = ['store_owner', 'manager', 'staff', 'viewer'].includes(
      params.role
    )
      ? (params.role as Exclude<CanonicalRole, 'super_admin'>)
      : 'store_owner';

    const targetTenantId = params.tenantId?.trim() || undefined;
    if (role !== 'store_owner') {
      if (!targetTenantId) {
        throw new AuthServiceError(
          400,
          'TENANT_REQUIRED',
          'Managers, staff, and viewers must be assigned to an existing store.'
        );
      }
      const store = await this.backend.getTenantDoc(targetTenantId, idToken);
      if (!store) {
        throw new AuthServiceError(404, 'TENANT_NOT_FOUND', 'Selected store workspace was not found.');
      }
    }

    const resolvedPermissions = params.permissions
      ? sanitizePermissions(params.permissions, role)
      : getDefaultPermissionsForRole(role);

    const expiresAtIso =
      params.expiresAtIso && params.expiresAtIso.trim()
        ? params.expiresAtIso
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const created = await this.authService.createInvitation({
      idToken,
      maxUses: params.maxUses ?? 1,
      expiresAtIso,
      label: params.label?.trim() || `${email} (${role})`,
      targetEmail: email,
      targetFullName: params.fullName?.trim(),
      targetBusinessName: params.businessName?.trim(),
      targetRole: role,
      targetTenantId,
      targetPermissions: resolvedPermissions,
    });

    const origin = (params.appOrigin || process.env.APP_URL || '').replace(/\/$/, '');
    const inviteUrl = `${origin}/?invite=${encodeURIComponent(created.inviteCode)}`;

    const emailDelivery = await this.deliverInviteEmail({
      toEmail: email,
      inviteCode: created.inviteCode,
      inviteUrl,
      fullName: params.fullName,
      businessName: params.businessName,
      role,
    });

    await this.logAudit(actor, idToken, {
      action: 'invitation.create',
      targetType: 'invitation',
      targetId: created.invitation.id,
      targetLabel: email,
      details: `Issued ${role} invite (${created.invitation.codePreview})${targetTenantId ? ` for store ${targetTenantId}` : ''}`,
    });

    return {
      inviteCode: created.inviteCode,
      inviteUrl,
      invitation: created.invitation,
      emailDelivery,
    };
  }

  async resendInvitation(
    idToken: string,
    inviteId: string,
    appOrigin?: string
  ): Promise<{ invitation: InvitationRecord; emailDelivery: EmailDeliveryInfo }> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    if (!/^[a-f0-9]{64}$/.test(inviteId)) {
      throw new AuthServiceError(400, 'INVALID_INVITE_ID', 'Invalid invitation ID format.');
    }

    const existing = await this.authService.backend.getInvitation(inviteId, idToken);
    if (!existing) {
      throw new AuthServiceError(404, 'INVITE_NOT_FOUND', 'Invitation not found.');
    }
    if (computeEffectiveInvitationStatus(existing.doc) !== 'active') {
      throw new AuthServiceError(409, 'INVITE_NOT_ACTIVE', 'Only active invitations can be resent.');
    }

    const updated = await this.backend.markInvitationResent(inviteId, idToken);
    this.authService.updateCachedInvitation(updated);

    const origin = (appOrigin || process.env.APP_URL || '').replace(/\/$/, '');
    const inviteUrl = `${origin}/`;
    const recipient = updated.targetEmail || '';

    const emailDelivery = recipient
      ? await this.deliverInviteEmail({
          toEmail: recipient,
          inviteUrl,
          fullName: updated.targetFullName,
          businessName: updated.targetBusinessName,
          role: updated.targetRole ?? 'store_owner',
        })
      : {
          sent: false,
          provider: 'manual_link' as const,
          message:
            'This invitation has no bound recipient email. Share the portal URL and original invitation code manually.',
        };

    await this.logAudit(actor, idToken, {
      action: 'invitation.resend',
      targetType: 'invitation',
      targetId: inviteId,
      targetLabel: recipient || updated.codePreview,
      details: `Resent invitation reminder (resend #${updated.resendCount ?? 1})`,
    });

    return { invitation: updated, emailDelivery };
  }

  async updateUser(
    idToken: string,
    targetUid: string,
    patch: {
      fullName?: string;
      role?: CanonicalRole;
      tenantId?: string | null;
      businessName?: string;
      permissions?: SectionPermissions;
    }
  ): Promise<PlatformUserRecord> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    if (!targetUid || targetUid === actor.uid) {
      throw new AuthServiceError(
        400,
        'SELF_MODIFICATION_FORBIDDEN',
        'Super Admin cannot modify their own privileges or role via User Management.'
      );
    }

    if (patch.role === 'super_admin') {
      throw new AuthServiceError(
        400,
        'ROLE_FORBIDDEN',
        'Super Admin privileges cannot be granted from the web application. Provision /admins/{uid} via Firebase Console.'
      );
    }

    const [existingUser, existingTenant] = await Promise.all([
      this.backend.getUserDoc(targetUid, idToken),
      this.backend.getTenantDoc(targetUid, idToken),
    ]);

    if (!existingUser && !existingTenant) {
      throw new AuthServiceError(404, 'USER_NOT_FOUND', 'User profile not found.');
    }

    const prevRole = existingUser?.role ?? 'store_owner';
    const nextRole: Exclude<CanonicalRole, 'super_admin'> =
      patch.role && ['store_owner', 'manager', 'staff', 'viewer'].includes(patch.role)
        ? (patch.role as Exclude<CanonicalRole, 'super_admin'>)
        : prevRole === 'super_admin'
        ? 'store_owner'
        : (prevRole as Exclude<CanonicalRole, 'super_admin'>);

    const prevTenantId = existingUser?.tenantId ?? existingTenant?.tenantId ?? null;
    const nextTenantId =
      patch.tenantId !== undefined
        ? patch.tenantId
          ? patch.tenantId.trim()
          : null
        : nextRole === 'store_owner' && existingTenant
        ? targetUid
        : prevTenantId;

    if (nextTenantId && nextTenantId !== targetUid) {
      const targetStore = await this.backend.getTenantDoc(nextTenantId, idToken);
      if (!targetStore) {
        throw new AuthServiceError(404, 'TENANT_NOT_FOUND', 'Assigned store workspace does not exist.');
      }
    }

    const nextFullName = (
      patch.fullName ??
      existingUser?.fullName ??
      existingTenant?.fullName ??
      existingTenant?.businessName ??
      'User'
    )
      .trim()
      .slice(0, 120);
    const nextBusinessName = (
      patch.businessName ??
      existingUser?.businessName ??
      existingTenant?.businessName ??
      ''
    )
      .trim()
      .slice(0, 100);
    const nextPermissions = patch.permissions
      ? sanitizePermissions(patch.permissions, nextRole)
      : patch.role && patch.role !== prevRole
      ? getDefaultPermissionsForRole(nextRole)
      : sanitizePermissions(existingUser?.permissions, nextRole);
    const email = existingUser?.email || existingTenant?.ownerEmail || '';
    const accountStatus = existingUser?.accountStatus ?? existingTenant?.accountStatus ?? 'active';

    const updated = await this.backend.upsertUserDocByAdmin(
      {
        uid: targetUid,
        email,
        fullName: nextFullName,
        photoUrl: existingUser?.photoUrl ?? existingTenant?.photoUrl,
        role: nextRole,
        accountStatus,
        tenantId: nextTenantId,
        businessName: nextBusinessName,
        permissions: nextPermissions,
        createdByUid: actor.uid,
        exists: Boolean(existingUser),
      },
      idToken
    );

    // Maintain tenant member access record for non-owner roles assigned to another store
    if (prevTenantId && prevTenantId !== targetUid && (prevTenantId !== nextTenantId || nextRole === 'store_owner')) {
      await this.backend.deleteTenantMemberByAdmin(prevTenantId, targetUid, idToken);
    }
    if (nextTenantId && nextTenantId !== targetUid && (nextRole === 'manager' || nextRole === 'staff' || nextRole === 'viewer')) {
      await this.backend.upsertTenantMemberByAdmin(
        {
          tenantId: nextTenantId,
          uid: targetUid,
          email,
          fullName: nextFullName,
          role: nextRole,
          accountStatus,
          permissions: nextPermissions,
          invitedByUid: actor.uid,
        },
        idToken
      );
    }

    await this.logAudit(actor, idToken, {
      action: 'user.update',
      targetType: 'user',
      targetId: targetUid,
      targetLabel: email || nextFullName,
      details: `Updated role=${nextRole}, tenantId=${nextTenantId ?? 'none'}`,
    });

    return updated;
  }

  async updateUserStatus(
    idToken: string,
    targetUid: string,
    accountStatus: AccountStatus
  ): Promise<PlatformUserRecord> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    if (!targetUid || targetUid === actor.uid) {
      throw new AuthServiceError(
        400,
        'SELF_SUSPEND_FORBIDDEN',
        'Super Admin cannot suspend their own account.'
      );
    }

    const [existingUser, existingTenant] = await Promise.all([
      this.backend.getUserDoc(targetUid, idToken),
      this.backend.getTenantDoc(targetUid, idToken),
    ]);
    if (!existingUser && !existingTenant) {
      throw new AuthServiceError(404, 'USER_NOT_FOUND', 'User profile not found.');
    }

    const role =
      existingUser?.role && existingUser.role !== 'super_admin'
        ? (existingUser.role as Exclude<CanonicalRole, 'super_admin'>)
        : 'store_owner';
    const email = existingUser?.email || existingTenant?.ownerEmail || '';
    const fullName =
      existingUser?.fullName || existingTenant?.fullName || existingTenant?.businessName || 'User';
    const tenantId = existingUser?.tenantId ?? existingTenant?.tenantId ?? null;
    const permissions = sanitizePermissions(existingUser?.permissions, role);

    const updated = await this.backend.upsertUserDocByAdmin(
      {
        uid: targetUid,
        email,
        fullName,
        role,
        accountStatus,
        tenantId,
        businessName: existingUser?.businessName ?? existingTenant?.businessName,
        permissions,
        createdByUid: actor.uid,
        exists: Boolean(existingUser),
      },
      idToken
    );

    if (tenantId && tenantId !== targetUid && (role === 'manager' || role === 'staff' || role === 'viewer')) {
      await this.backend.upsertTenantMemberByAdmin(
        {
          tenantId,
          uid: targetUid,
          email,
          fullName,
          role,
          accountStatus,
          permissions,
          invitedByUid: actor.uid,
        },
        idToken
      );
    }

    await this.logAudit(actor, idToken, {
      action: accountStatus === 'suspended' ? 'user.suspend' : 'user.activate',
      targetType: 'user',
      targetId: targetUid,
      targetLabel: email || fullName,
      details: `Account status changed to ${accountStatus}`,
    });

    return updated;
  }

  async deleteUserAccount(
    idToken: string,
    targetUid: string,
    confirmUid: string,
    confirmationText: string
  ): Promise<{ deletedUid: string }> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    if (!targetUid || targetUid === actor.uid) {
      throw new AuthServiceError(
        400,
        'SELF_DELETE_FORBIDDEN',
        'Super Admin cannot delete their own account.'
      );
    }
    if (confirmUid !== targetUid || confirmationText.trim() !== 'DELETE') {
      throw new AuthServiceError(
        400,
        'DELETE_CONFIRMATION_REQUIRED',
        'Type DELETE and confirm the target UID to permanently remove this user access record.'
      );
    }

    const existingUser = await this.backend.getUserDoc(targetUid, idToken);
    if (!existingUser) {
      throw new AuthServiceError(404, 'USER_NOT_FOUND', 'User access record not found in /users.');
    }

    await this.logAudit(actor, idToken, {
      action: 'user.delete',
      targetType: 'user',
      targetId: targetUid,
      targetLabel: existingUser.email || existingUser.fullName,
      details: `Deleted /users/${targetUid} access record (store business records preserved intact)`,
    });

    if (existingUser.tenantId && existingUser.tenantId !== targetUid) {
      await this.backend.deleteTenantMemberByAdmin(existingUser.tenantId, targetUid, idToken);
    }
    await this.backend.deleteUserDocByAdmin(targetUid, idToken);

    return { deletedUid: targetUid };
  }

  async listStores(idToken: string): Promise<StoreSummaryRecord[]> {
    await this.authService.requireSuperAdmin(idToken);
    const tenants = await this.backend.listTenantDocs(idToken);

    const summaries = await Promise.all(
      tenants.map(async (t): Promise<StoreSummaryRecord> => {
        const members = await this.backend.listTenantMembers(t.tenantId, idToken);
        return {
          tenantId: t.tenantId,
          ownerId: t.ownerId,
          ownerEmail: t.ownerEmail,
          businessName: t.businessName,
          currency: t.currency,
          accountStatus: t.accountStatus === 'suspended' ? 'suspended' : 'active',
          memberCount: members.length,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        };
      })
    );

    return summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  async updateStoreStatus(
    idToken: string,
    tenantId: string,
    accountStatus: AccountStatus
  ): Promise<StoreSummaryRecord> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    if (tenantId === actor.uid && accountStatus === 'suspended') {
      throw new AuthServiceError(
        400,
        'SELF_SUSPEND_FORBIDDEN',
        'Cannot suspend your own primary workspace while signed in as Super Admin.'
      );
    }

    const updated = await this.backend.updateTenantStatusByAdmin(tenantId, accountStatus, idToken);
    const members = await this.backend.listTenantMembers(tenantId, idToken);

    await this.logAudit(actor, idToken, {
      action: accountStatus === 'suspended' ? 'tenant.suspend' : 'tenant.activate',
      targetType: 'tenant',
      targetId: tenantId,
      targetLabel: updated.businessName,
      details: `Store status set to ${accountStatus}`,
    });

    return {
      tenantId: updated.tenantId,
      ownerId: updated.ownerId,
      ownerEmail: updated.ownerEmail,
      businessName: updated.businessName,
      currency: updated.currency,
      accountStatus: updated.accountStatus === 'suspended' ? 'suspended' : 'active',
      memberCount: members.length,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async inspectStore(idToken: string, tenantId: string): Promise<StoreInspectionReport> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    const tenant = await this.backend.getTenantDoc(tenantId, idToken);
    if (!tenant) {
      throw new AuthServiceError(404, 'TENANT_NOT_FOUND', 'Store workspace not found.');
    }

    // Mandatory audit log BEFORE inspecting or returning store record counts/details
    const audit = await this.logAudit(actor, idToken, {
      action: 'tenant.inspect',
      targetType: 'tenant',
      targetId: tenantId,
      targetLabel: tenant.businessName,
      details: `Super Admin audited inspection of store ${tenant.businessName} (${tenant.ownerEmail})`,
    });

    const [products, orders, customers, expenses, members] = await Promise.all([
      this.backend.countCollectionDocs(`tenants/${encodeURIComponent(tenantId)}/products`, idToken),
      this.backend.countCollectionDocs(`tenants/${encodeURIComponent(tenantId)}/orders`, idToken),
      this.backend.countCollectionDocs(`tenants/${encodeURIComponent(tenantId)}/customers`, idToken),
      this.backend.countCollectionDocs(`tenants/${encodeURIComponent(tenantId)}/expenses`, idToken),
      this.backend.countCollectionDocs(`tenants/${encodeURIComponent(tenantId)}/members`, idToken),
    ]);

    return {
      tenantId,
      profile: tenant,
      counts: {
        products,
        orders,
        customers,
        expenses,
        members,
      },
      auditLogId: audit.id,
      inspectedAt: audit.createdAt,
    };
  }

  async listRoleTemplates(idToken: string): Promise<RoleTemplateRecord[]> {
    await this.authService.requireSuperAdmin(idToken);
    const saved = await this.backend.listRoleTemplatesDocs(idToken);
    const byRole = new Map(saved.map((item) => [item.role, item]));

    return CANONICAL_ROLES.map((role): RoleTemplateRecord => {
      const existing = byRole.get(role);
      const defaults = DEFAULT_ROLE_DESCRIPTIONS[role];
      if (existing) {
        return existing;
      }
      return {
        role,
        label: defaults.label,
        description: defaults.description,
        permissions: getDefaultPermissionsForRole(role),
      };
    });
  }

  async updateRoleTemplate(
    idToken: string,
    role: CanonicalRole,
    payload: {
      label?: string;
      description?: string;
      permissions: SectionPermissions;
    }
  ): Promise<RoleTemplateRecord> {
    const actor = await this.authService.requireSuperAdmin(idToken);
    if (!CANONICAL_ROLES.includes(role)) {
      throw new AuthServiceError(400, 'INVALID_ROLE', 'Unsupported role identifier.');
    }
    if (role === 'super_admin') {
      throw new AuthServiceError(
        400,
        'SUPER_ADMIN_IMMUTABLE',
        'Super Admin permission matrix is locked to full platform authority.'
      );
    }

    const defaults = DEFAULT_ROLE_DESCRIPTIONS[role];
    const cleanPermissions = sanitizePermissions(payload.permissions, role);
    const saved = await this.backend.upsertRoleTemplateDoc(
      {
        role,
        label: (payload.label ?? defaults.label).trim().slice(0, 80) || defaults.label,
        description: (payload.description ?? defaults.description).trim().slice(0, 240),
        permissions: cleanPermissions,
        updatedByUid: actor.uid,
      },
      idToken
    );

    await this.logAudit(actor, idToken, {
      action: 'role_template.update',
      targetType: 'role_template',
      targetId: role,
      targetLabel: saved.label,
      details: `Updated default permissions template for ${role}`,
    });

    return saved;
  }

  async listAuditLogs(idToken: string): Promise<AdminAuditLogEntry[]> {
    await this.authService.requireSuperAdmin(idToken);
    return this.backend.listAuditLogsDocs(idToken);
  }
}

export const superAdminService = new SuperAdminService();
