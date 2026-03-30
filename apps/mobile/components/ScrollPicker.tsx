import React, { useRef, useEffect, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
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
  const scrollRef = useRef<ScrollView>(null);
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
      scrollRef.current?.scrollTo({
        y: idx * itemHeight,
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

  return (
    <View style={[styles.wrapper, { height: pickerHeight }]}>
      {/* Selection highlight */}
      <View
        style={[
          styles.selectionBar,
          {
            top: itemHeight * padRows - 4,
            height: itemHeight + 8,
            backgroundColor: colors.accentBg,
            borderRadius: 14,
          },
        ]}
        pointerEvents="none"
      />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate={0.985}
        contentContainerStyle={{ paddingVertical: itemHeight * padRows }}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        scrollEventThrottle={16}
        nestedScrollEnabled
        onLayout={() => {
          if (!hasInitialScrolled.current) {
            hasInitialScrolled.current = true;
            scrollToIndex(indexForValue(value), false);
          }
        }}
      >
        {values.map((item) => {
          const isSelected = item === value;
          return (
            <View key={item} style={{ height: itemHeight, alignItems: 'center', justifyContent: 'center' }}>
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
        })}
      </ScrollView>
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
    left: 0,
    right: 0,
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
});
