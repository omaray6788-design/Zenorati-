# ZENORATI Multi-Tenant Security Specification

## 1. Data Invariants
1. Every business owner's workspace is strictly isolated under `/tenants/{tenantId}` where `tenantId == request.auth.uid` and `request.auth.token.email_verified == true`.
2. Every subcollection document (`products`, `customers`, `orders`, `items`, `history`, `expenses`, `activities`, `researchIdeas`) must have `ownerId == tenantId == request.auth.uid`, and single-document writes verify parent tenant ownership via `get(/databases/$(database)/documents/tenants/$(tenantId)).data.ownerId == request.auth.uid`.
3. `list` queries on subcollections explicitly require `resource.data.ownerId == request.auth.uid` and `request.auth.uid == tenantId` with zero `get()` calls inside `allow list`.
4. All document IDs (`tenantId`, `productId`, `customerId`, `orderId`, `itemId`, `historyId`, `expenseId`, `activityId`, `ideaId`, `adminUid`, `inviteId`, `redeemerUid`) must match `^[a-zA-Z0-9_\-]+$` and stay `<= 128` characters.
5. All `createdAt`, `updatedAt`, `redeemedAt`, and `revokedAt` timestamps must equal `request.time`, and `ownerId` and `createdAt` are immutable after creation.
6. Orders with terminal status (`cancelled` or `returned`) cannot be modified further once finalized.
7. Shadow fields are rejected via `keys().hasAll(...) && keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update.
8. Admin membership (`/admins/{adminUid}`) is read-only for clients (`allow get: if isVerified() && request.auth.uid == adminUid; allow list, create, update, delete: if false;`), making client-side self-escalation impossible.
9. Invitation documents (`/invitations/{inviteId}`) store ONLY cryptographic SHA-256 hashes (`codeHash`, matching 64-hex `inviteId`), never plaintext codes and never user PII. Listing `/invitations` is strictly restricted to verified admins (`isAdmin()`).
10. Redemption records (`/invitations/{inviteId}/redemptions/{redeemerUid}`) are immutable (`allow update, delete: if false;`), readable only by `isAdmin()` or the redeeming user (`request.auth.uid == redeemerUid`), and enforce unique per-user redemption (`!exists` via `allow create`).
11. Creating a new `/tenants/{tenantId}` workspace requires either `isAdmin()` OR an atomic transaction (`getAfter` + `existsAfter`) that simultaneously increments an active, unexpired, under-limit `/invitations/{invitationId}` (`usedCount == prev + 1`), writes `/invitations/{invitationId}/redemptions/{request.auth.uid}`, and sets `role: 'user'` and `accountStatus: 'active'`. Existing `/tenants/{uid}` documents continue working unchanged for `get` and `update`, and permitted profile updates never modify `ownerId`, `createdAt`, `role`, `accountStatus`, or `invitationId`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Yield PERMISSION_DENIED)
1. Cross-tenant read: User B (`uid_b`) attempts `get` on `/tenants/uid_a/products/prod_1`.
2. Cross-tenant list: User B (`uid_b`) attempts `list` on `/tenants/uid_a/orders`.
3. Unverified email write: User with `email_verified: false` attempts `create` on `/tenants/uid_a`.
4. Identity spoofing on create: User B sets `ownerId: "uid_a"` while writing to `/tenants/uid_b/products/prod_2`.
5. Shadow field injection: User A creates a Product including an unexpected field `isFeaturedAdmin: true`.
6. Owner mutation on update: User A updates a Product and tries to change `ownerId` to `"uid_b"`.
7. Timestamp forgery: User A creates an Expense with client-supplied past timestamp `createdAt` instead of `request.time`.
8. Terminal order tampering: User A attempts to change `status` or `totalAmount` of an Order whose existing `status == "cancelled"` or `"returned"`.
9. Uninvited tenant creation: Newly signed-in Google user creates `/tenants/{uid}` directly without an atomic invitation redemption.
10. Self-assigned admin escalation: Ordinary user attempts `create` on `/admins/{uid}` or updates `role: 'admin'` on `/tenants/{uid}`.
11. Invitation enumeration / creation by non-admin: Ordinary user attempts `list` or `create` on `/invitations`, or `update` to `status: 'revoked'`.
12. Invitation overuse / replay: User attempts to redeem an expired, revoked, or already-exhausted (`usedCount >= maxUses`) invitation, or redeem an order/item under a non-existent parent.
