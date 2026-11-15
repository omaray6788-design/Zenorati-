import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountStatus,
  AdminAuditLogEntry,
  AuthSessionInfo,
  CanonicalRole,
  CurrencyCode,
  InvitationRecord,
  InvitationRedemption,
  InvitationStatus,
  PlatformUserRecord,
  RoleTemplateRecord,
  SectionPermissions,
  SuperAdminDiagnostic,
  TenantProfile,
  UserRole,
} from '../src/types/zenorati';
import {
  getDefaultPermissionsForRole,
  normalizeCanonicalRole,
  PERMISSION_SECTIONS,
  sanitizePermissions,
} from '../src/utils/permissions';

export interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), 'firebase-applet-config.json');
const INVITE_CACHE_PATH = path.resolve(process.cwd(), '.zenorati-invites.json');
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 unambiguous chars (5 bits each)

export function loadFirebaseConfig(): FirebaseAppletConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
  if (!parsed.projectId || !parsed.apiKey || !parsed.firestoreDatabaseId) {
    throw new Error('firebase-applet-config.json is missing required Firebase fields.');
  }
  return {
    projectId: parsed.projectId,
    apiKey: parsed.apiKey,
    firestoreDatabaseId: parsed.firestoreDatabaseId,
  };
}

export function normalizeInvitationCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatInvitationCode(normalized: string): string {
  if (normalized.startsWith('ZENO') && normalized.length === 20) {
    const body = normalized.slice(4);
    return `ZENO-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
  }
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export function isValidInvitationCodeFormat(raw: string): boolean {
  const norm = normalizeInvitationCode(raw);
  return norm.length >= 12 && norm.length <= 32 && /^[A-Z0-9]+$/.test(norm);
}

export function hashInvitationCode(raw: string): string {
  const norm = normalizeInvitationCode(raw);
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

export function generateRandomInvitationCode(): string {
  const bytes = crypto.randomBytes(16);
  let body = '';
  for (let i = 0; i < 16; i += 1) {
    body += CODE_ALPHABET[bytes[i] & 31];
  }
  return `ZENO-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

export function buildCodePreview(code: string): string {
  const norm = normalizeInvitationCode(code);
  const tail = norm.slice(-4);
  const prefix = norm.startsWith('ZENO') ? 'ZENO' : norm.slice(0, 4);
  return `${prefix}-••••-••••-${tail}`;
}

export function computeEffectiveInvitationStatus(
  record: Pick<InvitationRecord, 'status' | 'usedCount' | 'maxUses' | 'expiresAt'>,
  nowMs = Date.now()
): InvitationStatus {
  if (record.status === 'revoked') return 'revoked';
  if (record.usedCount >= record.maxUses || record.status === 'used') return 'used';
  const expMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expMs) || expMs <= nowMs) return 'expired';
  return 'active';
}

export class AttemptRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(maxAttempts = 6, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    const cutoff = nowMs - this.windowMs;
    const prev = (this.buckets.get(key) ?? []).filter((ts) => ts > cutoff);
    if (prev.length === 0) {
      this.buckets.delete(key);
    } else {
      this.buckets.set(key, prev);
    }

    if (prev.length >= this.maxAttempts) {
      const oldest = prev[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, this.maxAttempts - prev.length),
    };
  }

  recordFailure(key: string, nowMs = Date.now()): void {
    const cutoff = nowMs - this.windowMs;
    const prev = (this.buckets.get(key) ?? []).filter((ts) => ts > cutoff);
    prev.push(nowMs);
    this.buckets.set(key, prev);
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoUrl: string;
  createdAt: string | null;
  providerIds: string[];
}

export interface TenantMemberRecord {
  uid: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: 'manager' | 'staff' | 'viewer';
  accountStatus: AccountStatus;
  permissions: SectionPermissions;
  invitedByUid?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InviteStoreBackend {
  verifyIdToken(idToken: string): Promise<VerifiedFirebaseUser>;
  getAdminDoc(uid: string, idToken: string): Promise<{ uid: string; role: UserRole } | null>;
  getUserDoc(uid: string, idToken: string): Promise<PlatformUserRecord | null>;
  getTenantMember(
    tenantId: string,
    memberUid: string,
    idToken: string
  ): Promise<TenantMemberRecord | null>;
  tenantExists(uid: string, idToken: string): Promise<boolean>;
  getInvitation(inviteId: string, idToken: string): Promise<{ doc: InvitationRecord; updateTime?: string } | null>;
  listInvitations(idToken: string): Promise<InvitationRecord[]>;
  listRedemptions(inviteId: string, idToken: string): Promise<InvitationRedemption[]>;
  createInvitationDoc(record: InvitationRecord, idToken: string): Promise<InvitationRecord>;
  revokeInvitationDoc(inviteId: string, idToken: string): Promise<InvitationRecord>;
  commitRedemptionAndTenant(params: {
    invite: InvitationRecord;
    inviteUpdateTime?: string;
    user: VerifiedFirebaseUser;
    fullName: string;
    businessName: string;
    idToken: string;
  }): Promise<{ invitation: InvitationRecord; redemption: InvitationRedemption }>;
}

export type FirestoreJsonValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { mapValue: { fields?: Record<string, FirestoreJsonValue> } }
  | { arrayValue: { values?: FirestoreJsonValue[] } };

export interface FirestoreRestDoc {
  name?: string;
  fields?: Record<string, FirestoreJsonValue>;
  createTime?: string;
  updateTime?: string;
}

export function fromFsVal(val: FirestoreJsonValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number.parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields ?? {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFsVal(v);
    }
    return out;
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values ?? []).map((v) => fromFsVal(v));
  }
  return undefined;
}

export function permissionsToFsMap(perms: SectionPermissions): FirestoreJsonValue {
  const fields: Record<string, FirestoreJsonValue> = {};
  for (const section of PERMISSION_SECTIONS) {
    const entry = perms[section];
    fields[section] = {
      mapValue: {
        fields: {
          view: { booleanValue: Boolean(entry?.view) },
          create: { booleanValue: Boolean(entry?.create) },
          edit: { booleanValue: Boolean(entry?.edit) },
          delete: { booleanValue: Boolean(entry?.delete) },
        },
      },
    };
  }
  return { mapValue: { fields } };
}

