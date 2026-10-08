# ADR-028 — Roles, permissions and invitations

- **Status:** Accepted (2026-10-07, Tom). Model agreed in conversation on 2026-10-05.
- **Owner:** Tom
- **Amends:** ADR-017 Decision 1 (role values) and Decision 7 (invitation flow). Everything else in ADR-015 / ADR-017 stands: per-request resolution from the database, `TenantAuthorizationContext`, the Sanity chokepoint, `assertModuleAction`, module-installed-before-permission ordering, the phased RLS rollout.
- **Related:** ADR-011 (module permissions, `MODULE_PERMISSION_MAP`), ADR-018 (forms — contact requests are form submissions), ADR-019 (Resend is wired), ADR-024 (members area — uses the `members.*` permission prefix), ADR-025 (client content editor).

## Context

What exists today (verified in code, 2026-10-05):

- **Two membership tables.** `tenant_members(tenant_id, user_id, role)` with `role in ('owner','editor','viewer')`, unique per (tenant, user) — migration 003. `project_members(project_id, user_id, role)` with `role in ('editor','viewer')`, unique per (project, user) — migration 007. Both are keyed on the Supabase auth user, so **one email can already hold different roles in different tenants and projects** (ADR-017 identity model).
- **Owner is tenant-level and covers every project of the tenant** (ADR-017 Decision 2). Editor and Viewer are project-level.
- **Super Admin** is the `platform_role = 'abluo_admin'` claim (migration 006, `src/lib/api/auth.ts`), not a membership.
- **Permissions already exist for modules.** Module manifests declare permission ids (`{module}.{noun}.{verb}`, e.g. `blog.post.write`, `forms.submission.read`) with `defaultRoles`. `getTenantAuthorizationContext()` resolves `ProjectGrant.permissions`; `assertModuleAction()` enforces them. The client dashboard already uses both.
- **Contact requests are form submissions** (`forms.submission.read` / `.update`). The old `leads` table was dropped (migration 026).
- **Platform permissions are role functions.** `src/lib/permissions.ts` has `canViewLeads(role)`, `canViewBilling(role)`, etc., which switch on role names.
- **Raw role checks exist despite the "never compare roles" rule:** `post-lifecycle.ts` (delete published post: `grant.role !== 'owner'`), `gallery-drafts.ts` (delete gallery), `galleries/[id]/page.tsx` (`canDelete`), `modules/create-menu.ts` (install more modules), both invite routes (`INVITABLE_ROLES`).
- **Invitations** use Supabase `inviteUserByEmail` plus a `handle_new_user()` trigger (migration 024) that creates the membership when a **new** auth user is created. An email that already has an account cannot be invited to a second tenant or project this way.

What Tom requires:

1. One person (one email) can have different roles on different tenants and projects. *(Already true.)*
2. We must never find ourselves blocked because "we need a role we don't have". Adding access later is configuration, not a redesign.
3. Sensitive data (contact requests, invoices) is opt-in per person, not bundled into editorial roles.
4. Simple for clients: few roles, plain words.

## Decision

### 1. Four roles, three scopes

| Scope | Role | Stored in | Meaning |
|---|---|---|---|
| Platform | **Super Admin** | `platform_role = 'abluo_admin'` (unchanged) | Everything, everywhere. |
| Tenant | **Owner** | `tenant_members.role = 'owner'` | Full control of the client: every project, people, billing. |
| Tenant | *Member* (internal) | `tenant_members.role = 'member'` | **No default permissions.** Exists only to carry tenant-level extras (e.g. an accountant who sees invoices). Never offered as a role in the UI. |
| Project | **Project Admin** | `project_members.role = 'admin'` | Full control of one project: content, contact requests, settings exposed to clients, inviting Editors. |
| Project | **Editor** | `project_members.role = 'editor'` | Write, publish, take offline within one project. **No contact requests by default.** |

