begin;
do $fix$
declare source text:=pg_get_functiondef('subscription_billing.billing_api(text,jsonb)'::regprocedure);fixed text;
begin
 fixed:=replace(source,'#variable_conflict use_column','#variable_conflict error');
 fixed:=replace(fixed,'reason text;frequency text;','reason text;requested_frequency text;');
 fixed:=replace(fixed,'frequency:=','requested_frequency:=');
 fixed:=replace(fixed,'private.billing_price(count_barbers,frequency)','private.billing_price(count_barbers,requested_frequency)');
 fixed:=replace(fixed,$q$in('both',frequency)$q$,$q$in('both',requested_frequency)$q$);
 fixed:=replace(fixed,$q$'frequency',frequency$q$,$q$'frequency',requested_frequency$q$);
 fixed:=replace(fixed,'case when frequency=s.frequency then null else frequency end','case when requested_frequency=s.frequency then null else requested_frequency end');
 fixed:=replace(fixed,$q$if frequency is null or frequency not in$q$,$q$if requested_frequency is null or requested_frequency not in$q$);
 fixed:=replace(fixed,'discount bigint:=0;code text;','discount bigint:=0;entered_code text;');
 fixed:=replace(fixed,'code:=','entered_code:=');
 fixed:=replace(fixed,$q$if code<>''$q$,$q$if entered_code<>''$q$);
 fixed:=replace(fixed,'billing_discount_codes.code=code','billing_discount_codes.code=entered_code');
 fixed:=replace(fixed,$q$nullif(code,'')$q$,$q$nullif(entered_code,'')$q$);
 fixed:=replace(fixed,'values(code,p_data','values(entered_code,p_data');
 if fixed=source then raise exception 'Subscription variable source changed';end if;
 execute fixed;
end $fix$;
commit;
