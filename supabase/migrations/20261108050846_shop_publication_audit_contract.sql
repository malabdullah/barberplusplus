begin;
do $$declare definition text;
 old_insert text:='insert into public.logs(user_id,branch_id,action,entity_type,entity_id,message,metadata)';
 old_values text:='values(auth.uid(),new.id,''update'',''branch'',new.id,''Shop booking access changed'',';
begin
 select pg_get_functiondef('private.guard_shop_publication()'::regprocedure) into definition;
 if position(old_insert in definition)=0 or position(old_values in definition)=0 then raise exception 'Publication audit contract changed';end if;
 definition:=replace(definition,old_insert,'insert into public.logs(level,log_type,user_role,session_id,user_id,branch_id,action,entity_type,entity_id,message,metadata)');
 execute replace(definition,old_values,'values(''info'',''action'',staff_role,(auth.jwt()->>''session_id'')::uuid,auth.uid(),new.id,''update'',''branch'',new.id,''Shop booking access changed'',');
end $$;
commit;