- **Viewer is retired.** No new Viewer memberships. Existing rows are migrated (see Migration).
- **Tenant Admin is not introduced now.** If a client one day needs "full control except money", it is added as a role = Owner's bundle minus `billing.*` and minus managing Owners. Because nothing checks role names (§3), that is one allowed value + one bundle entry.
- **Multiple Owners per tenant are allowed. A tenant always has at least one Owner** — enforced in the database (trigger rejecting the delete/demotion of the last Owner), not only in the UI.
- Inheritance: tenant-level access applies to every project of the tenant. An Owner needs no `project_members` rows (unchanged from ADR-017).

### 2. Permissions are the only thing code checks

- **A permission is a fixed id declared in code**, with a **scope** (`tenant` or `project`) and a flag `grantable` (may be given as an extra).
- **Module permissions** keep their existing ids and convention (`{module}.{noun}.{verb}`) and stay project-scoped and module-gated (installed-before-permission, ADR-017 Decision 5).
- **Platform permissions** move from `src/lib/permissions.ts` role functions into the same registry (`src/lib/authz/permissions.ts`). Initial set:

| Id | Scope | Grantable | Default roles | UI label |
|---|---|---|---|---|
| `users.invite` | tenant, project | no | Owner; Project Admin (project only) | — |
| `users.manage` | tenant, project | no | Owner; Project Admin (project only, Editors only) | — |
| `billing.invoice.read` | tenant | **yes** | Owner | Invoices |
| `billing.manage` | tenant | no | Owner | — |
| `settings.manage` | project | no | Owner, Project Admin | — |
| `modules.manage` | project | no | Owner | — |
| `media.library.manage` | project | no | Owner, Project Admin, Editor | — |
| `tenants.manage`, `support.access` | platform | no | Super Admin | — |
| `forms.submission.read` | project | **yes** | Owner, Project Admin | Contact requests |
| `forms.submission.update` | project | **yes** (granted together with read) | Owner, Project Admin | Contact requests |
| `blog.post.delete` (published) | project | no | Owner, Project Admin | — |

  The exact list is settled in the implementation slice; the rules above are what is frozen.
