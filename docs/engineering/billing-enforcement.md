# Billing enforcement (ADR-041 D8)

Env `BILLING_ENFORCEMENT` = `off` (default; also any unknown value) | `observe` | `on`.

- `off`: no billing read at all; the authorization context is unchanged.
- `observe`: each project grant carries `billing` (drives the dashboard banner); permissions are NOT stripped; `console.info` lists the projects that would be locked.
- `on`: locked/review projects keep reads + `BILLING_LOCK_ALLOWED` (support tickets, form submissions). Tenant grants are untouched; support visits are not locked.

Applied as the last step of `resolveForRequest` (src/lib/api/tenant-context.ts) via `applyBillingEnforcement` (src/lib/billing/enforcement.ts). Any load error fails OPEN (context unchanged, `console.error`). Banner: `BillingNotice` in the project dashboard layout; copy in `clientDashboard.billingNotice` (messages to be merged from the enforcement.json draft).
