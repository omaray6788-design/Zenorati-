import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Store,
  Ticket,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type {
  AccountStatus,
  AdminAuditLogEntry,
  AppLanguage,
  CanonicalRole,
  EmailDeliveryInfo,
  InvitationRecord,
  InvitationStatus,
  NavSection,
  PermissionAction,
  PermissionSection,
  PlatformUserRecord,
  RoleTemplateRecord,
  SectionPermissions,
  StoreInspectionReport,
  StoreSummaryRecord,
  SuperAdminOverviewData,
} from '../types/zenorati';
import {
  getDefaultPermissionsForRole,
  PERMISSION_ACTIONS,
  PERMISSION_SECTIONS,
  sanitizePermissions,
} from '../utils/permissions';
import {
  createAdminInvitation,
  listAdminInvitations,
  resendAdminInvitation,
  revokeAdminInvitation,
} from '../services/authInviteClient';
import {
  deletePlatformUser,
  fetchSuperAdminAuditLogs,
  fetchSuperAdminOverview,
  fetchSuperAdminRoles,
  fetchSuperAdminStores,
  fetchSuperAdminUsers,
  inspectSuperAdminStore,
  invitePlatformUser,
  updatePlatformUser,
  updatePlatformUserStatus,
  updateSuperAdminRoleTemplate,
  updateSuperAdminStoreStatus,
} from '../services/superAdminClient';

interface SuperAdminDashboardViewProps {
  activeSection: Extract<
    NavSection,
    'sa_overview' | 'sa_users' | 'sa_stores' | 'sa_invitations' | 'sa_roles' | 'sa_audit'
  >;
  firebaseUser: User;
  onSelectSection: (section: NavSection) => void;
}

