--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: secure; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS secure;


--
-- Name: cancel_booking_reminder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking_reminder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    UPDATE booking_reminders
    SET status = 'cancelled'
    WHERE booking_id = NEW.id AND status = 'pending';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: check_auth_rate_limit(text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_auth_rate_limit(p_identifier text, p_max_attempts integer DEFAULT 5, p_window_seconds integer DEFAULT 60, p_lockout_seconds integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_record auth_rate_limits%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_window_start TIMESTAMPTZ;
  v_retry_after INTEGER;
BEGIN
  -- Get or create rate limit record
  SELECT * INTO v_record FROM auth_rate_limits WHERE identifier = p_identifier FOR UPDATE;
  
  IF NOT FOUND THEN
    -- First attempt for this identifier
    INSERT INTO auth_rate_limits (identifier, attempt_count, first_attempt_at, updated_at)
    VALUES (p_identifier, 1, v_now, v_now);
    
    RETURN jsonb_build_object(
      'allowed', true,
      'retryAfter', 0,
      'remaining', p_max_attempts - 1
    );
  END IF;
  
  -- Check if currently locked out
  IF v_record.locked_until IS NOT NULL AND v_record.locked_until > v_now THEN
    v_retry_after := EXTRACT(EPOCH FROM (v_record.locked_until - v_now))::INTEGER;
    RETURN jsonb_build_object(
      'allowed', false,
      'retryAfter', v_retry_after,
      'remaining', 0
    );
  END IF;
  
  -- Check if window has expired (reset counter)
  v_window_start := v_now - (p_window_seconds || ' seconds')::INTERVAL;
  IF v_record.first_attempt_at < v_window_start THEN
    -- Reset the counter
    UPDATE auth_rate_limits 
    SET attempt_count = 1, first_attempt_at = v_now, locked_until = NULL, updated_at = v_now
    WHERE identifier = p_identifier;
    
    RETURN jsonb_build_object(
      'allowed', true,
      'retryAfter', 0,
      'remaining', p_max_attempts - 1
    );
  END IF;
  
  -- Increment counter
  IF v_record.attempt_count >= p_max_attempts THEN
    -- Lock out the user
    UPDATE auth_rate_limits 
    SET locked_until = v_now + (p_lockout_seconds || ' seconds')::INTERVAL, updated_at = v_now
    WHERE identifier = p_identifier;
    
    RETURN jsonb_build_object(
      'allowed', false,
      'retryAfter', p_lockout_seconds,
      'remaining', 0
    );
  END IF;
  
  -- Allow the attempt, increment counter
  UPDATE auth_rate_limits 
  SET attempt_count = attempt_count + 1, updated_at = v_now
  WHERE identifier = p_identifier;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'retryAfter', 0,
    'remaining', p_max_attempts - v_record.attempt_count - 1
  );
END;
$$;


--
-- Name: check_booking_conflict(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_booking_conflict() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  conflict_count INTEGER;
  new_end_time TIME;
  existing_start TIME;
  existing_end TIME;
BEGIN
  -- Calculate end time for the new booking
  new_end_time := NEW.time + (NEW.duration * INTERVAL '1 minute');
  
  -- Check for overlapping bookings for the same barber on the same date
  SELECT COUNT(*) INTO conflict_count
  FROM bookings
  WHERE barber_id = NEW.barber_id
    AND date = NEW.date
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND status NOT IN ('cancelled', 'no_show')
    AND (
      -- New booking starts during an existing booking
      (NEW.time >= time AND NEW.time < time + (duration * INTERVAL '1 minute'))
      OR
      -- New booking ends during an existing booking
      (new_end_time > time AND new_end_time <= time + (duration * INTERVAL '1 minute'))
      OR
      -- New booking completely contains an existing booking
      (NEW.time <= time AND new_end_time >= time + (duration * INTERVAL '1 minute'))
    );
  
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Booking conflict: This time slot overlaps with an existing booking for this barber'
      USING ERRCODE = 'P0001';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: cleanup_old_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_notifications() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    DELETE FROM public.notifications
    WHERE is_read = true
      AND created_at < NOW() - INTERVAL '30 days';
    
    DELETE FROM public.notifications
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$;


--
-- Name: cleanup_old_notifications(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_notifications(retention_days integer DEFAULT 30, batch_size integer DEFAULT 1000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  total_deleted INTEGER := 0;
  batch_deleted INTEGER;
  cutoff_date TIMESTAMPTZ;
BEGIN
  cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;

  LOOP
    WITH deleted AS (
      DELETE FROM public.notifications
      WHERE id IN (
        SELECT id FROM public.notifications
        WHERE created_at < cutoff_date
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    )
    SELECT COUNT(*) INTO batch_deleted FROM deleted;

    total_deleted := total_deleted + batch_deleted;
    EXIT WHEN batch_deleted = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Notification cleanup completed: % notifications deleted (older than %)',
    total_deleted, cutoff_date;

  RETURN total_deleted;
END;
$$;


--
-- Name: count_users_by_role(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_users_by_role(role_filter text) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM auth.users
  WHERE raw_user_meta_data ->> 'role' = role_filter;
$$;


--
-- Name: create_booking_reminder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking_reminder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  booking_datetime TIMESTAMPTZ;
  reminder_time TIMESTAMPTZ;
BEGIN
  -- Only create reminder for confirmed bookings
  IF NEW.status IN ('pending', 'confirmed') THEN
    -- Combine date and time to get full timestamp (Kuwait timezone)
    booking_datetime := (NEW.date || ' ' || NEW.time)::TIMESTAMP AT TIME ZONE 'Asia/Kuwait';
    
    -- Schedule reminder 1 hour before
    reminder_time := booking_datetime - INTERVAL '1 hour';
    
    -- Only create reminder if it's in the future
    IF reminder_time > now() THEN
      INSERT INTO booking_reminders (booking_id, scheduled_at)
      VALUES (NEW.id, reminder_time)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: detect_suspicious_booking_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_suspicious_booking_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  recent_bookings INTEGER;
  same_slot_bookings INTEGER;
BEGIN
  -- Count bookings made by same user/phone in last hour
  SELECT COUNT(*) INTO recent_bookings
  FROM bookings
  WHERE customer_id = NEW.customer_id
    AND created_at > now() - interval '1 hour';

  -- Flag if more than 10 bookings in an hour (potential spam)
  IF recent_bookings >= 10 THEN
    INSERT INTO suspicious_activities (
      activity_type,
      severity,
      description,
      metadata
    ) VALUES (
      'excessive_bookings',
      'medium',
      'Excessive booking attempts detected (' || recent_bookings || ' in 1 hour)',
      jsonb_build_object(
        'customer_id', NEW.customer_id,
        'booking_count', recent_bookings,
        'branch_id', NEW.branch_id,
        'latest_booking_id', NEW.id
      )
    );
  END IF;

  -- Check for duplicate time slot attempts
  SELECT COUNT(*) INTO same_slot_bookings
  FROM bookings
  WHERE barber_id = NEW.barber_id
    AND date = NEW.date
    AND time = NEW.time
    AND created_at > now() - interval '5 minutes'
    AND id != NEW.id;

  -- Flag potential race condition exploitation
  IF same_slot_bookings > 0 THEN
    INSERT INTO suspicious_activities (
      activity_type,
      severity,
      description,
      metadata
    ) VALUES (
      'duplicate_slot_booking',
      'low',
      'Multiple bookings for same time slot detected',
      jsonb_build_object(
        'barber_id', NEW.barber_id,
        'date', NEW.date,
        'time', NEW.time,
        'duplicate_count', same_slot_bookings + 1
      )
    );
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: detect_suspicious_login_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_suspicious_login_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  recent_failures INTEGER;
  user_identifier TEXT;
BEGIN
  -- Only check login-related log entries
  IF NEW.log_type != 'auth' OR NEW.action NOT IN ('login', 'login_failure') THEN
    RETURN NEW;
  END IF;

  user_identifier := COALESCE(NEW.user_id::TEXT, NEW.metadata ->> 'email');

  -- Count recent failed logins for this user/email in last 15 minutes
  IF NEW.action = 'login_failure' THEN
    SELECT COUNT(*) INTO recent_failures
    FROM logs
    WHERE (user_id = NEW.user_id OR metadata ->> 'email' = NEW.metadata ->> 'email')
      AND log_type = 'auth'
      AND action = 'login_failure'
      AND created_at > now() - interval '15 minutes';

    -- Flag as suspicious if more than 5 failures in 15 minutes
    IF recent_failures >= 5 THEN
      INSERT INTO suspicious_activities (
        user_id,
        activity_type,
        severity,
        description,
        metadata,
        source_ip
      ) VALUES (
        NEW.user_id,
        'multiple_failed_logins',
        CASE 
          WHEN recent_failures >= 10 THEN 'critical'
          WHEN recent_failures >= 7 THEN 'high'
          ELSE 'medium'
        END,
        'Multiple failed login attempts detected (' || recent_failures || ' in 15 minutes)',
        jsonb_build_object(
          'failure_count', recent_failures,
          'email', NEW.metadata ->> 'email',
          'user_agent', NEW.user_agent,
          'last_attempt', now()
        ),
        NEW.metadata ->> 'ip'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: get_barber_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_barber_branch_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT branch_id FROM barbers WHERE user_id = auth.uid() LIMIT 1
$$;


--
-- Name: get_manager_by_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_manager_by_id(manager_id uuid) RETURNS TABLE(id uuid, email text, name text, phone text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT
    u.id,
    u.email::text,
    COALESCE(u.raw_user_meta_data->>'name', split_part(u.email::text, '@', 1))::text as name,
    (u.raw_user_meta_data->>'phone')::text as phone,
    u.created_at
  FROM auth.users u
  WHERE u.id = manager_id
    AND u.raw_user_meta_data->>'role' = 'manager';
$$;


--
-- Name: get_managers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_managers() RETURNS TABLE(id uuid, email text, name text, phone text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT
    u.id,
    u.email::text,
    COALESCE(u.raw_user_meta_data->>'name', split_part(u.email::text, '@', 1))::text as name,
    (u.raw_user_meta_data->>'phone')::text as phone,
    u.created_at
  FROM auth.users u
  WHERE u.raw_user_meta_data->>'role' = 'manager';
$$;


--
-- Name: get_user_branch_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_branch_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id FROM branches WHERE manager_id = auth.uid()
$$;


--
-- Name: increment_customer_booking_count(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_customer_booking_count(p_customer_id uuid, p_booking_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE customers
  SET 
    total_bookings = COALESCE(total_bookings, 0) + 1,
    last_booking_date = p_booking_date,
    updated_at = NOW()
  WHERE id = p_customer_id;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;


--
-- Name: is_agent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_agent() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'agent'
$$;


--
-- Name: is_barber(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_barber() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM barbers
    WHERE user_id = auth.uid()
  );
$$;


--
-- Name: is_manager(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_manager() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
$$;


--
-- Name: reset_auth_rate_limit(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_auth_rate_limit(p_identifier text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM auth_rate_limits WHERE identifier = p_identifier;
END;
$$;


--
-- Name: update_customer_booking_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer_booking_stats() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Update total_bookings and last_booking_date for the customer
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET 
      total_bookings = (
        SELECT COUNT(*) FROM public.bookings 
        WHERE customer_id = NEW.customer_id 
        AND status NOT IN ('cancelled', 'no_show')
      ),
      last_booking_date = (
        SELECT MAX(date) FROM public.bookings 
        WHERE customer_id = NEW.customer_id
        AND status NOT IN ('cancelled', 'no_show')
      ),
      updated_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  
  -- Also update old customer if customer_id changed
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id AND OLD.customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET 
      total_bookings = (
        SELECT COUNT(*) FROM public.bookings 
        WHERE customer_id = OLD.customer_id 
        AND status NOT IN ('cancelled', 'no_show')
      ),
      last_booking_date = (
        SELECT MAX(date) FROM public.bookings 
        WHERE customer_id = OLD.customer_id
        AND status NOT IN ('cancelled', 'no_show')
      ),
      updated_at = NOW()
    WHERE id = OLD.customer_id;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: update_notification_preferences_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_notification_preferences_timestamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Update the timestamp based on which column changed
    IF OLD.new_bookings IS DISTINCT FROM NEW.new_bookings THEN
        NEW.new_bookings_enabled_at = CASE WHEN NEW.new_bookings THEN NOW() ELSE NULL END;
    END IF;
    IF OLD.booking_updates IS DISTINCT FROM NEW.booking_updates THEN
        NEW.booking_updates_enabled_at = CASE WHEN NEW.booking_updates THEN NOW() ELSE NULL END;
    END IF;
    IF OLD.cancellations IS DISTINCT FROM NEW.cancellations THEN
        NEW.cancellations_enabled_at = CASE WHEN NEW.cancellations THEN NOW() ELSE NULL END;
    END IF;
    IF OLD.system_alerts IS DISTINCT FROM NEW.system_alerts THEN
        NEW.system_alerts_enabled_at = CASE WHEN NEW.system_alerts THEN NOW() ELSE NULL END;
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_whatsapp_conversation_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_whatsapp_conversation_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: decrypt_pii(text); Type: FUNCTION; Schema: secure; Owner: -
--

CREATE FUNCTION secure.decrypt_pii(ciphertext text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  encryption_key BYTEA;
  decrypted_data TEXT;
  encrypted_bytes BYTEA;
BEGIN
  IF ciphertext IS NULL OR ciphertext = '' THEN
    RETURN ciphertext;
  END IF;
  
  -- Handle unencrypted data (development mode)
  IF starts_with(ciphertext, 'UNENC:') THEN
    RETURN substring(ciphertext FROM 7);
  END IF;
  
  -- Handle encrypted data
  IF NOT starts_with(ciphertext, 'ENC:') THEN
    -- Plain text (legacy data), return as-is
    RETURN ciphertext;
  END IF;
  
  -- Get encryption key from Vault
  BEGIN
    SELECT decrypted_secret INTO encryption_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'pii_encryption_key' 
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    encryption_key := NULL;
  END;
  
  IF encryption_key IS NULL THEN
    RAISE WARNING 'Encryption key not found in vault';
    RETURN '[ENCRYPTED]';
  END IF;
  
  -- Decrypt
  encrypted_bytes := decode(substring(ciphertext FROM 5), 'base64');
  decrypted_data := extensions.pgp_sym_decrypt(encrypted_bytes, convert_from(encryption_key, 'UTF8'));
  RETURN decrypted_data;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Decryption failed: %', SQLERRM;
  RETURN '[DECRYPTION_FAILED]';
END;
$$;


--
-- Name: encrypt_pii(text); Type: FUNCTION; Schema: secure; Owner: -
--

CREATE FUNCTION secure.encrypt_pii(plaintext text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  encryption_key BYTEA;
  encrypted_data BYTEA;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN plaintext;
  END IF;
  
  -- Get encryption key from Vault (or use a fallback for development)
  -- In production, set this via: SELECT vault.create_secret('pii_encryption_key', 'your-32-byte-key');
  BEGIN
    SELECT decrypted_secret INTO encryption_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'pii_encryption_key' 
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    encryption_key := NULL;
  END;
  
  -- If no vault key, return a tagged unencrypted value (for development)
  IF encryption_key IS NULL THEN
    RETURN 'UNENC:' || plaintext;
  END IF;
  
  -- Encrypt using AES-256
  encrypted_data := extensions.pgp_sym_encrypt(plaintext, convert_from(encryption_key, 'UTF8'));
  RETURN 'ENC:' || encode(encrypted_data, 'base64');
END;
$$;


--
-- Name: mask_pii(text, text); Type: FUNCTION; Schema: secure; Owner: -
--

CREATE FUNCTION secure.mask_pii(value text, pii_type text DEFAULT 'generic'::text) RETURNS text
    LANGUAGE plpgsql
    AS $_$
BEGIN
  IF value IS NULL OR value = '' THEN
    RETURN value;
  END IF;
  
  CASE pii_type
    WHEN 'email' THEN
      -- Show first 2 chars and domain: jo****@example.com
      RETURN regexp_replace(value, '^(.{2})[^@]*(@.*)$', '\1****\2');
    WHEN 'phone' THEN
      -- Show last 4 digits: ****1234
      RETURN '****' || right(value, 4);
    WHEN 'name' THEN
      -- Show first letter of each word: J**** S****
      RETURN regexp_replace(value, '(\w)\w+', '\1****', 'g');
    ELSE
      -- Generic: show first and last char
      IF length(value) <= 2 THEN
        RETURN '**';
      END IF;
      RETURN left(value, 1) || repeat('*', length(value) - 2) || right(value, 1);
  END CASE;
END;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    setting_key character varying(100) NOT NULL,
    setting_value jsonb NOT NULL,
    description text,
    category character varying(50) NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_settings_category_check CHECK (((category)::text = ANY (ARRAY[('general'::character varying)::text, ('notifications'::character varying)::text, ('security'::character varying)::text, ('branding'::character varying)::text, ('limits'::character varying)::text, ('business_defaults'::character varying)::text, ('booking_rules'::character varying)::text, ('financial'::character varying)::text, ('features'::character varying)::text])))
);


--
-- Name: areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.areas (
    id integer NOT NULL,
    governorate_id integer NOT NULL,
    name_en text NOT NULL,
    name_ar text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    action_type character varying(50) NOT NULL,
    target_user_id uuid,
    target_entity_type character varying(50),
    target_entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_action_type_check CHECK (((action_type)::text = ANY (ARRAY[('user_created'::character varying)::text, ('user_updated'::character varying)::text, ('user_disabled'::character varying)::text, ('user_enabled'::character varying)::text, ('user_deleted'::character varying)::text, ('settings_changed'::character varying)::text, ('role_assigned'::character varying)::text, ('branch_modified'::character varying)::text, ('barber_modified'::character varying)::text, ('service_modified'::character varying)::text, ('booking_modified'::character varying)::text, ('data_export'::character varying)::text, ('security_event'::character varying)::text, ('system_config'::character varying)::text, ('location_modified'::character varying)::text, ('login_success'::character varying)::text, ('login_failure'::character varying)::text, ('logout'::character varying)::text, ('password_reset_requested'::character varying)::text, ('password_reset_completed'::character varying)::text, ('permission_denied'::character varying)::text, ('suspicious_activity'::character varying)::text, ('session_expired'::character varying)::text, ('account_locked'::character varying)::text, ('account_unlocked'::character varying)::text, ('manager_enabled'::character varying)::text, ('manager_disabled'::character varying)::text, ('barber_enabled'::character varying)::text, ('barber_disabled'::character varying)::text, ('template_updated'::character varying)::text, ('bulk_operation'::character varying)::text, ('import_data'::character varying)::text])))
);


--
-- Name: barbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    branch_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    status text DEFAULT 'active'::text,
    avatar_url text,
    availability jsonb DEFAULT '{"friday": {"end": "21:00", "start": "14:00", "available": true}, "monday": {"end": "21:00", "start": "09:00", "available": true}, "sunday": {"end": "21:00", "start": "09:00", "available": false}, "tuesday": {"end": "21:00", "start": "09:00", "available": true}, "saturday": {"end": "21:00", "start": "09:00", "available": true}, "thursday": {"end": "21:00", "start": "09:00", "available": true}, "wednesday": {"end": "21:00", "start": "09:00", "available": true}}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name_ar text,
    country_code text DEFAULT '+965'::text,
    service_ids uuid[] DEFAULT '{}'::uuid[],
    invite_status character varying(20) DEFAULT 'pending'::character varying,
    invite_sent_at timestamp with time zone,
    invite_accepted_at timestamp with time zone,
    time_offs jsonb DEFAULT '[]'::jsonb,
    vacations jsonb DEFAULT '[]'::jsonb,
    max_booking_days integer DEFAULT 30,
    CONSTRAINT barbers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'on_leave'::text]))),
    CONSTRAINT max_booking_days_range CHECK (((max_booking_days >= 1) AND (max_booking_days <= 365)))
);


--
-- Name: booking_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    reminder_type text DEFAULT '1_hour'::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    status text DEFAULT 'pending'::text,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT booking_reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    barber_id uuid NOT NULL,
    service_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    date date NOT NULL,
    "time" time without time zone NOT NULL,
    duration integer DEFAULT 30 NOT NULL,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'confirmed'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    added_by_type text,
    added_by_user_id uuid,
    modified_by_type text,
    modified_by_user_id uuid,
    customer_id uuid,
    CONSTRAINT bookings_added_by_type_check CHECK ((added_by_type = ANY (ARRAY['manager'::text, 'barber'::text, 'whatsapp_agent'::text, 'admin'::text, 'system'::text]))),
    CONSTRAINT bookings_modified_by_type_check CHECK ((modified_by_type = ANY (ARRAY['manager'::text, 'barber'::text, 'whatsapp_agent'::text, 'admin'::text, 'system'::text]))),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])))
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    manager_id uuid NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    country text DEFAULT 'Saudi Arabia'::text,
    phone text,
    email text,
    status text DEFAULT 'active'::text,
    working_hours jsonb DEFAULT '{"friday": {"open": "14:00", "close": "21:00"}, "monday": {"open": "09:00", "close": "21:00"}, "sunday": {"open": "09:00", "close": "21:00"}, "tuesday": {"open": "09:00", "close": "21:00"}, "saturday": {"open": "09:00", "close": "21:00"}, "thursday": {"open": "09:00", "close": "21:00"}, "wednesday": {"open": "09:00", "close": "21:00"}}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name_ar text,
    governorate_id integer,
    area_id integer,
    location_url text,
    country_code text DEFAULT '+965'::text,
    number_of_barbers integer,
    image_url text,
    CONSTRAINT branches_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    name_ar character varying(255),
    country_code character varying(10) DEFAULT '+965'::character varying NOT NULL,
    phone character varying(20) NOT NULL,
    email character varying(255),
    notes text,
    tags text[] DEFAULT '{}'::text[],
    preferred_barber_id uuid,
    preferred_branch_id uuid,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    total_bookings integer DEFAULT 0,
    last_booking_date date,
    created_by_type character varying(50),
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('inactive'::character varying)::text, ('blocked'::character varying)::text])))
);


--
-- Name: governorates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.governorates (
    id integer NOT NULL,
    name_en text NOT NULL,
    name_ar text NOT NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    level character varying(10) NOT NULL,
    log_type character varying(20) NOT NULL,
    user_id uuid,
    user_role character varying(20),
    branch_id uuid,
    barber_id uuid,
    entity_type character varying(50),
    entity_id uuid,
    action character varying(50),
    message text NOT NULL,
    stack_trace text,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_agent text,
    page_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid,
    request_id uuid DEFAULT gen_random_uuid(),
    client_ip_hash text,
    CONSTRAINT logs_level_check CHECK (((level)::text = ANY (ARRAY[('error'::character varying)::text, ('warning'::character varying)::text, ('info'::character varying)::text, ('debug'::character varying)::text]))),
    CONSTRAINT logs_log_type_check CHECK (((log_type)::text = ANY (ARRAY[('error'::character varying)::text, ('action'::character varying)::text, ('navigation'::character varying)::text, ('system'::character varying)::text, ('auth'::character varying)::text])))
);


--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key character varying(100) NOT NULL,
    title_en character varying(255) NOT NULL,
    title_ar character varying(255),
    message_en text NOT NULL,
    message_ar text,
    variables jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_user_id uuid,
    recipient_branch_id uuid,
    recipient_role character varying(20),
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    entity_type character varying(50),
    entity_id uuid,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_recipient_role_check CHECK (((recipient_role)::text = ANY (ARRAY[('manager'::character varying)::text, ('barber'::character varying)::text]))),
    CONSTRAINT notifications_type_check CHECK (((type)::text = ANY (ARRAY[('booking_created'::character varying)::text, ('booking_cancelled'::character varying)::text, ('booking_completed'::character varying)::text, ('booking_status_changed'::character varying)::text, ('booking_reminder'::character varying)::text, ('barber_invite_accepted'::character varying)::text, ('barber_availability_updated'::character varying)::text, ('barber_profile_updated'::character varying)::text, ('low_availability_warning'::character varying)::text, ('system_alert'::character varying)::text])))
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    phone_number character varying(20) NOT NULL,
    minute_count integer DEFAULT 0,
    minute_window_start bigint NOT NULL,
    hour_count integer DEFAULT 0,
    hour_window_start bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    duration integer DEFAULT 30 NOT NULL,
    price numeric(10,2) NOT NULL,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name_ar text,
    CONSTRAINT services_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: suspicious_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suspicious_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    activity_type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    description text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    source_ip text,
    resolved boolean DEFAULT false,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    new_bookings boolean DEFAULT true NOT NULL,
    booking_updates boolean DEFAULT true NOT NULL,
    cancellations boolean DEFAULT true NOT NULL,
    barber_updates boolean DEFAULT true NOT NULL,
    team_invites boolean DEFAULT true NOT NULL,
    system_alerts boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    new_bookings_enabled_at timestamp with time zone DEFAULT now(),
    booking_updates_enabled_at timestamp with time zone DEFAULT now(),
    cancellations_enabled_at timestamp with time zone DEFAULT now(),
    system_alerts_enabled_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    theme character varying(10) DEFAULT 'dark'::character varying,
    language character varying(5) DEFAULT 'en'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_settings_language_check CHECK (((language)::text = ANY (ARRAY[('en'::character varying)::text, ('ar'::character varying)::text]))),
    CONSTRAINT user_settings_theme_check CHECK (((theme)::text = ANY (ARRAY[('dark'::character varying)::text, ('light'::character varying)::text, ('system'::character varying)::text])))
);


