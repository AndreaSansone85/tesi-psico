-- Archivio proposte di tesi: schema Supabase (PostgreSQL)
-- Da eseguire una sola volta nello SQL Editor di Supabase.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_net  with schema extensions;  -- chiamate HTTP per l'invio delle email

-- ---------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------

create table public.sessions (
  id          serial primary key,
  label       text not null unique,          -- es. "Estiva 2027"
  sort_order  int  not null default 0,
  active      boolean not null default true  -- le sessioni non attive non sono selezionabili
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        text not null default 'teacher' check (role in ('teacher', 'admin')),
  active      boolean not null default true,
  -- limiti separati per livello: richieste attive (in attesa + approvate); null = nessun limite
  max_triennale  int check (max_triennale  is null or max_triennale  >= 0),
  max_magistrale int check (max_magistrale is null or max_magistrale >= 0)
);

-- Dati visibili pubblicamente (nessun dato di contatto).
create table public.theses (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null check (char_length(first_name) between 1 and 80),
  last_name   text not null check (char_length(last_name)  between 1 and 80),
  title       text check (title is null or char_length(title) between 5 and 250),  -- definito dal docente se lo studente non lo propone
  abstract    text not null check (char_length(abstract)   between 20 and 3000),  -- descrizione della richiesta
  degree_level text not null check (degree_level in ('triennale', 'magistrale')),
  teacher_id  uuid not null references public.profiles(id),
  session_id  int  not null references public.sessions(id),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Dati riservati: mai esposti all'utente anonimo.
create table public.thesis_private (
  thesis_id       uuid primary key references public.theses(id) on delete cascade,
  matricola       text not null,
  email           text not null default '',
  phone           text not null default '',
  teacher_notes   text,
  attachment_path text unique
                  check (attachment_path is null or attachment_path ~ '^uploads/[0-9a-f-]{36}\.pdf$')
);

-- Impostazioni riservate (indirizzo e codice segreto dello script email, indirizzo del sito).
-- Nessuna policy e nessun permesso: non è leggibile dal sito, solo dalle funzioni del database.
create table public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;

-- Storico delle modifiche (visibile solo a docente della tesi e amministratori).
create table public.thesis_log (
  id         bigserial primary key,
  thesis_id  uuid not null references public.theses(id) on delete cascade,
  at         timestamptz not null default now(),
  actor_name text not null,
  field      text not null,   -- creazione | stato | sessione | docente | livello | titolo
  old_value  text,
  new_value  text
);

create index theses_teacher_idx on public.theses(teacher_id);
create index theses_session_idx on public.theses(session_id);
create index theses_status_idx  on public.theses(status);
create index theses_title_trgm  on public.theses using gin (title extensions.gin_trgm_ops);
create index thesis_private_matricola_idx on public.thesis_private(matricola);
create index thesis_log_thesis_idx on public.thesis_log(thesis_id, at desc);

-- ---------------------------------------------------------------
-- Funzioni di supporto
-- ---------------------------------------------------------------

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin');
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger theses_a_touch before update on public.theses
  for each row execute function public.touch_updated_at();

-- I docenti non possono riassegnare una tesi a un altro docente né cambiare la data di creazione.
create or replace function public.guard_thesis_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and new.teacher_id is distinct from old.teacher_id then
    raise exception 'Solo un amministratore può cambiare il docente.';
  end if;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger theses_b_guard before update on public.theses
  for each row execute function public.guard_thesis_update();

-- Un docente può modificare solo il proprio limite di tesi: ruolo, stato, nome ed email restano all'amministratore.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and (
       new.role is distinct from old.role or new.active is distinct from old.active
       or new.full_name is distinct from old.full_name or new.email is distinct from old.email
       or new.id is distinct from old.id) then
    raise exception 'Puoi modificare solo il tuo limite di tesi.';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Limiti di tesi per docente e per livello (profiles.max_triennale, profiles.max_magistrale):
