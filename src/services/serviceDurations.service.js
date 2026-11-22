import { supabase } from '../lib/supabase';

export async function saveServiceDuration(barberId, serviceId, duration) {
  const { data, error } = await supabase.rpc('set_barber_service_duration', { p_barber: barberId, p_service: serviceId, p_duration: duration });
  if (error) throw error;
  return data;
}
