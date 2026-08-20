-- Email support on new in-app feedback.
--
-- Turns the append-only public.feedback sink (in-app "Ideas, Feedback, & Issues")
-- into a lightweight email support inbox: on INSERT, an AFTER trigger fires
-- pg_net at the `notify-feedback` Edge Function, which emails FEEDBACK_NOTIFY_TO
-- with Reply-To = the submitter (so a reply reaches the customer directly), then
-- stamps notified_at.
--
-- Mirrors the appt-reminder plumbing (20260629000100_appt_reminder_cron.sql): a
-- SECURITY DEFINER function reads project_url + service_role_key from Vault and
-- calls the EF over pg_net. net.http_post QUEUES asynchronously, so it never
-- blocks or slows the client's INSERT. Warn-and-skip if the Vault secrets are
-- absent, so this is safe to apply before/independent of seeding them.

create extension if not exists pg_net;

-- Idempotency + audit marker: set once the notification email is sent.
alter table public.feedback
  add column if not exists notified_at timestamptz;

-- ── Fire the EF for one feedback row (also callable manually to re-send) ──────
create or replace function public.fire_feedback_notify(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    raise warning 'fire_feedback_notify: missing vault secrets project_url/service_role_key — skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/notify-feedback',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('id', p_id)
  );
end;
$$;

-- Reads Vault secrets — keep it off the client roles; the trigger below invokes
-- it as its (definer) owner, and the owner may run it from the dashboard.
revoke all on function public.fire_feedback_notify(uuid) from public, anon, authenticated;

-- ── AFTER INSERT trigger ─────────────────────────────────────────────────────
-- SECURITY DEFINER so the trigger runs as the owner (not the inserting
-- authenticated user, who has no EXECUTE on fire_feedback_notify).
create or replace function public.trg_feedback_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fire_feedback_notify(new.id);
  return null; -- AFTER trigger: return value is ignored.
end;
$$;

revoke all on function public.trg_feedback_notify() from public, anon, authenticated;

drop trigger if exists feedback_notify_ins on public.feedback;
create trigger feedback_notify_ins
  after insert on public.feedback
  for each row
  execute function public.trg_feedback_notify();
