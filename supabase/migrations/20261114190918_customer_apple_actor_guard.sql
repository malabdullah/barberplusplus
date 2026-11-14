begin;
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.customer_deletion_service(text,jsonb)'::regprocedure)into definition;
 if position('TEST_ACCOUNT_ONLY'in definition)=0 or position('apple-credential:'in definition)=0 then raise exception 'UNEXPECTED_APPLE_BASELINE';end if;
 definition:=replace(definition,
  '    select coalesce(nullif(identity_data->>''sub'',''''),provider_id)into v_subject',
  '    -- No profile-creation dependency; linked work/admin responsibilities still deny.
    perform private.deletion_actor(u,s);
    select coalesce(nullif(identity_data->>''sub'',''''),provider_id)into v_subject');
 if position('perform private.deletion_actor(u,s)'in definition)=0 then raise exception 'UNEXPECTED_APPLE_BASELINE';end if;
 execute definition;
end $migration$;
commit;
