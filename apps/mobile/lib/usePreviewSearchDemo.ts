import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

const CRAVING = 'pizza';

/** Writes into the real search field; the shared discovery debounce owns fetching. */
export function usePreviewSearchDemo(active: boolean, changeQuery: (query: string) => void, autoDemo = true) {
  const [typing, setTyping] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [searchStep, setSearchStep] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownStep = useRef<string | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    shownStep.current = null;
    setTyping(false);
    setSearchStep(false);
  }, []);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduceMotion(value); }).catch(() => { if (live) setReduceMotion(true); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { live = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (active && autoDemo) changeQuery('');
    else cancel();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [active, autoDemo, changeQuery, cancel]);
  useEffect(() => {
    if (!active || !autoDemo || !searchStep || reduceMotion === null) return;
    changeQuery('');
    if (reduceMotion) { changeQuery(CRAVING); setTyping(false); return; }
    setTyping(true);
    let length = 0;
    const typeLetter = () => {
      length++;
      changeQuery(CRAVING.slice(0, length));
      if (length < CRAVING.length) timer.current = setTimeout(typeLetter, 140);
      else { timer.current = null; setTyping(false); }
    };
    timer.current = setTimeout(typeLetter, 280);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [active, autoDemo, searchStep, reduceMotion, changeQuery]);
  const showStep = useCallback((key: string) => {
    if (shownStep.current === key) return;
    cancel();
    shownStep.current = key;
    if (key === 'search' && autoDemo) { setTyping(true); setSearchStep(true); }
  }, [cancel, autoDemo]);
  const editQuery = useCallback((query: string) => { cancel(); changeQuery(query); }, [cancel, changeQuery]);
  return { typing, showStep, cancel, editQuery };
}
