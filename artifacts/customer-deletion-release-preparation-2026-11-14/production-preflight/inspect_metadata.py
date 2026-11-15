#!/usr/bin/env python3
"""PROPOSAL ONLY. Stream to approved DB host stdin after separate owner consent.
No writes, key signing, external requests, customer rows, logs or routine bodies.
"""
import base64, datetime, hashlib, json, math, os, re, signal, stat, subprocess, sys, time

SOURCE = 'e32cfb9105c2652fab8c2065af7280bf7dc76ec9'
PROD_APP = 'https://www.barberplusplus.com'
PROD_API = 'https://srv1073968.hstgr.cloud'
CLIENTS = ('com.barberplusplus.authentication.prod.web', 'com.barberplusplus.customer')
ROOT = '/etc/barber-release'
JSON_FILES = {
    'renewal': ROOT + '/apple-renewal/config.json',
    'renewalState': ROOT + '/apple-renewal/state/state.json',
    'backend': ROOT + '/backend.json',
    'backendState': '/var/lib/barber-release-backend/state.json',
    'backup': ROOT + '/backup-readiness.json',
}
KEY_PATH = ROOT + '/apple-renewal/signing-key.p8'
CODE_FILES = {
    'appleRenewal': '/usr/local/lib/barber-release/apple_renewal.py',
    'backupPolicy': '/usr/local/lib/barber-release/backup_policy.py',
    'backend': '/usr/local/lib/barber-release/backend.py',
}
TIMERS = ('barber-apple-renewal.timer', 'barber-backup-daily.timer')
TIMER_FIELDS = ('LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'LastTriggerUSec', 'NextElapseUSecRealtime')
NAMES = ('supabase-db', 'supabase-auth', 'supabase-storage', 'supabase-edge-functions')
PUBLIC_ENV = ('APP_ENV', 'APP_URL', 'SUPABASE_URL', 'CUSTOMER_PUBLIC_API_URL', 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', 'CUSTOMER_ACCOUNT_DELETION_ENABLED', 'CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED', 'CUSTOMER_APPLE_REVOCATION_ENABLED', 'GOTRUE_EXTERNAL_APPLE_ENABLED', 'GOTRUE_EXTERNAL_APPLE_CLIENT_ID')
METADATA_JWTS = ('GOTRUE_EXTERNAL_APPLE_SECRET', 'CUSTOMER_APPLE_REVOCATION_CLIENTS')
PRESENCE_ONLY = ('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'RESEND_API_KEY', 'CRON_SHARED_SECRET', 'CUSTOMER_APPLE_ENCRYPTION_KEY')
MAX_BYTES = 512 * 1024
HEX64 = re.compile(r'[a-f0-9]{64}')
MIGRATION = re.compile(r'\d{14}_[a-z0-9_]+\.sql')
# Populated from the frozen, already-reviewed source, never from Live secrets.
EXPECTED_IMAGES = {'supabase-db': 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00', 'supabase-auth': 'sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf', 'supabase-storage': 'sha256:c8eb9858eafec891a97c27125470aaad54703c3f4eb4d55ca7f1bf6c6411febf', 'supabase-edge-functions': 'sha256:2781daf92394db91f7e94129cc3d04ec474ad16a8fe64b3fbeef6e7d557ab120'}
EXPECTED_MIGRATIONS = [{'name': '20260901000000_baseline.sql', 'sha256': 'b901044d0b1d6d99e1a078938031163b58acd56040f7cc52353c392b9ca7cc14'}, {'name': '20260901104047_self_hosted_cutover.sql', 'sha256': '5d6758daeb28d8349062100ae2d486e15bb55db8e310430ae8546d443a45406b'}, {'name': '20260902095726_trusted_authorization_and_cron.sql', 'sha256': '49e3f92e35d88142e5a08909e868b1c24b4913b9bd309b357b77e2be881187aa'}, {'name': '20260903111635_harden_authorization_and_service_policies.sql', 'sha256': '1dcbb12039adefebd47d134e699131c75373d6a16fd4d8fda4721406f7f3e6df'}, {'name': '20261011085658_private_booking_reminder_triggers.sql', 'sha256': '37877dc53acdb831f6845adc5eee7af51a3a1791d4a44a05af86f0a9ee172ca9'}, {'name': '20261012045130_harden_legacy_function_paths_and_rate_limits.sql', 'sha256': 'c63c118b3aade20a259b609e1b6e9f692307eedbd1538bd33f1910412f63e273'}, {'name': '20261028190316_add_avatar_storage_policies.sql', 'sha256': 'c5e01c4251c5ba81166e12398e24cc2b5a69f9cd7b9b48c47dec94847d04d211'}, {'name': '20261029082959_retire_whatsapp_reminders.sql', 'sha256': 'a02e6a45e26332aa0195d52492651cc2dcf7227cd233bc48723d73bd972f20d1'}, {'name': '20261029114557_guard_admin_password_resets.sql', 'sha256': '37e0dedeac05efdc68e2ce62af03aaef1bbd968422a1306fb4380d15175c50f1'}, {'name': '20261030170311_customer_booking_test.sql', 'sha256': 'b99bf9211888043ee606493995d2be0a1fd34ecf16c488946e54d900c5a55575'}, {'name': '20261030185118_customer_accounts_test.sql', 'sha256': '9b5dcab7e8d17b2811168a4b808c3298e7faa900a286a69554fda7a9560279a8'}, {'name': '20261030200735_customer_social_accounts_test.sql', 'sha256': '5e50ece428b4daedc42dcc63b6073af852cc1f91dc221e4347a6515df96df689'}, {'name': '20261031022506_customer_booking_ownership_test.sql', 'sha256': '4f017a20496200354785d72ae61046eac0853e4a59149c43a0dbaac36d86ca91'}, {'name': '20261031023209_customer_booking_account_ownership.sql', 'sha256': '793693f19f48dc47d666ccd9d4eaddab84023b195266605e47b42a4c5c330279'}, {'name': '20261031023651_customer_email_accounts_test.sql', 'sha256': 'c52d9c41c07d0133f1f875e819a56b34872e7193e121fdee57988b1a94a3ac00'}, {'name': '20261031141858_preserve_legacy_booking_conflicts_with_write_guard.sql', 'sha256': '586aeeba59b1cdbd6baed7ce418d85faf90677f9ad2242f318079e90e1e2e03f'}, {'name': '20261031142612_defer_booking_conflict_guard_until_after_authorization.sql', 'sha256': '78912ef311044dffc0b50fc9717ebf23bed1fbd240c7d4ad0dd942a7d8db2152'}, {'name': '20261101111100_customer_booking_repeat_selection.sql', 'sha256': '45798c185b782ac5930d4b906b99bd6dc7ad37ed184c1ca11b04b30c5f875c21'}, {'name': '20261101175215_global_phone_uniqueness.sql', 'sha256': 'c5af6c6bf0b7f7510c0dfaf78de3c1e3feca057d1ac6c97bc117e787fddd6f5b'}, {'name': '20261101181520_normalize_contact_phone_fields.sql', 'sha256': '3ded160bd407ac343fee135f884343e9789e3eec7e486d8c1995d03debe9b6ee'}, {'name': '20261101183931_harden_phone_country_codes.sql', 'sha256': '8471f3991338a01ff69c3a111056c4006a520ee504b4fa2aa9dda260d0023b6d'}, {'name': '20261102040024_canonical_customer_profiles.sql', 'sha256': '52de14ca7c7576b5a8f8abec06ec0f8c46ee8b751dc9feabc146d4236c79d713'}, {'name': '20261102041649_canonical_social_status_contract.sql', 'sha256': 'ff1e8509a3b045261dbbfd98f80a2ca3c65578c493650cd1c9144d7eec623777'}, {'name': '20261102042715_staff_booking_customer_references.sql', 'sha256': '6b30439e9abe7a78e83039910df950136741480dcac68e6c42d96f950e098722'}, {'name': '20261102070602_customer_guest_booking_claim.sql', 'sha256': '344a9911f1479882377c5f361b4b00c9cd362ec9b698aa46dba9d3c8e43b16f9'}, {'name': '20261102174253_dashboard_notifications.sql', 'sha256': '52140214ab12bff975964faa74a2114cce21ace9740f9c25b6c7678c80756600'}, {'name': '20261102210358_customer_favourites.sql', 'sha256': '1b98e1187a22e55aaf80f664704ab0db158d9f60641477baed5284bf705bf762'}, {'name': '20261103052307_manager_chair.sql', 'sha256': 'f2085d07d3ae881f5cbf4fbc4f7325e3157b39ee18c14d19fc5abcfe0737fbd1'}, {'name': '20261103052525_manager_chair_account_contact.sql', 'sha256': '1b4adb730c6834de70f38419038a03ea5bd38aa32bb4c2b26e771598ca027ef7'}, {'name': '20261103074737_branch_manager_transfer.sql', 'sha256': '0d001bf317e857334792c0a72d526d0f990be460fc125dcd274686cfa4d87100'}, {'name': '20261103105516_customer_booking_ratings.sql', 'sha256': 'f20f37599eeb07ef06d8450a81594d15a7c2af9d1186a11f8baf1e08e48c6277'}, {'name': '20261103111622_customer_catalog_ratings.sql', 'sha256': '4c9c15acad95f70a9b85f75d6b58188cac86d352e3bd5949f980d9dd28985a6d'}, {'name': '20261104043030_customer_upcoming_booking_actions.sql', 'sha256': '3ab292745ed8e8f5b29bf9b8452f2ca8303617ea09e998f4d565bf76221980e6'}, {'name': '20261104052530_booking_change_policies.sql', 'sha256': '05e6ef72c06031c50ac1ac635ba67979f5fe1402db37f061a2bcb865f4398934'}, {'name': '20261104062136_close_booking_cancellation_bypasses.sql', 'sha256': 'c10ab03e7fd25fe36a515f9b2d34eade4ca57413ee6215b1af14b2303e32b6ec'}, {'name': '20261104100356_customer_checkout_phone_verification.sql', 'sha256': '211752cd50af8912d3d3be52a7b8b8f6819d1d8befffb333442dcfe08e50ea16'}, {'name': '20261105200251_shared_customer_work_accounts.sql', 'sha256': '61a84711577b06464cb1e06f1a39ed44f4f9b14a6fa7a74a6680e7eb7101e9db'}, {'name': '20261106055852_customer_password_proof_security.sql', 'sha256': '4bb1d8776ac27049e874d4f1dadf991868ddde934585ef602f38cdefee7059cd'}, {'name': '20261106061813_preserve_password_account_dispatch.sql', 'sha256': '286cdd660ff7c3727b1f40cc243864d466385b968f399265272558ab72e86eca'}, {'name': '20261106062538_guard_invitation_password_bootstrap.sql', 'sha256': '4fc3670356075a3188fd4c77a1fab4a0072487b9d473e91c15f10d047854bb1c'}, {'name': '20261106133835_account_email_admin_control.sql', 'sha256': '235775a57b330488a0d5833f303e07899a45c15fbc2b5bea00a275eb2d564504'}, {'name': '20261106143831_email_admin_mfa_release_compatibility.sql', 'sha256': 'f907b08650467f7b27e558ee6e68b1274f1738822ae6c90ebd873971841c2c31'}, {'name': '20261106151413_preserve_canonical_email_on_profile_edits.sql', 'sha256': '66247af19a6d6884897fbbc5bd43bc8c22c7d99623c5a862e0b1dd8522415f00'}, {'name': '20261107053655_manager_journey_integrity.sql', 'sha256': '2f917610b62d7c209c889a2322e594cda7a2a20631a79457092cbec75abe581d'}, {'name': '20261107054523_manager_journey_validation_recovery.sql', 'sha256': '80fc30da72e3826f6743f22160165ea7bbf4ccfc75955e83dd75453bc82d1153'}, {'name': '20261107055658_manager_journey_permission_edges.sql', 'sha256': '88e4859979d27fab2c33ef575f44caa14fa6f98baacf6c2595dc6f5c8d89841e'}, {'name': '20261107090247_availability_approvals.sql', 'sha256': '84d1a61807020cf42ef3f246a66217fc2581142ef37a63ba0625c7b115ae7929'}, {'name': '20261107090933_availability_booking_lock_fix.sql', 'sha256': 'c2bcd901f53a4ba68ab40ea125e029042323fa43973549163647506eaf73daa5'}, {'name': '20261107101722_granular_availability_requests.sql', 'sha256': '2462bd9af9b05d702d07cadb52d0edbd9720680ec54302f5a8eca990008461c1'}, {'name': '20261107102814_availability_decision_history_order.sql', 'sha256': '1596861533bd1064c609ac7637aa182136982b18730235c7e7c8e33a15d9d3b1'}, {'name': '20261107190624_shop_barber_invitations.sql', 'sha256': '4d0adc39b8857254263471a63fa87e6492adf953744b8d3201df364db98c0cb4'}, {'name': '20261107191050_invitation_acceptance_fixes.sql', 'sha256': '7e65648ae41983d9681a3f24c4e953dcba806f72bc848c94b95c5dfb51cdfc0d'}, {'name': '20261107191718_invitation_customer_contact_transition.sql', 'sha256': '9ae80a109ea1030cea67837e12449bc28b001fd67b0018946be0d55db11ec680'}, {'name': '20261107195245_invitation_interrupted_setup_recovery.sql', 'sha256': '9145b35bc7775ad35475d633d0564b1a4d1881aab9ede8c64649967bf4cbee8e'}, {'name': '20261108050609_shop_publishing.sql', 'sha256': 'c0ad91aa7385443174965f1ee70575508a7643e2271d88bf792373e90bc6a866'}, {'name': '20261108050714_shop_publication_api_access.sql', 'sha256': 'ac74b11fd53a0c1cf02dd1d7b131be7868be1866b05c80f9fa337c872ca39a2a'}, {'name': '20261108050846_shop_publication_audit_contract.sql', 'sha256': '3a3d5928243e36bc45a36a9e17e12a671bacecb43d26536db1dde8a43938fd4d'}, {'name': '20261108051641_shop_publication_visibility_guards.sql', 'sha256': '36ed4eb7bdf0adfa9583291f7c3239e51b1c1fc4f7e5c6b5a61acc4af6da3abf'}, {'name': '20261108084253_booking_discovery.sql', 'sha256': 'a8752088337352d3ad66ccb58cc52b6421f07849485e437505ed0292e77616d9'}, {'name': '20261108085314_booking_discovery_validation_fix.sql', 'sha256': '45c23af307176bf5c05be5fc529201e773cbcc063af5c2bbdd4823f1d5242be2'}, {'name': '20261108085704_booking_discovery_search_performance.sql', 'sha256': 'ed0c7d90fd8a3410ede5090c31c8effc9f45ff1ce0eda3569ce777491750d735'}, {'name': '20261108091007_booking_discovery_empty_cursor.sql', 'sha256': 'ac6d6e7bf1a3f524845e34e74cb4f50a24d10d601d035c4edfaebdcf7d7a8a28'}, {'name': '20261108105535_barber_auto_confirm.sql', 'sha256': '8beeb1596706cb5f57b912bc7740b347efd50b7c03a9ec3cc39c2de9ac618a22'}, {'name': '20261108200716_shop_service_packages.sql', 'sha256': '97ce8bb825e8123ce7a8f7a3bee3618c311018aa4b5e7f47dcdadd36eb18952f'}, {'name': '20261108201859_package_quote_contract.sql', 'sha256': 'c250b7539992540be814016525bcf0ae00ca05dadd5a44325c989cbc65a77d6b'}, {'name': '20261108202255_package_manager_guard_fixes.sql', 'sha256': 'ae4ede0f420070e7196dafa7de356d368762744cd747f2e8ed41b9817a8c5b06'}, {'name': '20261108203957_package_history_projection_guard.sql', 'sha256': 'a590906e331fee440d204f51fdbe8bd1df3a383a8163375a4f1f4441dd203eaa'}, {'name': '20261108204900_package_gateway_quote_permission.sql', 'sha256': '6d927e5d82bd1e2177174a0391e7318f4a1e8061beee0d42b6c21a5b77232e42'}, {'name': '20261109090930_native_checkout_recovery.sql', 'sha256': '7252d45877ddc42cbd7b6210463fcef505e17116842faf5360f10bd2e0dbb0be'}, {'name': '20261109090931_native_cancellation_history.sql', 'sha256': '1d9aceb48181eb4c5a99a7f8dfa82afedc61c3be74bcde150b2bc9638e2f6301'}, {'name': '20261109090932_native_push_runtime.sql', 'sha256': 'e5d092718588e229a6ffd62834b81a9b5082e7288a576c4afd772290a839c954'}, {'name': '20261109141908_customer_push_service_reads.sql', 'sha256': 'd2e171a0c24928c5141a0b16136baa3e229d4de2b9ab74509ad6f9680c5fcb0d'}, {'name': '20261110064317_manager_managed_barbers.sql', 'sha256': '1fe9c441eef26052a94b4d80d8f05f7e03467dccd87fe176109ddceb8d6d573b'}, {'name': '20261110085647_customer_booking_email_updates.sql', 'sha256': 'fea314c6bd3068ab666d2333bae441c25e6a48c11a5c9f91f420dbe4258834b8'}, {'name': '20261111040859_customer_booking_share_links.sql', 'sha256': 'c009b45558170e33b29112e2cfe9d030366cf3e710aca8d473ff6620b6c7e530'}, {'name': '20261111042039_guest_email_claim_permission.sql', 'sha256': 'f4ee4d53738801319865b4481201b92924a62eef707964982b1764da6e854a66'}, {'name': '20261111073819_admin_push_announcements.sql', 'sha256': 'b59db2318e29c8eca4fcf57f6ce59f960641fae7cee10686a239060a06ee453f'}, {'name': '20261111075351_announcement_audience_pagination.sql', 'sha256': 'a524380a0d6195e8000c58c7360b53861f299cc7dc616b70905a00248266397d'}, {'name': '20261111080101_announcement_mode_snapshot.sql', 'sha256': '876a55aa97562fe8390a0f5037186282da72cc07fab92589d5a3bfdd3ae61d56'}, {'name': '20261111080418_announcement_token_validation.sql', 'sha256': '83f01e51eb8f0245a6dcc9f809a3af40ea147761d38b65164243eaad249d7e10'}, {'name': '20261111080455_announcement_worker_qualification.sql', 'sha256': '81218d4b338d8bbf538477671e2ae91ee4b4dc5b0d432bad8943b777432082b7'}, {'name': '20261111082620_announcement_bulk_audience.sql', 'sha256': '0c7bb70f2993f09f6d65b3d05e27deb6efde749b6a2151a7afaca032b693d935'}, {'name': '20261111082830_announcement_filter_planning.sql', 'sha256': '34b47b3e6edcafc7faf53f0d9f141372793b63788c64d72e96af7ffc0110d7e0'}, {'name': '20261111082901_announcement_audience_result_types.sql', 'sha256': 'd3f20dab94926850956d95d4ca06667c9d8f89d349cc7cf07142db2c8e01256a'}, {'name': '20261111084224_announcement_master_consent_boundary.sql', 'sha256': 'dd827684415f6fd68c5baa4acb7c27ad0703faaa50bb82c0e6ba0ffa665cda14'}, {'name': '20261111102111_booking_share_snapshots.sql', 'sha256': '6952aa0e94a55a498b15cb4f4c800b1e15fc525648d9202b281a179271ba81cb'}, {'name': '20261111113413_booking_notification_defaults.sql', 'sha256': 'dec33c971aa126ff1e7179f3b7f2e3916e0889f66b3d744e1fd140283d9bbd06'}, {'name': '20261111114918_admin_announcements_phase2.sql', 'sha256': '0242c0f70962920a235e48ec9828e1a115c2df5acfdfce5bbab3bb4944e31c73'}, {'name': '20261111115330_announcement_cancellation_index.sql', 'sha256': '088553d783b41277e2657f431aea8960cb64959f92097cc76ed1ec284c16aa11'}, {'name': '20261111120923_announcement_activity_query_planning.sql', 'sha256': '0a9efddaf11d7dcf37e7ff6444e6014df0039ae5a13c9b538cf8767dfb5a044d'}, {'name': '20261112042924_account_tools_sessions_activity.sql', 'sha256': 'b820537afbfaf3d6a86f9b405768b4d0c41ed5f0af8aa91224e28afd0c95d27b'}, {'name': '20261112043721_account_tools_revocation_guard.sql', 'sha256': '0bbf43e4ca023fb1155107f55ead34b7deb79f8cead5d6f3477466cc6c3afd5a'}, {'name': '20261112064028_checkout_email_contact_policy.sql', 'sha256': '3d4c4fdfe2e893cf4dcb65e38115a9567aad53b54ba84d5846fbfb025ca14461'}, {'name': '20261112065217_checkout_email_identity_helper.sql', 'sha256': '7f1361bd145beebcb6d4123ad6b4b06255deb4bf9c9b93f7ee7ab48d6f36e6f2'}, {'name': '20261112080327_email_guest_push_receipts.sql', 'sha256': '6ce30aa2f318559d5c7e5da697f360cc9a019ba0f4c638e7288edd2e4a93ae3b'}, {'name': '20261112101059_apns_environment_credentials.sql', 'sha256': '0ad14a0be9617bd4c3301a5cf3151c56eb807d57e529be0a529fc6578a80195e'}, {'name': '20261112161339_notification_first_setup_defaults.sql', 'sha256': '52725ac6b3d3f4ef32e1ab91c853b3a2b6cea254c4ae4b8c4bf2d225c9e6818a'}, {'name': '20261112165450_require_live_role_for_barber_transfers.sql', 'sha256': 'f1ed63051cfa87dd2a50c997ff6c1ae865f3502d3a1aedda714e19304b310300'}, {'name': '20261112171007_resolve_staff_security_findings.sql', 'sha256': '137a9fd9199d77aaa3fd1ee52722904db50c8a2594ade880fb1fa14df0438288'}, {'name': '20261113062931_preserve_mfa_return_and_session_revocation.sql', 'sha256': '427c739e6394d7860b20e59c1e50c5738dc7fbfaa819aafc64213d85b7ee8522'}, {'name': '20261113063144_restrict_legacy_customer_statistics.sql', 'sha256': '1b3ba0f2a33c53362355cff591465692fbc30c88a3c74b14c5694ab3a7fdc0c5'}, {'name': '20261113065304_preserve_admin_mfa_error.sql', 'sha256': 'd4e4ce667ebe89258578f54ae752f39cecee60e17933944d57a6368b1c727bee'}, {'name': '20261113131730_customer_account_deletion.sql', 'sha256': '5b69234082c9a665a9f8868dec9bac181b3287f89fa57a85b7460c54edc19373'}, {'name': '20261113132148_customer_account_deletion_validation.sql', 'sha256': 'cb9fbf39aad234a536c4aa439f8d868810334bab0e4bff47ffc73413ce04ee2d'}, {'name': '20261113134112_customer_deletion_auth_cleanup.sql', 'sha256': '2f36693101d090e5a50dda9aa95c650d3755990f6638c37fa9b760b7302b5efd'}, {'name': '20261113134447_customer_deletion_device_cleanup.sql', 'sha256': 'e06ccc03614bad6f828af646742530b19755b547e63f6e7371fba3e165a2e8e8'}, {'name': '20261113140603_customer_deletion_verified_contact_cleanup.sql', 'sha256': 'bbd52be27f3954f5e8ab8959f7e90840e922eac868d0cb812966a31b25ee265f'}, {'name': '20261113144103_customer_deletion_environment_binding.sql', 'sha256': '6b99aaca1698a0df16edf6ed416ac0ff0f85ae4a7e4e229f867227f45c2d1b94'}, {'name': '20261113181421_customer_apple_revocation.sql', 'sha256': '4ad456f06e3241c3cdc7d081182ca1ebab6e3eb2704cb07591035eaa023ad558'}, {'name': '20261113182000_customer_apple_scope_binding.sql', 'sha256': '19b32cac7fc62ff9699e09a3dad2b23db5502469db3ade95dc13461b8110fc89'}, {'name': '20261113183235_customer_apple_actor_guard.sql', 'sha256': 'c5eb5a15acf991b975c7e9c60bfbf56efc7634f3fed64a96b4c94d30eee4fe41'}]
EXPECTED_CODE_HASHES = {'appleRenewal': '810d3cb8fc618b70c8bb4a8e05c3306753ea4dba9d5515cf0ec20aa19b08ee23', 'backupPolicy': '9b7f45ef3390d80d662c064e162740b16be694dec6e0e63322057cc2ac7802c4', 'backend': '332dd2f02229d1312c6d0d47716f66ea5c64be96aa5f4b6e18ca6adc3fec185d'}
BASE_COUNT = 102

SQL = {
'catalogue': """select jsonb_build_object(
 'serverVersion',current_setting('server_version'),
 'systemId',(select system_identifier::text from pg_control_system()),
 'relations',(select coalesce(jsonb_agg(x),'[]')from(select n.nspname as schema,c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='barber_release'and c.relname in('migrations','schema_state'))or(n.nspname='supabase_migrations'and c.relname='schema_migrations')or(n.nspname='private'and c.relname in('customer_deletion_runtime','customer_deletion_jobs','customer_apple_credentials','customer_apple_tasks','apple_probe_runtime'))or(n.nspname='cron'and c.relname in('job','job_run_details'))order by n.nspname,c.relname)x),
 'routineMetadata',(select coalesce(jsonb_agg(x),'[]')from(select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid)as args,md5(p.prosrc)as "bodyHash",p.prosecdef as "securityDefiner",has_function_privilege('anon',p.oid,'execute')as "anonymousExecute",has_function_privilege('authenticated',p.oid,'execute')as "authenticatedExecute" from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and p.proname in('customer_session_is_live','customer_deletion_service','configure_customer_deletion','customer_deletion_runtime_configuration','deletion_actor','kick_customer_deletions')order by n.nspname,p.proname)x));""",
'ledger': "select coalesce(jsonb_agg(jsonb_build_object('name',name,'sha256',sha256)order by name),'[]')from barber_release.migrations;",
'fingerprint': "select coalesce(jsonb_agg(jsonb_build_object('fingerprint',fingerprint)),'[]')from barber_release.schema_state where singleton;",
'cron': "select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'commandHash',md5(command))order by jobname),'[]')from cron.job where jobname in('customer-deletion-cleanup','customer-push-dispatch','customer-booking-email');",
'queue': "select jsonb_build_object('pending',count(*),'unscoped',count(*)filter(where cardinality(user_ids)is null or cardinality(user_ids)=0))from private.customer_deletion_jobs where state='cleanup_pending';",
'appleCounts': "select jsonb_build_object('credentials',(select count(*)from private.customer_apple_credentials),'tasks',(select count(*)from private.customer_apple_tasks));",
}

def safe_id(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Z0-9]{10}', value) else None

def stamp(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value < 4102444800:
        return None
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()

def parsed_time(value):
    try:
        if not isinstance(value, str) or len(value) > 64: return None
        d = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return d.timestamp() if d.tzinfo is not None else None
    except (ValueError, OverflowError): return None

def jwt_metadata(raw, now):
    result = {'present': bool(raw), 'parseable': False, 'signatureVerified': False}
    try:
        if not isinstance(raw, str) or len(raw) > 16384: return result
        parts = raw.split('.')
        if len(parts) != 3: return result
        def decode(part): return json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
        header, body = decode(parts[0]), decode(parts[1])
        if not isinstance(header, dict) or not isinstance(body, dict): return result
        issued, expires = stamp(body.get('iat')), stamp(body.get('exp'))
        result.update(parseable=True, algorithm=header.get('alg')if header.get('alg')in('ES256','RS256')else'unexpected', keyId=safe_id(header.get('kid')), expectedTeam=body.get('iss')=='D49RFZQ6BT', client=body.get('sub')if body.get('sub')in CLIENTS else'unexpected', expectedAudience=body.get('aud')=='https://appleid.apple.com', issuedAtUTC=issued, expiresAtUTC=expires, expired=None if expires is None else body['exp']<=now, secondsToExpiry=None if expires is None else int(body['exp']-now))
    except Exception: pass
    return result

def allowed_env(key, value):
    if key in ('APP_ENV',): return value if value in('production','cloud-test')else'unexpected'
    if key.endswith('_ENABLED'): return value if value in('true','false','')else'unexpected'
    if key == 'GOTRUE_EXTERNAL_APPLE_CLIENT_ID':
        ids=value.split(',')if value else[]
        return {'configured':bool(ids),'webFirst':bool(ids)and ids[0]==CLIENTS[0],'approvedIds':[x for x in ids if x in CLIENTS],'unexpectedIdCount':len([x for x in ids if x not in CLIENTS]),'duplicates':len(ids)!=len(set(ids))}
    known = {'APP_URL':(PROD_APP,), 'SUPABASE_URL':(PROD_API,'http://api-gw:8000','http://kong:8000'), 'CUSTOMER_PUBLIC_API_URL':(PROD_API,), 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL':(PROD_API,'http://api-gw:8000','http://kong:8000')}
    return value if value in known.get(key,())or value==''else'unexpected'

def projection_template():
    # Docker projects only these entries. Unrelated environment values never
    # leave the Docker engine; encryption/service/mail keys return booleans only.
    public_or_jwt = ' '.join('(eq $n '+json.dumps(k)+')'for k in PUBLIC_ENV+METADATA_JWTS)
    present = ' '.join('(eq $n '+json.dumps(k)+')'for k in PRESENCE_ONLY)
    return '{{range .Config.Env}}{{$p := split . "="}}{{$n := index $p 0}}{{if or '+public_or_jwt+'}}{{json .}}{{println ""}}{{else if or '+present+'}}{{json (printf "PRESENT:%s=%t" $n (and (gt (len $p) 1) (ne (index $p 1) "")))}}{{println ""}}{{end}}{{end}}'

def summarize_environment(raw, now):
    env={};present={}
    for line in raw.splitlines():
        if line.startswith(chr(34)):
            try:line=json.loads(line)
            except Exception:continue
        if not isinstance(line,str)or '='not in line:continue
        name,value=line.split('=',1)
        if name.startswith('PRESENT:')and name[8:]in PRESENCE_ONLY:
            present[name[8:]]=value=='true'
        elif name in PUBLIC_ENV+METADATA_JWTS:env[name]=value
    result={'configuration':{k:allowed_env(k,env.get(k,''))for k in PUBLIC_ENV if k in env},'secretPresent':{k:present.get(k,False)for k in PRESENCE_ONLY}}
    if 'GOTRUE_EXTERNAL_APPLE_SECRET'in env:result['appleLoginCredential']=jwt_metadata(env['GOTRUE_EXTERNAL_APPLE_SECRET'],now)
    if 'CUSTOMER_APPLE_REVOCATION_CLIENTS'in env:
        result['appleCleanupCredentials']={'configured':bool(env['CUSTOMER_APPLE_REVOCATION_CLIENTS']),'parseable':False}
        try:
            clients=json.loads(env['CUSTOMER_APPLE_REVOCATION_CLIENTS']);assert isinstance(clients,dict)
            result['appleCleanupCredentials'].update(parseable=True,platforms={k:{'client':v.get('clientId')if v.get('clientId')in CLIENTS else'unexpected','credential':jwt_metadata(v.get('clientSecret'),now)}for k,v in clients.items()if k in('ios','web')and isinstance(v,dict)},unexpectedPlatformCount=len(set(clients)-{'ios','web'}))
        except Exception:pass
    return result

def backup_metadata(document, actual_system, expected_system, now):
    captured, verified = parsed_time(document.get('captured_at')), parsed_time(document.get('verified_at'))
    flags=('encrypted_offsite','database_restored','storage_restored','functions_restored','configuration_restored','isolated_target_removed')
    same=bool(actual_system)and document.get('system_id')==actual_system==expected_system
    rto=document.get('restore_seconds');valid_rto=type(rto)in(int,float)and math.isfinite(rto)and 0<rto<=7200
    fresh=captured is not None and verified is not None and captured<=verified and 0<=now-captured<=26*3600 and 0<=now-verified<=26*3600
    binding=all(isinstance(document.get(k),str)and bool(document[k])for k in('base_backup','object_snapshot','recovery_lsn','repository'))
    return {'policy':document.get('policy')if document.get('policy')=='daily-v1'else'unexpected','provider':document.get('provider')if document.get('provider')in('b2','r2-transition')else'unexpected','capturedAtUTC':stamp(captured),'verifiedAtUTC':stamp(verified),'captureAgeSeconds':None if captured is None else int(now-captured),'freshWithin26Hours':fresh,'systemBindingMatches':same,'bindingFieldsPresent':binding,'restoreSeconds':rto if valid_rto else None,'verifiedFlags':{k:document.get(k)is True for k in flags},'b2DailyReceiptMetadataPass':document.get('policy')=='daily-v1'and document.get('provider')=='b2'and same and fresh and binding and valid_rto and all(document.get(k)is True for k in flags)}

class Host:
    def run(self,args):
        p=subprocess.run(args,capture_output=True,text=True,timeout=15)
        if p.returncode or len(p.stdout.encode())>MAX_BYTES:raise RuntimeError('READ_UNAVAILABLE')
        return p.stdout
    def json_file(self,name):
        path=JSON_FILES[name]
        try:
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                info=os.fstat(fd)
                if info.st_uid!=0 or info.st_mode&0o077 or not stat.S_ISREG(info.st_mode)or info.st_size>MAX_BYTES:raise ValueError('UNSAFE_METADATA_FILE')
                with os.fdopen(os.dup(fd),'rb')as handle:value=json.loads(handle.read(MAX_BYTES+1))
                if not isinstance(value,dict):raise ValueError('UNSAFE_METADATA_FILE')
                return value
            finally:os.close(fd)
        except FileNotFoundError:return None
    def key_stat(self,path):
        if not isinstance(path,str)or not path.startswith(ROOT+'/apple-renewal/')or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}\.p8',path[len(ROOT+'/apple-renewal/'):]):return {'configuredReferenceAllowed':False}
        try:
            info=os.stat(path,follow_symlinks=False)
            return {'configuredReferenceAllowed':True,'present':True,'rootOwned':info.st_uid==0,'regularFile':stat.S_ISREG(info.st_mode),'privatePermissions':not bool(info.st_mode&0o077)}
        except FileNotFoundError:return {'configuredReferenceAllowed':True,'present':False}
    def code_hash(self,name):
        path=CODE_FILES[name]
        try:
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                info=os.fstat(fd)
                if info.st_uid!=0 or info.st_mode&0o022 or not stat.S_ISREG(info.st_mode)or info.st_size>MAX_BYTES:raise ValueError('UNSAFE_HELPER')
                with os.fdopen(os.dup(fd),'rb')as handle:return hashlib.sha256(handle.read(MAX_BYTES+1)).hexdigest()
            finally:os.close(fd)
        except FileNotFoundError:return None
    def sql(self,name):
        # There is no caller-supplied SQL, configurable shell or URL.
        query='BEGIN READ ONLY; SET LOCAL statement_timeout=8000; '+SQL[name]+' ROLLBACK;'
        raw=self.run(['docker','exec','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',query])
        return json.loads(raw)
    def runtime(self,name):
        if name not in NAMES:raise ValueError('UNAPPROVED_CONTAINER')
        raw=self.run(['docker','inspect','--type','container','--format','{{json .Image}}\n{{json .State.Running}}\n{{if .State.Health}}{{json .State.Health.Status}}{{else}}"not-reported"{{end}}',name])
        rows=raw.splitlines()
        if len(rows)!=3:raise ValueError('UNEXPECTED_INSPECT')
        image,running,health=map(json.loads,rows)
        if not isinstance(image,str)or not re.fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('UNEXPECTED_INSPECT')
        return {'name':name,'imageId':image,'matchesReviewedParent':image==EXPECTED_IMAGES[name],'running':running is True,'health':health if health in('healthy','unhealthy','starting','not-reported')else'unexpected'}
    def environment(self,name):
        if name not in('supabase-auth','supabase-edge-functions'):raise ValueError('UNAPPROVED_CONTAINER')
        return self.run(['docker','inspect','--type','container','--format',projection_template(),name])
    def timer(self,name):
        if name not in TIMERS:raise ValueError('UNAPPROVED_TIMER')
        raw=self.run(['systemctl','show',name,'--no-pager','--property='+','.join(TIMER_FIELDS)])
        return {k:v if len(v)<=100 and re.fullmatch(r'[A-Za-z0-9 .:_+/@-]*',v)else'unexpected'for k,v in(line.split('=',1)for line in raw.splitlines()if'='in line)if k in TIMER_FIELDS}

def collect(host,now):
    result={'schemaVersion':1,'status':'METADATA_CAPTURED_REVIEW_REQUIRED','mode':'READ_ONLY_METADATA_NO_RELEASE','sourceCandidate':SOURCE,'checkedAtUTC':stamp(now),'hostArchitecture':os.uname().machine if os.uname().machine in('x86_64','aarch64','arm64')else'unexpected','runtime':[host.runtime(n)for n in NAMES]}
    result['auth']=summarize_environment(host.environment('supabase-auth'),now)
    result['functions']=summarize_environment(host.environment('supabase-edge-functions'),now)
    configs={k:host.json_file(k)for k in JSON_FILES}
    renewal=configs['renewal']or{};backend=configs['backend']or{}
    accepted=renewal.get('acceptedClientIds',[renewal.get('clientId')]);accepted=accepted if isinstance(accepted,list)else[]
    result['renewal']={'configurationPresent':configs['renewal']is not None,'productionNamespace':renewal.get('environment')=='production','teamId':safe_id(renewal.get('teamId')),'keyId':safe_id(renewal.get('keyId')),'client':renewal.get('clientId')if renewal.get('clientId')in CLIENTS else'unexpected','approvedAcceptedClients':[x for x in accepted if x in CLIENTS],'unexpectedClientCount':len([x for x in accepted if x not in CLIENTS]),'keyReference':host.key_stat(renewal.get('keyFile')),'stateDirectoryMatches':renewal.get('stateDirectory')==ROOT+'/apple-renewal/state'}
    state=configs['renewalState']or{}
    result['renewal']['state']={'present':configs['renewalState']is not None,'phase':state.get('phase')if state.get('phase')in('HEALTHY_NOT_DUE','RENEWED','ROLLED_BACK','PREPARED','CONFIGURED')else'unexpected',**{k:stamp(parsed_time(state.get(k)))for k in('checkedAt','expiresAt','renewAfter')}}
    result['helpers']={name:{'sha256':host.code_hash(name),'matchesReviewedSource':False}for name in CODE_FILES}
    for name,value in result['helpers'].items():value['matchesReviewedSource']=value['sha256']==EXPECTED_CODE_HASHES.get(name)
    cat=host.sql('catalogue');relations=cat.get('relations',[]);present={(x['schema'],x['name'])for x in relations}
    version=cat.get('serverVersion','').split(' ')[0];result['database']={'serverVersion':version if re.fullmatch(r'[0-9.]{1,24}',version)else'unexpected','supabaseHistoryPresent':('supabase_migrations','schema_migrations')in present,'deletionTablesPresent':('private','customer_deletion_jobs')in present,'temporaryProbeUnexpectedlyPresent':('private','apple_probe_runtime')in present,'routineMetadata':[]}
    for row in cat.get('routineMetadata',[]):
        if not isinstance(row,dict)or not re.fullmatch('[a-f0-9]{32}',str(row.get('bodyHash','')))or any(type(row.get(k))is not bool for k in('securityDefiner','anonymousExecute','authenticatedExecute')):raise ValueError('UNEXPECTED_ROUTINE_METADATA')
        result['database']['routineMetadata'].append({'schema':row['schema']if row.get('schema')in('public','private')else'unexpected','name':row['name']if row.get('name')in('customer_session_is_live','customer_deletion_service','configure_customer_deletion','customer_deletion_runtime_configuration','deletion_actor','kick_customer_deletions')else'unexpected','bodyHash':row.get('bodyHash')if re.fullmatch('[a-f0-9]{32}',str(row.get('bodyHash','')))else None,'securityDefiner':row.get('securityDefiner')is True,'anonymousExecute':row.get('anonymousExecute')is True,'authenticatedExecute':row.get('authenticatedExecute')is True})
    ledger=host.sql('ledger')if('barber_release','migrations')in present else None
    if ledger is not None and(any(not isinstance(x,dict)or not MIGRATION.fullmatch(str(x.get('name','')))or not HEX64.fullmatch(str(x.get('sha256','')))for x in ledger)or len(ledger)>500):raise ValueError('UNEXPECTED_LEDGER')
    prefix=ledger is not None and ledger==EXPECTED_MIGRATIONS[:len(ledger)]
    result['ledger']={'present':ledger is not None,'appliedCount':None if ledger is None else len(ledger),'matchesCandidatePrefix':prefix,'equalsReviewedMainPrefix':prefix and len(ledger)==BASE_COUNT,'pendingCandidateNames':[x['name']for x in EXPECTED_MIGRATIONS[len(ledger):]]if prefix else[]}
    if('barber_release','schema_state')in present:
        fp=host.sql('fingerprint');result['ledger']['storedFingerprint']=fp[0]['fingerprint']if len(fp)==1 and HEX64.fullmatch(str(fp[0].get('fingerprint','')))else None
    cron=host.sql('cron')if('cron','job')in present else None
    result['cron']=None if cron is None else[{'name':x.get('name')if x.get('name')in('customer-deletion-cleanup','customer-push-dispatch','customer-booking-email')else'unexpected','schedule':x.get('schedule')if isinstance(x.get('schedule'),str)and (re.fullmatch(r'[0-9*/,\- ]{1,80}',x['schedule'])or x['schedule']in('@daily','@hourly','@weekly','@monthly','@yearly','@reboot'))else'unexpected','active':x.get('active')is True,'commandHash':x.get('commandHash')if re.fullmatch('[a-f0-9]{32}',str(x.get('commandHash','')))else None}for x in cron]
    queue=host.sql('queue')if('private','customer_deletion_jobs')in present else None
    counts=host.sql('appleCounts')if all(('private',x)in present for x in('customer_apple_credentials','customer_apple_tasks'))else None
    number=lambda x:x if type(x)is int and 0<=x<=2147483647 else None
    result['queue']=None if queue is None else{k:number(queue.get(k))for k in('pending','unscoped')}
    result['appleStoreCounts']=None if counts is None else{k:number(counts.get(k))for k in('credentials','tasks')}
    result['backup']={'receiptPresent':configs['backup']is not None,**backup_metadata(configs['backup']or{},cat.get('systemId'),backend.get('backupSystemId'),now)}
    phase=(configs['backendState']or{}).get('phase');commit=(configs['backendState']or{}).get('commit')
    result['backend']={'configurationPresent':configs['backend']is not None,'enabled':backend.get('enabled')is True,'appUrlMatches':backend.get('appUrl')==PROD_APP,'stateDirectoryMatches':backend.get('stateDirectory')=='/var/lib/barber-release-backend','backupEvidencePathMatches':backend.get('backupEvidenceFile')==JSON_FILES['backup'],'recordedPhase':phase if phase in('SQL_APPLYING','SQL_APPLIED','FUNCTIONS_UNCHANGED','FUNCTIONS_PREPARING','FUNCTIONS_CHANGING','FUNCTIONS_APPLIED','FUNCTIONS_ROLLED_BACK')else'unexpected','recordedCommit':commit if isinstance(commit,str)and re.fullmatch('[a-f0-9]{40}',commit)else None}
    result['timers']={name:host.timer(name)for name in TIMERS}
    result['limits']={'productionWrites':False,'privateKeyReadOrUsed':False,'encryptionKeyValueReadByProbe':False,'credentialExported':False,'providerCalls':False,'customerRows':False,'routineBodiesExported':False,'frontendInspected':False,'jwtSignatureOrAppleKeyScopeVerified':False,'freshRestoreOrArchiveDownloadPerformed':False,'fullLiveSchemaDriftAttested':False}
    raw=json.dumps(result,sort_keys=True)
    if len(raw.encode())>MAX_BYTES:raise ValueError('OUTPUT_LIMIT')
    return result

def main():
    if os.geteuid()!=0 or len(sys.argv)!=1 or os.uname().nodename.split('.')[0]!='srv1073968':raise ValueError('FIXED_DB_HOST_ROOT_STDIN_ONLY')
    signal.alarm(180)
    print(json.dumps(collect(Host(),time.time()),sort_keys=True))

if __name__=='__main__':
    try:main()
    except BaseException:
        print(json.dumps({'status':'PREFLIGHT_UNAVAILABLE','readOnly':True}));sys.exit(1)
