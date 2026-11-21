-- CI-only empty rowtypes and approved public definition. Never invoke the gateway.
-- Provenance: approved live-review-20261118/install.sql; no data/keys/target lists.
begin;
set local check_function_bodies=false;
create table private.maintenance_configuration(
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 environment text not null check(environment='production'),
 backend_ref text not null check(backend_ref='srv1073968.hstgr.cloud'), escrow_public_key text not null, escrow_fingerprint text not null,
 retention_policy text not null check(retention_policy='retain_until_explicit_owner_review'),
 operator_users uuid[]not null default'{}',allowed_targets uuid[]not null default'{}',
 protected_users uuid[]not null default'{}',test_run_id uuid
);
create table private.maintenance_batches(
 id uuid primary key, manifest jsonb not null, manifest_hash text not null,
 environment text not null, backend_ref text not null, schema_hash text not null,
 actor_id uuid not null, created_at timestamptz not null default clock_timestamp(),
 state text not null default 'prepared'check(state in('prepared','erased','restored')),
 secret_id uuid not null, archive bytea not null, archive_hash text not null, archive_mac text not null, archive_binding jsonb not null,
 key_capsule bytea not null, custody_nonce text not null, custody_verified boolean not null default false,
 before_scope_hash text not null, after_fingerprints jsonb, after_mac text,
 erased_at timestamptz, restored_at timestamptz
);
create function public.account_maintenance_gateway(p_action text,p_data jsonb)returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='35s' set lock_timeout='2s'as $$
declare actor uuid:=(p_data->>'actorId')::uuid;session uuid:=(p_data->>'sessionId')::uuid;
 cfg private.maintenance_configuration%rowtype;j private.maintenance_batches%rowtype;
 manifest jsonb:=p_data->'manifest';binding jsonb;payload jsonb;records jsonb;current_records jsonb;scope jsonb;entry jsonb;desired jsonb;
 users uuid[];protected uuid[];key text;source_hash text;secret uuid;cipher bytea;mac text;proof text;action_digest text;failure text;
 root uuid;phase text;record_count integer;
