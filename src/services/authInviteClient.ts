import type {
  AuthSessionInfo,
  CanonicalRole,
  EmailDeliveryInfo,
  InvitationRecord,
  SectionPermissions,
} from '../types/zenorati';

export interface PasswordValidationResult {
  valid: boolean;
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const minLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return {
    valid: minLength && hasUpper && hasLower && hasNumber && hasSpecial,
    minLength,
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
  };
}

export class InviteApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : 'REQUEST_FAILED';
    const message =
      typeof body.error === 'string' ? body.error : `Request failed with status ${res.status}.`;
    throw new InviteApiError(res.status, code, message);
  }
  return body as T;
}

export async function fetchServerSessionInfo(idToken: string): Promise<AuthSessionInfo> {
  const res = await fetch('/api/auth/session', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return parseJsonOrThrow<AuthSessionInfo>(res);
}

export async function checkInvitationPreAuth(code: string): Promise<{
  valid: boolean;
  verifiedByCache: boolean;
  codePreview?: string;
  remainingUses?: number;
  expiresAt?: string;
  targetRole?: CanonicalRole;
  targetFullName?: string;
  targetBusinessName?: string;
}> {
  const res = await fetch('/api/auth/invitations/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return parseJsonOrThrow(res);
}

export async function verifyInvitationAuthenticated(
  idToken: string,
  code: string
): Promise<{
  valid: boolean;
  codePreview: string;
  remainingUses: number;
  expiresAt: string;
  targetRole?: CanonicalRole;
}> {
  const res = await fetch('/api/auth/invitations/verify-authenticated', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  return parseJsonOrThrow(res);
}

export async function redeemInvitationOnServer(params: {
  idToken: string;
  code: string;
  fullName?: string;
  businessName?: string;
}): Promise<{
  alreadyActive: boolean;
  invitation?: InvitationRecord;
}> {
  const res = await fetch('/api/auth/invitations/redeem', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: params.code,
      fullName: params.fullName,
      businessName: params.businessName,
    }),
  });
  return parseJsonOrThrow(res);
}

export async function listAdminInvitations(idToken: string): Promise<InvitationRecord[]> {
  const res = await fetch('/api/admin/invitations', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ invitations: InvitationRecord[] }>(res);
  return data.invitations ?? [];
}

export async function createAdminInvitation(params: {
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
  const res = await fetch('/api/admin/invitations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      maxUses: params.maxUses,
      expiresAtIso: params.expiresAtIso,
      label: params.label ?? '',
      targetEmail: params.targetEmail,
      targetFullName: params.targetFullName,
      targetBusinessName: params.targetBusinessName,
      targetRole: params.targetRole,
      targetTenantId: params.targetTenantId,
      targetPermissions: params.targetPermissions,
    }),
  });
  return parseJsonOrThrow(res);
}

export async function resendAdminInvitation(
  idToken: string,
  inviteId: string
): Promise<{ invitation: InvitationRecord; emailDelivery: EmailDeliveryInfo }> {
  const res = await fetch(`/api/admin/invitations/${encodeURIComponent(inviteId)}/resend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return parseJsonOrThrow(res);
}

export async function revokeAdminInvitation(
  idToken: string,
  inviteId: string
): Promise<InvitationRecord> {
  const res = await fetch(`/api/admin/invitations/${encodeURIComponent(inviteId)}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow<{ invitation: InvitationRecord }>(res);
  return data.invitation;
}
