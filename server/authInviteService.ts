import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AuthSessionInfo,
  InvitationRecord,
  InvitationRedemption,
  InvitationStatus,
  UserRole,
} from '../src/types/zenorati';

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), 'firebase-applet-config.json');
const INVITE_CACHE_PATH = path.resolve(process.cwd(), '.zenorati-invites.json');
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 unambiguous chars (5 bits each)

function loadFirebaseConfig(): FirebaseAppletConfig {
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

export interface InviteStoreBackend {
  verifyIdToken(idToken: string): Promise<VerifiedFirebaseUser>;
  getAdminDoc(uid: string, idToken: string): Promise<{ uid: string; role: UserRole } | null>;
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

type FirestoreJsonValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null };

interface FirestoreRestDoc {
  name?: string;
  fields?: Record<string, FirestoreJsonValue>;
  createTime?: string;
  updateTime?: string;
}

function fromFsVal(val: FirestoreJsonValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number.parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  return undefined;
}

function docToInvitation(doc: FirestoreRestDoc): InvitationRecord {
  const f = doc.fields ?? {};
  const idFromName = doc.name?.split('/').pop() ?? '';
  const id = String(fromFsVal(f.id) ?? idFromName);
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

export class FirebaseRestBackend implements InviteStoreBackend {
  private readonly cfg: FirebaseAppletConfig;
  private readonly docsBase: string;
  private readonly docPrefix: string;

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

  private async fetchDoc(relPath: string, idToken: string): Promise<FirestoreRestDoc | null> {
    const res = await fetch(`${this.docsBase}/${relPath}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 404) return null;
    if (res.status === 403) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new AuthServiceError(502, 'FIRESTORE_ERROR', `Firestore read failed: ${text}`);
    }
    return (await res.json()) as FirestoreRestDoc;
  }

  async getAdminDoc(uid: string, idToken: string): Promise<{ uid: string; role: UserRole } | null> {
    const doc = await this.fetchDoc(`admins/${encodeURIComponent(uid)}`, idToken);
    if (!doc?.fields) return null;
    const roleVal = String(fromFsVal(doc.fields.role) ?? '');
    if (roleVal !== 'owner' && roleVal !== 'admin') return null;
    return {
      uid: String(fromFsVal(doc.fields.uid) ?? uid),
      role: roleVal,
    };
  }

  async tenantExists(uid: string, idToken: string): Promise<boolean> {
    const res = await fetch(`${this.docsBase}/tenants/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.ok) return true;

    // Fallback check for pre-existing tenants that already have subcollection business data
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
              fields: {
                id: { stringValue: record.id },
                codeHash: { stringValue: record.codeHash },
                codePreview: { stringValue: record.codePreview },
                label: { stringValue: record.label },
                createdByUid: { stringValue: record.createdByUid },
                status: { stringValue: 'active' },
                maxUses: { integerValue: String(record.maxUses) },
                usedCount: { integerValue: '0' },
                expiresAt: { timestampValue: record.expiresAt },
              },
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
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
            update: {
              name: invitePath,
              fields: {
                id: { stringValue: existing.doc.id },
                codeHash: { stringValue: existing.doc.codeHash },
                codePreview: { stringValue: existing.doc.codePreview },
                label: { stringValue: existing.doc.label },
                createdByUid: { stringValue: existing.doc.createdByUid },
                status: { stringValue: 'revoked' },
                maxUses: { integerValue: String(existing.doc.maxUses) },
                usedCount: { integerValue: String(existing.doc.usedCount) },
                expiresAt: { timestampValue: existing.doc.expiresAt },
                createdAt: { timestampValue: existing.doc.createdAt },
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

    const invitePath = `${this.docPrefix}/invitations/${invite.id}`;
    const redemptionPath = `${this.docPrefix}/invitations/${invite.id}/redemptions/${user.uid}`;
    const tenantPath = `${this.docPrefix}/tenants/${user.uid}`;

    const res = await fetch(`${this.docsBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: inviteUpdateTime ? { updateTime: inviteUpdateTime } : { exists: true },
            update: {
              name: invitePath,
              fields: {
                id: { stringValue: invite.id },
                codeHash: { stringValue: invite.codeHash },
                codePreview: { stringValue: invite.codePreview },
                label: { stringValue: invite.label },
                createdByUid: { stringValue: invite.createdByUid },
                status: { stringValue: nextStatus },
                maxUses: { integerValue: String(invite.maxUses) },
                usedCount: { integerValue: String(nextUsedCount) },
                expiresAt: { timestampValue: invite.expiresAt },
                createdAt: { timestampValue: invite.createdAt },
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
                email: { stringValue: user.email.slice(0, 160) },
                displayName: { stringValue: fullName.slice(0, 120) },
                provider: { stringValue: provider.slice(0, 40) },
              },
            },
            updateTransforms: [{ fieldPath: 'redeemedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            currentDocument: { exists: false },
            update: {
              name: tenantPath,
              fields: {
                ownerId: { stringValue: user.uid },
                businessName: { stringValue: businessName.slice(0, 100) },
                ownerEmail: { stringValue: user.email.slice(0, 160) },
                fullName: { stringValue: fullName.slice(0, 120) },
                photoUrl: { stringValue: (user.photoUrl || '').slice(0, 500) },
                role: { stringValue: 'user' },
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
          },
        ],
      }),
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
        displayName: fullName,
        provider,
        redeemedAt: nowIso,
      },
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
  private readonly backend: InviteStoreBackend;
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

  private isEnvOwnerUid(uid: string): boolean {
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

  private async resolveAdminStatus(
    user: VerifiedFirebaseUser,
    idToken: string
  ): Promise<{ isAdmin: boolean; role: UserRole }> {
    if (!user.emailVerified) {
      return { isAdmin: false, role: 'user' };
    }
    const adminDoc = await this.backend.getAdminDoc(user.uid, idToken);
    if (adminDoc) {
      return { isAdmin: true, role: adminDoc.role };
    }
    if (this.isEnvOwnerUid(user.uid) || this.isEnvOwnerEmail(user.email, user.emailVerified)) {
      return { isAdmin: true, role: 'owner' };
    }
    return { isAdmin: false, role: 'user' };
  }

  async getSessionInfo(idToken: string): Promise<AuthSessionInfo> {
    const user = await this.backend.verifyIdToken(idToken);
    const [{ isAdmin, role }, hasTenant] = await Promise.all([
      this.resolveAdminStatus(user, idToken),
      this.backend.tenantExists(user.uid, idToken),
    ]);
    return {
      ...user,
      isAdmin,
      role,
      hasTenant,
    };
  }

  private assertInviteRedeemable(record: InvitationRecord | null): asserts record is InvitationRecord {
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
  }

  /**
   * Unauthenticated pre-check run BEFORE opening Google popup or creating an Email/Password account.
   * Rate-limited strictly to prevent brute-force guessing.
   */
  checkInvitationPreAuth(code: string, clientKey: string): {
    valid: boolean;
    verifiedByCache: boolean;
    codePreview?: string;
    remainingUses?: number;
    expiresAt?: string;
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

    // Cold server cache before an admin has hydrated it: allow Auth step to obtain idToken so
    // verifyInvitationAuthenticated / redeemInvitationAndCreateTenant performs authoritative Firestore verification & rollback on failure.
    return {
      valid: true,
      verifiedByCache: false,
    };
  }

  /**
   * Authoritative Firestore check for signed-in users (including newly created email/password accounts before email verification).
   */
  async verifyInvitationAuthenticated(params: {
    idToken: string;
    code: string;
    clientKey: string;
  }): Promise<{
    valid: boolean;
    codePreview: string;
    remainingUses: number;
    expiresAt: string;
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
      this.assertInviteRedeemable(fetched.doc);
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

    // Existing users with an active tenant doc retain access without consuming any new invitation
    const hasTenant = await this.backend.tenantExists(user.uid, params.idToken);
    if (hasTenant) {
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
        this.assertInviteRedeemable(fetched.doc);
      } catch (err) {
        this.inviteCache.set(fetched.doc.id, fetched.doc);
        this.writeDiskCache();
        this.rateLimiter.recordFailure(`ip:${params.clientKey}`);
        this.rateLimiter.recordFailure(`uid:${user.uid}`);
        throw err;
      }

      const cleanFullName =
        (params.fullName ?? user.displayName ?? user.email.split('@')[0] ?? 'Merchant')
          .trim()
          .slice(0, 120) || 'Merchant';
      const defaultBiz = `${cleanFullName.split(' ')[0]}'s Store`;
      const cleanBusinessName =
        (params.businessName ?? defaultBiz).trim().slice(0, 100) || 'ZENORATI Store';

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

  private async requireAdmin(idToken: string): Promise<VerifiedFirebaseUser> {
    const user = await this.backend.verifyIdToken(idToken);
    const { isAdmin } = await this.resolveAdminStatus(user, idToken);
    if (!isAdmin) {
      throw new AuthServiceError(
        403,
        'ADMIN_REQUIRED',
        'Only an authorized platform owner or administrator can manage invitations.'
      );
    }
    return user;
  }

  async createInvitation(params: {
    idToken: string;
    maxUses: number;
    expiresAtIso: string;
    label?: string;
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
}

export const authInviteService = new AuthInviteService();