function docToInvitation(doc: FirestoreRestDoc): InvitationRecord {
  const f = doc.fields ?? {};
  const idFromName = doc.name?.split('/').pop() ?? '';
  const id = String(fromFsVal(f.id) ?? idFromName);
  const targetRoleRaw = fromFsVal(f.targetRole);
  const targetRole: CanonicalRole | undefined =
    typeof targetRoleRaw === 'string' &&
    ['store_owner', 'manager', 'staff', 'viewer'].includes(targetRoleRaw)
      ? (targetRoleRaw as CanonicalRole)
      : undefined;
  const targetPermissionsRaw = fromFsVal(f.targetPermissions);
  const targetPermissions = targetPermissionsRaw
    ? sanitizePermissions(targetPermissionsRaw, targetRole ?? 'store_owner')
    : undefined;

  return {
    id,
    codeHash: String(fromFsVal(f.codeHash) ?? id),
    codePreview: String(fromFsVal(f.codePreview) ?? ''),
    label: String(fromFsVal(f.label) ?? ''),
    createdByUid: String(fromFsVal(f.createdByUid) ?? ''),
    status: String(fromFsVal(f.status) ?? 'active') as InvitationStatus,
    maxUses: Number(fromFsVal(f.maxUses) ?? 1),
    usedCount: Number(fromFsVal(f.usedCount) ?? 0),
    expiresAt: String(fromFsVal(f.expiresAt) ?? ''),
    createdAt: String(fromFsVal(f.createdAt) ?? doc.createTime ?? ''),
    updatedAt: String(fromFsVal(f.updatedAt) ?? doc.updateTime ?? ''),
    ...(fromFsVal(f.revokedAt) ? { revokedAt: String(fromFsVal(f.revokedAt)) } : {}),
    ...(fromFsVal(f.targetEmail) ? { targetEmail: String(fromFsVal(f.targetEmail)) } : {}),
    ...(fromFsVal(f.targetFullName) ? { targetFullName: String(fromFsVal(f.targetFullName)) } : {}),
    ...(fromFsVal(f.targetBusinessName)
      ? { targetBusinessName: String(fromFsVal(f.targetBusinessName)) }
      : {}),
    ...(targetRole ? { targetRole } : {}),
    ...(fromFsVal(f.targetTenantId) ? { targetTenantId: String(fromFsVal(f.targetTenantId)) } : {}),
    ...(targetPermissions ? { targetPermissions } : {}),
    ...(fromFsVal(f.lastSentAt) ? { lastSentAt: String(fromFsVal(f.lastSentAt)) } : {}),
    ...(fromFsVal(f.resendCount) !== undefined
      ? { resendCount: Number(fromFsVal(f.resendCount)) }
      : {}),
  };
}

function docToRedemption(doc: FirestoreRestDoc): InvitationRedemption {
  const f = doc.fields ?? {};
  const uidFromName = doc.name?.split('/').pop() ?? '';
  return {
    inviteId: String(fromFsVal(f.inviteId) ?? ''),
    uid: String(fromFsVal(f.uid) ?? uidFromName),
    email: String(fromFsVal(f.email) ?? ''),
    displayName: String(fromFsVal(f.displayName) ?? ''),
    provider: String(fromFsVal(f.provider) ?? 'password'),
    redeemedAt: String(fromFsVal(f.redeemedAt) ?? doc.createTime ?? ''),
  };
}

export function docToUserProfile(doc: FirestoreRestDoc): PlatformUserRecord {
  const f = doc.fields ?? {};
  const uidFromName = doc.name?.split('/').pop() ?? '';
  const uid = String(fromFsVal(f.uid) ?? uidFromName);
  const role = normalizeCanonicalRole(String(fromFsVal(f.role) ?? 'store_owner'), 'tenant');
  const statusRaw = String(fromFsVal(f.accountStatus) ?? 'active');
  const accountStatus: AccountStatus = statusRaw === 'suspended' ? 'suspended' : 'active';
  const tenantIdVal = fromFsVal(f.tenantId);
  const permissions = sanitizePermissions(fromFsVal(f.permissions), role);

  return {
    uid,
    email: String(fromFsVal(f.email) ?? ''),
    fullName: String(fromFsVal(f.fullName) ?? ''),
    ...(fromFsVal(f.photoUrl) ? { photoUrl: String(fromFsVal(f.photoUrl)) } : {}),
    role,
    accountStatus,
    tenantId: typeof tenantIdVal === 'string' && tenantIdVal.trim() ? tenantIdVal : null,
    ...(fromFsVal(f.businessName) ? { businessName: String(fromFsVal(f.businessName)) } : {}),
    permissions,
    ...(fromFsVal(f.invitationId) ? { invitationId: String(fromFsVal(f.invitationId)) } : {}),
    ...(fromFsVal(f.createdByUid) ? { createdByUid: String(fromFsVal(f.createdByUid)) } : {}),
    ...(fromFsVal(f.createdAt)
      ? { createdAt: String(fromFsVal(f.createdAt)) }
      : doc.createTime
      ? { createdAt: doc.createTime }
      : {}),
    ...(fromFsVal(f.lastActiveAt) ? { lastActiveAt: String(fromFsVal(f.lastActiveAt)) } : {}),
    ...(fromFsVal(f.updatedAt)
      ? { updatedAt: String(fromFsVal(f.updatedAt)) }
      : doc.updateTime
      ? { updatedAt: doc.updateTime }
      : {}),
    source: 'users_collection',
  };
}

export function docToTenantProfile(doc: FirestoreRestDoc): TenantProfile & { tenantId: string } {
  const f = doc.fields ?? {};
  const idFromName = doc.name?.split('/').pop() ?? '';
  const ownerId = String(fromFsVal(f.ownerId) ?? idFromName);
  const statusRaw = String(fromFsVal(f.accountStatus) ?? 'active');
  return {
    tenantId: idFromName || ownerId,
    ownerId,
    businessName: String(fromFsVal(f.businessName) ?? 'ZENORATI Store'),
    ownerEmail: String(fromFsVal(f.ownerEmail) ?? ''),
    ...(fromFsVal(f.fullName) ? { fullName: String(fromFsVal(f.fullName)) } : {}),
    ...(fromFsVal(f.photoUrl) ? { photoUrl: String(fromFsVal(f.photoUrl)) } : {}),
    ...(fromFsVal(f.role) ? { role: String(fromFsVal(f.role)) as UserRole } : {}),
    accountStatus: statusRaw === 'suspended' ? 'suspended' : 'active',
    ...(fromFsVal(f.invitationId) ? { invitationId: String(fromFsVal(f.invitationId)) } : {}),
    currency: (String(fromFsVal(f.currency) ?? 'USD') as CurrencyCode) || 'USD',
    ...(fromFsVal(f.usdToEgpRate) ? { usdToEgpRate: Number(fromFsVal(f.usdToEgpRate)) } : {}),
    taxRate: Number(fromFsVal(f.taxRate) ?? 0),
    lowStockThreshold: Number(fromFsVal(f.lowStockThreshold) ?? 12),
    createdAt: String(fromFsVal(f.createdAt) ?? doc.createTime ?? ''),
    updatedAt: String(fromFsVal(f.updatedAt) ?? doc.updateTime ?? ''),
  };
}

function docToTenantMember(doc: FirestoreRestDoc): TenantMemberRecord {
  const f = doc.fields ?? {};
  const uidFromName = doc.name?.split('/').pop() ?? '';
  const roleRaw = String(fromFsVal(f.role) ?? 'staff');
  const role: 'manager' | 'staff' | 'viewer' =
    roleRaw === 'manager' || roleRaw === 'viewer' ? roleRaw : 'staff';
  const statusRaw = String(fromFsVal(f.accountStatus) ?? 'active');
  return {
    uid: String(fromFsVal(f.uid) ?? uidFromName),
    tenantId: String(fromFsVal(f.tenantId) ?? ''),
    email: String(fromFsVal(f.email) ?? ''),
    fullName: String(fromFsVal(f.fullName) ?? ''),
    role,
    accountStatus: statusRaw === 'suspended' ? 'suspended' : 'active',
    permissions: sanitizePermissions(fromFsVal(f.permissions), role),
    ...(fromFsVal(f.invitedByUid) ? { invitedByUid: String(fromFsVal(f.invitedByUid)) } : {}),
    ...(fromFsVal(f.createdAt) ? { createdAt: String(fromFsVal(f.createdAt)) } : {}),
    ...(fromFsVal(f.updatedAt) ? { updatedAt: String(fromFsVal(f.updatedAt)) } : {}),
  };
}

