import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { hasSeenPreviewTour, markPreviewTourSeen } from './teaserGate';

/** A delayed start belongs to the focused, ready screen, never to an old timer. */
export function usePreviewTour(ready: boolean) {
  const focused = useIsFocused();
  const [seen, setSeen] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    let live = true;
    void hasSeenPreviewTour().then(value => { if (live) setSeen(value); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!ready || !focused) { setVisible(false); return; }
    if (seen !== false || started.current) return;
    const timer = setTimeout(() => {
      Keyboard.dismiss();
      started.current = true;
      setVisible(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [ready, focused, seen]);
  const start = useCallback(() => {
    if (!ready || !focused) return;
    Keyboard.dismiss();
    started.current = true;
    setVisible(true);
  }, [ready, focused]);
  const finish = useCallback(() => {
    markPreviewTourSeen();
    setSeen(true);
    setVisible(false);
  }, []);
  return { visible: visible && ready && focused, start, finish };
}