--
-- Name: whatsapp_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_number text NOT NULL,
    phone_country_code text DEFAULT '+965'::text,
    customer_name text,
    current_state text DEFAULT 'greeting'::text,
    context jsonb DEFAULT '{}'::jsonb,
    language text DEFAULT 'ar'::text,
    last_message_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    current_session_id uuid DEFAULT gen_random_uuid()
);


--
-- Name: whatsapp_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    phone_number text,
    log_level text NOT NULL,
    event_type text NOT NULL,
    message text NOT NULL,
    inbound_message text,
    outbound_message text,
    tool_name text,
    tool_input jsonb,
    tool_output jsonb,
    error_code text,
    error_message text,
    stack_trace text,
    context_snapshot jsonb,
    execution_time_ms integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT whatsapp_logs_log_level_check CHECK ((log_level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text])))
);


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    whatsapp_message_id text,
    direction text NOT NULL,
    message_type text DEFAULT 'text'::text,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'sent'::text,
    created_at timestamp with time zone DEFAULT now(),
    session_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT whatsapp_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
    CONSTRAINT whatsapp_messages_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])))
);


--
-- Name: admin_settings admin_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_pkey PRIMARY KEY (id);


--
-- Name: admin_settings admin_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: barbers barbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT barbers_pkey PRIMARY KEY (id);