- **Vocabulary.** Verbs are `read`, `write`, `update`, `delete`, `manage`, `invite`, `use`, `access` with fixed meanings: `read` = see; `write` = create and edit; `update` = change state of existing records (e.g. a lead's status); `delete` = remove; `manage` = configure or administer (includes changing/removing other people for `users.manage`, adding modules for `modules.manage`); `invite` = add people at or below your own level; `use` = invoke a tool; `access` = enter a surface (`support.access`). A test enforces it. `users.invite` = add people **at or below your own level**; `users.manage` = also change or remove existing people. No synonyms. The `members.*` prefix belongs to the Members area module (ADR-024) and is never used for platform user management.
- **One resolver.** `getTenantAuthorizationContext()` remains the single place permissions are resolved. Every check goes through `can(ctx, permissionId, scope)` / `assertModuleAction()`. **No code compares role names**; the raw checks listed in Context are replaced. A test fails the build if `role ===` / `role !==` / `.role ==` appears outside the resolver and the role registry.
- **Super Admin goes through the same function.** `can()` answers yes for `abluo_admin` on **platform-scope** permissions (`tenants.manage`, `support.access`). It does **not** implicitly grant tenant or project permissions: reaching a client's data takes a membership or a support session (§8), so it is always an explicit, logged event. (Refined during implementation, 2026-10-07.)

### 3. Extras: per-membership, additive only

- Both membership tables get `extra_permissions text[] not null default '{}'`.
- **Effective permissions** for a person on a project =
  role defaults (module-gated) ∪ project-membership extras ∪ tenant-membership extras (for project-scoped grantable permissions).
  Tenant-scoped permissions come from the tenant membership only.
- **Tenant extras apply to every project of the tenant; project extras to that project only.**
- **Extras only add. Nothing ever subtracts.** There is no deny. If someone needs less than a role gives, they get a smaller role plus extras.
- Only `grantable` permissions may appear as extras. The database rejects unknown ids (a `permission_catalog` table seeded by migration, with a test asserting it matches the code registry).

### 4. No escalation

A person may grant only what they hold, in that scope:

- the role granted is at or below their own (Owner > Project Admin > Editor; Member is below Owner only);
- every extra granted is in their own effective permissions for that scope;
- only Owners create, demote or remove Owners; only Super Admin creates the first Owner of a new tenant.

Enforced server-side in the invite and membership-change paths, and mirrored in RLS on the membership tables.

### 5. Presets are invite-time shortcuts

A preset (e.g. a future "Marketing Manager" = Editor + contact requests + marketing permissions) only pre-ticks switches in the invite form. **Nothing stores the preset.** Changing a preset never changes anyone's existing access.

### 6. Invitations are records until accepted

- New table `invitations`: `id`, `email`, `scope_type` (`tenant` | `project`), `scope_id`, `role`, `extra_permissions`, `invited_by`, `token_hash`, `created_at`, `expires_at` (default 14 days), `accepted_at`, `accepted_by`, `revoked_at`.
- **One flow for everyone.** The email (sent via Resend, ADR-019) carries a link. The person signs in if they have an account, or creates one if not. Accepting the link creates the membership server-side, after checking: token valid, not expired/revoked/used, and the signed-in email matches the invited email.
- The membership-creation half of the `handle_new_user()` trigger (migration 024) is retired; the trigger keeps only identity work. Supabase `inviteUserByEmail` is no longer used for memberships.
- An invitation can be revoked by anyone who could have sent it. Pending invitations are listed on the People screen.
- No-escalation (§4) is checked when the invitation is **created and again when it is accepted** (the inviter may have lost access in between).

### 7. People with several memberships

After login, a person with more than one tenant or project gets a client/site switcher. The current project is always explicit in the URL; it is never inferred from "the last one used" for authorization.

### 8. Abluo staff and support mode

Abluo staff are **never** added to a client's memberships, and nobody ever logs in with a client's credentials. Abluo looks into a client's dashboard through **support mode**:

- **Who:** Super Admin now; later, staff holding a platform-level `support.access` capability (a platform role flag, like `abluo_admin`, never a tenant membership). Requires a 2FA (aal2) session.
- **Viewing needs no approval and is read-only.** Support sees the dashboard as the client sees it, with a banner "Viewing as Abluo support". **Contact requests stay hidden** until support clicks an explicit "show contact requests" — a separate logged event.
- **Editing needs the client's approval.** Support clicks *Request edit access* (optional note). The site's Owner(s) and Project Admin(s) — anyone holding `users.manage` on that project — get an email; one button opens their dashboard (works on a phone) where one tap approves. The grant is **for that one project, time-limited, and revocable** by the client at any time.
- **Per-project support settings** (Supabase, editable by anyone holding `users.manage` on the project):
  - **Edit access duration** — preset choices (1 hour, 24 hours, 7 days); **default 24 hours**.
  - **"Abluo support may make changes without asking"** — **off by default**. When on, a support edit session starts without the email/approval step, still for the configured duration, still logged and notified.
- **Everything is traced and visible to the client.** An **Activity** page in the client dashboard lists every support visit, contact-request reveal, edit-access request/approval/expiry/revocation, and every change made. Content changed in support mode is attributed "<name> (Abluo support)". The client is emailed when edit access starts and ends.
- **No emergency override** in support mode. Platform emergencies go through Studio, which is Super Admin's existing, separate path.
- Storage: `support_sessions` (who, project, mode `view|edit`, started, expires, ended, approved_by) and an append-only `access_events` log. Neither is writable by `authenticated`; only server routes write them.
- **Implementation order:** after steps 1–5 of the Migration below; it depends on the permission check, the RLS rules and the email flow.

A live "Abluo support is here now" indicator for the client is a possible later addition; the Activity page and emails cover the need first.

### 9. UI language

Clients never see "tenant", "project", "Member" or permission ids. Roles show as *Owner*, *Site admin*, *Editor*; extras as switches (*Contact requests*, *Invoices*). All labels come from locale dictionaries.

## Migration

Planned, not executed. Every database step is `Tom decides` at execution time; the code that reads the new shape ships **before** any data changes (2026-08-14 outage rule).

1. **Code first, behaviour unchanged.** Permission registry with scopes + `grantable`; `can()`; resolver reads `extra_permissions` if the column exists (treat missing as empty); the role registry accepts both old and new values. Replace every raw role check. Tests: inheritance, extras union, tenant-vs-project scope, no-escalation, last-Owner guard, "no raw role comparisons".
2. **Additive schema.** Add `extra_permissions` to both tables; add `permission_catalog`; widen role checks to accept `admin` (project) and `member` (tenant) alongside the old values; add `invitations`; add the last-Owner trigger.
3. **Data.** Check live rows first. For every existing `viewer`: decide per person (Tom) — normally Editor, or Member/Editor + `forms.submission.read` if they only read contact requests. For every existing `editor` who currently reads contact requests: add the `forms.submission.read` / `.update` extras **before** step 4, so nobody silently loses access. Tenant-level `editor`/`viewer` rows (allowed by migration 003, not by the model) are reviewed one by one.
4. **Flip defaults.** Remove `viewer` from module `defaultRoles`; remove contact requests from Editor's defaults; narrow the role checks to the new values.
5. **Invitations.** Ship the invitation flow; retire membership creation in `handle_new_user()` and the `inviteUserByEmail` path.
6. **UI.** People screen (Owners: whole tenant; Project Admins: their project) showing each person's effective access; switcher.

Each step goes `dev` → STOP → `preview` → STOP → `main`.

## Consequences

**Positive**
- New needs (Tenant Admin, accountant, Marketing Manager) are a role value, a preset or a switch — never a redesign.
- Sensitive data is opt-in per person.
- One identity, many memberships, one resolver: easy to test, one place to audit.
- Fixes the existing-account invitation gap and gives pending invitations a visible, revocable state.

**Negative**
- Effective access is role + extras + inheritance; harder to read at a glance. The People screen must show effective access, not just the role.
- Every RLS policy that grants by role must go through the shared permission function; a bug there affects all tenants, so the cross-tenant harness covers it.
- Permission ids become stored data. Renaming one needs a migration; choose names carefully.
- Step 3 needs a per-person review of existing Editors/Viewers.

## Decisions taken after the first draft (2026-10-07, Tom)

1. No hidden staff memberships — replaced by support mode (§8).
2. Support mode: read-only by default, edit with the client's approval, configurable duration (default 24 h) and optional "without asking", everything visible to the client (§8).
3. Project Admins may give Editors the Contact requests switch on their own project (§4).

## Implementation log

- **2026-10-07 — steps 1–2 (code).** `src/lib/authz` (registry, resolver, `can()`, grant rules); every role comparison replaced by a permission; build-failing guard test. Commit `2028e41`.
- **2026-10-07 — migration 029 applied** (additive: extras, role values, last-Owner guard, invitations). Proven by `supabase/verify/hardening-029.verify.mjs`.
- **2026-10-07 — production review (step 3):** every membership is an Owner held by Tom's own accounts; no Editor or Viewer exists, so changing Editor defaults removes nobody's access. Two clients (`tmz`, `cyce`) have no Owner yet — to be invited in step 6.
- **2026-10-07 — step 4 (code + migration 030, written).** Contact requests are Owner / Site admin by default and otherwise an extra, in the code (`forms.submission.*` defaults) and in the database (`get_my_project_ids_with()` behind the submissions, form-events and inquiries policies). The resolver reads extras and tenant Member grants. Legacy role values retired. 028 now refuses to re-run over 030.
- **2026-10-07 — step 5 (invitations, code).** `src/lib/invitations` (token, email, service). Create: caller authorized by `checkGrant` before any write; a new invitation cancels the pending one for the same person and place; only the SHA-256 of the link token is stored; email from "<inviter> via Abluo" `<no-reply@mail.abluo.app>` with Reply-To = inviter, in the inviter's dashboard language. Accept (`/invite/accept`): signed in with the invited email → accept; other account → sign out; new person → set a password (account created server-side, the token being the authorization). At acceptance the inviter is re-resolved from the database and re-checked; the invitation is claimed atomically; an existing membership is never downgraded and extras only add. Link origin restricted to Abluo hosts (no Host-header injection). Both invite API routes use it; `inviteUserByEmail` is no longer called.
- **2026-10-07 — step 6 (People list).** Built on the shared list pattern (PageHeader, ListToolbar, DataTable, phone cards, CardMenu, BottomSheet). One list: active people, invitations (Invited / Expired) and Archived. Columns: avatar, person, role + extras, status, invited, joined, last active, 2-step. Person sheet shows "invited by". **People are archived, never deleted** (Tom): archiving deletes the membership — access ends at once through the existing checks — and keeps a server-only record (migration 031, `project_member_archive`, grants nothing) for Restore. Archiving also cancels their pending invitations on that site. Restore brings back the same role and extras only if the restorer could grant them today, and emails "your access is back". Resend issues a fresh invitation (old link dies), at most once per 5 minutes and 5 per day per person and site. Cancel/resend are scoped to the site in the URL. Avatars only from Abluo storage (no tracking pixels). The Submissions page hides status/delete controls the viewer lacks (server re-checks).

## Amendment — 2026-10-08: support mode built (§8)

Built on a branch (not released; migration `038_support_sessions.sql` NOT APPLIED). Engineering doc:
`docs/engineering/support-mode.md`. Where it differs from §8 as first written, Tom's 2026-10-08 decisions win:

- **Entry:** admin project page → *View as client*, with a role perspective (Owner by default; Site admin,
  Editor). View only; a persistent banner "Support mode — viewing <site> as <role>" with Exit.
- **Edit approval:** the request appears **inside the client's dashboard** (notice on every page, Home
  included) for the project's Owner / Site admin, with Allow / Decline / End access. **No email yet.**
  Duration is **one constant, 60 minutes** (`SUPPORT_EDIT_MINUTES`); the per-project duration choice and
  "may make changes without asking" settings are not built.