export class FirebaseRestBackend implements InviteStoreBackend {
  readonly cfg: FirebaseAppletConfig;
  readonly docsBase: string;
  readonly docPrefix: string;

  constructor(cfg?: FirebaseAppletConfig) {
    this.cfg = cfg ?? loadFirebaseConfig();
    this.docPrefix = `projects/${this.cfg.projectId}/databases/${this.cfg.firestoreDatabaseId}/documents`;
    this.docsBase = `https://firestore.googleapis.com/v1/${this.docPrefix}`;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(this.cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    const body = (await res.json()) as {
      users?: Array<{
        localId: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
        photoUrl?: string;
        createdAt?: string;
        providerUserInfo?: Array<{ providerId?: string }>;
      }>;
      error?: { message?: string };
    };
    if (!res.ok || !body.users || body.users.length === 0) {
      throw new AuthServiceError(
        401,
        'AUTH_INVALID_TOKEN',
        body.error?.message || 'Invalid or expired authentication session.'
      );
    }
    const u = body.users[0];
    const createdMs = u.createdAt ? Number(u.createdAt) : NaN;
    return {
      uid: u.localId,
      email: u.email ?? '',
      emailVerified: Boolean(u.emailVerified),
      displayName: u.displayName ?? '',
      photoUrl: u.photoUrl ?? '',
      createdAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
      providerIds: (u.providerUserInfo ?? [])
        .map((p) => p.providerId ?? '')
        .filter((p) => p.length > 0),
    };
  }

  async fetchRawDoc(relPath: string, idToken: string): Promise<FirestoreRestDoc | null> {
    const res = await fetch(`${this.docsBase}/${relPath}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Firestore read failed: ${text}`);
    }
    return (await res.json()) as FirestoreRestDoc;
  }

  async getAdminDoc(uid: string, idToken: string): Promise<{ uid: string; role: UserRole } | null> {
    const doc = await this.fetchRawDoc(`admins/${encodeURIComponent(uid)}`, idToken);
    if (!doc?.fields) return null;
    const roleVal = String(fromFsVal(doc.fields.role) ?? '').trim();
    return {
      uid: String(fromFsVal(doc.fields.uid) ?? uid),
      role: (roleVal || 'unknown') as UserRole,
    };
  }

  async getUserDoc(uid: string, idToken: string): Promise<PlatformUserRecord | null> {
    const doc = await this.fetchRawDoc(`users/${encodeURIComponent(uid)}`, idToken);
    if (!doc?.fields) return null;
    return docToUserProfile(doc);
  }

  async getTenantMember(
    tenantId: string,
    memberUid: string,
    idToken: string
  ): Promise<TenantMemberRecord | null> {
    const doc = await this.fetchRawDoc(
      `tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(memberUid)}`,
      idToken
    );
    if (!doc?.fields) return null;
    return docToTenantMember(doc);
  }

  async tenantExists(uid: string, idToken: string): Promise<boolean> {
    const res = await fetch(`${this.docsBase}/tenants/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.ok) return true;

    const parentPath = `${this.docPrefix}/tenants/${uid}`;
    for (const collectionId of ['orders', 'products', 'customers', 'expenses']) {
      try {
        const qRes = await fetch(`${parentPath}:runQuery`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'ownerId' },
                  op: 'EQUAL',
                  value: { stringValue: uid },
                },
              },
              limit: 1,
            },
          }),
        });
        if (!qRes.ok) continue;
        const rows = (await qRes.json()) as Array<{ document?: FirestoreRestDoc }>;
        if (Array.isArray(rows) && rows.some((row) => Boolean(row.document))) {
          return true;
        }
      } catch {
        // Continue checking remaining subcollections
      }
    }
    return false;
  }

  async getInvitation(
    inviteId: string,
    idToken: string
  ): Promise<{ doc: InvitationRecord; updateTime?: string } | null> {
    const res = await fetch(`${this.docsBase}/invitations/${encodeURIComponent(inviteId)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 404) return null;
    if (res.status === 403) {
      throw new AuthServiceError(403, 'FIRESTORE_PERMISSION_DENIED', 'Permission denied reading invitation.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to read invitation: ${text}`);
    }
    const raw = (await res.json()) as FirestoreRestDoc;
    return { doc: docToInvitation(raw), updateTime: raw.updateTime };
  }

  async listInvitations(idToken: string): Promise<InvitationRecord[]> {
    const res = await fetch(`${this.docsBase}/invitations?pageSize=200`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 403) {
      throw new AuthServiceError(403, 'ADMIN_REQUIRED', 'Admin permissions are required to list invitations.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to list invitations: ${text}`);
    }
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).map(docToInvitation);
  }

  async listRedemptions(inviteId: string, idToken: string): Promise<InvitationRedemption[]> {
    const res = await fetch(
      `${this.docsBase}/invitations/${encodeURIComponent(inviteId)}/redemptions?pageSize=100`,
      { headers: { Authorization: `Bearer ${idToken}` } }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).map(docToRedemption);
  }

  async createInvitationDoc(record: InvitationRecord, idToken: string): Promise<InvitationRecord> {
    const invitePath = `${this.docPrefix}/invitations/${record.id}`;
    const fields: Record<string, FirestoreJsonValue> = {
      id: { stringValue: record.id },
      codeHash: { stringValue: record.codeHash },
      codePreview: { stringValue: record.codePreview },
      label: { stringValue: record.label },
      createdByUid: { stringValue: record.createdByUid },
      status: { stringValue: 'active' },
      maxUses: { integerValue: String(record.maxUses) },
      usedCount: { integerValue: '0' },
      expiresAt: { timestampValue: record.expiresAt },
      resendCount: { integerValue: String(record.resendCount ?? 0) },
    };
    if (record.targetEmail) {
      fields.targetEmail = { stringValue: record.targetEmail.trim().toLowerCase().slice(0, 160) };
    }
    if (record.targetFullName) {
      fields.targetFullName = { stringValue: record.targetFullName.trim().slice(0, 120) };
    }
    if (record.targetBusinessName) {
      fields.targetBusinessName = { stringValue: record.targetBusinessName.trim().slice(0, 100) };
    }
    if (
      record.targetRole &&
      ['store_owner', 'manager', 'staff', 'viewer'].includes(record.targetRole)
    ) {
      fields.targetRole = { stringValue: record.targetRole };
    }
    if (record.targetTenantId) {
      fields.targetTenantId = { stringValue: record.targetTenantId.trim().slice(0, 128) };
    }
    if (record.targetPermissions) {
      fields.targetPermissions = permissionsToFsMap(record.targetPermissions);
    }

    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: invitePath,
              fields,
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ...(record.lastSentAt
                ? [{ fieldPath: 'lastSentAt', setToServerValue: 'REQUEST_TIME' as const }]
                : []),
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403) {
        throw new AuthServiceError(
          403,
          'ADMIN_REQUIRED',
          'Firestore denied invitation creation. Verify your UID is registered in /admins/{uid}.'
        );
      }
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to create invitation: ${text}`);
    }

    const fresh = await this.getInvitation(record.id, idToken);
    return fresh?.doc ?? record;
  }

  async revokeInvitationDoc(inviteId: string, idToken: string): Promise<InvitationRecord> {
    const invitePath = `${this.docPrefix}/invitations/${inviteId}`;
    const existing = await this.getInvitation(inviteId, idToken);
    if (!existing) {
      throw new AuthServiceError(404, 'INVITE_NOT_FOUND', 'Invitation not found.');
    }
    if (existing.doc.status !== 'active') {
      throw new AuthServiceError(409, 'INVITE_NOT_ACTIVE', 'Only active invitations can be revoked.');
    }

    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: existing.updateTime
              ? { updateTime: existing.updateTime }
              : { exists: true },
            updateMask: { fieldPaths: ['status'] },
            update: {
              name: invitePath,
              fields: {
                status: { stringValue: 'revoked' },
              },
            },
            updateTransforms: [
              { fieldPath: 'revokedAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403) {
        throw new AuthServiceError(403, 'ADMIN_REQUIRED', 'Only authorized admins may revoke invitations.');
      }
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to revoke invitation: ${text}`);
    }