--
-- Name: booking_reminders booking_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_reminders
    ADD CONSTRAINT booking_reminders_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: customers customers_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_unique UNIQUE (country_code, phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: governorates governorates_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governorates
    ADD CONSTRAINT governorates_code_key UNIQUE (code);


--
-- Name: governorates governorates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governorates
    ADD CONSTRAINT governorates_pkey PRIMARY KEY (id);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_template_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_template_key_key UNIQUE (template_key);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (phone_number);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: suspicious_activities suspicious_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_activities
    ADD CONSTRAINT suspicious_activities_pkey PRIMARY KEY (id);


--
-- Name: user_notification_preferences unique_user_preferences; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_preferences
    ADD CONSTRAINT unique_user_preferences UNIQUE (user_id);


--
-- Name: user_notification_preferences user_notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_preferences
    ADD CONSTRAINT user_notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: whatsapp_conversations whatsapp_conversations_phone_number_phone_country_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_phone_number_phone_country_code_key UNIQUE (phone_number, phone_country_code);


--
-- Name: whatsapp_conversations whatsapp_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_logs whatsapp_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_logs
    ADD CONSTRAINT whatsapp_logs_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: idx_admin_settings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_settings_category ON public.admin_settings USING btree (category);


--
-- Name: idx_admin_settings_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_settings_key ON public.admin_settings USING btree (setting_key);


--
-- Name: idx_areas_governorate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_areas_governorate ON public.areas USING btree (governorate_id);


--
-- Name: idx_audit_logs_action_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action_type ON public.audit_logs USING btree (action_type);


--
-- Name: idx_audit_logs_admin_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_admin_user ON public.audit_logs USING btree (admin_user_id);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_target_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_target_entity ON public.audit_logs USING btree (target_entity_type, target_entity_id) WHERE (target_entity_id IS NOT NULL);


--
-- Name: idx_audit_logs_target_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_target_user ON public.audit_logs USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);


