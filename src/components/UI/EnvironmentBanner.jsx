import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import './EnvironmentBanner.css';

export default function EnvironmentBanner() {
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadBanner = async () => {
      const { data, error } = await supabase
        .from('environment_settings')
        .select('environment, banner_text')
        .eq('id', 'current')
        .eq('enabled', true)
        .maybeSingle();

      if (mounted && !error && data?.environment === 'development') {
        setBanner(data.banner_text);
      }
    };

    loadBanner();

    return () => {
      mounted = false;
    };
  }, []);

  if (!banner) return null;

  return (
    <div className="environment-banner" role="status">
      {banner}
    </div>
  );
}
