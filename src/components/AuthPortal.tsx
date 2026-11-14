import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Ticket,
  UserPlus,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';
import {
  checkInvitationPreAuth,
  fetchServerSessionInfo,
  InviteApiError,
  redeemInvitationOnServer,
  validatePasswordStrength,
  verifyInvitationAuthenticated,
} from '../services/authInviteClient';
import { fetchExistingCloudTenantProfile } from '../services/tenantStore';

export type AuthPortalMode = 'auth' | 'verify_email' | 'needs_activation';

export interface PendingInviteActivation {
  code: string;
  fullName: string;
  businessName: string;
  savedAt: string;
}

const PENDING_PREFIX = 'zenorati_pending_invite_';

export function getPendingInviteActivation(uid: string): PendingInviteActivation | null {
  try {
    const raw = window.sessionStorage.getItem(`${PENDING_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingInviteActivation;
    if (!parsed || typeof parsed.code !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingInviteActivation(uid: string, data: PendingInviteActivation): void {
  try {
    window.sessionStorage.setItem(`${PENDING_PREFIX}${uid}`, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

export function clearPendingInviteActivation(uid: string): void {
  try {
    window.sessionStorage.removeItem(`${PENDING_PREFIX}${uid}`);
  } catch {
    // Ignore storage errors
  }
}

function mapErrorToMessage(
  err: unknown,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string {
  if (err instanceof InviteApiError) {
    switch (err.code) {
      case 'INVITE_MISSING':
        return t('errInviteMissing');
      case 'INVITE_INVALID':
        return t('errInviteInvalid');
      case 'INVITE_EXPIRED':
        return t('errInviteExpired');
      case 'INVITE_REVOKED':
        return t('errInviteRevoked');
      case 'INVITE_USED':
        return t('errInviteUsed');
      case 'INVITE_CONFLICT':
        return t('errInviteConflict');
      case 'RATE_LIMITED':
        return t('errRateLimited');
      default:
        return err.message;
    }
  }

  const firebaseCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (firebaseCode === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return t('errEmailOpDisabled');
  }
  if (
    firebaseCode === 'auth/wrong-password' ||
    firebaseCode === 'auth/user-not-found' ||
    firebaseCode === 'auth/invalid-credential' ||
    msg.includes('invalid-credential')
  ) {
    return t('errInvalidCreds');
  }
  if (firebaseCode === 'auth/email-already-in-use' || msg.includes('email-already-in-use')) {
    return t('errEmailInUse');
  }
  if (firebaseCode === 'auth/too-many-requests' || msg.includes('too-many-requests')) {
    return t('errTooManyRequests');
  }
  if (
    firebaseCode === 'auth/popup-closed-by-user' ||
    firebaseCode === 'auth/cancelled-popup-request'
  ) {
    return t('errPopupClosed');
  }
  return msg || 'Authentication failed.';
}

interface AuthPortalProps {
  mode: AuthPortalMode;
  firebaseUser: User | null;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  externalError?: string | null;
  onClearExternalError?: () => void;
  onSetExternalError?: (msg: string | null) => void;
  onSessionRefreshNeeded: () => Promise<void>;
}

export const AuthPortal: React.FC<AuthPortalProps> = ({
  mode,
  firebaseUser,
  theme,
  onToggleTheme,
  externalError,
  onClearExternalError,
  onSetExternalError,
  onSessionRefreshNeeded,
}) => {
  const { language, setLanguage, t } = useI18n();
  const [activeTab, setActiveTab] = useState<'login' | 'signup' | 'forgot'>('login');

  // Shared / Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Sign Up state
  const [inviteCode, setInviteCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  // Verification / Activation gate state
  const [activationCode, setActivationCode] = useState('');
  const [activationFullName, setActivationFullName] = useState(firebaseUser?.displayName || '');
  const [activationBusinessName, setActivationBusinessName] = useState('');
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Read ?invite=CODE from URL to prefill invite registration
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlInvite = params.get('invite')?.trim();
      if (urlInvite) {
        setInviteCode(urlInvite.toUpperCase());
        setActivationCode(urlInvite.toUpperCase());
        setActiveTab('signup');
      }
    } catch {
      // Ignore URL parse error
    }
  }, []);

  useEffect(() => {
    if (firebaseUser?.displayName && !activationFullName) {
      setActivationFullName(firebaseUser.displayName);
    }
  }, [firebaseUser?.displayName, activationFullName]);

  const pwRules = validatePasswordStrength(signupPassword);
  const displayedError = errorMsg || externalError || null;

  const clearErrors = () => {
    setErrorMsg(null);
    setResetNotice(null);
    setVerifyNotice(null);
    onClearExternalError?.();
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();
    if (!loginEmail.trim() || !loginPassword) {
      setErrorMsg(t('errInvalidCreds'));
      return;
    }
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      await cred.user.reload();
      await onSessionRefreshNeeded();
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    clearErrors();
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      const idToken = await user.getIdToken(true);
      const [session, existingTenant] = await Promise.all([
        fetchServerSessionInfo(idToken).catch(() => null),
        fetchExistingCloudTenantProfile(user.uid),
      ]);

      const isKnownExistingOrOwner = Boolean(
        existingTenant || session?.hasTenant || session?.isAdmin
      );

      if (!isKnownExistingOrOwner) {
        const createdMs = user.metadata.creationTime
          ? Date.parse(user.metadata.creationTime)
          : 0;
        const isFreshlyCreated = createdMs > 0 && Date.now() - createdMs < 30000;
        if (isFreshlyCreated) {
          onSetExternalError?.(t('errGoogleInviteRequired'));
          setErrorMsg(t('errGoogleInviteRequired'));
          await deleteUser(user).catch(() => signOut(auth));
          return;
        }
        // Let App.tsx resolve or show needs_activation with Switch Account option
      }

      await onSessionRefreshNeeded();
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignUp = async () => {
    clearErrors();
    const trimmedCode = inviteCode.trim();
    if (!trimmedCode) {
      setErrorMsg(t('errInviteMissing'));
      return;
    }

    setBusy(true);
    try {
      // Pre-auth fast reject when server cache already knows the code is invalid/expired/used/revoked
      await checkInvitationPreAuth(trimmedCode);

      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      const idToken = await user.getIdToken(true);
      const existingTenant = await fetchExistingCloudTenantProfile(user.uid);
      if (existingTenant) {
        // Existing active account does not consume a new invitation
        await onSessionRefreshNeeded();
        return;
      }

      try {
        await redeemInvitationOnServer({
          idToken,
          code: trimmedCode,
          fullName: fullName.trim() || user.displayName || undefined,
          businessName: businessName.trim() || undefined,
        });
        await onSessionRefreshNeeded();
      } catch (redeemErr) {
        const createdMs = user.metadata.creationTime
          ? Date.parse(user.metadata.creationTime)
          : 0;
        const isFreshlyCreated = createdMs > 0 && Date.now() - createdMs < 60000;
        if (isFreshlyCreated) {
          await deleteUser(user).catch(() => signOut(auth));
        } else {
          await signOut(auth).catch(() => undefined);
        }
        throw redeemErr;
      }
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();

    const trimmedCode = inviteCode.trim();
    if (!trimmedCode) {
      setErrorMsg(t('errInviteMissing'));
      return;
    }
    if (!fullName.trim()) {
      setErrorMsg(t('authNameRequired'));
      return;
    }
    if (!signupEmail.trim() || !signupEmail.includes('@')) {
      setErrorMsg(t('authEmailRequired'));
      return;
    }
    if (!pwRules.valid) {
      setErrorMsg(t('authPwWeak'));
      return;
    }
    if (signupPassword !== confirmPassword) {
      setErrorMsg(t('authPwMismatch'));
      return;
    }

    setBusy(true);
    try {
      await checkInvitationPreAuth(trimmedCode);

      const cred = await createUserWithEmailAndPassword(auth, signupEmail.trim(), signupPassword);
      const user = cred.user;

      try {
        const idToken = await user.getIdToken(true);
        // Authoritative Firestore-backed invitation validation while signed in
        await verifyInvitationAuthenticated(idToken, trimmedCode);
      } catch (verifyErr) {
        await deleteUser(user).catch(() => signOut(auth));
        throw verifyErr;
      }

      setPendingInviteActivation(user.uid, {
        code: trimmedCode,
        fullName: fullName.trim(),
        businessName: businessName.trim(),
        savedAt: new Date().toISOString(),
      });

      await updateProfile(user, { displayName: fullName.trim().slice(0, 120) }).catch(
        () => undefined
      );
      await sendEmailVerification(user);
      await onSessionRefreshNeeded();
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();
    const targetEmail = resetEmail.trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      setErrorMsg(t('authEmailRequired'));
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      setResetNotice(t('authResetSentNotice', { email: targetEmail }));
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!firebaseUser) return;
    clearErrors();
    setBusy(true);
    try {
      await sendEmailVerification(firebaseUser);
      setVerifyNotice(t('authVerifyResentNotice', { email: firebaseUser.email || '' }));
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerified = async () => {
    if (!firebaseUser) return;
    clearErrors();
    setBusy(true);
    try {
      await firebaseUser.reload();
      await firebaseUser.getIdToken(true);
      if (!auth.currentUser?.emailVerified) {
        setErrorMsg(t('authVerifyStillPending'));
        return;
      }
      await onSessionRefreshNeeded();
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleActivateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    clearErrors();
    const trimmedCode = activationCode.trim();
    if (!trimmedCode) {
      setErrorMsg(t('errInviteMissing'));
      return;
    }
    setBusy(true);
    try {
      const idToken = await firebaseUser.getIdToken(true);
      await redeemInvitationOnServer({
        idToken,
        code: trimmedCode,
        fullName: activationFullName.trim() || firebaseUser.displayName || undefined,
        businessName: activationBusinessName.trim() || undefined,
      });
      clearPendingInviteActivation(firebaseUser.uid);
      await onSessionRefreshNeeded();
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOutGate = async () => {
    clearErrors();
    setBusy(true);
    try {
      if (firebaseUser) clearPendingInviteActivation(firebaseUser.uid);
      await signOut(auth);
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUnactivated = async () => {
    if (!firebaseUser) return;
    clearErrors();
    setBusy(true);
    try {
      clearPendingInviteActivation(firebaseUser.uid);
      await deleteUser(firebaseUser).catch(() => signOut(auth));
    } catch (err) {
      setErrorMsg(mapErrorToMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const pwChecklist = [
    { ok: pwRules.minLength, label: t('authPwRuleLength') },
    { ok: pwRules.hasUpper, label: t('authPwRuleUpper') },
    { ok: pwRules.hasLower, label: t('authPwRuleLower') },
    { ok: pwRules.hasNumber, label: t('authPwRuleNumber') },
    { ok: pwRules.hasSpecial, label: t('authPwRuleSpecial') },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#060B18] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar Controls */}
      <header className="h-16 px-4 sm:px-8 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#070D1D]/90 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-sm shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6H20L8 18H20"
                stroke="white"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
            {t('brandName')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
            aria-label={t('switchLanguageAria')}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" aria-hidden="true" />
            <span>{language === 'en' ? t('languageAr') : t('languageEn')}</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? t('switchLightAria') : t('switchDarkAria')}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      {/* Main Centered Auth Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md space-y-5">
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-cyan-400">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span>
                {mode === 'auth' && activeTab !== 'signup'
                  ? t('authLoginBadge')
                  : t('authInviteOnlyBadge')}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t('brandName')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('authPortalSubtitle')}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 shadow-xl space-y-5">
            {displayedError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{displayedError}</span>
              </div>
            )}

            {mode === 'verify_email' && firebaseUser && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                    <Mail className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {t('authVerifyTitle')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {t('authVerifyDesc', { email: firebaseUser.email || '' })}
                    </p>
                  </div>
                </div>

                {verifyNotice && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                    {verifyNotice}
                  </div>
                )}

                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCheckVerified}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    {busy ? t('authVerifyCheckingBtn') : t('authVerifyCheckBtn')}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleResendVerification}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    {busy ? t('authVerifyResendingBtn') : t('authVerifyResendBtn')}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSignOutGate}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('signOut')}
                  </button>
                </div>
              </div>
            )}

            {mode === 'needs_activation' && firebaseUser && (
              <form onSubmit={handleActivateWorkspace} className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Ticket className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {t('authActivateTitle')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {t('authActivateDesc', { email: firebaseUser.email || '' })}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('authInviteCodeLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                    placeholder={t('authInviteCodePlaceholder')}
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('authFullNameLabel')}
                    </label>
                    <input
                      type="text"
                      value={activationFullName}
                      onChange={(e) => setActivationFullName(e.target.value)}
                      placeholder={t('authFullNamePlaceholder')}
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('authBusinessNameOptLabel')}
                    </label>
                    <input
                      type="text"
                      value={activationBusinessName}
                      onChange={(e) => setActivationBusinessName(e.target.value)}
                      placeholder={t('authBusinessNamePlaceholder')}
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  {busy ? t('authActivatingBtn') : t('authActivateBtn')}
                </button>

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSignOutGate}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('authBackToSignInBtn')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDeleteUnactivated}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                  >
                    {t('authDeleteUnactivatedBtn')}
                  </button>
                </div>
              </form>
            )}

            {mode === 'auth' && (
              <>
                {/* Navigation Tabs */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      clearErrors();
                      setActiveTab('login');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      activeTab === 'login' || activeTab === 'forgot'
                        ? 'bg-white dark:bg-[#0B1328] text-blue-600 dark:text-cyan-300 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {t('authTabLogin')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearErrors();
                      setActiveTab('signup');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      activeTab === 'signup'
                        ? 'bg-white dark:bg-[#0B1328] text-blue-600 dark:text-cyan-300 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {t('authTabSignUp')}
                  </button>
                </div>

                {/* LOGIN TAB */}
                {activeTab === 'login' && (
                  <div className="space-y-4">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('authExistingUserHint')}
                    </p>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleGoogleLogin}
                      className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-800 dark:text-slate-100 hover:border-blue-500/40 disabled:opacity-60 cursor-pointer"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                        />
                      </svg>
                      <span>{t('authContinueGoogleBtn')}</span>
                    </button>

                    <div className="relative flex items-center py-1">
                      <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                      <span className="px-3 text-[11px] text-slate-400 uppercase">
                        {t('authOrDivider')}
                      </span>
                      <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                    </div>

                    <form onSubmit={handleEmailLogin} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          {t('authEmailLabel')}
                        </label>
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder={t('authEmailPlaceholder')}
                          dir="ltr"
                          className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            {t('authPasswordLabel')}
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              clearErrors();
                              setResetEmail(loginEmail);
                              setActiveTab('forgot');
                            }}
                            className="text-[11px] font-medium text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                          >
                            {t('authForgotLink')}
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showLoginPw ? 'text' : 'password'}
                            required
                            autoComplete="current-password"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder={t('authPasswordPlaceholder')}
                            dir="ltr"
                            className="w-full ps-3.5 pe-10 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPw((v) => !v)}
                            className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                            aria-label="Toggle password visibility"
                          >
                            {showLoginPw ? (
                              <EyeOff className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                      >
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                        {busy ? t('authSigningInBtn') : t('authSignInBtn')}
                      </button>
                    </form>
                  </div>
                )}

                {/* FORGOT PASSWORD TAB */}
                {activeTab === 'forgot' && (
                  <form onSubmit={handleSendReset} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                        {t('authTabForgot')}
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          clearErrors();
                          setActiveTab('login');
                        }}
                        className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                      >
                        {t('authBackToLoginLink')}
                      </button>
                    </div>

                    {resetNotice && (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                        {resetNotice}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('authEmailLabel')}
                      </label>
                      <input
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder={t('authEmailPlaceholder')}
                        dir="ltr"
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                    >
                      <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                      {busy ? t('authSendingResetBtn') : t('authSendResetBtn')}
                    </button>
                  </form>
                )}

                {/* INVITATION-ONLY SIGN UP TAB */}
                {activeTab === 'signup' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                        {t('authInviteCodeLabel')} *
                      </label>
                      <input
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        placeholder={t('authInviteCodePlaceholder')}
                        dir="ltr"
                        className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-blue-500/40 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {t('authInviteCodeHint')}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleGoogleSignUp}
                      className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-800 dark:text-slate-100 hover:border-blue-500/40 disabled:opacity-60 cursor-pointer"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                        />
                      </svg>
                      <span>{t('authSignUpGoogleBtn')}</span>
                    </button>

                    <div className="relative flex items-center py-0.5">
                      <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                      <span className="px-3 text-[11px] text-slate-400 uppercase">
                        {t('authOrDivider')}
                      </span>
                      <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                    </div>

                    <form onSubmit={handleEmailSignUp} className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('authFullNameLabel')} *
                          </label>
                          <input
                            type="text"
                            required
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder={t('authFullNamePlaceholder')}
                            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('authBusinessNameOptLabel')}
                          </label>
                          <input
                            type="text"
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder={t('authBusinessNamePlaceholder')}
                            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          {t('authEmailLabel')} *
                        </label>
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          placeholder={t('authEmailPlaceholder')}
                          dir="ltr"
                          className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          {t('authPasswordLabel')} *
                        </label>
                        <div className="relative">
                          <input
                            type={showSignupPw ? 'text' : 'password'}
                            required
                            autoComplete="new-password"
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            placeholder={t('authPasswordPlaceholder')}
                            dir="ltr"
                            className="w-full ps-3.5 pe-10 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSignupPw((v) => !v)}
                            className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                            aria-label="Toggle password visibility"
                          >
                            {showSignupPw ? (
                              <EyeOff className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-1">
                          {pwChecklist.map((rule) => (
                            <div
                              key={rule.label}
                              className={`text-[11px] flex items-center gap-1.5 ${
                                rule.ok
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>{rule.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          {t('authConfirmPasswordLabel')} *
                        </label>
                        <input
                          type={showSignupPw ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder={t('authPasswordPlaceholder')}
                          dir="ltr"
                          className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                      >
                        <UserPlus className="w-4 h-4" aria-hidden="true" />
                        {busy ? t('authCreatingAccountBtn') : t('authSignUpEmailBtn')}
                      </button>
                    </form>

                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 text-center space-y-1.5">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('authHaveAccountPrompt')}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          clearErrors();
                          setActiveTab('login');
                        }}
                        className="text-xs font-semibold text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                      >
                        {t('authSwitchToSignInBtn')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