--
-- Name: idx_barbers_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_barbers_branch_id ON public.barbers USING btree (branch_id);


--
-- Name: idx_barbers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_barbers_user_id ON public.barbers USING btree (user_id);


--
-- Name: idx_bookings_added_by_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_added_by_type ON public.bookings USING btree (added_by_type);


--
-- Name: idx_bookings_barber_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_barber_id ON public.bookings USING btree (barber_id);


--
-- Name: idx_bookings_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_branch_id ON public.bookings USING btree (branch_id);


--
-- Name: idx_bookings_conflict_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_conflict_check ON public.bookings USING btree (barber_id, date, "time") WHERE (status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]));


--
-- Name: idx_bookings_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_customer_id ON public.bookings USING btree (customer_id);


--
-- Name: idx_bookings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_date ON public.bookings USING btree (date);


--
-- Name: idx_bookings_modified_by_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_modified_by_type ON public.bookings USING btree (modified_by_type);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_branches_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_area ON public.branches USING btree (area_id);


--
-- Name: idx_branches_governorate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_governorate ON public.branches USING btree (governorate_id);


--
-- Name: idx_branches_manager_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_manager_id ON public.branches USING btree (manager_id);


--
-- Name: idx_conversations_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_last_message ON public.whatsapp_conversations USING btree (last_message_at DESC);


--
-- Name: idx_conversations_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_phone ON public.whatsapp_conversations USING btree (phone_number, phone_country_code);


--
-- Name: idx_customers_country_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_country_phone ON public.customers USING btree (country_code, phone);


--
-- Name: idx_customers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_created_at ON public.customers USING btree (created_at DESC);


--
-- Name: idx_customers_last_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_last_booking ON public.customers USING btree (last_booking_date DESC NULLS LAST);


--
-- Name: idx_customers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name ON public.customers USING btree (name);


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone ON public.customers USING btree (phone);


--
-- Name: idx_customers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_status ON public.customers USING btree (status);


--
-- Name: idx_logs_barber_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_barber_id ON public.logs USING btree (barber_id);


--
-- Name: idx_logs_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_branch_id ON public.logs USING btree (branch_id);


--
-- Name: idx_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_created_at ON public.logs USING btree (created_at DESC);


--
-- Name: idx_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_level ON public.logs USING btree (level);


--
-- Name: idx_logs_log_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_log_type ON public.logs USING btree (log_type);


--
-- Name: idx_logs_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_request_id ON public.logs USING btree (request_id);


--
-- Name: idx_logs_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_session_id ON public.logs USING btree (session_id) WHERE (session_id IS NOT NULL);


--
-- Name: idx_logs_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_user_created ON public.logs USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logs_user_id ON public.logs USING btree (user_id);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.whatsapp_messages USING btree (conversation_id);


