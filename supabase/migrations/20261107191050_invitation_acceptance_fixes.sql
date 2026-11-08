begin;
do $migration$
declare source text;
begin
 select pg_get_functiondef('public.shop_barber_invitation_api(text,jsonb)'::regprocedure) into source;
 source:=replace(source,'insert into public.logs(user_id,action,entity_type,entity_id,message) values(actor,''invite'',''barber'',inv.id,''Barber invitation issued'');','insert into public.logs(level,log_type,user_id,user_role,action,entity_type,entity_id,message) values(''info'',''action'',actor,''manager'',''invite'',''barber'',inv.id,''Barber invitation issued'');');
 source:=replace(source,'insert into public.logs(user_id,action,entity_type,entity_id,message) values(person.id,''accept_invite'',''barber'',chair.id,''Barber invitation accepted'');','insert into public.logs(level,log_type,user_id,user_role,action,entity_type,entity_id,message) values(''info'',''action'',person.id,''barber'',''accept_invite'',''barber'',chair.id,''Barber invitation accepted'');');
 source:=replace(source,'''signed_in'',profile.id is not null,','''signed_in'',coalesce(actor=person.id and private.invitation_live(actor,sid,''customer''),false),');
 execute source;
end $migration$;
commit;
