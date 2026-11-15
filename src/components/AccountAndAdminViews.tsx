import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendPasswordResetEmail, updateProfile, type User } from 'firebase/auth';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Ticket,
  User as UserIcon,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { useI18n } from '../i18n/I18nContext';
import type {
  AppLanguage,
  AuthSessionInfo,
  CanonicalRole,
  CurrencyCode,
  InvitationRecord,
  InvitationStatus,
  TenantProfile,
} from '../types/zenorati';
import { normalizeCanonicalRole } from '../utils/permissions';
import {
  createAdminInvitation,
  listAdminInvitations,
  revokeAdminInvitation,
} from '../services/authInviteClient';

function formatTimestamp(iso: string | undefined | null, lang: AppLanguage): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

interface UserProfileViewProps {
  profile: TenantProfile;
  firebaseUser: User;
  sessionInfo: AuthSessionInfo | null;
  onSaveProfile: (next: TenantProfile) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  profile,
  firebaseUser,
  sessionInfo,
  onSaveProfile,
  onSignOut,
}) => {
  const { language, t } = useI18n();
  const [fullName, setFullName] = useState(
    profile.fullName ?? firebaseUser.displayName ?? ''
  );
  const [photoUrl, setPhotoUrl] = useState(
    profile.photoUrl ?? firebaseUser.photoURL ?? ''
  );
  const [businessName, setBusinessName] = useState(profile.businessName);
  const [selectedLang, setSelectedLang] = useState<AppLanguage>(profile.language ?? language);
  const [currency, setCurrency] = useState<CurrencyCode>(profile.currency);

  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setFullName(profile.fullName ?? firebaseUser.displayName ?? '');
    setPhotoUrl(profile.photoUrl ?? firebaseUser.photoURL ?? '');
    setBusinessName(profile.businessName);
    setSelectedLang(profile.language ?? language);
    setCurrency(profile.currency);
    setImgBroken(false);
  }, [profile, firebaseUser.displayName, firebaseUser.photoURL, language]);

  const effectiveRole: CanonicalRole = useMemo(() => {
    if (sessionInfo?.isSuperAdmin) return 'super_admin';
    if (sessionInfo?.role) return normalizeCanonicalRole(sessionInfo.role, 'tenant');
    return normalizeCanonicalRole(profile.role, 'tenant');
  }, [sessionInfo?.isSuperAdmin, sessionInfo?.role, profile.role]);

  const roleLabel =
    effectiveRole === 'super_admin'
      ? t('saRoleSuperAdmin')
      : effectiveRole === 'store_owner'
      ? t('saRoleStoreOwner')
      : effectiveRole === 'manager'
      ? t('saRoleManager')
      : effectiveRole === 'staff'
      ? t('saRoleStaff')
      : t('saRoleViewer');

  const accountStatus = sessionInfo?.accountStatus ?? profile.accountStatus ?? 'active';
  const superAdminDiag = sessionInfo?.superAdminDiagnostic ?? null;
  const isVerifiedSuperAdmin = Boolean(sessionInfo?.isSuperAdmin);

  const accountCreatedAt =
    profile.createdAt ?? firebaseUser.metadata.creationTime ?? null;

  const initials = (fullName || firebaseUser.email || 'Z')
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedNotice(false);
    setSaving(true);
    try {
      const trimmedName = fullName.trim().slice(0, 120);
      const trimmedPhoto = photoUrl.trim().slice(0, 500);
      const trimmedBiz = businessName.trim().slice(0, 100) || profile.businessName;

      // Update permitted Firebase Auth profile metadata as well
      await updateProfile(firebaseUser, {
        displayName: trimmedName || undefined,
        photoURL: trimmedPhoto || null,
      }).catch(() => undefined);

      await onSaveProfile({
        ...profile,
        fullName: trimmedName,
        photoUrl: trimmedPhoto,
        businessName: trimmedBiz,
        language: selectedLang,
        currency,
      });
      setSavedNotice(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUid = async () => {
    try {
      await navigator.clipboard.writeText(firebaseUser.uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handlePasswordReset = async () => {
    const email = firebaseUser.email;
    if (!email) return;
    setErrorMsg(null);
    setResetSent(false);
    setSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send password reset email.');
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('profileTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('profileSubtitle')}
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Identity Overview Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800/70">
          <div className="flex items-center gap-4 min-w-0">
            {photoUrl.trim() && !imgBroken ? (
              <img
                src={photoUrl.trim()}
                alt={fullName || firebaseUser.email || 'User avatar'}
                onError={() => setImgBroken(true)}
                className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
                {initials || <UserIcon className="w-6 h-6" aria-hidden="true" />}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {fullName || firebaseUser.displayName || profile.businessName}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-cyan-300">
                  <Shield className="w-3 h-3" aria-hidden="true" />
                  {roleLabel}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  {accountStatus === 'suspended'
                    ? t('profileStatusSuspended')
                    : t('profileStatusActive')}
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                <span dir="ltr">{firebaseUser.email}</span>
                {firebaseUser.emailVerified ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('profileVerifiedBadge')}
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {t('profileUnverifiedBadge')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            {t('signOut')}
          </button>
        </div>

        {/* Read-only Security Metadata Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('profileUidLabel')}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate" dir="ltr">
                {firebaseUser.uid}
              </span>
              <button
                type="button"
                onClick={handleCopyUid}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-cyan-400 hover:underline shrink-0 cursor-pointer"
              >
                {copiedUid ? (
                  <>
                    <Check className="w-3 h-3" aria-hidden="true" />
                    {t('profileCopiedLabel')}
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" aria-hidden="true" />
                    {t('profileCopyUidBtn')}
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('profileCreatedAtLabel')}
            </div>
            <div className="mt-1 text-xs font-mono text-slate-800 dark:text-slate-200">
              {formatTimestamp(accountCreatedAt, language)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('profileRoleLabel')} / {t('profileStatusLabel')}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
              {roleLabel} ·{' '}
              {accountStatus === 'suspended'
                ? t('profileStatusSuspended')
                : t('profileStatusActive')}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" aria-hidden="true" />
          <span>{t('profileSecurityNote')}</span>
        </div>
      </div>

      {/* Super Admin Verification Diagnostic Card (Read-Only) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <ShieldCheck
              className={`w-4 h-4 ${
                isVerifiedSuperAdmin
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
              aria-hidden="true"
            />
            <span>{t('saDiagTitle')}</span>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border ${
              isVerifiedSuperAdmin
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}
          >
            {isVerifiedSuperAdmin
              ? t('saDiagVerified', { uid: firebaseUser.uid })
              : t('saDiagUnverified')}
          </span>
        </div>

        <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {isVerifiedSuperAdmin ? (
            <span>
              {t('saDiagVerified', { uid: firebaseUser.uid })} ·{' '}
              <span className="font-mono">{superAdminDiag?.adminDocRole ?? 'super_admin'}</span>
            </span>
          ) : superAdminDiag?.reason === 'email_unverified' ? (
            t('saDiagEmailUnverified')
          ) : superAdminDiag?.reason === 'role_insufficient' ? (
            t('saDiagRoleInsufficient', {
              uid: firebaseUser.uid,
              role: superAdminDiag.adminDocRole ?? 'unknown',
            })
          ) : (
            t('saDiagMissingAdminDoc', { uid: firebaseUser.uid })
          )}
        </div>
      </div>

      {/* Editable Profile Details & Preferences Form */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-5"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          {t('profileAvatarTitle')} & {t('profilePrefsTitle')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('profileDisplayNameLabel')}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('authFullNamePlaceholder')}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('profileBusinessNameLabel')}
            </label>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('profilePhotoUrlLabel')}
            </label>
            <input
              type="url"
              value={photoUrl}
              onChange={(e) => {
                setPhotoUrl(e.target.value);
                setImgBroken(false);
              }}
              placeholder={t('profilePhotoUrlPlaceholder')}
              dir="ltr"
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('storeLanguageLabel')}
            </label>
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value === 'ar' ? 'ar' : 'en')}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="en">{t('languageOptEn')}</option>
              <option value="ar">{t('languageOptAr')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('defaultCurrencyLabel')}
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value === 'EGP' ? 'EGP' : 'USD')}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="USD">USD ($) — US Dollar</option>
              <option value="EGP">EGP (E£) — Egyptian Pound</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            {savedNotice ? t('profileSavedNotice') : ''}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
          >
            {saving ? t('saving') : t('saveChanges')}
          </button>
        </div>
      </form>

      {/* Password Reset Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('profilePasswordResetTitle')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('profilePasswordResetDesc', { email: firebaseUser.email || '' })}
          </p>
          {resetSent && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-2">
              {t('profileResetSentMsg', { email: firebaseUser.email || '' })}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={sendingReset || !firebaseUser.email}
          onClick={handlePasswordReset}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 shrink-0 cursor-pointer"
        >
          <Mail className="w-3.5 h-3.5" aria-hidden="true" />
          {sendingReset ? t('authSendingResetBtn') : t('profileSendResetBtn')}
        </button>
      </div>
    </div>
  );
};

interface AdminInvitationsViewProps {
  firebaseUser: User;
}

export const AdminInvitationsView: React.FC<AdminInvitationsViewProps> = ({ firebaseUser }) => {
  const { language, t } = useI18n();
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | InvitationStatus>('all');

  // Create form state
  const [usageMode, setUsageMode] = useState<'single' | 'limited'>('single');
  const [maxUsesInput, setMaxUsesInput] = useState('5');
  const [expiryPreset, setExpiryPreset] = useState<'24h' | '3d' | '7d' | '30d' | 'custom'>('7d');
  const [customExpiry, setCustomExpiry] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [labelInput, setLabelInput] = useState('');
  const [creating, setCreating] = useState(false);

  // Newly created invite display (shown once!)
  const [newlyGeneratedCode, setNewlyGeneratedCode] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const rows = await listAdminInvitations(idToken);
      setInvitations(rows);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load invitations.');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setCreating(true);
    try {
      const maxUses =
        usageMode === 'single' ? 1 : Math.min(100, Math.max(1, Math.round(Number(maxUsesInput) || 1)));
      let expiresMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
      if (expiryPreset === '24h') expiresMs = Date.now() + 24 * 60 * 60 * 1000;
      else if (expiryPreset === '3d') expiresMs = Date.now() + 3 * 24 * 60 * 60 * 1000;
      else if (expiryPreset === '7d') expiresMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
      else if (expiryPreset === '30d') expiresMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      else if (expiryPreset === 'custom') {
        const parsed = Date.parse(customExpiry);
        if (!Number.isFinite(parsed) || parsed <= Date.now()) {
          throw new Error('Expiration date/time must be in the future.');
        }
        expiresMs = parsed;
      }

      const idToken = await firebaseUser.getIdToken();
      const res = await createAdminInvitation({
        idToken,
        maxUses,
        expiresAtIso: new Date(expiresMs).toISOString(),
        label: labelInput.trim(),
      });
      setNewlyGeneratedCode(res.inviteCode);
      setLabelInput('');
      setInvitations((prev) => [res.invitation, ...prev]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate invitation.');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    setErrorMsg(null);
    setRevokingId(inviteId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const updated = await revokeAdminInvitation(idToken, inviteId);
      setInvitations((prev) => prev.map((inv) => (inv.id === inviteId ? updated : inv)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to revoke invitation.');
    } finally {
      setRevokingId(null);
    }
  };

  const copyNewInvite = async (kind: 'code' | 'link') => {
    if (!newlyGeneratedCode) return;
    const text =
      kind === 'code'
        ? newlyGeneratedCode
        : `${window.location.origin}/?invite=${encodeURIComponent(newlyGeneratedCode)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(kind);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return invitations;
    return invitations.filter((inv) => inv.status === filterStatus);
  }, [invitations, filterStatus]);

  const statusBadge = (status: InvitationStatus) => {
    switch (status) {
      case 'active':
        return {
          label: t('invStatusActive'),
          cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        };
      case 'used':
        return {
          label: t('invStatusUsed'),
          cls: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-cyan-300',
        };
      case 'expired':
        return {
          label: t('invStatusExpired'),
          cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        };
      case 'revoked':
        return {
          label: t('invStatusRevoked'),
          cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
        };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t('invitationsTitle')}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-cyan-300">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              {t('invitationsAdminBadge')}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('invitationsSubtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={loadInvitations}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('invRefreshBtn')}
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Newly Generated Code Banner (shown once) */}
      {newlyGeneratedCode && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
            <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('invNewCodeTitle')}</span>
          </div>
          <p className="text-xs text-emerald-700/90 dark:text-emerald-200/80">
            {t('invNewCodeHint')}
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <code
              dir="ltr"
              className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#070D1D] border border-emerald-500/30 font-mono text-sm font-bold text-slate-900 dark:text-white tracking-wider"
            >
              {newlyGeneratedCode}
            </code>
            <button
              type="button"
              onClick={() => copyNewInvite('code')}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 cursor-pointer"
            >
              {copiedType === 'code' ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {copiedType === 'code' ? t('profileCopiedLabel') : t('invCopyCodeBtn')}
            </button>
            <button
              type="button"
              onClick={() => copyNewInvite('link')}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-emerald-500/40 bg-white dark:bg-[#070D1D] text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
            >
              {copiedType === 'link' ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {copiedType === 'link' ? t('profileCopiedLabel') : t('invCopyLinkBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Generate New Invitation Card */}
      <form
        onSubmit={handleGenerate}
        className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-4"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Ticket className="w-4 h-4 text-blue-600 dark:text-cyan-400" aria-hidden="true" />
          <span>{t('invCreateTitle')}</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('invUsageModeLabel')}
            </label>
            <select
              value={usageMode}
              onChange={(e) => setUsageMode(e.target.value === 'limited' ? 'limited' : 'single')}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="single">{t('invSingleUseOpt')}</option>
              <option value="limited">{t('invLimitedUseOpt')}</option>
            </select>
          </div>

          {usageMode === 'limited' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('invMaxUsesLabel')}
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={maxUsesInput}
                onChange={(e) => setMaxUsesInput(e.target.value)}
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('invExpiryPresetLabel')}
            </label>
            <select
              value={expiryPreset}
              onChange={(e) =>
                setExpiryPreset(e.target.value as '24h' | '3d' | '7d' | '30d' | 'custom')
              }
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="24h">{t('invExpiry24h')}</option>
              <option value="3d">{t('invExpiry3d')}</option>
              <option value="7d">{t('invExpiry7d')}</option>
              <option value="30d">{t('invExpiry30d')}</option>
              <option value="custom">{t('invExpiryCustom')}</option>
            </select>
          </div>

          {expiryPreset === 'custom' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('invCustomExpiryLabel')}
              </label>
              <input
                type="datetime-local"
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value)}
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
          )}

          <div className={usageMode === 'single' && expiryPreset !== 'custom' ? 'lg:col-span-2' : ''}>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('invLabelField')}
            </label>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder={t('invLabelPlaceholder')}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {creating ? t('invGeneratingBtn') : t('invGenerateBtn')}
          </button>
        </div>
      </form>

      {/* Invitations List */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('invListTitle', { count: filtered.length })}
          </h2>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: t('invFilterAll') },
                { id: 'active', label: t('invFilterActive') },
                { id: 'used', label: t('invFilterUsed') },
                { id: 'expired', label: t('invFilterExpired') },
                { id: 'revoked', label: t('invFilterRevoked') },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  filterStatus === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-[#070D1D] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center space-y-1.5">
            <Ticket className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {t('invEmptyTitle')}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t('invEmptyDesc')}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pe-3 text-start font-medium">{t('invColCodePreview')}</th>
                  <th className="py-2.5 px-3 text-start font-medium">{t('invColLabel')}</th>
                  <th className="py-2.5 px-3 text-start font-medium">{t('invColStatus')}</th>
                  <th className="py-2.5 px-3 text-start font-medium">{t('invColUsage')}</th>
                  <th className="py-2.5 px-3 text-start font-medium">{t('invColDates')}</th>
                  <th className="py-2.5 px-3 text-start font-medium">{t('invColCreator')}</th>
                  <th className="py-2.5 px-3 text-start font-medium">{t('invColRedeemers')}</th>
                  <th className="py-2.5 ps-3 text-end font-medium">{t('invColActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filtered.map((inv) => {
                  const badge = statusBadge(inv.status);
                  return (
                    <tr key={inv.id} className="align-top">
                      <td className="py-3 pe-3 font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap" dir="ltr">
                        {inv.codePreview}
                      </td>
                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                        {inv.label || '—'}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {inv.usedCount} / {inv.maxUses}
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        <div>{formatTimestamp(inv.createdAt, language)}</div>
                        <div className="text-slate-400 dark:text-slate-500">
                          → {formatTimestamp(inv.expiresAt, language)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[140px]" dir="ltr">
                          {inv.createdByUid}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[11px]">
                        {inv.redemptions && inv.redemptions.length > 0 ? (
                          <div className="space-y-1.5">
                            {inv.redemptions.map((r) => (
                              <div
                                key={`${inv.id}_${r.uid}`}
                                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] px-2.5 py-1.5"
                              >
                                <div className="font-medium text-slate-800 dark:text-slate-200">
                                  {r.displayName || r.email || r.uid}
                                </div>
                                {r.email && (
                                  <div className="text-slate-500 dark:text-slate-400" dir="ltr">
                                    {r.email}
                                  </div>
                                )}
                                <div className="text-[10px] font-mono text-slate-400">
                                  {r.provider} · {formatTimestamp(r.redeemedAt, language)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">{t('invNoRedemptionsYet')}</span>
                        )}
                      </td>
                      <td className="py-3 ps-3 text-end">
                        {inv.status === 'active' ? (
                          <button
                            type="button"
                            disabled={revokingId === inv.id}
                            onClick={() => handleRevoke(inv.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-60 cursor-pointer"
                          >
                            <Ban className="w-3 h-3" aria-hidden="true" />
                            {revokingId === inv.id ? t('invRevokingBtn') : t('invRevokeBtn')}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
