import { useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation } from 'expo-router';

/** An async operation may finish, but may only act on the route that began it. */
export function useRouteContinuation() {
  const navigation = useNavigation();
  const generation = useRef(0);
  const cancel = useCallback(() => { generation.current++; }, []);
  useFocusEffect(useCallback(() => cancel, [cancel]));
  const begin = useCallback(() => {
    const started = ++generation.current;
    return () => started === generation.current && navigation.isFocused();
  }, [navigation]);
  return { begin, cancel };
}