function formatDateTime(iso: string | undefined | null, lang: AppLanguage): string {
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

function roleBadgeStyle(role: CanonicalRole): string {
  switch (role) {
    case 'super_admin':
      return 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300';
    case 'store_owner':
      return 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-cyan-300';
    case 'manager':
      return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'staff':
      return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'viewer':
      return 'border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300';
  }
}

export const SuperAdminDashboardView: React.FC<SuperAdminDashboardViewProps> = ({
  activeSection,
  firebaseUser,
  onSelectSection,
}) => {
  const { language, t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Data per view
  const [overview, setOverview] = useState<SuperAdminOverviewData | null>(null);
  const [users, setUsers] = useState<PlatformUserRecord[]>([]);
  const [stores, setStores] = useState<StoreSummaryRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [roles, setRoles] = useState<RoleTemplateRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogEntry[]>([]);

  // Users filters & modals
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | CanonicalRole>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | AccountStatus>('all');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteBusinessName, setInviteBusinessName] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<CanonicalRole, 'super_admin'>>('store_owner');
  const [inviteTenantId, setInviteTenantId] = useState('');
  const [inviteExpiry, setInviteExpiry] = useState<'24h' | '3d' | '7d' | '30d'>('7d');
  const [inviteCustomPerms, setInviteCustomPerms] = useState<SectionPermissions>(() =>
    getDefaultPermissionsForRole('store_owner')
  );
  const [showInviteMatrix, setShowInviteMatrix] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    inviteCode: string;
    inviteUrl: string;
    emailDelivery: EmailDeliveryInfo;
  } | null>(null);

  // Edit User modal
  const [editingUser, setEditingUser] = useState<PlatformUserRecord | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState<Exclude<CanonicalRole, 'super_admin'>>('store_owner');
  const [editTenantId, setEditTenantId] = useState('');
  const [editBusinessName, setEditBusinessName] = useState('');
  const [editPermissions, setEditPermissions] = useState<SectionPermissions>(() =>
    getDefaultPermissionsForRole('store_owner')
  );
  const [savingUser, setSavingUser] = useState(false);

  // Delete User modal (typed confirmation)
  const [deletingUser, setDeletingUser] = useState<PlatformUserRecord | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);

  // Store filters & inspection report
  const [storeSearch, setStoreSearch] = useState('');
  const [inspectionReport, setInspectionReport] = useState<StoreInspectionReport | null>(null);
  const [inspectingTenantId, setInspectingTenantId] = useState<string | null>(null);

  // Invitations state
  const [invFilter, setInvFilter] = useState<'all' | InvitationStatus>('all');
  const [invUsageMode, setInvUsageMode] = useState<'single' | 'limited'>('single');
  const [invMaxUses, setInvMaxUses] = useState('5');
  const [invExpiryPreset, setInvExpiryPreset] = useState<'24h' | '3d' | '7d' | '30d'>('7d');
  const [invTargetEmail, setInvTargetEmail] = useState('');
  const [invTargetRole, setInvTargetRole] = useState<Exclude<CanonicalRole, 'super_admin'>>('store_owner');
  const [invTargetTenantId, setInvTargetTenantId] = useState('');
  const [invLabel, setInvLabel] = useState('');
  const [invCreating, setInvCreating] = useState(false);
  const [newlyCreatedInvite, setNewlyCreatedInvite] = useState<{
    code: string;
    url: string;
  } | null>(null);
  const [resendFeedback, setResendFeedback] = useState<{
    inviteId: string;
    delivery: EmailDeliveryInfo;
  } | null>(null);

  // Roles editor state
  const [selectedRoleTab, setSelectedRoleTab] = useState<CanonicalRole>('manager');
  const [roleDraftLabel, setRoleDraftLabel] = useState('');
  const [roleDraftDesc, setRoleDraftDesc] = useState('');
  const [roleDraftPerms, setRoleDraftPerms] = useState<SectionPermissions>(() =>
    getDefaultPermissionsForRole('manager')
  );
  const [savingRole, setSavingRole] = useState(false);

  // Audit log filter
  const [auditSearch, setAuditSearch] = useState('');

  // Clipboard feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const roleLabel = useCallback(
    (role: CanonicalRole): string => {
      switch (role) {
        case 'super_admin':
          return t('saRoleSuperAdmin');
        case 'store_owner':
          return t('saRoleStoreOwner');
        case 'manager':
          return t('saRoleManager');
        case 'staff':
          return t('saRoleStaff');
        case 'viewer':
          return t('saRoleViewer');
      }
    },
    [t]
  );

  const loadSectionData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      if (activeSection === 'sa_overview') {
        const data = await fetchSuperAdminOverview(idToken);
        setOverview(data);
      } else if (activeSection === 'sa_users') {
        const [uRows, sRows] = await Promise.all([
          fetchSuperAdminUsers(idToken),
          fetchSuperAdminStores(idToken),
        ]);
        setUsers(uRows);
        setStores(sRows);
      } else if (activeSection === 'sa_stores') {
        const sRows = await fetchSuperAdminStores(idToken);
        setStores(sRows);
      } else if (activeSection === 'sa_invitations') {
        const [invRows, sRows] = await Promise.all([
          listAdminInvitations(idToken),
          fetchSuperAdminStores(idToken),
        ]);
        setInvitations(invRows);
        setStores(sRows);
      } else if (activeSection === 'sa_roles') {
        const rRows = await fetchSuperAdminRoles(idToken);
        setRoles(rRows);
        const current = rRows.find((r) => r.role === selectedRoleTab) ?? rRows[0];
        if (current) {
          setRoleDraftLabel(current.label);
          setRoleDraftDesc(current.description);
          setRoleDraftPerms(current.permissions);
        }
      } else if (activeSection === 'sa_audit') {
        const logs = await fetchSuperAdminAuditLogs(idToken);
        setAuditLogs(logs);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load Super Admin data.');
    } finally {
      setLoading(false);
    }
  }, [activeSection, firebaseUser, selectedRoleTab]);

  useEffect(() => {
    void loadSectionData();
  }, [loadSectionData]);

  const handleSelectRoleTab = (role: CanonicalRole) => {
    setSelectedRoleTab(role);
    const found = roles.find((r) => r.role === role);
    if (found) {
      setRoleDraftLabel(found.label);
      setRoleDraftDesc(found.description);
      setRoleDraftPerms(found.permissions);
    } else {
      setRoleDraftLabel(roleLabel(role));
      setRoleDraftDesc('');
      setRoleDraftPerms(getDefaultPermissionsForRole(role));
    }
  };

  const toggleMatrixCell = (
    setter: React.Dispatch<React.SetStateAction<SectionPermissions>>,
    section: PermissionSection,
    action: PermissionAction
  ) => {
    setter((prev) => {
      const cur = prev[section];
      const nextVal = !cur[action];
      if (action === 'view') {
        return {
          ...prev,
          [section]: {
            view: nextVal,
            create: nextVal ? cur.create : false,
            edit: nextVal ? cur.edit : false,
            delete: nextVal ? cur.delete : false,
          },
        };
      }
      return {
        ...prev,
        [section]: {
          ...cur,
          view: nextVal ? true : cur.view,
          [action]: nextVal,
        },
      };
    });
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleOpenInviteModal = () => {
    setInviteResult(null);
    setInviteEmail('');
    setInviteFullName('');
    setInviteBusinessName('');
    setInviteRole('store_owner');
    setInviteTenantId(stores[0]?.tenantId ?? '');
    setInviteExpiry('7d');
    setInviteCustomPerms(getDefaultPermissionsForRole('store_owner'));
    setShowInviteMatrix(false);
    setInviteModalOpen(true);
  };

  const handleInviteRoleChange = (nextRole: Exclude<CanonicalRole, 'super_admin'>) => {
    setInviteRole(nextRole);
    setInviteCustomPerms(getDefaultPermissionsForRole(nextRole));
    if (nextRole !== 'store_owner' && !inviteTenantId && stores.length > 0) {
      setInviteTenantId(stores[0].tenantId);
    }
  };

  const handleSubmitInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);
    setInviteSubmitting(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const hours =
        inviteExpiry === '24h'
          ? 24
          : inviteExpiry === '3d'
          ? 72
          : inviteExpiry === '30d'
          ? 720
          : 168;
      const res = await invitePlatformUser(idToken, {
        email: inviteEmail.trim(),
        fullName: inviteFullName.trim() || undefined,
        businessName:
          inviteRole === 'store_owner' ? inviteBusinessName.trim() || undefined : undefined,
        role: inviteRole,
        tenantId: inviteRole !== 'store_owner' ? inviteTenantId || undefined : undefined,
        permissions: showInviteMatrix ? inviteCustomPerms : undefined,
        maxUses: 1,
        expiresAtIso: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
      });
      setInviteResult({
        inviteCode: res.inviteCode,
        inviteUrl: res.inviteUrl,
        emailDelivery: res.emailDelivery,
      });
      setNoticeMsg(`Invitation issued for ${inviteEmail.trim()}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send user invitation.');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const openEditUser = (u: PlatformUserRecord) => {
    const safeRole: Exclude<CanonicalRole, 'super_admin'> =
      u.role === 'super_admin' ? 'store_owner' : u.role;
    setEditingUser(u);
    setEditFullName(u.fullName);
    setEditRole(safeRole);
    setEditTenantId(u.tenantId ?? '');
    setEditBusinessName(u.businessName ?? '');
    setEditPermissions(sanitizePermissions(u.permissions, safeRole));
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setSavingUser(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const updated = await updatePlatformUser(idToken, editingUser.uid, {
        fullName: editFullName.trim(),
        role: editRole,
        tenantId: editTenantId.trim() ? editTenantId.trim() : null,
        businessName: editBusinessName.trim(),
        permissions: editPermissions,
      });
      setUsers((prev) => prev.map((u) => (u.uid === updated.uid ? updated : u)));
      setEditingUser(null);
      setNoticeMsg(`Updated permissions & profile for ${updated.email || updated.fullName}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save user changes.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleToggleUserStatus = async (u: PlatformUserRecord) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    const nextStatus: AccountStatus = u.accountStatus === 'suspended' ? 'active' : 'suspended';
    try {
      const idToken = await firebaseUser.getIdToken();
      const updated = await updatePlatformUserStatus(idToken, u.uid, nextStatus);
      setUsers((prev) => prev.map((row) => (row.uid === updated.uid ? updated : row)));
      setNoticeMsg(`User ${updated.email || updated.uid} is now ${nextStatus}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update user status.');
    }
  };

  const handleConfirmDeleteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletingUser) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setDeletingBusy(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      await deletePlatformUser(idToken, deletingUser.uid, deletingUser.uid, deleteConfirmText);
      setUsers((prev) => prev.filter((u) => u.uid !== deletingUser.uid));
      setNoticeMsg(`Removed access record for ${deletingUser.email || deletingUser.uid}.`);
      setDeletingUser(null);
      setDeleteConfirmText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete user record.');
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleToggleStoreStatus = async (s: StoreSummaryRecord) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    const nextStatus: AccountStatus = s.accountStatus === 'suspended' ? 'active' : 'suspended';
    try {
      const idToken = await firebaseUser.getIdToken();
      const updated = await updateSuperAdminStoreStatus(idToken, s.tenantId, nextStatus);
      setStores((prev) => prev.map((row) => (row.tenantId === updated.tenantId ? updated : row)));
      setNoticeMsg(`Store "${updated.businessName}" is now ${nextStatus}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update store status.');
    }
  };

  const handleInspectStore = async (s: StoreSummaryRecord) => {
    setErrorMsg(null);
    setInspectingTenantId(s.tenantId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const report = await inspectSuperAdminStore(idToken, s.tenantId);
      setInspectionReport(report);
      setNoticeMsg(`Audited store inspection recorded in Audit Logs (${report.auditLogId}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to inspect store.');
    } finally {
      setInspectingTenantId(null);
    }
  };

  const handleCreateQuickInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);
    setInvCreating(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const hours =
        invExpiryPreset === '24h'
          ? 24
          : invExpiryPreset === '3d'
          ? 72
          : invExpiryPreset === '30d'
          ? 720
          : 168;
      const maxUses =
        invUsageMode === 'single' ? 1 : Math.min(100, Math.max(1, Math.round(Number(invMaxUses) || 1)));
      const created = await createAdminInvitation({
        idToken,
        maxUses,
        expiresAtIso: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
        label: invLabel.trim(),
        targetEmail: invTargetEmail.trim() || undefined,
        targetRole: invTargetRole,
        targetTenantId:
          invTargetRole !== 'store_owner' ? invTargetTenantId || undefined : undefined,
      });
      setNewlyCreatedInvite({
        code: created.inviteCode,
        url: `${window.location.origin}/?invite=${encodeURIComponent(created.inviteCode)}`,
      });
      setInvLabel('');
      setInvTargetEmail('');
      setInvitations((prev) => [created.invitation, ...prev]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create invitation.');
    } finally {
      setInvCreating(false);
    }
  };

  const handleResendInvite = async (inviteId: string) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await resendAdminInvitation(idToken, inviteId);
      setInvitations((prev) => prev.map((inv) => (inv.id === inviteId ? res.invitation : inv)));
      setResendFeedback({ inviteId, delivery: res.emailDelivery });
      setNoticeMsg(res.emailDelivery.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to resend invitation.');
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const updated = await revokeAdminInvitation(idToken, inviteId);
      setInvitations((prev) => prev.map((inv) => (inv.id === inviteId ? updated : inv)));
      setNoticeMsg('Invitation revoked.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to revoke invitation.');
    }
  };

  const handleSaveRoleTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoleTab === 'super_admin') return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setSavingRole(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const saved = await updateSuperAdminRoleTemplate(idToken, selectedRoleTab, {
        label: roleDraftLabel,
        description: roleDraftDesc,
        permissions: roleDraftPerms,
      });
      setRoles((prev) => prev.map((r) => (r.role === saved.role ? saved : r)));
      setNoticeMsg(`Saved default permission template for ${saved.label}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save role template.');
    } finally {
      setSavingRole(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
      if (userStatusFilter !== 'all' && u.accountStatus !== userStatusFilter) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q) ||
        (u.businessName ?? '').toLowerCase().includes(q)
      );
    });
  }, [users, userSearch, userRoleFilter, userStatusFilter]);

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(
      (s) =>
        s.businessName.toLowerCase().includes(q) ||
        s.ownerEmail.toLowerCase().includes(q) ||
        s.tenantId.toLowerCase().includes(q)
    );
  }, [stores, storeSearch]);

  const filteredInvitations = useMemo(() => {
    if (invFilter === 'all') return invitations;
    return invitations.filter((inv) => inv.status === invFilter);
  }, [invitations, invFilter]);

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        l.targetLabel.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const sectionMeta = useMemo(() => {
    switch (activeSection) {
      case 'sa_overview':
        return { title: t('saOverviewTitle'), subtitle: t('saOverviewSubtitle'), icon: Activity };
      case 'sa_users':
        return { title: t('saUsersTitle'), subtitle: t('saUsersSubtitle'), icon: UserCog };
      case 'sa_stores':
        return { title: t('saStoresTitle'), subtitle: t('saStoresSubtitle'), icon: Store };
      case 'sa_invitations':
        return { title: t('saInvitationsTitle'), subtitle: t('saInvitationsSubtitle'), icon: Ticket };
      case 'sa_roles':
        return { title: t('saRolesTitle'), subtitle: t('saRolesSubtitle'), icon: KeyRound };
      case 'sa_audit':
        return { title: t('saAuditTitle'), subtitle: t('saAuditSubtitle'), icon: ScrollText };
    }
  }, [activeSection, t]);

  const HeaderIcon = sectionMeta.icon;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <HeaderIcon className="w-5 h-5 text-indigo-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {sectionMeta.title}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border border-indigo-500/35 bg-indigo-500/10 text-indigo-600 dark:text-cyan-300">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              {t('saBadge')}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{sectionMeta.subtitle}</p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {activeSection === 'sa_users' && (
            <button
              type="button"
              onClick={handleOpenInviteModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              {t('saInviteUserBtn')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadSectionData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('invRefreshBtn')}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="underline cursor-pointer">
            {t('dismiss')}
          </button>
        </div>
      )}

      {noticeMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
          <button type="button" onClick={() => setNoticeMsg(null)} className="underline cursor-pointer">
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* 1. OVERVIEW */}
      {activeSection === 'sa_overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: t('saStatTotalUsers'), val: overview?.totalUsers ?? 0, icon: Users, nav: 'sa_users' as NavSection },
              { label: t('saStatTotalStores'), val: overview?.totalStores ?? 0, icon: Store, nav: 'sa_stores' as NavSection },
              { label: t('saStatActiveAccounts'), val: overview?.activeAccounts ?? 0, icon: CheckCircle2, nav: 'sa_users' as NavSection },
              { label: t('saStatSuspendedAccounts'), val: overview?.suspendedAccounts ?? 0, icon: Ban, nav: 'sa_users' as NavSection },
              { label: t('saStatPendingInvites'), val: overview?.pendingInvitations ?? 0, icon: Ticket, nav: 'sa_invitations' as NavSection },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => onSelectSection(card.nav)}
                  className="text-start rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 hover:border-blue-500/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{card.label}</span>
                    <Icon className="w-4 h-4 text-blue-500 shrink-0" aria-hidden="true" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {card.val}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Recent Users */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t('saUsersTitle')}
                </h2>
                <button
                  type="button"
                  onClick={() => onSelectSection('sa_users')}
                  className="text-xs font-semibold text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                >
                  Manage
                </button>
              </div>
              {(!overview || overview.recentUsers.length === 0) ? (
                <p className="text-xs text-slate-500 py-6 text-center">No platform user profiles yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {overview.recentUsers.map((u) => (
                    <div key={u.uid} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {u.fullName || u.email}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate" dir="ltr">
                          {u.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${roleBadgeStyle(u.role)}`}>
                          {roleLabel(u.role)}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${
                            u.accountStatus === 'suspended'
                              ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {u.accountStatus}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Audit Logs */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t('saAuditTitle')}
                </h2>
                <button
                  type="button"
                  onClick={() => onSelectSection('sa_audit')}
                  className="text-xs font-semibold text-blue-600 dark:text-cyan-400 hover:underline cursor-pointer"
                >
                  View All
                </button>
              </div>
              {(!overview || overview.recentAuditLogs.length === 0) ? (
                <p className="text-xs text-slate-500 py-6 text-center">No Super Admin audit actions logged yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {overview.recentAuditLogs.map((log) => (
                    <div key={log.id} className="py-2.5 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-blue-600 dark:text-cyan-300">
                          {log.action}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatDateTime(log.createdAt, language)}
                        </span>
                      </div>
                      <div className="text-slate-700 dark:text-slate-300">{log.details}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. USER MANAGEMENT */}
      {activeSection === 'sa_users' && (
        <div className="space-y-5">
          {/* Filters */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by name, email, store, or UID..."
                className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
            <select
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value as 'all' | CanonicalRole)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="all">All Roles</option>
              <option value="super_admin">{roleLabel('super_admin')}</option>
              <option value="store_owner">{roleLabel('store_owner')}</option>
              <option value="manager">{roleLabel('manager')}</option>
              <option value="staff">{roleLabel('staff')}</option>
              <option value="viewer">{roleLabel('viewer')}</option>
            </select>
            <select
              value={userStatusFilter}
              onChange={(e) => setUserStatusFilter(e.target.value as 'all' | AccountStatus)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          {/* Users Table */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 overflow-x-auto">
            {filteredUsers.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No user accounts match the current filters.
              </div>
            ) : (
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pe-3 text-start font-medium">User & UID</th>
                    <th className="py-2.5 px-3 text-start font-medium">Role</th>
                    <th className="py-2.5 px-3 text-start font-medium">Store Workspace</th>
                    <th className="py-2.5 px-3 text-start font-medium">Status</th>
                    <th className="py-2.5 px-3 text-start font-medium">Created / Last Active</th>
                    <th className="py-2.5 ps-3 text-end font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredUsers.map((u) => {
                    const isSelf = u.uid === firebaseUser.uid;
                    return (
                      <tr key={u.uid} className="align-top">
                        <td className="py-3 pe-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {u.fullName || '—'}
                            {isSelf && (
                              <span className="ms-2 text-[10px] font-semibold text-blue-600 dark:text-cyan-400">
                                (You)
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500" dir="ltr">
                            {u.email}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 mt-0.5" dir="ltr">
                            {u.uid}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${roleBadgeStyle(u.role)}`}>
                            {roleLabel(u.role)}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {u.businessName || (u.tenantId ? 'Assigned Store' : 'No Store')}
                          </div>
                          {u.tenantId && (
                            <div className="font-mono text-[10px] text-slate-400 truncate max-w-[160px]" dir="ltr">
                              {u.tenantId}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${
                              u.accountStatus === 'suspended'
                                ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {u.accountStatus}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                          <div>{formatDateTime(u.createdAt, language)}</div>
                          <div className="text-slate-400">
                            Active: {formatDateTime(u.lastActiveAt ?? u.updatedAt, language)}
                          </div>
                        </td>
                        <td className="py-3 ps-3 text-end whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() => openEditUser(u)}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                            >
                              {t('saEditUserBtn')}
                            </button>
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() => void handleToggleUserStatus(u)}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border disabled:opacity-40 cursor-pointer ${
                                u.accountStatus === 'suspended'
                                  ? 'border-emerald-500/35 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                                  : 'border-amber-500/35 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                              }`}
                            >
                              {u.accountStatus === 'suspended' ? t('saActivateBtn') : t('saSuspendBtn')}
                            </button>
                            <button
                              type="button"
                              disabled={isSelf || u.source === 'legacy_tenant'}
                              onClick={() => {
                                setDeletingUser(u);
                                setDeleteConfirmText('');
                              }}
                              title={
                                u.source === 'legacy_tenant'
                                  ? 'Legacy tenant without separate /users access doc'
                                  : undefined
                              }
                              className="p-1.5 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-35 cursor-pointer"
                              aria-label="Delete user"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 3. STORE MANAGEMENT */}
      {activeSection === 'sa_stores' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
                placeholder="Search stores by business name, owner email, or tenant ID..."
                className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {inspectionReport && (
            <div className="rounded-2xl border border-indigo-500/35 bg-indigo-500/10 p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-cyan-300">
                    Audited Store Inspection Report
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                    {inspectionReport.profile.businessName}
                  </h3>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5" dir="ltr">
                    Tenant: {inspectionReport.tenantId} · Audit Log ID: {inspectionReport.auditLogId}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectionReport(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: 'Products', value: inspectionReport.counts.products },
                  { label: 'Orders', value: inspectionReport.counts.orders },
                  { label: 'Customers', value: inspectionReport.counts.customers },
                  { label: 'Expenses', value: inspectionReport.counts.expenses },
                  { label: 'Members', value: inspectionReport.counts.members },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-indigo-500/20 bg-white/80 dark:bg-[#070D1D] p-3"
                  >
                    <div className="text-[11px] text-slate-500">{stat.label}</div>
                    <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                Currency: <strong>{inspectionReport.profile.currency}</strong> · Tax Rate:{' '}
                <strong>{inspectionReport.profile.taxRate}%</strong> · Low Stock Threshold:{' '}
                <strong>{inspectionReport.profile.lowStockThreshold}</strong> · Inspected At:{' '}
                {formatDateTime(inspectionReport.inspectedAt, language)}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 overflow-x-auto">
            {filteredStores.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">No stores found.</div>
            ) : (
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pe-3 text-start font-medium">Store</th>
                    <th className="py-2.5 px-3 text-start font-medium">Owner</th>
                    <th className="py-2.5 px-3 text-start font-medium">Currency / Members</th>
                    <th className="py-2.5 px-3 text-start font-medium">Status</th>
                    <th className="py-2.5 ps-3 text-end font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredStores.map((s) => {
                    const isOwnPrimary = s.tenantId === firebaseUser.uid;
                    return (
                      <tr key={s.tenantId} className="align-top">
                        <td className="py-3 pe-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {s.businessName}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400" dir="ltr">
                            {s.tenantId}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-300" dir="ltr">
                          {s.ownerEmail}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {s.currency} · {s.memberCount} member(s)
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${
                              s.accountStatus === 'suspended'
                                ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {s.accountStatus}
                          </span>
                        </td>
                        <td className="py-3 ps-3 text-end whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={inspectingTenantId === s.tenantId}
                              onClick={() => void handleInspectStore(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-indigo-500/35 text-indigo-600 dark:text-cyan-300 hover:bg-indigo-500/10 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" aria-hidden="true" />
                              {t('saInspectStoreBtn')}
                            </button>
                            <button
                              type="button"
                              disabled={isOwnPrimary && s.accountStatus !== 'suspended'}
                              onClick={() => void handleToggleStoreStatus(s)}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border disabled:opacity-40 cursor-pointer ${
                                s.accountStatus === 'suspended'
                                  ? 'border-emerald-500/35 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                                  : 'border-amber-500/35 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                              }`}
                            >
                              {s.accountStatus === 'suspended' ? t('saActivateBtn') : t('saSuspendBtn')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 4. INVITATIONS */}
      {activeSection === 'sa_invitations' && (
        <div className="space-y-5">
          {newlyCreatedInvite && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                {t('invNewCodeTitle')}
              </div>
              <p className="text-xs text-emerald-700/90 dark:text-emerald-200/80">
                {t('invNewCodeHint')}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <code
                  dir="ltr"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#070D1D] border border-emerald-500/30 font-mono text-sm font-bold text-slate-900 dark:text-white"
                >
                  {newlyCreatedInvite.code}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText('new_inv_code', newlyCreatedInvite.code)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 cursor-pointer"
                >
                  {copiedKey === 'new_inv_code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {t('invCopyCodeBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => void copyText('new_inv_url', newlyCreatedInvite.url)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-emerald-500/40 bg-white dark:bg-[#070D1D] text-emerald-700 dark:text-emerald-300 cursor-pointer"
                >
                  {copiedKey === 'new_inv_url' ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                  {t('invCopyLinkBtn')}
                </button>
              </div>
            </div>
          )}

          {resendFeedback && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-xs text-slate-800 dark:text-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>{resendFeedback.delivery.message}</span>
              {resendFeedback.delivery.mailtoUrl && (
                <a
                  href={resendFeedback.delivery.mailtoUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-blue-600 text-white hover:bg-blue-500 shrink-0"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  Open Email Draft
                </a>
              )}
            </div>
          )}

          <form
            onSubmit={handleCreateQuickInvite}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-600 dark:text-cyan-400" aria-hidden="true" />
              <span>{t('invCreateTitle')}</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Target Email (Optional)
                </label>
                <input
                  type="email"
                  value={invTargetEmail}
                  onChange={(e) => setInvTargetEmail(e.target.value)}
                  placeholder="partner@store.com"
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Target Role
                </label>
                <select
                  value={invTargetRole}
                  onChange={(e) =>
                    setInvTargetRole(e.target.value as Exclude<CanonicalRole, 'super_admin'>)
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                >
                  <option value="store_owner">{roleLabel('store_owner')}</option>
                  <option value="manager">{roleLabel('manager')}</option>
                  <option value="staff">{roleLabel('staff')}</option>
                  <option value="viewer">{roleLabel('viewer')}</option>
                </select>
              </div>
              {invTargetRole !== 'store_owner' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Assign to Store
                  </label>
                  <select
                    required
                    value={invTargetTenantId}
                    onChange={(e) => setInvTargetTenantId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                  >
                    <option value="">Select Store...</option>
                    {stores.map((s) => (
                      <option key={s.tenantId} value={s.tenantId}>
                        {s.businessName} ({s.ownerEmail})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {t('invUsageModeLabel')}
                </label>
                <div className="flex gap-2">
                  <select
                    value={invUsageMode}
                    onChange={(e) => setInvUsageMode(e.target.value === 'limited' ? 'limited' : 'single')}
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                  >
                    <option value="single">{t('invSingleUseOpt')}</option>
                    <option value="limited">{t('invLimitedUseOpt')}</option>
                  </select>
                  {invUsageMode === 'limited' && (
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={invMaxUses}
                      onChange={(e) => setInvMaxUses(e.target.value)}
                      dir="ltr"
                      className="w-20 px-2.5 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {t('invExpiryPresetLabel')}
                </label>
                <select
                  value={invExpiryPreset}
                  onChange={(e) =>
                    setInvExpiryPreset(e.target.value as '24h' | '3d' | '7d' | '30d')
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                >
                  <option value="24h">{t('invExpiry24h')}</option>
                  <option value="3d">{t('invExpiry3d')}</option>
                  <option value="7d">{t('invExpiry7d')}</option>
                  <option value="30d">{t('invExpiry30d')}</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {t('invLabelField')}
                </label>
                <input
                  type="text"
                  value={invLabel}
                  onChange={(e) => setInvLabel(e.target.value)}
                  placeholder={t('invLabelPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={invCreating}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                {invCreating ? t('invGeneratingBtn') : t('invGenerateBtn')}
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('invListTitle', { count: filteredInvitations.length })}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'active', 'used', 'expired', 'revoked'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setInvFilter(tab)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                      invFilter === tab
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-[#070D1D] text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pe-3 text-start font-medium">Code / Target</th>
                    <th className="py-2 px-3 text-start font-medium">Role / Label</th>
                    <th className="py-2 px-3 text-start font-medium">Status</th>
                    <th className="py-2 px-3 text-start font-medium">Uses</th>
                    <th className="py-2 px-3 text-start font-medium">Dates</th>
                    <th className="py-2 ps-3 text-end font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredInvitations.map((inv) => (
                    <tr key={inv.id} className="align-top">
                      <td className="py-3 pe-3">
                        <div className="font-mono font-semibold text-slate-900 dark:text-white" dir="ltr">
                          {inv.codePreview}
                        </div>
                        {inv.targetEmail && (
                          <div className="text-[11px] text-blue-600 dark:text-cyan-300" dir="ltr">
                            {inv.targetEmail}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {inv.targetRole && (
                          <span className={`inline-flex me-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${roleBadgeStyle(inv.targetRole)}`}>
                            {roleLabel(inv.targetRole)}
                          </span>
                        )}
                        <span className="text-slate-600 dark:text-slate-300">{inv.label || '—'}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-slate-700">
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums">
                        {inv.usedCount} / {inv.maxUses}
                        {(inv.resendCount ?? 0) > 0 && (
                          <div className="text-[10px] text-slate-400">Resent ×{inv.resendCount}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                        <div>{formatDateTime(inv.createdAt, language)}</div>
                        <div>→ {formatDateTime(inv.expiresAt, language)}</div>
                      </td>
                      <td className="py-3 ps-3 text-end whitespace-nowrap">
                        {inv.status === 'active' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleResendInvite(inv.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-blue-500/35 text-blue-600 dark:text-cyan-300 hover:bg-blue-500/10 cursor-pointer"
                            >
                              <Send className="w-3 h-3" aria-hidden="true" />
                              {t('saResendBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRevokeInvite(inv.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-rose-500/35 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                            >
                              <Ban className="w-3 h-3" aria-hidden="true" />
                              {t('invRevokeBtn')}
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 5. ROLES & PERMISSIONS */}
      {activeSection === 'sa_roles' && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {(['super_admin', 'store_owner', 'manager', 'staff', 'viewer'] as CanonicalRole[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => handleSelectRoleTab(role)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                  selectedRoleTab === role
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-[#0B1328] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800'
                }`}
              >
                {roleLabel(role)}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleSaveRoleTemplate}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-5"
          >
            {selectedRoleTab === 'super_admin' && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-700 dark:text-indigo-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Super Admin permissions are locked at full platform authority and enforced by Firestore /admins/{'{uid}'}.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Role Display Label
                </label>
                <input
                  type="text"
                  disabled={selectedRoleTab === 'super_admin'}
                  value={roleDraftLabel}
                  onChange={(e) => setRoleDraftLabel(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  disabled={selectedRoleTab === 'super_admin'}
                  value={roleDraftDesc}
                  onChange={(e) => setRoleDraftDesc(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D] disabled:opacity-60"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pe-3 text-start font-medium">Module Section</th>
                    {PERMISSION_ACTIONS.map((action) => (
                      <th key={action} className="py-2 px-3 text-center font-medium uppercase">
                        {action}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {PERMISSION_SECTIONS.map((section) => (
                    <tr key={section}>
                      <td className="py-2.5 pe-3 font-medium capitalize text-slate-800 dark:text-slate-200">
                        {section}
                      </td>
                      {PERMISSION_ACTIONS.map((action) => (
                        <td key={action} className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            disabled={selectedRoleTab === 'super_admin'}
                            checked={Boolean(roleDraftPerms[section]?.[action])}
                            onChange={() => toggleMatrixCell(setRoleDraftPerms, section, action)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer disabled:opacity-60"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRoleTab !== 'super_admin' && (
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                >
                  {savingRole ? t('saving') : t('saveChanges')}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* 6. AUDIT LOGS */}
      {activeSection === 'sa_audit' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Filter audit logs by action, actor, target, or details..."
                className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
              />
            </div>
            <span className="text-[11px] font-semibold text-slate-500 shrink-0">
              Append-Only Immutable Ledger ({filteredLogs.length})
            </span>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 overflow-x-auto">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">No audit log entries recorded yet.</div>
            ) : (
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pe-3 text-start font-medium">Timestamp</th>
                    <th className="py-2 px-3 text-start font-medium">Action</th>
                    <th className="py-2 px-3 text-start font-medium">Actor</th>
                    <th className="py-2 px-3 text-start font-medium">Target</th>
                    <th className="py-2 ps-3 text-start font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="align-top">
                      <td className="py-3 pe-3 text-[11px] text-slate-500 whitespace-nowrap">
                        {formatDateTime(log.createdAt, language)}
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-blue-600 dark:text-cyan-300 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-3 px-3 text-[11px]" dir="ltr">
                        <div>{log.actorEmail}</div>
                        <div className="font-mono text-[10px] text-slate-400">{log.actorUid}</div>
                      </td>
                      <td className="py-3 px-3 text-[11px]">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {log.targetLabel || log.targetId}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400" dir="ltr">
                          {log.targetType}: {log.targetId}
                        </div>
                      </td>
                      <td className="py-3 ps-3 text-slate-700 dark:text-slate-300">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* INVITE USER MODAL */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t('saInviteUserBtn')}
              </h2>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {inviteResult ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {inviteResult.emailDelivery.message}
                  </div>
                  <div className="font-mono text-sm font-bold text-slate-900 dark:text-white" dir="ltr">
                    {inviteResult.inviteCode}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void copyText('modal_code', inviteResult.inviteCode)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copiedKey === 'modal_code' ? t('profileCopiedLabel') : t('invCopyCodeBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyText('modal_url', inviteResult.inviteUrl)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/40 bg-white dark:bg-[#070D1D] text-emerald-700 dark:text-emerald-300 cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {copiedKey === 'modal_url' ? t('profileCopiedLabel') : t('invCopyLinkBtn')}
                    </button>
                    {inviteResult.emailDelivery.mailtoUrl && (
                      <a
                        href={inviteResult.emailDelivery.mailtoUrl}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Open Email Client
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 cursor-pointer"
                  >
                    {t('close')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitInviteUser} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Email Address *</label>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      dir="ltr"
                      placeholder="owner@merchant.com"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Full Name</label>
                    <input
                      type="text"
                      value={inviteFullName}
                      onChange={(e) => setInviteFullName(e.target.value)}
                      placeholder="Full Name"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Role *</label>
                    <select
                      value={inviteRole}
                      onChange={(e) =>
                        handleInviteRoleChange(e.target.value as Exclude<CanonicalRole, 'super_admin'>)
                      }
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                    >
                      <option value="store_owner">{roleLabel('store_owner')}</option>
                      <option value="manager">{roleLabel('manager')}</option>
                      <option value="staff">{roleLabel('staff')}</option>
                      <option value="viewer">{roleLabel('viewer')}</option>
                    </select>
                  </div>
                  {inviteRole === 'store_owner' ? (
                    <div>
                      <label className="block text-xs font-medium mb-1">Initial Store Name</label>
                      <input
                        type="text"
                        value={inviteBusinessName}
                        onChange={(e) => setInviteBusinessName(e.target.value)}
                        placeholder="Merchant Store Name"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium mb-1">Assigned Store *</label>
                      <select
                        required
                        value={inviteTenantId}
                        onChange={(e) => setInviteTenantId(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                      >
                        <option value="">Select Store...</option>
                        {stores.map((s) => (
                          <option key={s.tenantId} value={s.tenantId}>
                            {s.businessName} ({s.ownerEmail})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium mb-1">Expires In</label>
                    <select
                      value={inviteExpiry}
                      onChange={(e) => setInviteExpiry(e.target.value as '24h' | '3d' | '7d' | '30d')}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                    >
                      <option value="24h">24 Hours</option>
                      <option value="3d">3 Days</option>
                      <option value="7d">7 Days</option>
                      <option value="30d">30 Days</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setShowInviteMatrix((v) => !v)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {showInviteMatrix ? 'Hide Custom Permissions' : 'Customize Section Permissions'}
                    </button>
                  </div>
                </div>

                {showInviteMatrix && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <table className="w-full text-start text-xs">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="py-1.5 text-start font-medium">Section</th>
                          {PERMISSION_ACTIONS.map((act) => (
                            <th key={act} className="py-1.5 text-center font-medium uppercase">
                              {act}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERMISSION_SECTIONS.map((sec) => (
                          <tr key={sec} className="border-t border-slate-100 dark:border-slate-800/60">
                            <td className="py-1.5 capitalize">{sec}</td>
                            {PERMISSION_ACTIONS.map((act) => (
                              <td key={act} className="py-1.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(inviteCustomPerms[sec]?.[act])}
                                  onChange={() => toggleMatrixCell(setInviteCustomPerms, sec, act)}
                                  className="accent-blue-600"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={inviteSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                  >
                    {inviteSubmitting ? t('invGeneratingBtn') : t('saInviteUserBtn')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleSaveEditUser}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Edit User Access & Permissions
                </h2>
                <p className="text-xs text-slate-500" dir="ltr">
                  {editingUser.email} ({editingUser.uid})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => {
                    const next = e.target.value as Exclude<CanonicalRole, 'super_admin'>;
                    setEditRole(next);
                    setEditPermissions(getDefaultPermissionsForRole(next));
                  }}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                >
                  <option value="store_owner">{roleLabel('store_owner')}</option>
                  <option value="manager">{roleLabel('manager')}</option>
                  <option value="staff">{roleLabel('staff')}</option>
                  <option value="viewer">{roleLabel('viewer')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Assigned Store (Tenant ID)</label>
                <select
                  value={editTenantId}
                  onChange={(e) => setEditTenantId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                >
                  <option value="">None / Unassigned</option>
                  {stores.map((s) => (
                    <option key={s.tenantId} value={s.tenantId}>
                      {s.businessName} ({s.tenantId.slice(0, 8)}…)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Business Name</label>
                <input
                  type="text"
                  value={editBusinessName}
                  onChange={(e) => setEditBusinessName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#070D1D]"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1.5 text-start font-medium">Section</th>
                    {PERMISSION_ACTIONS.map((act) => (
                      <th key={act} className="py-1.5 text-center font-medium uppercase">
                        {act}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_SECTIONS.map((sec) => (
                    <tr key={sec} className="border-t border-slate-100 dark:border-slate-800/60">
                      <td className="py-1.5 capitalize">{sec}</td>
                      {PERMISSION_ACTIONS.map((act) => (
                        <td key={act} className="py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(editPermissions[sec]?.[act])}
                            onChange={() => toggleMatrixCell(setEditPermissions, sec, act)}
                            className="accent-blue-600"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={savingUser}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
              >
                {savingUser ? t('saving') : t('saveChanges')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DELETE USER TYPED CONFIRMATION MODAL */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmDeleteUser}
            className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-white dark:bg-[#0B1328] p-6 space-y-4 shadow-2xl"
          >
            <h2 className="text-base font-bold text-rose-600 dark:text-rose-400">
              Confirm Permanent User Access Removal
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This removes platform access for <strong>{deletingUser.email}</strong> (UID:{' '}
              <code dir="ltr">{deletingUser.uid}</code>). Store business records in <code>/tenants</code> are preserved intact.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1">
                Type <code className="font-mono font-bold">DELETE</code> to confirm:
              </label>
              <input
                type="text"
                required
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                dir="ltr"
                placeholder="DELETE"
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-rose-500/40 bg-slate-50 dark:bg-[#070D1D]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={deletingBusy || deleteConfirmText.trim() !== 'DELETE'}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 cursor-pointer"
              >
                {deletingBusy ? t('deleting') : t('delete')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