--
-- Name: idx_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created ON public.whatsapp_messages USING btree (created_at DESC);


--
-- Name: idx_messages_whatsapp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_whatsapp_id ON public.whatsapp_messages USING btree (whatsapp_message_id) WHERE (whatsapp_message_id IS NOT NULL);


--
-- Name: idx_notification_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_templates_active ON public.notification_templates USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_notification_templates_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_templates_key ON public.notification_templates USING btree (template_key);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_entity ON public.notifications USING btree (entity_type, entity_id) WHERE (entity_id IS NOT NULL);


--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);


--
-- Name: idx_notifications_recipient_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_branch ON public.notifications USING btree (recipient_branch_id) WHERE (recipient_branch_id IS NOT NULL);


--
-- Name: idx_notifications_recipient_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_user ON public.notifications USING btree (recipient_user_id) WHERE (recipient_user_id IS NOT NULL);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (recipient_user_id, is_read, created_at DESC) WHERE ((recipient_user_id IS NOT NULL) AND (is_read = false));


--
-- Name: idx_rate_limits_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limits_updated ON public.rate_limits USING btree (updated_at);


--
-- Name: idx_reminders_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_booking ON public.booking_reminders USING btree (booking_id);


--
-- Name: idx_reminders_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_scheduled ON public.booking_reminders USING btree (scheduled_at) WHERE (status = 'pending'::text);


--
-- Name: idx_services_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_branch_id ON public.services USING btree (branch_id);


--
-- Name: idx_suspicious_activities_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suspicious_activities_unresolved ON public.suspicious_activities USING btree (resolved, severity, created_at DESC) WHERE (resolved = false);


--
-- Name: idx_suspicious_activities_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suspicious_activities_user ON public.suspicious_activities USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_user_notification_preferences_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_notification_preferences_user_id ON public.user_notification_preferences USING btree (user_id);


--
-- Name: idx_whatsapp_logs_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_logs_conversation ON public.whatsapp_logs USING btree (conversation_id);


--
-- Name: idx_whatsapp_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_logs_created ON public.whatsapp_logs USING btree (created_at DESC);


--
-- Name: idx_whatsapp_logs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_logs_event ON public.whatsapp_logs USING btree (event_type);


--
-- Name: idx_whatsapp_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_logs_level ON public.whatsapp_logs USING btree (log_level);


--
-- Name: idx_whatsapp_logs_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_logs_phone ON public.whatsapp_logs USING btree (phone_number);


--
-- Name: idx_whatsapp_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_messages_session ON public.whatsapp_messages USING btree (conversation_id, session_id, created_at DESC);


--
-- Name: unique_whatsapp_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_whatsapp_message_id ON public.whatsapp_messages USING btree (whatsapp_message_id) WHERE (whatsapp_message_id IS NOT NULL);


--
-- Name: barbers barbers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barbers_updated_at BEFORE UPDATE ON public.barbers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bookings booking_customer_stats_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_customer_stats_trigger AFTER INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_customer_booking_stats();


--
-- Name: bookings bookings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: branches branches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bookings cancel_reminder_on_booking_cancel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cancel_reminder_on_booking_cancel AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.cancel_booking_reminder();


--
-- Name: bookings create_reminder_on_booking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_reminder_on_booking AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.create_booking_reminder();


--
-- Name: bookings prevent_booking_conflicts_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_booking_conflicts_insert BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.check_booking_conflict();


--
-- Name: bookings prevent_booking_conflicts_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_booking_conflicts_update BEFORE UPDATE OF "time", date, duration, barber_id ON public.bookings FOR EACH ROW WHEN (((old."time" IS DISTINCT FROM new."time") OR (old.date IS DISTINCT FROM new.date) OR (old.duration IS DISTINCT FROM new.duration) OR (old.barber_id IS DISTINCT FROM new.barber_id))) EXECUTE FUNCTION public.check_booking_conflict();


--
-- Name: services services_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: bookings trigger_detect_suspicious_booking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_detect_suspicious_booking AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.detect_suspicious_booking_activity();


--
-- Name: logs trigger_detect_suspicious_login; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_detect_suspicious_login AFTER INSERT ON public.logs FOR EACH ROW EXECUTE FUNCTION public.detect_suspicious_login_activity();


--
-- Name: user_notification_preferences trigger_update_notification_preferences_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_notification_preferences_timestamp BEFORE UPDATE ON public.user_notification_preferences FOR EACH ROW EXECUTE FUNCTION public.update_notification_preferences_timestamp();


--
-- Name: areas update_areas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_areas_updated_at BEFORE UPDATE ON public.areas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers update_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: governorates update_governorates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_governorates_updated_at BEFORE UPDATE ON public.governorates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_settings update_user_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: whatsapp_conversations update_whatsapp_conversations_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_whatsapp_conversations_timestamp BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.update_whatsapp_conversation_timestamp();


