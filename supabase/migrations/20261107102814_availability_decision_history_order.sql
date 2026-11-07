begin;
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.availability_api(text,jsonb)'::regprocedure);
 if position('category<>''legacy'' order by created_at desc,id desc limit 20' in definition)=0 then raise exception 'Availability history definition changed; review migration';end if;
 definition:=replace(definition,'jsonb_agg(to_jsonb(r) order by created_at desc,id desc)','jsonb_agg(to_jsonb(r) order by coalesce(reviewed_at,created_at) desc,id desc)');
 definition:=replace(definition,'category<>''legacy'' order by created_at desc,id desc limit 20','category<>''legacy'' and status in(''approved'',''declined'') order by coalesce(reviewed_at,created_at) desc,id desc limit 20');
 execute definition;
end $migration$;
commit;