- **Storage:** one table `support_sessions` (visit + edit-access state). The append-only trail is the
  existing **admin audit log** (migration 033), not a separate `access_events` table: every visit
  start/exit, request, decision, expiry, contact-request reveal and every server action run in a visit.
  The client-facing **Activity page** is not built yet.
- **Enforcement (refines §2 "Super Admin goes through the same function"):** support plugs into
  `getTenantAuthorizationContext()` only. During a visit the context holds one synthetic project grant for
  the visited project and no tenant grants; `userId` stays the admin (attribution). Its permissions depend
  on the caller's declared purpose: pages/layouts (`render`) get the perspective role's set; everything else
  (`mutation`, the default) gets reads only — writes only while the client's approval is live. `can()` and
  `assertModuleAction()` re-check (`supportRefuses`). **People (`users.*`), `modules.manage` and
  `billing.manage` are never writable in support mode**, even with approval.
- **Contact requests** stay hidden until the admin's explicit, logged "Show contact requests" (as §8).
- **Self-approval is impossible:** the requesting admin can never decide on their own request, even when the
  same account is an Owner (enforced by `support_session_decide()` and a table CHECK).

## Follow-ups noted

- **"No access" page on `admin.abluo.app`** (Tom, 2026-10-07). A correctly signed-in non-admin (e.g. an Editor) lands on "No access", which is the right behaviour — authentication succeeded, authorization did not, so "wrong user or password" would be false. Improvement: offer a localized "Go to your dashboard" button to the client dashboard instead of a dead end.