-- le richieste in attesa e approvate occupano un posto. Quando i posti di un livello sono esauriti
-- il docente non accetta nuove richieste per quel livello, quindi nessuno studente invia una
-- proposta destinata a essere respinta per mancanza di posti.
create or replace function public.check_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_cnt int;
begin
  if new.status in ('pending', 'approved')
     and (tg_op = 'INSERT'
          or old.status not in ('pending', 'approved')
          or old.teacher_id is distinct from new.teacher_id
          or old.degree_level is distinct from new.degree_level) then
    select case when new.degree_level = 'triennale' then max_triennale else max_magistrale end
      into v_max from profiles where id = new.teacher_id;
    if v_max is not null then
      select count(*) into v_cnt from theses
        where teacher_id = new.teacher_id and degree_level = new.degree_level
          and status in ('pending', 'approved') and id <> new.id;
      if v_cnt >= v_max then
        raise exception 'Il docente ha raggiunto il numero massimo di tesi % (assegnate e in attesa): non accetta nuove richieste.', new.degree_level;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger theses_c_capacity before insert or update on public.theses
  for each row execute function public.check_capacity();

-- Il titolo può restare vuoto finché la richiesta è in valutazione; per approvare serve il titolo definitivo.
create or replace function public.check_title_on_approval() returns trigger
language plpgsql as $$
begin
  new.title := nullif(btrim(new.title), '');
  if new.status = 'approved' and new.title is null then
    raise exception 'Per approvare la richiesta inserisci il titolo definitivo della tesi.';
  end if;
  return new;
end;
$$;

create trigger theses_d_title before insert or update on public.theses
  for each row execute function public.check_title_on_approval();

-- Storico: registra creazione e modifiche di stato, sessione, docente e titolo.
create or replace function public.log_thesis_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text;
begin
  select full_name into v_actor from profiles where id = auth.uid();
  v_actor := coalesce(v_actor, 'Studente');

  if tg_op = 'INSERT' then
    insert into thesis_log (thesis_id, actor_name, field, new_value)
    values (new.id, v_actor, 'creazione', new.status);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into thesis_log (thesis_id, actor_name, field, old_value, new_value)
    values (new.id, v_actor, 'stato', old.status, new.status);
  end if;
  if new.session_id is distinct from old.session_id then
    insert into thesis_log (thesis_id, actor_name, field, old_value, new_value)
    values (new.id, v_actor, 'sessione',
            (select label from sessions where id = old.session_id),
            (select label from sessions where id = new.session_id));
  end if;
  if new.teacher_id is distinct from old.teacher_id then
    insert into thesis_log (thesis_id, actor_name, field, old_value, new_value)
    values (new.id, v_actor, 'docente',
            (select full_name from profiles where id = old.teacher_id),
            (select full_name from profiles where id = new.teacher_id));
  end if;
  if new.degree_level is distinct from old.degree_level then
    insert into thesis_log (thesis_id, actor_name, field, old_value, new_value)
    values (new.id, v_actor, 'livello', old.degree_level, new.degree_level);
  end if;
  if new.title is distinct from old.title then
    insert into thesis_log (thesis_id, actor_name, field, old_value, new_value)
    values (new.id, v_actor, 'titolo', old.title, new.title);
  end if;
  return new;
end;
$$;

create trigger theses_z_log after insert or update on public.theses
  for each row execute function public.log_thesis_change();

-- ---------------------------------------------------------------
-- Email automatiche
-- Il database chiama (tramite pg_net) uno script Google Apps Script collegato a un account Gmail
-- dedicato, che invia il messaggio. Finché non si imposta app_config (vedi README) le funzioni
-- non inviano nulla e non danno errori.
-- ---------------------------------------------------------------