--
-- Name: admin_settings admin_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: areas areas_governorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_governorate_id_fkey FOREIGN KEY (governorate_id) REFERENCES public.governorates(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: booking_reminders booking_reminders_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_reminders
    ADD CONSTRAINT booking_reminders_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_added_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_added_by_user_id_fkey FOREIGN KEY (added_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_modified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_modified_by_user_id_fkey FOREIGN KEY (modified_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: branches branches_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id);


--
-- Name: branches branches_governorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_governorate_id_fkey FOREIGN KEY (governorate_id) REFERENCES public.governorates(id);


--
-- Name: customers customers_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: customers customers_preferred_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_preferred_barber_id_fkey FOREIGN KEY (preferred_barber_id) REFERENCES public.barbers(id) ON DELETE SET NULL;


--
-- Name: customers customers_preferred_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_preferred_branch_id_fkey FOREIGN KEY (preferred_branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: barbers fk_barbers_branch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barbers
    ADD CONSTRAINT fk_barbers_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: bookings fk_bookings_barber; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_bookings_barber FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE CASCADE;


--
-- Name: bookings fk_bookings_branch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_bookings_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: services fk_services_branch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT fk_services_branch FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: logs logs_barber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_barber_id_fkey FOREIGN KEY (barber_id) REFERENCES public.barbers(id) ON DELETE SET NULL;


--
-- Name: logs logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: logs logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_recipient_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_branch_id_fkey FOREIGN KEY (recipient_branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: suspicious_activities suspicious_activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_activities
    ADD CONSTRAINT suspicious_activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_notification_preferences user_notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_preferences
    ADD CONSTRAINT user_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: whatsapp_logs whatsapp_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_logs
    ADD CONSTRAINT whatsapp_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL;


--
-- Name: whatsapp_messages whatsapp_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE;


--
-- Name: notifications Admins delete all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete all notifications" ON public.notifications FOR DELETE USING (public.is_admin());


--
-- Name: areas Admins delete areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete areas" ON public.areas FOR DELETE USING (public.is_admin());


--
-- Name: barbers Admins delete barbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete barbers" ON public.barbers FOR DELETE USING (public.is_admin());


--
-- Name: bookings Admins delete bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete bookings" ON public.bookings FOR DELETE USING (public.is_admin());


--
-- Name: branches Admins delete branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete branches" ON public.branches FOR DELETE USING (public.is_admin());


--
-- Name: governorates Admins delete governorates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete governorates" ON public.governorates FOR DELETE USING (public.is_admin());


--
-- Name: services Admins delete services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete services" ON public.services FOR DELETE USING (public.is_admin());


--
-- Name: admin_settings Admins delete settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete settings" ON public.admin_settings FOR DELETE USING (public.is_admin());


--
-- Name: notification_templates Admins delete templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete templates" ON public.notification_templates FOR DELETE USING (public.is_admin());


--
-- Name: areas Admins insert areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert areas" ON public.areas FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: audit_logs Admins insert audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: barbers Admins insert barbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert barbers" ON public.barbers FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: bookings Admins insert bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert bookings" ON public.bookings FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: branches Admins insert branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert branches" ON public.branches FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: governorates Admins insert governorates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert governorates" ON public.governorates FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: notifications Admins insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert notifications" ON public.notifications FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: services Admins insert services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert services" ON public.services FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: admin_settings Admins insert settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert settings" ON public.admin_settings FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: notification_templates Admins insert templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert templates" ON public.notification_templates FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: suspicious_activities Admins manage suspicious activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage suspicious activities" ON public.suspicious_activities TO authenticated USING ((((auth.jwt() ->> 'role'::text) = 'service_role'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))) WITH CHECK ((((auth.jwt() ->> 'role'::text) = 'service_role'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));


--
-- Name: barbers Admins update all barbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all barbers" ON public.barbers FOR UPDATE USING (public.is_admin());


--
-- Name: bookings Admins update all bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all bookings" ON public.bookings FOR UPDATE USING (public.is_admin());


--
-- Name: branches Admins update all branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all branches" ON public.branches FOR UPDATE USING (public.is_admin());


--
-- Name: notifications Admins update all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all notifications" ON public.notifications FOR UPDATE USING (public.is_admin());


--
-- Name: user_notification_preferences Admins update all preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all preferences" ON public.user_notification_preferences FOR UPDATE USING (public.is_admin());


--
-- Name: services Admins update all services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all services" ON public.services FOR UPDATE USING (public.is_admin());


--
-- Name: user_settings Admins update all user settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update all user settings" ON public.user_settings FOR UPDATE USING (public.is_admin());


--
-- Name: areas Admins update areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update areas" ON public.areas FOR UPDATE USING (public.is_admin());


--
-- Name: governorates Admins update governorates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update governorates" ON public.governorates FOR UPDATE USING (public.is_admin());


--
-- Name: admin_settings Admins update settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update settings" ON public.admin_settings FOR UPDATE USING (public.is_admin());


--
-- Name: notification_templates Admins update templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update templates" ON public.notification_templates FOR UPDATE USING (public.is_admin());


--
-- Name: areas Admins view all areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all areas" ON public.areas FOR SELECT USING (public.is_admin());


--
-- Name: barbers Admins view all barbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all barbers" ON public.barbers FOR SELECT USING (public.is_admin());


--
-- Name: bookings Admins view all bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all bookings" ON public.bookings FOR SELECT USING (public.is_admin());


--
-- Name: branches Admins view all branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all branches" ON public.branches FOR SELECT USING (public.is_admin());


--
-- Name: governorates Admins view all governorates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all governorates" ON public.governorates FOR SELECT USING (public.is_admin());


--
-- Name: notifications Admins view all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all notifications" ON public.notifications FOR SELECT USING (public.is_admin());


--
-- Name: user_notification_preferences Admins view all preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all preferences" ON public.user_notification_preferences FOR SELECT USING (public.is_admin());


--
-- Name: services Admins view all services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all services" ON public.services FOR SELECT USING (public.is_admin());


--
-- Name: user_settings Admins view all user settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all user settings" ON public.user_settings FOR SELECT USING (public.is_admin());


--
-- Name: audit_logs Admins view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view audit logs" ON public.audit_logs FOR SELECT USING (public.is_admin());


--
-- Name: admin_settings Admins view settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view settings" ON public.admin_settings FOR SELECT USING (public.is_admin());


--
-- Name: suspicious_activities Admins view suspicious activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view suspicious activities" ON public.suspicious_activities FOR SELECT TO authenticated USING ((((auth.jwt() ->> 'role'::text) = 'service_role'::text) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));


--
-- Name: notification_templates Admins view templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view templates" ON public.notification_templates FOR SELECT USING (public.is_admin());


--
-- Name: whatsapp_conversations Agents and admins can insert conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents and admins can insert conversations" ON public.whatsapp_conversations FOR INSERT TO authenticated WITH CHECK ((public.is_agent() OR public.is_admin()));


--
-- Name: whatsapp_messages Agents and admins can insert messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents and admins can insert messages" ON public.whatsapp_messages FOR INSERT TO authenticated WITH CHECK ((public.is_agent() OR public.is_admin()));


--
-- Name: whatsapp_conversations Agents and admins can update conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents and admins can update conversations" ON public.whatsapp_conversations FOR UPDATE TO authenticated USING ((public.is_agent() OR public.is_admin())) WITH CHECK ((public.is_agent() OR public.is_admin()));


--
-- Name: whatsapp_messages Agents and admins can update messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents and admins can update messages" ON public.whatsapp_messages FOR UPDATE TO authenticated USING ((public.is_agent() OR public.is_admin())) WITH CHECK ((public.is_agent() OR public.is_admin()));


--
-- Name: whatsapp_conversations Agents and admins can view conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents and admins can view conversations" ON public.whatsapp_conversations FOR SELECT TO authenticated USING ((public.is_agent() OR public.is_admin()));


--
-- Name: whatsapp_messages Agents and admins can view messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents and admins can view messages" ON public.whatsapp_messages FOR SELECT TO authenticated USING ((public.is_agent() OR public.is_admin()));


--
-- Name: bookings Agents can insert bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents can insert bookings" ON public.bookings FOR INSERT WITH CHECK (public.is_agent());


--
-- Name: bookings Agents can update bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents can update bookings" ON public.bookings FOR UPDATE USING (public.is_agent());


--
-- Name: barbers Agents can view all barbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents can view all barbers" ON public.barbers FOR SELECT USING (public.is_agent());


--
-- Name: bookings Agents can view all bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents can view all bookings" ON public.bookings FOR SELECT USING (public.is_agent());


--
-- Name: branches Agents can view all branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents can view all branches" ON public.branches FOR SELECT USING (public.is_agent());


--
-- Name: services Agents can view all services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Agents can view all services" ON public.services FOR SELECT USING (public.is_agent());


--
-- Name: bookings Barbers can insert bookings in their branch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can insert bookings in their branch" ON public.bookings FOR INSERT TO authenticated WITH CHECK (((branch_id = public.get_barber_branch_id()) AND (barber_id IN ( SELECT barbers.id
   FROM public.barbers
  WHERE (barbers.user_id = auth.uid())))));


--
-- Name: bookings Barbers can update own bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can update own bookings" ON public.bookings FOR UPDATE USING ((barber_id IN ( SELECT barbers.id
   FROM public.barbers
  WHERE (barbers.user_id = auth.uid()))));


--
-- Name: barbers Barbers can update own record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can update own record" ON public.barbers FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: branches Barbers can view assigned branch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can view assigned branch" ON public.branches FOR SELECT USING ((id = public.get_barber_branch_id()));


--
-- Name: bookings Barbers can view bookings in their branch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can view bookings in their branch" ON public.bookings FOR SELECT USING ((branch_id = public.get_barber_branch_id()));


--
-- Name: barbers Barbers can view own record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can view own record" ON public.barbers FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: services Barbers can view services in their branch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers can view services in their branch" ON public.services FOR SELECT USING ((branch_id = public.get_barber_branch_id()));


--
-- Name: logs Barbers view branch logs via barber record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers view branch logs via barber record" ON public.logs FOR SELECT USING ((barber_id IN ( SELECT barbers.id
   FROM public.barbers
  WHERE (barbers.user_id = auth.uid()))));


--
-- Name: notifications Barbers view branch notifications secure; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Barbers view branch notifications secure" ON public.notifications FOR SELECT USING (((recipient_branch_id IN ( SELECT barbers.branch_id
   FROM public.barbers
  WHERE (barbers.user_id = auth.uid()))) AND ((recipient_role)::text = 'barber'::text)));


