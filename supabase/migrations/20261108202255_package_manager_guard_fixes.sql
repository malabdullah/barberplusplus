begin;
do $patch$
declare definition text:=pg_get_functiondef('public.manage_service_packages(text,uuid,jsonb)'::regprocedure);start_at integer;end_at integer;block text;updated text;
begin
 start_at:=position('if p_action=''list'' then' in definition);
 end_at:=position('if p_action not in(' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'Package list contract changed';end if;
 block:=substring(definition from start_at for end_at-start_at);
 updated:=regexp_replace(block,'\mp\M','pkg','g');updated:=regexp_replace(updated,'\mo\M','ofr','g');
 definition:=substring(definition from 1 for start_at-1)||updated||substring(definition from end_at);
 updated:=replace(definition,$old$if p_action='archive' then update private.service_packages set archived=true,updated_at=now() where id=p.id;return$old$,
 $new$if p_action='archive' then update private.service_packages set archived=true,updated_at=now() where id=p.id;update private.package_offers set paused=true,updated_at=now() where package_id=p.id;return$new$);
 if updated=definition then raise exception 'Package archive contract changed';end if;execute updated;
end $patch$;
notify pgrst,'reload schema';
commit;
