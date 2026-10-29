import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { usePurchases } from '@/lib/usePurchases';
import { clearWidget, syncWidget, widgetAvailable } from '@/lib/widgetSync';
import { subscribeWidgetUpdates } from '@/lib/widgetEvents';

export function WidgetSync() {
  const { entitled } = usePurchases();
  useEffect(() => {
    if (!widgetAvailable()) return;
    let live = true;
    const update = () => { if (live) void syncWidget(entitled).catch(() => undefined); };
    if (entitled === false) void clearWidget().then(update).catch(() => undefined);
    else update();
    const data = subscribeWidgetUpdates(update);
    const app = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void clearWidget().catch(() => undefined);
      // Supabase holds its auth lock in this callback. Read the session afterwards.
      setTimeout(update, 0);
    });
    return () => { live = false; data(); app.remove(); auth.subscription.unsubscribe(); };
  }, [entitled]);
  return null;
}
