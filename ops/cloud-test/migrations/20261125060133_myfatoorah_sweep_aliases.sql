begin;
-- Qualify the sweep's SQL row aliases separately from its PL/pgSQL record a.
do $$ declare definition text; start_at integer; end_at integer; old_block text; new_block text; begin
 select pg_get_functiondef('public.myfatoorah_test_booking(text,uuid,jsonb)'::regprocedure) into definition;
 start_at:=position('if p_action=''sweep'' then' in definition);
 end_at:=position('if p_action=''read'' then' in definition);
 if start_at<1 or end_at<=start_at then raise exception 'MyFatoorah sweep contract changed';end if;
 old_block:=substring(definition from start_at for end_at-start_at);
 if position('booking_attempts a' in old_block)=0 then raise exception 'Expected sweep alias missing';end if;
 new_block:=replace(replace(old_block,'booking_attempts a','booking_attempts pay'),'a.','pay.');
 execute replace(definition,old_block,new_block);
end $$;
notify pgrst,'reload schema';
commit;