    const fresh = await this.getInvitation(inviteId, idToken);
    return fresh?.doc ?? { ...existing.doc, status: 'revoked' };
  }

  async markInvitationResent(inviteId: string, idToken: string): Promise<InvitationRecord> {
    const invitePath = `${this.docPrefix}/invitations/${inviteId}`;
    const existing = await this.getInvitation(inviteId, idToken);
    if (!existing) {
      throw new AuthServiceError(404, 'INVITE_NOT_FOUND', 'Invitation not found.');
    }
    if (computeEffectiveInvitationStatus(existing.doc) !== 'active') {
      throw new AuthServiceError(409, 'INVITE_NOT_ACTIVE', 'Only active invitations can be resent.');
    }

    const nextCount = Math.min(1000, (existing.doc.resendCount ?? 0) + 1);
    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: existing.updateTime
              ? { updateTime: existing.updateTime }
              : { exists: true },
            updateMask: { fieldPaths: ['resendCount'] },
            update: {
              name: invitePath,
              fields: {
                resendCount: { integerValue: String(nextCount) },
              },
            },
            updateTransforms: [
              { fieldPath: 'lastSentAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to update resend timestamp: ${text}`);
    }

    const fresh = await this.getInvitation(inviteId, idToken);
    return fresh?.doc ?? { ...existing.doc, resendCount: nextCount };
  }

  async commitRedemptionAndTenant(params: {
    invite: InvitationRecord;
    inviteUpdateTime?: string;
    user: VerifiedFirebaseUser;
    fullName: string;
    businessName: string;
    idToken: string;
  }): Promise<{ invitation: InvitationRecord; redemption: InvitationRedemption }> {
    const { invite, inviteUpdateTime, user, fullName, businessName, idToken } = params;
    const nextUsedCount = invite.usedCount + 1;
    const nextStatus: InvitationStatus = nextUsedCount >= invite.maxUses ? 'used' : 'active';
    const provider = user.providerIds[0] || 'password';

    const assignedRole: CanonicalRole =
      invite.targetRole && ['store_owner', 'manager', 'staff', 'viewer'].includes(invite.targetRole)
        ? invite.targetRole
        : 'store_owner';
    const isStoreMemberInvite =
      assignedRole !== 'store_owner' && Boolean(invite.targetTenantId?.trim());
    const assignedTenantId = isStoreMemberInvite ? invite.targetTenantId!.trim() : user.uid;
    const assignedPermissions = invite.targetPermissions
      ? sanitizePermissions(invite.targetPermissions, assignedRole)
      : getDefaultPermissionsForRole(assignedRole);
    const resolvedFullName = (fullName || invite.targetFullName || user.displayName || 'Merchant')
      .trim()
      .slice(0, 120);
    const resolvedBusinessName = (
      businessName ||
      invite.targetBusinessName ||
      `${resolvedFullName.split(' ')[0]}'s Store`
    )
      .trim()
      .slice(0, 100);

    const invitePath = `${this.docPrefix}/invitations/${invite.id}`;
    const redemptionPath = `${this.docPrefix}/invitations/${invite.id}/redemptions/${user.uid}`;
    const userPath = `${this.docPrefix}/users/${user.uid}`;
    const tenantPath = `${this.docPrefix}/tenants/${user.uid}`;
    const memberPath = `${this.docPrefix}/tenants/${assignedTenantId}/members/${user.uid}`;

    const userFields: Record<string, FirestoreJsonValue> = {
      uid: { stringValue: user.uid },
      email: { stringValue: user.email.toLowerCase().slice(0, 160) },
      fullName: { stringValue: resolvedFullName },
      photoUrl: { stringValue: (user.photoUrl || '').slice(0, 500) },
      role: { stringValue: assignedRole },
      accountStatus: { stringValue: 'active' },
      tenantId: { stringValue: assignedTenantId },
      businessName: { stringValue: resolvedBusinessName },
      permissions: permissionsToFsMap(assignedPermissions),
      invitationId: { stringValue: invite.id },
    };
    if (invite.createdByUid) {
      userFields.createdByUid = { stringValue: invite.createdByUid };
    }

    const writes: Array<Record<string, unknown>> = [
      {
        currentDocument: inviteUpdateTime ? { updateTime: inviteUpdateTime } : { exists: true },
        updateMask: { fieldPaths: ['status', 'usedCount'] },
        update: {
          name: invitePath,
          fields: {
            status: { stringValue: nextStatus },
            usedCount: { integerValue: String(nextUsedCount) },
          },
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        currentDocument: { exists: false },
        update: {
          name: redemptionPath,
          fields: {
            inviteId: { stringValue: invite.id },
            uid: { stringValue: user.uid },
            email: { stringValue: user.email.toLowerCase().slice(0, 160) },
            displayName: { stringValue: resolvedFullName },
            provider: { stringValue: provider.slice(0, 40) },
          },
        },
        updateTransforms: [{ fieldPath: 'redeemedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        currentDocument: { exists: false },
        update: {
          name: userPath,
          fields: userFields,
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'lastActiveAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
    ];

    if (isStoreMemberInvite) {
      writes.push({
        currentDocument: { exists: false },
        update: {
          name: memberPath,
          fields: {
            uid: { stringValue: user.uid },
            tenantId: { stringValue: assignedTenantId },
            email: { stringValue: user.email.toLowerCase().slice(0, 160) },
            fullName: { stringValue: resolvedFullName },
            role: { stringValue: assignedRole },
            accountStatus: { stringValue: 'active' },
            permissions: permissionsToFsMap(assignedPermissions),
            ...(invite.createdByUid ? { invitedByUid: { stringValue: invite.createdByUid } } : {}),
          },
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    } else {
      writes.push({
        currentDocument: { exists: false },
        update: {
          name: tenantPath,
          fields: {
            ownerId: { stringValue: user.uid },
            businessName: { stringValue: resolvedBusinessName },
            ownerEmail: { stringValue: user.email.toLowerCase().slice(0, 160) },
            fullName: { stringValue: resolvedFullName },
            photoUrl: { stringValue: (user.photoUrl || '').slice(0, 500) },
            role: { stringValue: 'store_owner' },
            accountStatus: { stringValue: 'active' },
            invitationId: { stringValue: invite.id },
            currency: { stringValue: 'USD' },
            usdToEgpRate: { doubleValue: 50 },
            taxRate: { doubleValue: 8.25 },
            lowStockThreshold: { integerValue: '12' },
          },
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    }

    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 409 || text.includes('FAILED_PRECONDITION') || text.includes('ALREADY_EXISTS')) {
        throw new AuthServiceError(
          409,
          'INVITE_CONFLICT_OR_EXHAUSTED',
          'This invitation could not be redeemed because it was just claimed or already used by this account.'
        );
      }
      if (res.status === 403) {
        throw new AuthServiceError(
          403,
          'INVITE_DENIED',
          'Invitation verification failed under Firestore security rules.'
        );
      }
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Atomic invitation redemption failed: ${text}`);
    }

    const nowIso = new Date().toISOString();
    return {
      invitation: {
        ...invite,
        usedCount: nextUsedCount,
        status: nextStatus,
        updatedAt: nowIso,
      },
      redemption: {
        inviteId: invite.id,
        uid: user.uid,
        email: user.email,
        displayName: resolvedFullName,
        provider,
        redeemedAt: nowIso,
      },
    };
  }

  async listUsersDocs(idToken: string): Promise<PlatformUserRecord[]> {
    const res = await fetch(`${this.docsBase}/users?pageSize=300`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 403) {
      throw new AuthServiceError(403, 'SUPER_ADMIN_REQUIRED', 'Super Admin permissions are required.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to list users: ${text}`);
    }
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).map(docToUserProfile);
  }

  async listTenantDocs(idToken: string): Promise<Array<TenantProfile & { tenantId: string }>> {
    const res = await fetch(`${this.docsBase}/tenants?pageSize=300`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 403) {
      throw new AuthServiceError(403, 'SUPER_ADMIN_REQUIRED', 'Super Admin permissions are required.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to list tenants: ${text}`);
    }
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).map(docToTenantProfile);
  }

  async getTenantDoc(tenantId: string, idToken: string): Promise<(TenantProfile & { tenantId: string }) | null> {
    const raw = await this.fetchRawDoc(`tenants/${encodeURIComponent(tenantId)}`, idToken);
    if (!raw?.fields) return null;
    return docToTenantProfile(raw);
  }

  async listTenantMembers(tenantId: string, idToken: string): Promise<TenantMemberRecord[]> {
    const res = await fetch(`${this.docsBase}/tenants/${encodeURIComponent(tenantId)}/members?pageSize=200`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).map(docToTenantMember);
  }

  async countCollectionDocs(relCollectionPath: string, idToken: string): Promise<number> {
    const res = await fetch(`${this.docsBase}/${relCollectionPath}?pageSize=500`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).length;
  }

  async createAuditLogDoc(entry: Omit<AdminAuditLogEntry, 'createdAt'>, idToken: string): Promise<AdminAuditLogEntry> {
    const logPath = `${this.docPrefix}/adminAuditLogs/${entry.id}`;
    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: logPath,
              fields: {
                id: { stringValue: entry.id },
                actorUid: { stringValue: entry.actorUid },
                actorEmail: { stringValue: entry.actorEmail.slice(0, 160) },
                action: { stringValue: entry.action.slice(0, 80) },
                targetType: { stringValue: entry.targetType },
                targetId: { stringValue: entry.targetId.slice(0, 128) },
                targetLabel: { stringValue: entry.targetLabel.slice(0, 160) },
                details: { stringValue: entry.details.slice(0, 500) },
              },
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403) {
        throw new AuthServiceError(403, 'SUPER_ADMIN_REQUIRED', 'Super Admin permissions are required to write audit logs.');
      }
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to record audit log: ${text}`);
    }

    return {
      ...entry,
      createdAt: new Date().toISOString(),
    };
  }

  async listAuditLogsDocs(idToken: string): Promise<AdminAuditLogEntry[]> {
    const res = await fetch(`${this.docsBase}/adminAuditLogs?pageSize=200`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 403) {
      throw new AuthServiceError(403, 'SUPER_ADMIN_REQUIRED', 'Super Admin permissions are required.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to load audit logs: ${text}`);
    }
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? [])
      .map((doc): AdminAuditLogEntry => {
        const f = doc.fields ?? {};
        const idFromName = doc.name?.split('/').pop() ?? '';
        return {
          id: String(fromFsVal(f.id) ?? idFromName),
          actorUid: String(fromFsVal(f.actorUid) ?? ''),
          actorEmail: String(fromFsVal(f.actorEmail) ?? ''),
          action: String(fromFsVal(f.action) ?? ''),
          targetType: String(fromFsVal(f.targetType) ?? 'system') as AdminAuditLogEntry['targetType'],
          targetId: String(fromFsVal(f.targetId) ?? ''),
          targetLabel: String(fromFsVal(f.targetLabel) ?? ''),
          details: String(fromFsVal(f.details) ?? ''),
          createdAt: String(fromFsVal(f.createdAt) ?? doc.createTime ?? ''),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listRoleTemplatesDocs(idToken: string): Promise<RoleTemplateRecord[]> {
    const res = await fetch(`${this.docsBase}/roleTemplates?pageSize=20`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { documents?: FirestoreRestDoc[] };
    return (json.documents ?? []).map((doc): RoleTemplateRecord => {
      const f = doc.fields ?? {};
      const role = normalizeCanonicalRole(String(fromFsVal(f.role) ?? 'viewer'), 'tenant');
      return {
        role,
        label: String(fromFsVal(f.label) ?? role),
        description: String(fromFsVal(f.description) ?? ''),
        permissions: sanitizePermissions(fromFsVal(f.permissions), role),
        ...(fromFsVal(f.updatedAt) ? { updatedAt: String(fromFsVal(f.updatedAt)) } : {}),
        ...(fromFsVal(f.updatedByUid) ? { updatedByUid: String(fromFsVal(f.updatedByUid)) } : {}),
      };
    });
  }

  async upsertRoleTemplateDoc(
    template: RoleTemplateRecord & { updatedByUid: string },
    idToken: string
  ): Promise<RoleTemplateRecord> {
    const templatePath = `${this.docPrefix}/roleTemplates/${template.role}`;
    const existing = await this.fetchRawDoc(`roleTemplates/${template.role}`, idToken);

    const write = existing
      ? {
          currentDocument: { exists: true },
          updateMask: { fieldPaths: ['label', 'description', 'permissions', 'updatedByUid'] },
          update: {
            name: templatePath,
            fields: {
              label: { stringValue: template.label.slice(0, 80) },
              description: { stringValue: template.description.slice(0, 240) },
              permissions: permissionsToFsMap(template.permissions),
              updatedByUid: { stringValue: template.updatedByUid },
            },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        }
      : {
          currentDocument: { exists: false },
          update: {
            name: templatePath,
            fields: {
              role: { stringValue: template.role },
              label: { stringValue: template.label.slice(0, 80) },
              description: { stringValue: template.description.slice(0, 240) },
              permissions: permissionsToFsMap(template.permissions),
              updatedByUid: { stringValue: template.updatedByUid },
            },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        };

    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes: [write] }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Failed to save role template: ${text}`);
    }
    return {
      ...template,
      updatedAt: new Date().toISOString(),
    };
  }
}

export class AuthServiceError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export class AuthInviteService {
  readonly backend: InviteStoreBackend;
  private readonly rateLimiter: AttemptRateLimiter;
  private readonly persistCache: boolean;
  private readonly inviteCache = new Map<string, InvitationRecord>();
  private readonly lockQueues = new Map<string, Promise<unknown>>();
  private cacheHydrated = false;

  constructor(options?: {
    backend?: InviteStoreBackend;
    rateLimiter?: AttemptRateLimiter;
    persistCache?: boolean;
  }) {
    this.backend = options?.backend ?? new FirebaseRestBackend();
    this.rateLimiter = options?.rateLimiter ?? new AttemptRateLimiter(6, 15 * 60 * 1000);
    this.persistCache = options?.persistCache ?? true;
    if (this.persistCache) {
      this.loadDiskCache();
    }
  }

  private loadDiskCache(): void {
    try {
      if (!fs.existsSync(INVITE_CACHE_PATH)) return;
      const raw = fs.readFileSync(INVITE_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as { hydrated?: boolean; items?: InvitationRecord[] };
      if (Array.isArray(parsed?.items)) {
        for (const item of parsed.items) {
          if (item?.id && item?.codeHash) {
            this.inviteCache.set(item.id, item);
          }
        }
        this.cacheHydrated = Boolean(parsed.hydrated);
      }
    } catch {
      // Ignore corrupt cache
    }
  }

  private writeDiskCache(): void {
    if (!this.persistCache) return;
    try {
      const payload = {
        hydrated: this.cacheHydrated,
        items: Array.from(this.inviteCache.values()),
      };
      const tmp = `${INVITE_CACHE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, INVITE_CACHE_PATH);
    } catch {
      // Ignore read-only fs errors
    }
  }

  private async withInviteLock<T>(inviteId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.lockQueues.get(inviteId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.lockQueues.set(inviteId, next);
    try {
      return await next;
    } finally {
      if (this.lockQueues.get(inviteId) === next) {
        this.lockQueues.delete(inviteId);
      }
    }
  }

  isEnvOwnerUid(uid: string): boolean {
    const raw = process.env.ZENORATI_OWNER_UID ?? '';
    if (!raw.trim()) return false;
    const allowlist = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return allowlist.includes(uid);
  }

  private isEnvOwnerEmail(email: string, emailVerified: boolean): boolean {
    if (!emailVerified || !email.trim()) return false;
    const raw = process.env.ZENORATI_OWNER_EMAIL ?? '';
    if (!raw.trim()) return false;
    const normalized = email.trim().toLowerCase();
    const allowlist = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return allowlist.includes(normalized);
  }

  async resolveAdminStatus(
    user: VerifiedFirebaseUser,
    idToken: string
  ): Promise<{
    isAdmin: boolean;
    isSuperAdmin: boolean;
    diagnostic: SuperAdminDiagnostic;
  }> {
    const envOwnerUidMatched = this.isEnvOwnerUid(user.uid);
    if (!user.emailVerified) {
      return {
        isAdmin: false,
        isSuperAdmin: false,
        diagnostic: {
          hasAdminDoc: false,
          adminDocRole: null,
          envOwnerUidMatched,
          reason: 'email_unverified',
        },
      };
    }

    const adminDoc = await this.backend.getAdminDoc(user.uid, idToken);
    if (!adminDoc) {
      // Email-only matching or env-only UID matching NEVER grants Super Admin without /admins/{uid}.
      return {
        isAdmin: false,
        isSuperAdmin: false,
        diagnostic: {
          hasAdminDoc: false,
          adminDocRole: null,
          envOwnerUidMatched,
          reason: 'missing_admin_doc',
        },
      };
    }

    if (adminDoc.role === 'super_admin' || adminDoc.role === 'owner') {
      return {
        isAdmin: true,
        isSuperAdmin: true,
        diagnostic: {
          hasAdminDoc: true,
          adminDocRole: adminDoc.role,
          envOwnerUidMatched,
          reason: 'verified_admin_doc',
        },
      };
    }

    // Legacy 'admin' or malformed /admins/{uid} role cannot pass firestore.rules isSuperAdmin()
    return {
      isAdmin: adminDoc.role === 'admin',
      isSuperAdmin: false,
      diagnostic: {
        hasAdminDoc: true,
        adminDocRole: adminDoc.role,
        envOwnerUidMatched,
        reason: 'role_insufficient',
      },
    };
  }

  async getSessionInfo(idToken: string): Promise<AuthSessionInfo> {
    const user = await this.backend.verifyIdToken(idToken);
    const [adminStatus, userDoc, hasOwnTenant] = await Promise.all([
      this.resolveAdminStatus(user, idToken),
      this.backend.getUserDoc(user.uid, idToken),
      this.backend.tenantExists(user.uid, idToken),
    ]);

    const { isAdmin, isSuperAdmin, diagnostic } = adminStatus;

    let role: CanonicalRole = isSuperAdmin ? 'super_admin' : 'store_owner';
    let accountStatus: AccountStatus = 'active';
    let tenantId: string | null = hasOwnTenant ? user.uid : null;
    let permissions: SectionPermissions = getDefaultPermissionsForRole(role);
    let hasTenant = hasOwnTenant;

    if (userDoc) {
      accountStatus = userDoc.accountStatus;
      if (isSuperAdmin) {
        role = 'super_admin';
        permissions = getDefaultPermissionsForRole('super_admin');
        tenantId = userDoc.tenantId ?? (hasOwnTenant ? user.uid : null);
      } else {
        role = userDoc.role === 'super_admin' ? 'store_owner' : userDoc.role;
        permissions = sanitizePermissions(userDoc.permissions, role);
        tenantId = userDoc.tenantId ?? (hasOwnTenant ? user.uid : null);
        if (tenantId && tenantId !== user.uid) {
          const member = await this.backend.getTenantMember(tenantId, user.uid, idToken);
          if (member) {
            if (member.accountStatus === 'suspended') {
              accountStatus = 'suspended';
            }
            role = member.role;
            permissions = sanitizePermissions(member.permissions, role);
            hasTenant = true;
          } else {
            hasTenant = false;
          }
        } else if (tenantId === user.uid && !hasOwnTenant) {
          hasTenant = await this.backend.tenantExists(user.uid, idToken);
        } else if (tenantId === user.uid) {
          hasTenant = true;
        }
      }
    }

    const legacyOwnerShellAccess =
      !hasTenant && !isSuperAdmin && this.isEnvOwnerEmail(user.email, user.emailVerified);

    return {
      ...user,
      isAdmin,
      isSuperAdmin,
      role,
      accountStatus,
      tenantId,
      permissions,
      hasTenant,
      ...(legacyOwnerShellAccess ? { legacyOwnerShellAccess: true } : {}),
      superAdminDiagnostic: diagnostic,
    };
  }

  private assertInviteRedeemable(
    record: InvitationRecord | null,
    userEmail?: string
  ): asserts record is InvitationRecord {
    if (!record) {
      throw new AuthServiceError(
        404,
        'INVITE_INVALID',
        'Invitation code is invalid or does not exist.'
      );
    }
    const effectiveStatus = computeEffectiveInvitationStatus(record);
    if (effectiveStatus === 'revoked') {
      throw new AuthServiceError(
        403,
        'INVITE_REVOKED',
        'This invitation has been revoked by an administrator.'
      );
    }
    if (effectiveStatus === 'expired') {
      throw new AuthServiceError(
        403,
        'INVITE_EXPIRED',
        'This invitation has expired and can no longer be used.'
      );
    }
    if (effectiveStatus === 'used' || record.usedCount >= record.maxUses) {
      throw new AuthServiceError(
        403,
        'INVITE_USED',
        'This invitation has already reached its usage limit.'
      );
    }
    if (
      userEmail &&
      record.targetEmail &&
      record.targetEmail.trim().length > 0 &&
      record.targetEmail.trim().toLowerCase() !== userEmail.trim().toLowerCase()
    ) {
      throw new AuthServiceError(
        403,
        'INVITE_EMAIL_MISMATCH',
        'This invitation is restricted to a different email address.'
      );
    }
  }

  checkInvitationPreAuth(code: string, clientKey: string): {
    valid: boolean;
    verifiedByCache: boolean;
    codePreview?: string;
    remainingUses?: number;
    expiresAt?: string;
    targetRole?: CanonicalRole;
    targetFullName?: string;
    targetBusinessName?: string;
  } {
    const rate = this.rateLimiter.check(`ip:${clientKey}`);
    if (!rate.allowed) {
      throw new AuthServiceError(
        429,
        'RATE_LIMITED',
        `Too many invalid invitation attempts. Please wait ${rate.retryAfterSeconds} seconds and try again.`
      );
    }

    if (!code || !code.trim()) {
      this.rateLimiter.recordFailure(`ip:${clientKey}`);
      throw new AuthServiceError(
        400,
        'INVITE_MISSING',
        'An invitation code is required to register.'
      );
    }

    if (!isValidInvitationCodeFormat(code)) {
      this.rateLimiter.recordFailure(`ip:${clientKey}`);
      throw new AuthServiceError(
        400,
        'INVITE_INVALID',
        'Invitation code format is invalid.'
      );
    }

    const codeHash = hashInvitationCode(code);
    const cached = this.inviteCache.get(codeHash) ?? null;

    if (cached) {
      try {
        this.assertInviteRedeemable(cached);
      } catch (err) {
        this.rateLimiter.recordFailure(`ip:${clientKey}`);
        throw err;
      }
      return {
        valid: true,
        verifiedByCache: true,
        codePreview: cached.codePreview,
        remainingUses: Math.max(0, cached.maxUses - cached.usedCount),
        expiresAt: cached.expiresAt,
        ...(cached.targetRole ? { targetRole: cached.targetRole } : {}),
        ...(cached.targetFullName ? { targetFullName: cached.targetFullName } : {}),
        ...(cached.targetBusinessName ? { targetBusinessName: cached.targetBusinessName } : {}),
      };
    }

    if (this.cacheHydrated) {
      this.rateLimiter.recordFailure(`ip:${clientKey}`);
      throw new AuthServiceError(
        404,
        'INVITE_INVALID',
        'Invitation code is invalid or does not exist.'
      );
    }

    return {
      valid: true,
      verifiedByCache: false,
    };
  }

  async verifyInvitationAuthenticated(params: {
    idToken: string;
    code: string;
    clientKey: string;
  }): Promise<{
    valid: boolean;
    codePreview: string;
    remainingUses: number;
    expiresAt: string;
    targetRole?: CanonicalRole;
  }> {
    const user = await this.backend.verifyIdToken(params.idToken);
    const ipRate = this.rateLimiter.check(`ip:${params.clientKey}`);
    const uidRate = this.rateLimiter.check(`uid:${user.uid}`);
    if (!ipRate.allowed || !uidRate.allowed) {
      const wait = Math.max(ipRate.retryAfterSeconds, uidRate.retryAfterSeconds);
      throw new AuthServiceError(
        429,
        'RATE_LIMITED',
        `Too many invalid invitation attempts. Please wait ${wait} seconds before trying again.`
      );
    }

    if (!params.code || !params.code.trim()) {
      this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
      this.rateLimiter.recordFailure(`uid:${user.uid}`);
      throw new AuthServiceError(400, 'INVITE_MISSING', 'An invitation code is required to register.');
    }

    if (!isValidInvitationCodeFormat(params.code)) {
      this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
      this.rateLimiter.recordFailure(`uid:${user.uid}`);
      throw new AuthServiceError(400, 'INVITE_INVALID', 'Invitation code format is invalid.');
    }

    const codeHash = hashInvitationCode(params.code);
    const fetched = await this.backend.getInvitation(codeHash, params.idToken);
    if (!fetched) {
      this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
      this.rateLimiter.recordFailure(`uid:${user.uid}`);
      throw new AuthServiceError(404, 'INVITE_INVALID', 'Invitation code is invalid or does not exist.');
    }

    try {
      this.assertInviteRedeemable(fetched.doc, user.email);
    } catch (err) {
      this.inviteCache.set(fetched.doc.id, fetched.doc);
      this.writeDiskCache();
      this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
      this.rateLimiter.recordFailure(`uid:${user.uid}`);
      throw err;
    }

    this.inviteCache.set(fetched.doc.id, fetched.doc);
    this.writeDiskCache();

    return {
      valid: true,
      codePreview: fetched.doc.codePreview,
      remainingUses: Math.max(0, fetched.doc.maxUses - fetched.doc.usedCount),
      expiresAt: fetched.doc.expiresAt,
      ...(fetched.doc.targetRole ? { targetRole: fetched.doc.targetRole } : {}),
    };
  }

  async redeemInvitationAndCreateTenant(params: {
    idToken: string;
    code: string;
    fullName?: string;
    businessName?: string;
    clientKey: string;
  }): Promise<{
    alreadyActive: boolean;
    user: VerifiedFirebaseUser;
    invitation?: InvitationRecord;
    redemption?: InvitationRedemption;
  }> {
    const user = await this.backend.verifyIdToken(params.idToken);

    const ipRate = this.rateLimiter.check(`ip:${params.clientKey}`);
    const uidRate = this.rateLimiter.check(`uid:${user.uid}`);
    if (!ipRate.allowed || !uidRate.allowed) {
      const wait = Math.max(ipRate.retryAfterSeconds, uidRate.retryAfterSeconds);
      throw new AuthServiceError(
        429,
        'RATE_LIMITED',
        `Too many invitation attempts. Please wait ${wait} seconds before trying again.`
      );
    }

    const existingUserDoc = await this.backend.getUserDoc(user.uid, params.idToken);
    if (existingUserDoc?.accountStatus === 'suspended') {
      throw new AuthServiceError(
        403,
        'ACCOUNT_SUSPENDED',
        'This account has been suspended by the platform administrator.'
      );
    }

    const hasOwnTenant = await this.backend.tenantExists(user.uid, params.idToken);
    if (hasOwnTenant || (existingUserDoc && existingUserDoc.tenantId)) {
      return { alreadyActive: true, user };
    }

    if (!user.emailVerified) {
      throw new AuthServiceError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address before activating your invitation.'
      );
    }

    if (!params.code || !params.code.trim()) {
      this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
      this.rateLimiter.recordFailure(`uid:${user.uid}`);
      throw new AuthServiceError(
        400,
        'INVITE_MISSING',
        'An invitation code is required to activate a new account.'
      );
    }

    if (!isValidInvitationCodeFormat(params.code)) {
      this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
      this.rateLimiter.recordFailure(`uid:${user.uid}`);
      throw new AuthServiceError(
        400,
        'INVITE_INVALID',
        'Invitation code is invalid.'
      );
    }

    const codeHash = hashInvitationCode(params.code);

    return this.withInviteLock(codeHash, async () => {
      const fetched = await this.backend.getInvitation(codeHash, params.idToken);
      if (!fetched) {
        this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
        this.rateLimiter.recordFailure(`uid:${user.uid}`);
        throw new AuthServiceError(
          404,
          'INVITE_INVALID',
          'Invitation code is invalid or does not exist.'
        );
      }

      try {
        this.assertInviteRedeemable(fetched.doc, user.email);
      } catch (err) {
        this.inviteCache.set(fetched.doc.id, fetched.doc);
        this.writeDiskCache();
        this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
        this.rateLimiter.recordFailure(`uid:${user.uid}`);
        throw err;
      }

      const cleanFullName =
        (
          params.fullName ??
          fetched.doc.targetFullName ??
          user.displayName ??
          user.email.split('@')[0] ??
          'Merchant'
        )
          .trim()
          .slice(0, 120) || 'Merchant';
      const defaultBiz = `${cleanFullName.split(' ')[0]}'s Store`;
      const cleanBusinessName =
        (params.businessName ?? fetched.doc.targetBusinessName ?? defaultBiz)
          .trim()
          .slice(0, 100) || 'ZENORATI Store';

      const result = await this.backend.commitRedemptionAndTenant({
        invite: fetched.doc,
        inviteUpdateTime: fetched.updateTime,
        user,
        fullName: cleanFullName,
        businessName: cleanBusinessName,
        idToken: params.idToken,
      });

      this.rateLimiter.clear(`ip:${params.clientKey}`);
      this.rateLimiter.clear(`uid:${user.uid}`);
      this.inviteCache.set(result.invitation.id, result.invitation);
      this.writeDiskCache();

      return {
        alreadyActive: false,
        user,
        invitation: result.invitation,
        redemption: result.redemption,
      };
    });
  }

  async requireAdmin(idToken: string): Promise<VerifiedFirebaseUser> {
    const user = await this.backend.verifyIdToken(idToken);
    const { isAdmin } = await this.resolveAdminStatus(user, idToken);
    if (!isAdmin) {
      throw new AuthServiceError(
        403,
        'ADMIN_REQUIRED',
        'Only an authorized administrator with a verified /admins/{uid} document can manage invitations.'
      );
    }
    return user;
  }

  async requireSuperAdmin(idToken: string): Promise<VerifiedFirebaseUser> {
    const user = await this.backend.verifyIdToken(idToken);
    const { isSuperAdmin, diagnostic } = await this.resolveAdminStatus(user, idToken);
    if (!isSuperAdmin) {
      const detail =
        diagnostic.reason === 'missing_admin_doc'
          ? `Super Admin verification requires a Firestore /admins/${user.uid} document with role "super_admin" or "owner".`
          : diagnostic.reason === 'role_insufficient'
          ? `Firestore /admins/${user.uid} has role "${diagnostic.adminDocRole}", which is insufficient for Super Admin access.`
          : 'Your Firebase email address must be verified before Super Admin access is granted.';
      throw new AuthServiceError(403, 'SUPER_ADMIN_REQUIRED', detail);
    }
    return user;
  }

  async createInvitation(params: {
    idToken: string;
    maxUses: number;
    expiresAtIso: string;
    label?: string;
    targetEmail?: string;
    targetFullName?: string;
    targetBusinessName?: string;
    targetRole?: CanonicalRole;
    targetTenantId?: string;
    targetPermissions?: SectionPermissions;
  }): Promise<{ inviteCode: string; invitation: InvitationRecord }> {
    const adminUser = await this.requireAdmin(params.idToken);

    const maxUses = Math.trunc(Number(params.maxUses));
    if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 100) {
      throw new AuthServiceError(
        400,
        'INVALID_MAX_USES',
        'Usage limit must be a whole number between 1 and 100.'
      );
    }

    const expMs = Date.parse(params.expiresAtIso);
    if (!Number.isFinite(expMs) || expMs <= Date.now() + 60 * 1000) {
      throw new AuthServiceError(
        400,
        'INVALID_EXPIRATION',
        'Expiration date must be at least 1 minute in the future.'
      );
    }

    const cleanRole: CanonicalRole | undefined =
      params.targetRole && ['store_owner', 'manager', 'staff', 'viewer'].includes(params.targetRole)
        ? params.targetRole
        : undefined;

    const inviteCode = generateRandomInvitationCode();
    const codeHash = hashInvitationCode(inviteCode);
    const nowIso = new Date().toISOString();

    const record: InvitationRecord = {
      id: codeHash,
      codeHash,
      codePreview: buildCodePreview(inviteCode),
      label: (params.label ?? '').trim().slice(0, 120),
      createdByUid: adminUser.uid,
      status: 'active',
      maxUses,
      usedCount: 0,
      expiresAt: new Date(expMs).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
      resendCount: 0,
      ...(params.targetEmail?.trim()
        ? { targetEmail: params.targetEmail.trim().toLowerCase().slice(0, 160) }
        : {}),
      ...(params.targetFullName?.trim()
        ? { targetFullName: params.targetFullName.trim().slice(0, 120) }
        : {}),
      ...(params.targetBusinessName?.trim()
        ? { targetBusinessName: params.targetBusinessName.trim().slice(0, 100) }
        : {}),
      ...(cleanRole ? { targetRole: cleanRole } : {}),
      ...(params.targetTenantId?.trim()
        ? { targetTenantId: params.targetTenantId.trim().slice(0, 128) }
        : {}),
      ...(params.targetPermissions
        ? { targetPermissions: sanitizePermissions(params.targetPermissions, cleanRole ?? 'store_owner') }
        : {}),
    };

    const persisted = await this.backend.createInvitationDoc(record, params.idToken);
    this.inviteCache.set(persisted.id, persisted);
    this.writeDiskCache();
    return { inviteCode, invitation: persisted };
  }

  async listInvitations(idToken: string): Promise<InvitationRecord[]> {
    await this.requireAdmin(idToken);
    const list = await this.backend.listInvitations(idToken);

    const hydrated = await Promise.all(
      list.map(async (item) => {
        const redemptions =
          item.usedCount > 0 ? await this.backend.listRedemptions(item.id, idToken) : [];
        const effectiveStatus = computeEffectiveInvitationStatus(item);
        return {
          ...item,
          status: effectiveStatus,
          redemptions,
        };
      })
    );

    this.inviteCache.clear();
    for (const item of list) {
      this.inviteCache.set(item.id, item);
    }
    this.cacheHydrated = true;
    this.writeDiskCache();

    return hydrated.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeInvitation(idToken: string, inviteId: string): Promise<InvitationRecord> {
    await this.requireAdmin(idToken);
    if (!/^[a-f0-9]{64}$/.test(inviteId)) {
      throw new AuthServiceError(400, 'INVALID_INVITE_ID', 'Invalid invitation ID format.');
    }
    const revoked = await this.backend.revokeInvitationDoc(inviteId, idToken);
    this.inviteCache.set(revoked.id, revoked);
    this.writeDiskCache();
    return revoked;
  }

  updateCachedInvitation(record: InvitationRecord): void {
    this.inviteCache.set(record.id, record);
    this.writeDiskCache();
  }
}

export const authInviteService = new AuthInviteService();
