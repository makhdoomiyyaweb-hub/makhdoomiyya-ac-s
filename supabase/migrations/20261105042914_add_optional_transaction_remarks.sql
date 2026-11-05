-- Add optional remarks to accounting transaction tables. Existing rows are unchanged.
ALTER TABLE public.income ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE public.refreshments ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE public.event_transactions ADD COLUMN IF NOT EXISTS remarks text;