--
-- Name: barbers Managers can delete barbers in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete barbers in own branches" ON public.barbers FOR DELETE USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: bookings Managers can delete bookings in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete bookings in own branches" ON public.bookings FOR DELETE USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: services Managers can delete services in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete services in own branches" ON public.services FOR DELETE USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: barbers Managers can insert barbers in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert barbers in own branches" ON public.barbers FOR INSERT WITH CHECK ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: bookings Managers can insert bookings in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert bookings in own branches" ON public.bookings FOR INSERT WITH CHECK ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: services Managers can insert services in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert services in own branches" ON public.services FOR INSERT WITH CHECK ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: barbers Managers can update barbers in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update barbers in own branches" ON public.barbers FOR UPDATE USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: bookings Managers can update bookings in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update bookings in own branches" ON public.bookings FOR UPDATE USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: services Managers can update services in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update services in own branches" ON public.services FOR UPDATE USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: barbers Managers can view barbers in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can view barbers in own branches" ON public.barbers FOR SELECT USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: bookings Managers can view bookings in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can view bookings in own branches" ON public.bookings FOR SELECT USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: services Managers can view services in own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can view services in own branches" ON public.services FOR SELECT USING ((branch_id IN ( SELECT public.get_user_branch_ids() AS get_user_branch_ids)));


--
-- Name: notifications Managers insert branch notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers insert branch notifications" ON public.notifications FOR INSERT WITH CHECK ((((recipient_branch_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.branches
  WHERE ((branches.id = notifications.recipient_branch_id) AND (branches.manager_id = auth.uid()))))) OR ((recipient_user_id = auth.uid()) AND (recipient_branch_id IS NULL))));


--
-- Name: notifications Managers view branch notifications secure; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers view branch notifications secure" ON public.notifications FOR SELECT USING ((recipient_branch_id IN ( SELECT branches.id
   FROM public.branches
  WHERE (branches.manager_id = auth.uid()))));


--
-- Name: logs Managers view managed branch logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers view managed branch logs" ON public.logs FOR SELECT USING ((branch_id IN ( SELECT branches.id
   FROM public.branches
  WHERE (branches.manager_id = auth.uid()))));


--
-- Name: areas Public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read access" ON public.areas FOR SELECT USING (true);


--
-- Name: governorates Public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read access" ON public.governorates FOR SELECT USING (true);


--
-- Name: whatsapp_logs Service role can manage whatsapp_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage whatsapp_logs" ON public.whatsapp_logs USING (true) WITH CHECK (true);


--
-- Name: areas Service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access" ON public.areas USING ((auth.role() = 'service_role'::text));


--
-- Name: governorates Service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access" ON public.governorates USING ((auth.role() = 'service_role'::text));


--
-- Name: barbers Service role full access to barbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to barbers" ON public.barbers TO service_role USING (true) WITH CHECK (true);


--
-- Name: bookings Service role full access to bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to bookings" ON public.bookings TO service_role USING (true) WITH CHECK (true);


--
-- Name: branches Service role full access to branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to branches" ON public.branches TO service_role USING (true) WITH CHECK (true);


--
-- Name: customers Service role full access to customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to customers" ON public.customers TO service_role USING (true) WITH CHECK (true);


--
-- Name: rate_limits Service role full access to rate_limits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to rate_limits" ON public.rate_limits TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: booking_reminders Service role full access to reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to reminders" ON public.booking_reminders USING (true) WITH CHECK (true);


--
-- Name: services Service role full access to services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to services" ON public.services TO service_role USING (true) WITH CHECK (true);


--
-- Name: notifications Service role insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role insert notifications" ON public.notifications FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: branches Users can delete own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own branches" ON public.branches FOR DELETE USING ((manager_id = auth.uid()));


--
-- Name: user_notification_preferences Users can delete own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own preferences" ON public.user_notification_preferences FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: branches Users can insert own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own branches" ON public.branches FOR INSERT WITH CHECK ((manager_id = auth.uid()));


--
-- Name: user_notification_preferences Users can insert own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own preferences" ON public.user_notification_preferences FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_settings Users can insert own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: branches Users can update own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own branches" ON public.branches FOR UPDATE USING ((manager_id = auth.uid()));


--
-- Name: user_notification_preferences Users can update own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own preferences" ON public.user_notification_preferences FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_settings Users can update own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: branches Users can view own branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own branches" ON public.branches FOR SELECT USING ((manager_id = auth.uid()));


--
-- Name: user_notification_preferences Users can view own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own preferences" ON public.user_notification_preferences FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_settings Users can view own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notifications Users delete own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE USING (((auth.uid() = recipient_user_id) OR (EXISTS ( SELECT 1
   FROM public.branches
  WHERE ((branches.id = notifications.recipient_branch_id) AND (branches.manager_id = auth.uid()))))));


--
-- Name: logs Users insert own logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own logs" ON public.logs FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: notifications Users update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (((auth.uid() = recipient_user_id) OR (EXISTS ( SELECT 1
   FROM public.branches
  WHERE ((branches.id = notifications.recipient_branch_id) AND (branches.manager_id = auth.uid())))))) WITH CHECK (((auth.uid() = recipient_user_id) OR (EXISTS ( SELECT 1
   FROM public.branches
  WHERE ((branches.id = notifications.recipient_branch_id) AND (branches.manager_id = auth.uid()))))));


--
-- Name: logs Users view own logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own logs" ON public.logs FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: notifications Users view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own notifications" ON public.notifications FOR SELECT USING ((recipient_user_id = auth.uid()));


--
-- Name: admin_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: customers admins_delete_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_delete_customers ON public.customers FOR DELETE USING (public.is_admin());


--
-- Name: customers agents_admins_insert_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agents_admins_insert_customers ON public.customers FOR INSERT WITH CHECK ((public.is_agent() OR public.is_admin()));


--
-- Name: customers agents_admins_update_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agents_admins_update_customers ON public.customers FOR UPDATE USING ((public.is_agent() OR public.is_admin()));


--
-- Name: areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: barbers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: governorates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.governorates ENABLE ROW LEVEL SECURITY;

--
-- Name: logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

--
-- Name: customers managers_barbers_agents_admins_select_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY managers_barbers_agents_admins_select_customers ON public.customers FOR SELECT USING ((public.is_manager() OR public.is_barber() OR public.is_agent() OR public.is_admin()));


--
-- Name: notification_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: suspicious_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suspicious_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: SCHEMA secure; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA secure TO authenticated;


