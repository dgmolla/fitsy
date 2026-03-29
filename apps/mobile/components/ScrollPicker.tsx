import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/lib/theme';

const DEFAULT_ITEM_HEIGHT = 44;
const DEFAULT_VISIBLE_ITEMS = 5;

interface Props {
  values: number[];
  value: number;
  unit?: string;
  formatItem?: (val: number) => string;
  onChange: (val: number) => void;
  /** Height of each row in the picker. Default: 44 */
  itemHeight?: number;
  /** Number of visible rows (must be odd). Default: 5 */
  visibleItems?: number;
}

export function ScrollPicker({
  values,
  value,
  unit,
  formatItem,
  onChange,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  visibleItems = DEFAULT_VISIBLE_ITEMS,
}: Props) {
  const { colors } = useTheme();
  const listRef = useRef<FlatList<number>>(null);
  const prevValue = useRef(value);
  const hasInitialScrolled = useRef(false);

  const pickerHeight = itemHeight * visibleItems;
  const padRows = Math.floor(visibleItems / 2);

  const indexForValue = useCallback(
    (v: number) => {
      const idx = values.indexOf(v);
      return idx >= 0 ? idx : 0;
    },
    [values],
  );

  const scrollToIndex = useCallback(
    (idx: number, animated: boolean) => {
      listRef.current?.scrollToOffset({
        offset: idx * itemHeight,
        animated,
      });
    },
    [itemHeight],
  );

  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      scrollToIndex(indexForValue(value), true);
    }
  }, [value, indexForValue, scrollToIndex]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.y;
      const idx = Math.round(offset / itemHeight);
      const clampedIdx = Math.max(0, Math.min(idx, values.length - 1));
      const newValue = values[clampedIdx];
      if (newValue !== undefined && newValue !== prevValue.current) {
        prevValue.current = newValue;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(newValue);
      }
    },
    [values, onChange, itemHeight],
  );

  const display = (item: number) => {
    const label = formatItem ? formatItem(item) : String(item);
    return unit ? `${label} ${unit}` : label;
  };

  const getItemLayout = useMemo(
    () => (_: unknown, index: number) => ({
      length: itemHeight,
      offset: itemHeight * index,
      index,
    }),
    [itemHeight],
  );

  return (
    <View style={[styles.wrapper, { height: pickerHeight }]}>
      {/* Selection highlight */}
      <View
        style={[
          styles.selectionBar,
          {
            top: itemHeight * padRows,
            height: itemHeight,
            backgroundColor: colors.accentBg,
            borderRadius: 10,
          },
        ]}
        pointerEvents="none"
      />

      <FlatList
        ref={listRef}
        data={values}
        keyExtractor={(item) => String(item)}
        renderItem={({ item }) => {
          const isSelected = item === value;
          return (
            <View style={{ height: itemHeight, alignItems: 'center', justifyContent: 'center' }}>
              <Text
                style={[
                  styles.itemText,
                  { color: isSelected ? colors.textPrimary : colors.textTertiary },
                  isSelected && styles.itemTextSelected,
                ]}
              >
                {display(item)}
              </Text>
            </View>
          );
        }}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: itemHeight * padRows }}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        getItemLayout={getItemLayout}
        scrollEventThrottle={16}
        onLayout={() => {
          if (!hasInitialScrolled.current) {
            hasInitialScrolled.current = true;
            scrollToIndex(indexForValue(value), false);
          }
        }}
      />

      {/* Top fade */}
      <LinearGradient
        colors={[colors.bg, colors.bg + '00']}
        style={[styles.fadeEdge, { top: 0, height: itemHeight }]}
        pointerEvents="none"
      />
      {/* Bottom fade */}
      <LinearGradient
        colors={[colors.bg + '00', colors.bg]}
        style={[styles.fadeEdge, { bottom: 0, height: itemHeight }]}
        pointerEvents="none"
      />
    </View>
  );
}

/** Generate an array of numbers from min to max with given step */
export function rangeValues(min: number, max: number, step = 1): number[] {
  const items: number[] = [];
  for (let v = min; v <= max; v += step) items.push(v);
  return items;
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
    flex: 1,
  },
  selectionBar: {
    position: 'absolute',
    left: 4,
    right: 4,
    zIndex: 1,
    pointerEvents: 'none',
  },
  itemText: {
    fontSize: 16,
    fontWeight: '400',
  },
  itemTextSelected: {
    fontSize: 20,
    fontWeight: '700',
  },
  fadeEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
  },
});