create or replace function public._cfg(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from app_config where key = p_key;
$$;

create or replace function public._html(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

create or replace function public._send_email(p_to text, p_subject text, p_html text, p_reply_to text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url   text := public._cfg('email_webhook_url');
  v_token text := public._cfg('email_token');
  v_name  text := coalesce(public._cfg('email_from_name'), 'Archivio tesi');
begin
  if p_to is null or btrim(p_to) = '' or v_url is null or v_token is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'token', v_token,
      'to', p_to,
      'subject', p_subject,
      'html', p_html,
      'name', v_name,
      'replyTo', nullif(btrim(coalesce(p_reply_to, '')), '')),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'Invio email non riuscito: %', sqlerrm;
end;
$$;

-- Nuova richiesta: conferma allo studente e avviso al docente.
-- Se la richiesta è inserita direttamente dal docente (già approvata) si scrive solo allo studente.
create or replace function public.notify_new_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_site text := coalesce(public._cfg('site_url'), '');
  v_nome text;
  v_titolo text;
  v_esito text;
begin
  select th.*, p.full_name as teacher_name, p.email as teacher_email, s.label as session_label
    into t
    from theses th
    join profiles p on p.id = th.teacher_id
    join sessions s on s.id = th.session_id
    where th.id = new.thesis_id;

  v_nome := public._html(t.first_name || ' ' || t.last_name);
  v_titolo := case when t.title is not null then ' dal titolo <em>' || public._html(t.title) || '</em>' else '' end;

  if t.status = 'pending' then
    perform public._send_email(new.email, 'Richiesta di tesi ricevuta',
      '<p>Gentile ' || v_nome || ',</p>'
      || '<p>abbiamo registrato la tua richiesta di tesi di laurea ' || t.degree_level || v_titolo
      || ' con ' || public._html(t.teacher_name) || ' (sessione ' || public._html(t.session_label) || ').</p>'
      || '<p>Il docente la valuterà e riceverai una email con l''esito. Per modificare o ritirare la richiesta '
      || '(ad esempio per cambiare sessione) rispondi a questa email: il messaggio arriverà direttamente al docente.</p>',
      t.teacher_email);

    perform public._send_email(t.teacher_email,
      'Nuova richiesta di tesi ' || t.degree_level || ': ' || t.last_name || ' ' || t.first_name,
      '<p>' || v_nome || ' ha inviato una richiesta di tesi di laurea ' || t.degree_level || v_titolo
      || ' per la sessione ' || public._html(t.session_label) || '.</p>'
      || case when v_site <> '' then '<p>Puoi valutarla dall''area docenti: <a href="' || public._html(v_site)
         || '/docenti.html">' || public._html(v_site) || '/docenti.html</a></p>' else '' end);
  else
    v_esito := case t.status when 'approved' then 'approvata' else t.status end;
    perform public._send_email(new.email, 'Esito della richiesta di tesi: ' || v_esito,
      '<p>Gentile ' || v_nome || ',</p>'
      || '<p>la tua richiesta di tesi di laurea ' || t.degree_level || v_titolo || ' con '
      || public._html(t.teacher_name) || ' (sessione ' || public._html(t.session_label)
      || ') risulta <strong>' || v_esito || '</strong>.</p>',
      t.teacher_email);
  end if;
  return new;
exception when others then
  raise warning 'Notifica non inviata: %', sqlerrm;
  return new;  -- un problema con le email non deve mai bloccare la registrazione della richiesta
end;
$$;

create trigger thesis_private_notify after insert on public.thesis_private
  for each row execute function public.notify_new_request();

-- Cambio di stato (approvata, non approvata, ritirata): email allo studente.
create or replace function public.notify_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_teacher text;
  v_teacher_email text;
  v_session text;
  v_esito text;
begin
  select email into v_email from thesis_private where thesis_id = new.id;
  select full_name, email into v_teacher, v_teacher_email from profiles where id = new.teacher_id;
  select label into v_session from sessions where id = new.session_id;
  v_esito := case new.status when 'approved' then 'approvata' when 'rejected' then 'non approvata'
                             when 'withdrawn' then 'ritirata' else new.status end;
  perform public._send_email(v_email, 'Esito della richiesta di tesi: ' || v_esito,
    '<p>Gentile ' || public._html(new.first_name || ' ' || new.last_name) || ',</p>'
    || '<p>la tua richiesta di tesi di laurea ' || new.degree_level
    || case when new.title is not null then ' dal titolo <em>' || public._html(new.title) || '</em>' else '' end
    || ' con ' || public._html(v_teacher) || ' (sessione ' || public._html(v_session)
    || ') risulta <strong>' || v_esito || '</strong>.</p>'
    || '<p>Per qualsiasi chiarimento puoi rispondere a questa email: il messaggio arriverà direttamente al docente.</p>',
    v_teacher_email);
  return new;
exception when others then
  raise warning 'Notifica non inviata: %', sqlerrm;
  return new;
end;
$$;

create trigger theses_zz_notify after update of status on public.theses
  for each row when (old.status is distinct from new.status and new.status <> 'pending')
  execute function public.notify_status_change();

-- ---------------------------------------------------------------
-- Creazione di una richiesta (funzione interna) e punti di ingresso
-- ---------------------------------------------------------------

create or replace function public._create_thesis(
  p_first_name text, p_last_name text, p_matricola text, p_email text, p_phone text,
  p_teacher_id uuid, p_session_id int, p_title text, p_abstract text, p_degree_level text,
  p_attachment_path text, p_staff boolean, p_status text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_first text := btrim(p_first_name);
  v_last  text := btrim(p_last_name);
  v_mat   text := upper(btrim(p_matricola));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_abs   text := btrim(p_abstract);
  v_att   text := nullif(btrim(coalesce(p_attachment_path, '')), '');
begin
  if char_length(v_first) < 1 or char_length(v_last) < 1 then
    raise exception 'Nome e cognome sono obbligatori.';
  end if;
  if v_mat !~ '^[A-Z0-9]{4,15}$' then
    raise exception 'La matricola non sembra valida (da 4 a 15 caratteri alfanumerici).';
  end if;
  if (not p_staff or v_email <> '') and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200) then
    raise exception 'L''indirizzo email non è valido.';
  end if;
  if (not p_staff or v_phone <> '') and v_phone !~ '^[0-9+ ()./-]{6,25}$' then
    raise exception 'Il numero di telefono non è valido.';
  end if;
  if v_title is not null and (char_length(v_title) < 5 or char_length(v_title) > 250) then
    raise exception 'Il titolo, se indicato, deve avere tra 5 e 250 caratteri.';
  end if;
  if char_length(v_abs) < 20 or char_length(v_abs) > 3000 then
    raise exception 'La descrizione della richiesta deve avere tra 20 e 3000 caratteri.';
  end if;
  if not exists (select 1 from profiles where id = p_teacher_id and active) then
    raise exception 'Il docente selezionato non è disponibile.';
  end if;
  if not exists (select 1 from sessions where id = p_session_id and active) then
    raise exception 'La sessione selezionata non è disponibile.';
  end if;
  if p_status not in ('pending', 'approved') then
    raise exception 'Stato iniziale non valido.';
  end if;
  if p_degree_level not in ('triennale', 'magistrale') then
    raise exception 'Seleziona il livello della tesi (triennale o magistrale).';
  end if;

  if v_att is not null then
    if v_att !~ '^uploads/[0-9a-f-]{36}\.pdf$'
       or not exists (select 1 from storage.objects where bucket_id = 'proposals' and name = v_att) then
      raise exception 'Allegato non valido: ricarica il file PDF.';
    end if;
    if exists (select 1 from thesis_private where attachment_path = v_att) then
      raise exception 'Allegato già utilizzato.';
    end if;
  end if;

  -- Serializza gli invii con la stessa matricola per evitare doppioni concorrenti.
  perform pg_advisory_xact_lock(hashtext('thesis_matricola_' || v_mat));

  if exists (
    select 1 from thesis_private tp join theses t on t.id = tp.thesis_id
    where tp.matricola = v_mat and t.status in ('pending', 'approved')
  ) then
    raise exception 'Esiste già una richiesta attiva per questa matricola. Per modificarla o ritirarla contatta il docente.';
  end if;

  -- Limite antispam per gli studenti: al massimo 3 invii all'ora con la stessa email.
  if not p_staff and (select count(*) from thesis_private tp join theses t on t.id = tp.thesis_id
      where tp.email = v_email and t.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Troppi invii ravvicinati. Riprova più tardi.';
  end if;

  insert into theses (first_name, last_name, title, abstract, degree_level, teacher_id, session_id, status)
  values (v_first, v_last, v_title, v_abs, p_degree_level, p_teacher_id, p_session_id, p_status)
  returning id into v_id;

  insert into thesis_private (thesis_id, matricola, email, phone, attachment_path)
  values (v_id, v_mat, v_email, v_phone, v_att);

  return v_id;
end;
$$;

-- Invio da parte dello studente (senza login).
create or replace function public.submit_thesis(
  p_first_name text, p_last_name text, p_matricola text, p_email text, p_phone text,
  p_teacher_id uuid, p_session_id int, p_title text, p_abstract text, p_degree_level text,
  p_attachment_path text default null
) returns uuid
language sql security definer set search_path = public as $$
  select public._create_thesis(p_first_name, p_last_name, p_matricola, p_email, p_phone,
    p_teacher_id, p_session_id, p_title, p_abstract, p_degree_level, p_attachment_path, false, 'pending');
$$;

-- Inserimento manuale da parte di un docente (per sé) o di un amministratore (per chiunque).
create or replace function public.staff_add_thesis(
  p_first_name text, p_last_name text, p_matricola text, p_email text, p_phone text,
  p_teacher_id uuid, p_session_id int, p_title text, p_abstract text, p_degree_level text,
  p_status text default 'approved', p_attachment_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Non autorizzato.';
  end if;
  if not public.is_admin() and p_teacher_id <> auth.uid() then
    raise exception 'Puoi inserire richieste solo per te stesso.';
  end if;
  return public._create_thesis(p_first_name, p_last_name, p_matricola, p_email, p_phone,
    p_teacher_id, p_session_id, p_title, p_abstract, p_degree_level, p_attachment_path, true, p_status);
end;
$$;

-- Titoli simili già presenti in archivio (per evitare progetti doppioni).
create or replace function public.similar_titles(p_title text)
returns table (id uuid, title text, last_name text, first_name text, teacher_name text, score real)
language sql stable security definer set search_path = public, extensions as $$
  select t.id, t.title, t.last_name, t.first_name, p.full_name, similarity(t.title, p_title)
  from theses t join profiles p on p.id = t.teacher_id
  where t.title is not null and t.status in ('pending', 'approved') and similarity(t.title, p_title) > 0.3
  order by similarity(t.title, p_title) desc
  limit 3;
$$;

-- ---------------------------------------------------------------
-- Viste pubbliche (solo dati non sensibili)
-- ---------------------------------------------------------------

create or replace view public.public_teachers as
  select id, full_name from public.profiles where active;

create or replace view public.stats_by_session as
  select s.id, s.label, s.sort_order, s.active,
         count(t.id) filter (where t.status = 'pending')  as pending,
         count(t.id) filter (where t.status = 'approved') as approved,
         count(t.id) filter (where t.status in ('pending', 'approved') and t.degree_level = 'triennale')  as triennale,
         count(t.id) filter (where t.status in ('pending', 'approved') and t.degree_level = 'magistrale') as magistrale,
         count(t.id) filter (where t.status in ('pending', 'approved')) as total
  from public.sessions s
  left join public.theses t on t.session_id = s.id
  group by s.id;

create or replace view public.stats_by_teacher as
  select p.id, p.full_name, p.max_triennale, p.max_magistrale,
         count(t.id) filter (where t.status = 'pending')  as pending,
         count(t.id) filter (where t.status = 'approved') as approved,
         count(t.id) filter (where t.status in ('pending', 'approved') and t.degree_level = 'triennale')  as triennale,
         count(t.id) filter (where t.status in ('pending', 'approved') and t.degree_level = 'magistrale') as magistrale,
         count(t.id) filter (where t.status in ('pending', 'approved')) as total
  from public.profiles p
  left join public.theses t on t.teacher_id = p.id
  where p.active
  group by p.id;

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------

alter table public.sessions       enable row level security;
alter table public.profiles       enable row level security;
alter table public.theses         enable row level security;
alter table public.thesis_private enable row level security;
alter table public.thesis_log     enable row level security;

-- sessions: lettura pubblica, scrittura solo admin
create policy sessions_read  on public.sessions for select to anon, authenticated using (true);
create policy sessions_admin on public.sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles: ciascuno vede il proprio profilo, l'admin vede e modifica tutti
create policy profiles_self  on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- ogni docente può aggiornare il proprio profilo (in pratica solo il limite di tesi, vedi trigger sotto)
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() and active) with check (id = auth.uid());

-- theses: il pubblico vede solo richieste in attesa o approvate
create policy theses_public on public.theses for select to anon, authenticated
  using (status in ('pending', 'approved'));
create policy theses_staff_read on public.theses for select to authenticated
  using (public.is_admin() or (public.is_staff() and teacher_id = auth.uid()));
create policy theses_staff_update on public.theses for update to authenticated
  using (public.is_admin() or (public.is_staff() and teacher_id = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and teacher_id = auth.uid()));
create policy theses_admin_delete on public.theses for delete to authenticated
  using (public.is_admin());

-- thesis_private: solo il docente della tesi e gli admin
create policy private_staff_read on public.thesis_private for select to authenticated
  using (public.is_admin() or (public.is_staff() and exists
    (select 1 from public.theses t where t.id = thesis_id and t.teacher_id = auth.uid())));
create policy private_staff_update on public.thesis_private for update to authenticated
  using (public.is_admin() or (public.is_staff() and exists
    (select 1 from public.theses t where t.id = thesis_id and t.teacher_id = auth.uid())))
  with check (public.is_admin() or (public.is_staff() and exists
    (select 1 from public.theses t where t.id = thesis_id and t.teacher_id = auth.uid())));

-- thesis_log: sola lettura per docente della tesi e admin
create policy log_staff_read on public.thesis_log for select to authenticated
  using (public.is_admin() or (public.is_staff() and exists
    (select 1 from public.theses t where t.id = thesis_id and t.teacher_id = auth.uid())));

-- ---------------------------------------------------------------
-- Storage per gli allegati PDF (bucket privato)
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposals', 'proposals', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Chiunque può caricare un PDF in uploads/ (nome casuale, solo scrittura, nessuna lettura).
create policy proposals_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'proposals' and name ~ '^uploads/[0-9a-f-]{36}\.pdf$');

-- Solo il docente della tesi e gli admin leggono l'allegato.
create policy proposals_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'proposals' and exists (
    select 1 from public.thesis_private tp join public.theses t on t.id = tp.thesis_id
    where tp.attachment_path = storage.objects.name
      and (public.is_admin() or (public.is_staff() and t.teacher_id = auth.uid()))));

create policy proposals_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'proposals' and public.is_admin());

