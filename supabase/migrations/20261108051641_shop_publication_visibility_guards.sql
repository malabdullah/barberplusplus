begin;
do $$declare definition text; original text:='if tg_op=''INSERT'' then';
begin
 select pg_get_functiondef('private.guard_shop_publication()'::regprocedure) into definition;
 if position(original in definition)=0 then raise exception 'Publication guard changed';end if;
 execute replace(definition,original,$guard$if tg_op='UPDATE' and auth.uid() is not null and auth.jwt()->>'role'='authenticated'
   and new.status is distinct from old.status and staff_role is distinct from 'admin' then
  raise exception 'SHOP_PERMISSION_ADMIN_ONLY' using errcode='42501';
 end if;
 if tg_op='INSERT' then$guard$);
 select pg_get_functiondef('private.customer_favourites_api(text,jsonb)'::regprocedure) into definition;
 if position('where id=target and status=''active'';' in definition)=0
  or position('b.status=''active'' and br.status=''active''' in definition)=0
  or position('coalesce(br.status=''active'' and (' in definition)=0 then raise exception 'Favourites visibility contract changed';end if;
 definition:=replace(definition,'where id=target and status=''active'';','where id=target and status=''active'' and publication_state=''published'';');
 definition:=replace(definition,'b.status=''active'' and br.status=''active''','b.status=''active'' and br.status=''active'' and br.publication_state=''published''');
 execute replace(definition,'coalesce(br.status=''active'' and (','coalesce(br.status=''active'' and br.publication_state=''published'' and (');
end $$;
commit;
