"""Real pinned Auth/Storage APIs against this run's synthetic records only."""
import base64, hashlib, json, secrets, uuid


def run(sql, request, record, auth_url, storage_url, service, anon):
    literal = lambda value: "'" + str(value).replace("'", "''") + "'"
    encode = lambda value: literal(json.dumps(value)) + '::jsonb'
    def check(condition, message):
        if not condition:
            raise AssertionError(message)
    def headers(token, content_type='application/json'):
        return {'Authorization': 'Bearer ' + token, 'apikey': anon, 'Content-Type': content_type}
    def create_user():
        email = 'delete-' + uuid.uuid4().hex + '@example.test'
        password = 'Synthetic!' + secrets.token_hex(12)
        created = request(auth_url + '/admin/users', 'POST', {'email': email, 'password': password, 'email_confirm': True, 'app_metadata': {'role': 'customer'}}, headers(service))
        check(created['status'] == 200, 'Synthetic Auth user creation failed')
        login = request(auth_url + '/token?grant_type=password', 'POST', {'email': email, 'password': password}, headers(anon))
        check(login['status'] == 200, 'Real pinned Auth login failed')
        session = login['value']
        claims = json.loads(base64.urlsafe_b64decode(session['access_token'].split('.')[1] + '==='))
        check(claims.get('role') == 'authenticated', 'Synthetic Auth must issue the standard authenticated database role')
        return {'id': created['value']['id'], 'email': email, 'password': password, 'session': session, 'claims': claims}
    user, other = create_user(), create_user()
    uid, other_id = user['id'], other['id']
    sid = user['claims']['session_id']
    check(uid == user['claims']['sub'], 'Auth session identity mismatch')
    record('real pinned Auth creates and signs in isolated customer accounts')
    customer, shop, chair, service_id, past, future, pending = [str(uuid.uuid4()) for _ in range(7)]
    manager = sql("select id from auth.users where raw_app_meta_data->>'role'='manager' order by id limit 1;").strip()
    check(manager, 'Synthetic seeded manager absent')
    sql(f"""
insert into public.customers(id,name,email)values({literal(customer)},'Disposable deletion customer',{literal(user['email'])});
insert into private.customer_accounts(user_id,customer_id)values({literal(uid)},{literal(customer)});
insert into public.branches(id,manager_id,name)values({literal(shop)},{literal(manager)},'Disposable deletion shop');
insert into public.services(id,branch_id,name,duration,price)values({literal(service_id)},{literal(shop)},'Synthetic haircut',30,3);
insert into public.barbers(id,branch_id,name,status,service_ids)values({literal(chair)},{literal(shop)},'Synthetic chair','active',array[{literal(service_id)}]::uuid[]);
insert into public.bookings(id,branch_id,barber_id,customer_id,date,time,service_ids,duration,price,status,added_by_type,notes)values
({literal(past)},{literal(shop)},{literal(chair)},{literal(customer)},current_date-2,'10:00',array[{literal(service_id)}]::uuid[],30,3,'completed','customer','Synthetic private note'),
({literal(future)},{literal(shop)},{literal(chair)},{literal(customer)},current_date+2,'10:00',array[{literal(service_id)}]::uuid[],30,3,'confirmed','customer','Synthetic private note'),
({literal(pending)},{literal(shop)},{literal(chair)},{literal(customer)},current_date+3,'10:00',array[{literal(service_id)}]::uuid[],30,3,'pending','customer','Synthetic private note');
insert into private.customer_favourites(id,customer_id,branch_id)values(gen_random_uuid(),{literal(customer)},{literal(shop)});
insert into private.customer_booking_ratings(booking_id,shop_rating,barber_rating)values({literal(past)},5,4);
create policy "Disposable customer object" on storage.objects for all to authenticated
using(bucket_id='deletion-qa'and owner_id=auth.uid()::text)with check(bucket_id='deletion-qa'and owner_id=auth.uid()::text);
update private.customer_deletion_runtime set deployment_environment='production',test_mode=false,function_url='https://srv1073968.hstgr.cloud/functions/v1/customer-account-deletion',allowed_test_users='{{}}'where singleton;
""")
    bucket = request(storage_url + '/bucket', 'POST', {'id': 'deletion-qa', 'name': 'deletion-qa', 'public': False}, headers(service))
    check(bucket['status'] in (200, 201), 'Synthetic private bucket creation failed')
    path = uid + '/profile.txt'
    asset = 'Synthetic disposable account-owned asset'
    uploaded = request(storage_url + '/object/deletion-qa/' + path, 'POST', headers=headers(user['session']['access_token'], 'text/plain'), raw=asset)
    check(uploaded['status'] in (200, 201), 'Customer-owned Storage upload failed: ' + str(uploaded['status']))
    downloaded = request(storage_url + '/object/authenticated/deletion-qa/' + path, headers=headers(user['session']['access_token']))
    check(downloaded['status'] == 200 and downloaded['value'] == asset, 'Live customer Storage access failed')
    denied = request(storage_url + '/object/authenticated/deletion-qa/' + path, headers=headers(other['session']['access_token']))
    check(denied['status'] in (400, 401, 403, 404), 'Another customer can read account-owned Storage')
    record('real Storage upload/read works only for the live owning customer')
    # Metadata-only synthetic objects exercise the 500-object cleanup boundary;
    # the real uploaded asset remains the last object in the sorted batch.
    sql("insert into storage.objects(bucket_id,name,owner,owner_id,metadata,version)select 'deletion-qa'," + literal(uid + '/extra-') + "||n::text||'.txt'," + literal(uid) + '::uuid,' + literal(uid) + ",'{}'::jsonb,gen_random_uuid()::text from generate_series(1,500)n;")
    job = str(uuid.uuid4())
    receipt_hash, code_hash = [hashlib.sha256(secrets.token_bytes(32)).hexdigest() for _ in range(2)]
    scope = {'id': job, 'user_id': uid, 'session_id': sid, 'receipt_hash': receipt_hash, 'receipt_box': 'synthetic-encrypted-receipt', 'code_hash': code_hash}
    def rpc(action, payload):
        return json.loads(sql("set request.jwt.claims='{\"role\":\"service_role\"}';select public.customer_deletion_service(" + literal(action) + ',' + encode(payload) + ');'))
    preview = rpc('preview', scope)
    check(preview['upcomingCount'] == 2, 'Preview must identify both future appointments')
    started = rpc('start', scope)
    check(started['created'] is True, 'Deletion operation not created')
    verified = rpc('verify', scope)
    check(verified['state'] == 'verified', 'Purpose-bound synthetic proof rejected')
    confirmed = rpc('confirm', {**scope, 'digest': preview['digest'], 'confirmCancellation': True})
    check(confirmed['state'] == 'cleanup_pending' and confirmed['cancelledCount'] == 2, 'Atomic erasure/future cancellation failed')
    check(sql('select public.customer_session_is_live(' + literal(uid) + ',' + literal(sid) + ');').strip() == 'f', 'Old JWT session remains live')
    denied = request(storage_url + '/object/authenticated/deletion-qa/' + path, headers=headers(user['session']['access_token']))
    check(denied['status'] in (400, 401, 403, 404), 'Signed old JWT still accesses Storage after session revocation')
    retained = sql('select count(*) from storage.objects where owner_id=' + literal(uid) + ';').strip()
    check(retained == '501', 'Storage denial was not tested while owned metadata remained')
    refresh = request(auth_url + '/token?grant_type=refresh_token', 'POST', {'refresh_token': user['session']['refresh_token']}, headers(anon))
    check(refresh['status'] in (400, 401, 403), 'Deleted account session can refresh')
    record('atomic cancellation revokes real refresh and old-JWT Storage access before cleanup')
    lease = rpc('claim', {'id': job})
    check(lease['userIds'] == [uid], 'Cleanup lease escaped its target identity')
    check(len(lease['objects']) == 500, 'Cleanup object batch exceeded or missed its 500-object bound')
    check(rpc('claim', {'id': job}) is None, 'Concurrent cleanup claim succeeded')
    # Finishing while Auth/Storage remain must fail honestly; no fake success.
    failed_finish = False
    try:
        rpc('finish', lease)
    except RuntimeError as error:
        failed_finish = 'CLEANUP_PENDING' in str(error)
    check(failed_finish, 'Cleanup reported complete before provider resources were removed')
    check(rpc('status', {'id': job, 'receipt_hash': receipt_hash})['state'] == 'cleanup_pending', 'Receipt lost pending state')
    previous_lease = lease
    rpc('retry', lease)
    check(rpc('claim', {'id': job}) is None, 'Cleanup ignored retry backoff')
    check(sql('select lease_id is null and available_at>clock_timestamp()from private.customer_deletion_jobs where id=' + literal(job) + ';').strip() == 't', 'Retry did not release lease with a bounded delay')
    # Advance only this synthetic job's retry clock; never wait on or mutate Live.
    sql('update private.customer_deletion_jobs set available_at=clock_timestamp()-interval\'1 second\'where id=' + literal(job) + ';')
    lease = rpc('claim', {'id': job})
    check(lease is not None and lease['lease'] != previous_lease['lease'], 'Retry did not acquire a fresh lease')
    check(rpc('finish', previous_lease) is False, 'Expired worker lease could report success')
    record('interrupted cleanup stays pending; backoff, fresh lease and stale-worker denial pass')
    removed = request(storage_url + '/object/deletion-qa', 'DELETE', {'prefixes': [item['name'] for item in lease['objects']]}, headers(service), timeout_ms=60000)
    check(removed['status'] == 200, 'Real Storage cleanup failed')
    check(sql('select count(*) from storage.objects where owner_id=' + literal(uid) + ';').strip() == '1', 'First bounded cleanup did not preserve the remaining object')
    rpc('retry', lease)
    sql('update private.customer_deletion_jobs set available_at=clock_timestamp()-interval\'1 second\'where id=' + literal(job) + ';')
    lease = rpc('claim', {'id': job})
    check(len(lease['objects']) == 1 and lease['objects'][0]['name'] == path, 'Next cleanup batch did not recover the remaining real file')
    check(request(storage_url + '/object/deletion-qa', 'DELETE', {'prefixes': [path]}, headers(service))['status'] == 200, 'Remaining real asset removal failed')
    check(request(storage_url + '/object/deletion-qa', 'DELETE', {'prefixes': [path]}, headers(service))['status'] == 200, 'Repeated Storage cleanup was not idempotent')
    record('501 owned objects clean up in bounded batches; missing files and repeated deletes are safe')
    deleted = request(auth_url + '/admin/users/' + uid, 'DELETE', {}, headers(service))
    check(deleted['status'] == 200, 'Real Auth hard deletion failed after finite ban')
    check(request(auth_url + '/admin/users/' + uid, 'DELETE', {}, headers(service))['status'] in (200, 404), 'Repeated Auth cleanup returned an unexpected failure')
    check(rpc('finish', lease) is True, 'Cleanup cannot finish after provider deletion')
    check(rpc('status', {'id': job, 'receipt_hash': receipt_hash})['state'] == 'complete', 'Receipt-only recovery failed after Auth removal')
    check(request(auth_url + '/user', headers=headers(user['session']['access_token']))['status'] in (401, 403, 404), 'Deleted Auth account remains accessible')
    check(request(auth_url + '/user', headers=headers(other['session']['access_token']))['status'] == 200, 'Another signed-in customer was affected')
    check(sql(f"select count(*) from public.bookings where id={literal(past)} and status='completed'and price=3 and duration=30 and notes is null;").strip() == '1', 'Anonymous past booking value was lost')
    check(sql(f"select count(*) from public.bookings where id=any(array[{literal(future)},{literal(pending)}]::uuid[])and status='cancelled'and notes is null;").strip() == '2', 'Future appointments not safely cancelled')
    check(sql(f"select count(*) from private.customer_booking_email_jobs where booking_id=any(array[{literal(past)},{literal(future)},{literal(pending)}]::uuid[]);").strip() == '0', 'Customer emails remained queued after deletion')
    check(sql(f"select count(*) from private.customer_booking_ratings where booking_id={literal(past)};").strip() == '0', 'Customer ratings remained')
    check(sql(f"select count(*) from private.customer_favourites where customer_id={literal(customer)};").strip() == '0', 'Customer favourites remained')
    record('real Auth/Storage cleanup and sessionless receipt recovery complete; other customer preserved')
    record('anonymous past value retained; future bookings cancelled; ratings, favourites and queued emails removed')