-- ---------------------------------------------------------------
-- Permessi
-- ---------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.sessions, public.theses to anon;
grant select on public.public_teachers, public.stats_by_session, public.stats_by_teacher to anon, authenticated;
grant select on public.sessions, public.theses, public.thesis_log to authenticated;
grant select, update, insert, delete on public.profiles, public.sessions to authenticated;
grant update, delete on public.theses to authenticated;
grant select, update on public.thesis_private to authenticated;

-- Solo le funzioni che il frontend deve chiamare.
grant execute on function public.submit_thesis(text,text,text,text,text,uuid,int,text,text,text,text) to anon, authenticated;
grant execute on function public.similar_titles(text) to anon, authenticated;
grant execute on function public.staff_add_thesis(text,text,text,text,text,uuid,int,text,text,text,text,text) to authenticated;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- ---------------------------------------------------------------
-- Dati iniziali
-- ---------------------------------------------------------------

insert into public.sessions (label, sort_order) values
  ('Estiva 2027', 1),
  ('Autunnale 2027', 2),
  ('Invernale 2028', 3);

-- ---------------------------------------------------------------
-- Creazione di un docente (dopo aver creato l'utente da
-- Authentication > Users > Add user, con "Auto Confirm User" attivo):
--
--   insert into public.profiles (id, full_name, email, role)
--   select id, 'Prof. Mario Rossi', email, 'teacher'
--   from auth.users where email = 'mario.rossi@uniroma2.it';
--
-- Per il primo amministratore usare role = 'admin'.
--
