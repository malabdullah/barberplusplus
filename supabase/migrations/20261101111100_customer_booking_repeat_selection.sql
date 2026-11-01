-- Add exact selection IDs to owned history without changing account/session guards.
-- Requires the hosted customer-account implementation in the private schema.
do $migration$
declare
  definition text := pg_get_functiondef('private.customer_account_api(text,jsonb)'::regprocedure);
  original text := 'select b.id,b.date,';
  replacement text := 'select b.id,b.branch_id,b.barber_id,b.service_ids,b.date,';
begin
  if (length(definition)-length(replace(definition,replacement,''))) / length(replacement) = 2 then return; end if;
  if (length(definition)-length(replace(definition,original,''))) / length(original) <> 2 then
    raise exception 'Unexpected customer history projection; review before changing it';
  end if;
  execute replace(definition,original,replacement);
end;
$migration$;