--
-- Name: FUNCTION cancel_booking_reminder(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cancel_booking_reminder() TO anon;
GRANT ALL ON FUNCTION public.cancel_booking_reminder() TO authenticated;
GRANT ALL ON FUNCTION public.cancel_booking_reminder() TO service_role;


--
-- Name: FUNCTION check_auth_rate_limit(p_identifier text, p_max_attempts integer, p_window_seconds integer, p_lockout_seconds integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_auth_rate_limit(p_identifier text, p_max_attempts integer, p_window_seconds integer, p_lockout_seconds integer) TO anon;
GRANT ALL ON FUNCTION public.check_auth_rate_limit(p_identifier text, p_max_attempts integer, p_window_seconds integer, p_lockout_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.check_auth_rate_limit(p_identifier text, p_max_attempts integer, p_window_seconds integer, p_lockout_seconds integer) TO service_role;


--
-- Name: FUNCTION check_booking_conflict(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_booking_conflict() TO anon;
GRANT ALL ON FUNCTION public.check_booking_conflict() TO authenticated;
GRANT ALL ON FUNCTION public.check_booking_conflict() TO service_role;


--
-- Name: FUNCTION cleanup_old_notifications(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_old_notifications() TO anon;
GRANT ALL ON FUNCTION public.cleanup_old_notifications() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_old_notifications() TO service_role;


--
-- Name: FUNCTION cleanup_old_notifications(retention_days integer, batch_size integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_old_notifications(retention_days integer, batch_size integer) TO anon;
GRANT ALL ON FUNCTION public.cleanup_old_notifications(retention_days integer, batch_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_old_notifications(retention_days integer, batch_size integer) TO service_role;


--
-- Name: FUNCTION count_users_by_role(role_filter text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.count_users_by_role(role_filter text) TO anon;
GRANT ALL ON FUNCTION public.count_users_by_role(role_filter text) TO authenticated;
GRANT ALL ON FUNCTION public.count_users_by_role(role_filter text) TO service_role;


--
-- Name: FUNCTION create_booking_reminder(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_booking_reminder() TO anon;
GRANT ALL ON FUNCTION public.create_booking_reminder() TO authenticated;
GRANT ALL ON FUNCTION public.create_booking_reminder() TO service_role;


--
-- Name: FUNCTION detect_suspicious_booking_activity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.detect_suspicious_booking_activity() TO anon;
GRANT ALL ON FUNCTION public.detect_suspicious_booking_activity() TO authenticated;
GRANT ALL ON FUNCTION public.detect_suspicious_booking_activity() TO service_role;


--
-- Name: FUNCTION detect_suspicious_login_activity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.detect_suspicious_login_activity() TO anon;
GRANT ALL ON FUNCTION public.detect_suspicious_login_activity() TO authenticated;
GRANT ALL ON FUNCTION public.detect_suspicious_login_activity() TO service_role;


--
-- Name: FUNCTION get_barber_branch_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_barber_branch_id() TO anon;
GRANT ALL ON FUNCTION public.get_barber_branch_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_barber_branch_id() TO service_role;


--
-- Name: FUNCTION get_manager_by_id(manager_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_manager_by_id(manager_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_manager_by_id(manager_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_manager_by_id(manager_id uuid) TO service_role;


--
-- Name: FUNCTION get_managers(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_managers() TO anon;
GRANT ALL ON FUNCTION public.get_managers() TO authenticated;
GRANT ALL ON FUNCTION public.get_managers() TO service_role;


--
-- Name: FUNCTION get_user_branch_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_user_branch_ids() TO anon;
GRANT ALL ON FUNCTION public.get_user_branch_ids() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_branch_ids() TO service_role;


--
-- Name: FUNCTION increment_customer_booking_count(p_customer_id uuid, p_booking_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_customer_booking_count(p_customer_id uuid, p_booking_date date) TO anon;
GRANT ALL ON FUNCTION public.increment_customer_booking_count(p_customer_id uuid, p_booking_date date) TO authenticated;
GRANT ALL ON FUNCTION public.increment_customer_booking_count(p_customer_id uuid, p_booking_date date) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_agent(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_agent() TO anon;
GRANT ALL ON FUNCTION public.is_agent() TO authenticated;
GRANT ALL ON FUNCTION public.is_agent() TO service_role;


--
-- Name: FUNCTION is_barber(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_barber() TO anon;
GRANT ALL ON FUNCTION public.is_barber() TO authenticated;
GRANT ALL ON FUNCTION public.is_barber() TO service_role;


--
-- Name: FUNCTION is_manager(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_manager() TO anon;
GRANT ALL ON FUNCTION public.is_manager() TO authenticated;
GRANT ALL ON FUNCTION public.is_manager() TO service_role;


--
-- Name: FUNCTION reset_auth_rate_limit(p_identifier text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reset_auth_rate_limit(p_identifier text) TO anon;
GRANT ALL ON FUNCTION public.reset_auth_rate_limit(p_identifier text) TO authenticated;
GRANT ALL ON FUNCTION public.reset_auth_rate_limit(p_identifier text) TO service_role;


--
-- Name: FUNCTION update_customer_booking_stats(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_customer_booking_stats() TO anon;
GRANT ALL ON FUNCTION public.update_customer_booking_stats() TO authenticated;
GRANT ALL ON FUNCTION public.update_customer_booking_stats() TO service_role;


--
-- Name: FUNCTION update_notification_preferences_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_notification_preferences_timestamp() TO anon;
GRANT ALL ON FUNCTION public.update_notification_preferences_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.update_notification_preferences_timestamp() TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION update_whatsapp_conversation_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_whatsapp_conversation_timestamp() TO anon;
GRANT ALL ON FUNCTION public.update_whatsapp_conversation_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.update_whatsapp_conversation_timestamp() TO service_role;


--
-- Name: FUNCTION decrypt_pii(ciphertext text); Type: ACL; Schema: secure; Owner: -
--

GRANT ALL ON FUNCTION secure.decrypt_pii(ciphertext text) TO service_role;


--
-- Name: FUNCTION encrypt_pii(plaintext text); Type: ACL; Schema: secure; Owner: -
--

GRANT ALL ON FUNCTION secure.encrypt_pii(plaintext text) TO service_role;


--
-- Name: FUNCTION mask_pii(value text, pii_type text); Type: ACL; Schema: secure; Owner: -
--

GRANT ALL ON FUNCTION secure.mask_pii(value text, pii_type text) TO authenticated;


--
-- Name: TABLE admin_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_settings TO anon;
GRANT ALL ON TABLE public.admin_settings TO authenticated;
GRANT ALL ON TABLE public.admin_settings TO service_role;


--
-- Name: TABLE areas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.areas TO anon;
GRANT ALL ON TABLE public.areas TO authenticated;
GRANT ALL ON TABLE public.areas TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE barbers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.barbers TO anon;
GRANT ALL ON TABLE public.barbers TO authenticated;
GRANT ALL ON TABLE public.barbers TO service_role;


--
-- Name: TABLE booking_reminders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_reminders TO anon;
GRANT ALL ON TABLE public.booking_reminders TO authenticated;
GRANT ALL ON TABLE public.booking_reminders TO service_role;


--
-- Name: TABLE bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bookings TO anon;
GRANT ALL ON TABLE public.bookings TO authenticated;
GRANT ALL ON TABLE public.bookings TO service_role;


--
-- Name: TABLE branches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.branches TO anon;
GRANT ALL ON TABLE public.branches TO authenticated;
GRANT ALL ON TABLE public.branches TO service_role;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- Name: TABLE governorates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.governorates TO anon;
GRANT ALL ON TABLE public.governorates TO authenticated;
GRANT ALL ON TABLE public.governorates TO service_role;


--
-- Name: TABLE logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.logs TO anon;
GRANT ALL ON TABLE public.logs TO authenticated;
GRANT ALL ON TABLE public.logs TO service_role;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_templates TO anon;
GRANT ALL ON TABLE public.notification_templates TO authenticated;
GRANT ALL ON TABLE public.notification_templates TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limits TO anon;
GRANT ALL ON TABLE public.rate_limits TO authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;


--
-- Name: TABLE services; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.services TO anon;
GRANT ALL ON TABLE public.services TO authenticated;
GRANT ALL ON TABLE public.services TO service_role;


--
-- Name: TABLE suspicious_activities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.suspicious_activities TO anon;
GRANT ALL ON TABLE public.suspicious_activities TO authenticated;
GRANT ALL ON TABLE public.suspicious_activities TO service_role;


--
-- Name: TABLE user_notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_notification_preferences TO anon;
GRANT ALL ON TABLE public.user_notification_preferences TO authenticated;
GRANT ALL ON TABLE public.user_notification_preferences TO service_role;


--
-- Name: TABLE user_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_settings TO anon;
GRANT ALL ON TABLE public.user_settings TO authenticated;
GRANT ALL ON TABLE public.user_settings TO service_role;


--
-- Name: TABLE whatsapp_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_conversations TO anon;
GRANT ALL ON TABLE public.whatsapp_conversations TO authenticated;
GRANT ALL ON TABLE public.whatsapp_conversations TO service_role;


--
-- Name: TABLE whatsapp_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_logs TO anon;
GRANT ALL ON TABLE public.whatsapp_logs TO authenticated;
GRANT ALL ON TABLE public.whatsapp_logs TO service_role;


--
-- Name: TABLE whatsapp_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_messages TO anon;
GRANT ALL ON TABLE public.whatsapp_messages TO authenticated;
GRANT ALL ON TABLE public.whatsapp_messages TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- PostgreSQL database dump complete
--

-- Preserve the production Realtime publication membership without assuming
-- whether the self-hosted Supabase bootstrap created the publication first.
DO $$
DECLARE
  relation_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH relation_name IN ARRAY ARRAY[
      'bookings',
      'notifications',
      'whatsapp_conversations',
      'whatsapp_messages'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = relation_name
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          relation_name
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;
