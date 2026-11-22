-- Independent, manually entered bank statement evidence. This never posts money.
create table private.settlement_bank_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  direction text not null check (direction in ('in', 'out')),
  reference text not null check (char_length(reference) between 1 and 120 and reference = btrim(reference) and reference !~ '[[:cntrl:]]'),
  booked_on date not null check (booked_on >= date '2000-01-01'),
  amount_fils bigint not null check (amount_fils between 1 and 1000000000),
  recorded_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (direction, reference)
);

alter table private.settlement_bank_entries enable row level security;
revoke all on private.settlement_bank_entries from public, anon, authenticated, service_role;
create index settlement_bank_entries_date on private.settlement_bank_entries (booked_on desc, id);
create trigger settlement_bank_entry_immutable before update or delete on private.settlement_bank_entries
for each row execute function private.settlement_immutable();

create function settlement_api.reconciliation(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '20s' as $$
declare
  page_offset integer;
  filter_text text;
  entry_date date;
  entry_amount bigint;
  entry_direction text;
  entry_reference text;
  entry_amount_text text;
  saved private.settlement_bank_entries%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'SETTLEMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from private.settlement_runtime where singleton and enabled) then
    raise exception 'SETTLEMENT_DISABLED';
  end if;
  if p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 2048 then
    raise exception 'SETTLEMENT_INVALID';
  end if;

  if p_action = 'record' then
    entry_direction := p_data->>'direction';
    entry_reference := btrim(p_data->>'reference');
    entry_amount_text := p_data->>'amountFils';
    if entry_direction is null or entry_direction not in ('in', 'out')
      or entry_reference is null or char_length(entry_reference) not between 1 and 120 or entry_reference ~ '[[:cntrl:]]'
      or coalesce(entry_amount_text, '') !~ '^[0-9]{1,10}$'
      or coalesce(p_data->>'bookedOn', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'SETTLEMENT_INVALID';
    end if;
    entry_date := (p_data->>'bookedOn')::date;
    entry_amount := entry_amount_text::bigint;
    if entry_date not between date '2000-01-01' and (clock_timestamp() at time zone 'Asia/Kuwait')::date
      or entry_amount not between 1 and 1000000000 then
      raise exception 'SETTLEMENT_INVALID';
    end if;

    insert into private.settlement_bank_entries (direction, reference, booked_on, amount_fils, recorded_by)
    values (entry_direction, entry_reference, entry_date, entry_amount, auth.uid())
    on conflict (direction, reference) do nothing
    returning * into saved;
    if not found then
      select * into strict saved from private.settlement_bank_entries
      where direction = entry_direction and reference = entry_reference;
      if saved.booked_on <> entry_date or saved.amount_fils <> entry_amount then
        raise exception 'SETTLEMENT_BANK_REFERENCE_EXISTS';
      end if;
    end if;
    return jsonb_build_object('id', saved.id);
  end if;

  page_offset := greatest(0, least(100000, coalesce((p_data->>'offset')::integer, 0)));
  if p_action = 'shops' then
    filter_text := left(btrim(coalesce(p_data->>'query', '')), 100);
    return (
      with page as materialized (
        select b.id, b.name, b.name_ar
        from public.branches b
        where b.name ilike '%' || filter_text || '%' or b.name_ar ilike '%' || filter_text || '%'
        order by b.name, b.id limit 26 offset page_offset
      ), balances as (
        select r.shop_id, greatest(0, sum(r.net_fils - r.paid_fils)) as owed
        from private.settlement_receipt_state r
        join page on page.id = r.shop_id
        left join private.settlement_statements s on s.id = r.statement_id
        where r.net_fils - r.paid_fils < 0 or (r.eligible and s.state = 'final')
        group by r.shop_id
      ), transfers as (
        select p.shop_id, sum(p.amount_fils) as transferred
        from private.settlement_payouts p join page on page.id = p.shop_id
        where p.state = 'paid' group by p.shop_id
      )
      select jsonb_build_object(
        'rows', coalesce(jsonb_agg(jsonb_build_object(
          'id', page.id, 'name', page.name, 'nameAr', page.name_ar,
          'owedFils', coalesce(balances.owed, 0)::text,
          'transferredFils', coalesce(transfers.transferred, 0)::text
        ) order by page.name, page.id), '[]'::jsonb), 'hasMore', count(*) > 25
      )
      from page left join balances on balances.shop_id = page.id
      left join transfers on transfers.shop_id = page.id
    );
  end if;

  if p_action = 'entries' then
    return (
      select jsonb_build_object('rows', coalesce(jsonb_agg(row_data order by booked_on desc, id), '[]'::jsonb), 'hasMore', count(*) > 25)
      from (
        select e.id, e.booked_on, jsonb_build_object(
          'id', e.id, 'reference', e.reference, 'amountFils', e.amount_fils::text,
          'bookedOn', e.booked_on, 'direction', e.direction,
          'status', case matches.total when 0 then 'unmatched' when 1 then 'matched' else 'ambiguous' end
        ) as row_data
        from private.settlement_bank_entries e
        cross join lateral (
          select count(*) as total
          from (
            select r.id
            from private.settlement_receipts r
            where e.direction = 'in' and r.source_ref = e.reference and r.amount_fils = e.amount_fils
              and r.settled_at is not null and r.settled_at <= clock_timestamp()
              and not exists (
                select 1 from private.settlement_journals j
                join private.settlement_journals reversal on reversal.reverses_id = j.id
                where j.receipt_id = r.id and j.kind = 'receipt'
              )
            union all
            select p.id
            from private.settlement_payouts p
            where e.direction = 'out' and p.state = 'paid' and p.bank_ref = e.reference and p.amount_fils = e.amount_fils
            union all
            select j.id
            from private.settlement_journals j
            where j.external_ref = e.reference and (
              (j.kind = 'refund' and e.direction = 'out' and j.amount_fils = e.amount_fils)
              or (j.kind = 'fee' and ((e.direction = 'out' and j.amount_fils = e.amount_fils)
                or (e.direction = 'in' and j.amount_fils = -e.amount_fils)))
            )
              and not exists (select 1 from private.settlement_journals reversal where reversal.reverses_id = j.id)
          ) candidates
        ) matches
        where matches.total <> 1 or p_data->>'filter' = 'all'
        order by e.booked_on desc, e.id limit 26 offset page_offset
      ) entries
    );
  end if;

  raise exception 'SETTLEMENT_INVALID';
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'SETTLEMENT_INVALID';
end $$;

revoke all on function settlement_api.reconciliation(text, jsonb) from public, anon, service_role;
grant execute on function settlement_api.reconciliation(text, jsonb) to authenticated;

create function public.platform_settlement_reconciliation(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb
language sql set search_path = ''
as $$select settlement_api.reconciliation(p_action,p_data);$$;

revoke all on function public.platform_settlement_reconciliation(text, jsonb) from public, anon, service_role;
grant execute on function public.platform_settlement_reconciliation(text, jsonb) to authenticated;
