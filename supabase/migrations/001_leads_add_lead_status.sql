-- ============================================================
-- Migration 001 — leads: add lead_status column
-- ============================================================
-- lead_status tracks where a lead is in the sales process.
-- Distinct from `status` (new | read | archived) which tracks
-- whether the message has been read in the inbox.
-- ============================================================

alter table public.leads
  add column lead_status text not null default 'new'
    check (lead_status in ('new', 'contacted', 'qualified', 'converted', 'closed', 'spam'));
