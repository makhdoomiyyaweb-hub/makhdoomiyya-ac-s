-- Transaction edits keep their existing primary key. No INSERT, DELETE, table
-- replacement, RLS/grant change, or receipt/voucher renumbering is performed.
-- Review the target schema and migration history before applying to production.

CREATE OR REPLACE FUNCTION public.set_transaction_edit_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['income', 'expenses', 'refreshments', 'event_transactions']
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing; verify the target schema', target_table;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', target_table);
    EXECUTE format('DROP TRIGGER IF EXISTS transaction_edit_updated_at ON public.%I', target_table);
    EXECUTE format('CREATE TRIGGER transaction_edit_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_transaction_edit_updated_at()', target_table);
  END LOOP;
END;
$$;