begin
 perform private.maintenance_actor(actor,session);
 select *into cfg from private.maintenance_configuration where singleton;
 if not cfg.enabled or cfg.environment is distinct from(select deployment_environment from private.customer_deletion_runtime where singleton)
 or cfg.environment<>'production' or cfg.backend_ref<>'srv1073968.hstgr.cloud' then raise exception 'MAINTENANCE_ENVIRONMENT_DISABLED';end if;
 if p_action not in('prepare','export','custody','erase','restore','status')or p_action is null then raise exception 'INVALID_MAINTENANCE_ACTION';end if;
 if p_action='prepare'then
 if manifest is null or jsonb_typeof(manifest)is distinct from'object'
 or(select array_agg(k order by k)from jsonb_object_keys(manifest)k)is distinct from array['backendRef','batchId','environment','protected','reason','targets']::text[]
 or manifest->>'environment'is distinct from cfg.environment or manifest->>'backendRef'is distinct from cfg.backend_ref
 or length(coalesce(manifest->>'reason',''))not between 1 and 120 then raise exception 'INVALID_MAINTENANCE_MANIFEST';end if;
 root:=(manifest->>'batchId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('recoverable-maintenance:'||root::text,0));
 select *into j from private.maintenance_batches where id=root for update;
 if found then
 if j.manifest is distinct from manifest then raise exception 'IMMUTABLE_MANIFEST_CONFLICT';end if;
 return private.maintenance_receipt(j);end if;
 users:=array(select value::uuid from jsonb_array_elements_text(manifest->'targets'));
 protected:=array(select value::uuid from jsonb_array_elements_text(manifest->'protected'));
 if array(select x from unnest(protected)x order by x) is distinct from
 array(select x from unnest(cfg.protected_users)x order by x) or cardinality(protected)<>11
 then raise exception 'PROTECTED_SCOPE_MISMATCH';end if;
 if users&&protected or actor=any(users)or exists(select 1 from unnest(users)x where not x=any(cfg.allowed_targets))
 or cfg.environment='cloud-test'and exists(select 1 from auth.users u where u.id=any(users)and u.raw_app_meta_data->>'maintenance_qa_run'is distinct from cfg.test_run_id::text)
 then raise exception 'MAINTENANCE_TARGET_NOT_AUTHORIZED';end if;
 scope:=private.maintenance_scope(manifest);
 perform private.maintenance_lock_scope(scope);
 records:=private.maintenance_collect(scope);
 source_hash:=private.maintenance_hash(private.maintenance_fingerprints(records));
 binding:=jsonb_build_object('version',1,'batchId',root,'environment',cfg.environment,'backendRef',cfg.backend_ref,'schemaHash',private.maintenance_schema_hash(),'manifestHash',private.maintenance_hash(manifest),'escrowFingerprint',cfg.escrow_fingerprint);
 -- Do not archive old bearer/reset tokens. Password hashes and original
 -- identities remain only inside authenticated ciphertext on the server.
 select jsonb_agg(case when x->>'mode'='auth'then x||jsonb_build_object('row',private.maintenance_row('auth.users'::regclass,private.maintenance_sanitize_auth(x->'row')))else x end order by ord)
 into records from jsonb_array_elements(records)with ordinality e(x,ord);
 payload:=jsonb_build_object('binding',binding,'scope',scope,'records',records);
 if octet_length(payload::text)>8388608 then raise exception 'RECOVERY_SCOPE_TOO_LARGE';end if;
 key:=encode(extensions.gen_random_bytes(32),'hex');
 select vault.create_secret(key,'account-maintenance-'||root::text,'Private recoverable maintenance; retain until explicit owner review')into secret;
 cipher:=extensions.pgp_sym_encrypt(payload::text,key,'cipher-algo=aes256,compress-algo=1');
 mac:=encode(extensions.hmac(convert_to(binding::text||':'||encode(extensions.digest(cipher,'sha256'),'hex'),'UTF8'),convert_to(key,'UTF8'),'sha256'),'hex');
 if extensions.pgp_sym_decrypt(cipher,key)::jsonb is distinct from payload then raise exception 'RECOVERY_ARCHIVE_VERIFICATION_FAILED';end if;
 insert into private.maintenance_batches(id,manifest,manifest_hash,environment,backend_ref,schema_hash,actor_id,secret_id,archive,archive_hash,archive_mac,archive_binding,key_capsule,custody_nonce,before_scope_hash)
 values(root,manifest,private.maintenance_hash(manifest),cfg.environment,cfg.backend_ref,binding->>'schemaHash',actor,secret,cipher,encode(extensions.digest(cipher,'sha256'),'hex'),mac,binding,
 extensions.pgp_pub_encrypt(key,extensions.dearmor(cfg.escrow_public_key),'cipher-algo=aes256'),encode(extensions.gen_random_bytes(24),'hex'),source_hash)returning *into j;
 insert into private.maintenance_events(batch_id,actor_id,event)values(j.id,actor,'prepared');
 return private.maintenance_receipt(j);
 end if;
 root:=(p_data->>'batchId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('recoverable-maintenance:'||root::text,0));
 select *into j from private.maintenance_batches where id=root for update;
 if not found then raise exception 'RECOVERY_BATCH_NOT_FOUND';end if;
 if j.environment is distinct from cfg.environment or j.backend_ref is distinct from cfg.backend_ref then raise exception 'RECOVERY_ENVIRONMENT_MISMATCH';end if;
 if p_action='status'then return private.maintenance_receipt(j);end if;
 if p_action='export'then
 return private.maintenance_receipt(j)||jsonb_build_object('archiveCiphertext',encode(j.archive,'base64'),'keyCapsule',encode(j.key_capsule,'base64'),'custodyNonce',j.custody_nonce);
 end if;
 key:=private.maintenance_key_value(j.secret_id);
 if p_action='custody'then
 proof:=encode(extensions.hmac(convert_to('maintenance-custody:'||j.id::text||':'||j.custody_nonce||':'||j.manifest_hash||':'||j.environment,'UTF8'),convert_to(key,'UTF8'),'sha256'),'hex');
 if p_data->>'proof'is distinct from proof then raise exception 'INDEPENDENT_KEY_CUSTODY_NOT_PROVEN';end if;
 if not j.custody_verified then
 update private.maintenance_batches set custody_verified=true where id=j.id returning *into j;
 insert into private.maintenance_events(batch_id,actor_id,event)values(j.id,actor,'custody_verified');end if;
 return private.maintenance_receipt(j);
 end if;
 if not j.custody_verified then raise exception 'INDEPENDENT_KEY_CUSTODY_REQUIRED';end if;
 if p_action='erase'and j.state='restored'then raise exception 'RESTORED_BATCH_CANNOT_ERASE_AGAIN';end if;
 if p_action='erase'and j.state='erased'then return private.maintenance_receipt(j);end if;
 if p_action='restore'and j.state='restored'then return private.maintenance_receipt(j);end if;
 if p_action='erase'and j.state<>'prepared'or p_action='restore'and j.state<>'erased'then raise exception 'INVALID_RECOVERY_PHASE';end if;
 if private.maintenance_schema_hash()is distinct from j.schema_hash and not(
 p_action='restore'and exists(select 1 from private.maintenance_code_repairs r
 where r.batch_id=j.id and r.from_hash=j.schema_hash and r.to_hash=private.maintenance_schema_hash()
 and r.new_gateway_hash=(select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
 from pg_proc p where p.oid='public.account_maintenance_gateway(text,jsonb)'::regprocedure)))
 then raise exception 'RECOVERY_SCHEMA_DRIFT';end if;
 if encode(extensions.digest(j.archive,'sha256'),'hex')is distinct from j.archive_hash
 or encode(extensions.hmac(convert_to(j.archive_binding::text||':'||j.archive_hash,'UTF8'),convert_to(key,'UTF8'),'sha256'),'hex')is distinct from j.archive_mac
 then raise exception 'RECOVERY_ARCHIVE_INTEGRITY_FAILED';end if;
 begin payload:=extensions.pgp_sym_decrypt(j.archive,key)::jsonb;exception when others then raise exception 'RECOVERY_KEY_OR_ARCHIVE_INVALID';end;
 if payload->'binding'is distinct from j.archive_binding or payload->'binding'->>'batchId'is distinct from j.id::text or payload->'binding'->>'manifestHash'is distinct from j.manifest_hash
 or payload->'binding'->>'environment'is distinct from j.environment or payload->'binding'->>'backendRef'is distinct from j.backend_ref
 or payload->'binding'->>'schemaHash'is distinct from j.schema_hash then raise exception 'RECOVERY_ARCHIVE_BINDING_FAILED';end if;
 scope:=payload->'scope';records:=payload->'records';
 perform private.maintenance_lock_scope(scope);
 users:=array(select value::uuid from jsonb_array_elements_text(scope->'users'));
 if private.maintenance_scope(users)is distinct from scope then raise exception 'RECOVERY_OWNERSHIP_OR_BOOKING_SCOPE_CHANGED';end if;
 current_records:=private.maintenance_collect(scope);
 if p_action='erase'and private.maintenance_hash(private.maintenance_fingerprints(current_records))is distinct from j.before_scope_hash
 then raise exception 'RECOVERY_SCOPE_CHANGED_BEFORE_ERASURE';end if;
 if p_action='restore'then
 proof:=encode(extensions.hmac(convert_to('maintenance-restore:'||j.id::text||':'||j.custody_nonce||':'||j.archive_hash||':'||j.environment,'UTF8'),convert_to(key,'UTF8'),'sha256'),'hex');
 if p_data->>'proof'is distinct from proof then raise exception 'RECOVERY_KEY_PROOF_INVALID';end if;
 if encode(extensions.hmac(convert_to(j.id::text||':'||j.archive_hash||':'||j.after_fingerprints::text,'UTF8'),convert_to(key,'UTF8'),'sha256'),'hex')is distinct from j.after_mac
 or private.maintenance_fingerprints(current_records)is distinct from j.after_fingerprints then raise exception 'RECOVERY_AFTER_STATE_CONFLICT';end if;
 end if;
 insert into private.maintenance_write_context(transaction_id,batch_id,actor_id,session_id,operation)values(txid_current(),j.id,actor,session,case when p_action='erase'then'erase'else'restore'end);
 if p_action='erase'then
 -- Ephemeral authentication/reset/delivery state is intentionally not recovered.
 delete from private.customer_push_devices where account_id=any(users);
 delete from auth.refresh_tokens where user_id=any(array(select x::text from unnest(users)x));
 delete from auth.sessions where user_id=any(users);
 delete from auth.one_time_tokens where user_id=any(users);
 delete from private.customer_password_requests where user_id=any(users);
 delete from private.customer_password_proofs where user_id=any(users);
 delete from private.customer_auth_challenges c where c.payload::text like any(array(select'%'||x::text||'%'from unnest(users)x));
 for entry in select value from jsonb_array_elements(records)where value->>'mode'='auth'loop
 perform private.maintenance_write(entry,private.maintenance_erased(entry,j.id,now()));end loop;
 for entry in select value from jsonb_array_elements(records)where value->>'mode'not in('auth','keep')loop
 perform private.maintenance_write(entry,private.maintenance_erased(entry,j.id,now()));end loop;
 -- No messages are regenerated on restore. Pending schedules and jobs remain
 -- revoked, just like old sessions; provider grants and Storage remain unchanged.
 delete from private.customer_booking_email_jobs where booking_id in(select value::uuid from jsonb_array_elements_text(scope->'bookings'));
 delete from private.customer_push_schedules where booking_id in(select value::uuid from jsonb_array_elements_text(scope->'bookings'));
 delete from private.customer_push_events where booking_id in(select value::uuid from jsonb_array_elements_text(scope->'bookings'));
 else
 -- Canonical profiles first; Auth stays deleted until contact/ownership exists.
 for entry in select value from jsonb_array_elements(records)where value->>'mode'='customer'loop
 perform private.maintenance_write(entry,entry->'row');end loop;
 for entry in select value from jsonb_array_elements(records)where value->>'mode'not in('auth','customer','keep')loop
 perform private.maintenance_write(entry,entry->'row');end loop;
 for entry in select value from jsonb_array_elements(records)where value->>'mode'='auth'loop
 perform private.maintenance_write(entry,entry->'row');end loop;
 end if;
 set constraints all immediate;
 delete from private.maintenance_write_context where transaction_id=txid_current();
 current_records:=private.maintenance_collect(scope);
 if p_action='erase'then
 current_records:=private.maintenance_collect(scope);
 for entry in select x from jsonb_array_elements(current_records)x where not exists(select 1 from jsonb_array_elements(records)b where b->>'relation'=x->>'relation'and b->'key'=x->'key')loop
 if entry->>'mode'<>'remove'or not private.maintenance_same_transaction(entry)then
 raise exception 'CONCURRENT_SCOPED_INSERT_CONFLICT: % % own=%',entry->>'relation',entry->>'mode',private.maintenance_same_transaction(entry);end if;
 end loop;
 update private.maintenance_batches set state='erased',erased_at=clock_timestamp(),after_fingerprints=private.maintenance_fingerprints(current_records),
 after_mac=encode(extensions.hmac(convert_to(j.id::text||':'||j.archive_hash||':'||private.maintenance_fingerprints(current_records)::text,'UTF8'),convert_to(key,'UTF8'),'sha256'),'hex')where id=j.id returning *into j;
 else
 -- Timestamps may advance, and old reset/bearer tokens intentionally stay empty.
 if exists(select 1 from jsonb_array_elements(records)e where not exists(
 select 1 from jsonb_array_elements(current_records)c where c->>'relation'=e->>'relation'and c->'key'=e->'key'
 and((c->'row')-'updated_at')=((e->'row')-'updated_at')))then raise exception 'SELECTIVE_RECOVERY_VERIFICATION_FAILED';end if;
 update private.maintenance_batches set state='restored',restored_at=clock_timestamp()where id=j.id returning *into j;
 end if;
 insert into private.maintenance_events(batch_id,actor_id,event)values(j.id,actor,case when p_action='erase'then'erased'else'restored'end);
 return private.maintenance_receipt(j);
end $$;
revoke all on function public.account_maintenance_gateway(text,jsonb)from public,anon,authenticated;
grant execute on function public.account_maintenance_gateway(text,jsonb)to service_role;

commit;
