import React, { useRef, useEffect, useCallback } from 'react';
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/lib/theme';

const ITEM_HEIGHT = 42;
const VISIBLE_ITEMS = 5; // 2 above + selected + 2 below
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (val: number) => void;
}

function generateItems(min: number, max: number, step: number): number[] {
  const items: number[] = [];
  for (let v = min; v <= max; v += step) items.push(v);
  return items;
}

function snapToStep(v: number, step: number, min: number, max: number): number {
  const snapped = min + Math.round((v - min) / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

export function MacroScrollPicker({ label, value, min, max, step = 1, unit, onChange }: Props) {
  const { colors } = useTheme();
  const listRef = useRef<FlatList<number>>(null);
  const items = generateItems(min, max, step);
  const prevValue = useRef(value);
  const hasInitialScrolled = useRef(false);

  const scrollToValue = useCallback(
    (v: number, animated: boolean) => {
      const snapped = snapToStep(v, step, min, max);
      const index = Math.round((snapped - min) / step);
      listRef.current?.scrollToOffset({
        offset: index * ITEM_HEIGHT,
        animated,
      });
    },
    [min, max, step],
  );

  // Sync scroll position when value changes externally (e.g. diet style button)
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      scrollToValue(value, true);
    }
  }, [value, scrollToValue]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.y;
      const index = Math.round(offset / ITEM_HEIGHT);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
      const newValue = items[clampedIndex];
      if (newValue !== undefined && newValue !== prevValue.current) {
        prevValue.current = newValue;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(newValue);
      }
    },
    [items, onChange],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bgCard, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>

      <View style={styles.pickerWrap}>
        {/* Selection highlight bar */}
        <View
          style={[
            styles.selectionBar,
            {
              top: ITEM_HEIGHT * 2,
              height: ITEM_HEIGHT,
              backgroundColor: colors.accentBg,
              borderTopColor: colors.accent,
              borderBottomColor: colors.accent,
            },
          ]}
          pointerEvents="none"
        />

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => String(item)}
          renderItem={({ item }) => {
            const isSelected = item === value;
            return (
              <View style={styles.item}>
                <Text
                  style={[
                    styles.itemText,
                    { color: isSelected ? colors.accent : colors.textTertiary },
                    isSelected && styles.itemTextSelected,
                  ]}
                >
                  {item}
                </Text>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          getItemLayout={(_, index) => ({
            length: ITEM_HEIGHT,
            offset: ITEM_HEIGHT * index,
            index,
          })}
          scrollEventThrottle={16}
          onLayout={() => {
            if (!hasInitialScrolled.current) {
              hasInitialScrolled.current = true;
              scrollToValue(value, false);
            }
          }}
        />
      </View>

      <Text style={[styles.unit, { color: colors.accent }]}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  pickerWrap: {
    height: PICKER_HEIGHT,
    width: '100%',
    overflow: 'hidden',
  },
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    zIndex: 1,
    pointerEvents: 'none',
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontSize: 18,
    fontWeight: '400',
  },
  itemTextSelected: {
    fontSize: 26,
    fontWeight: '700',
  },
  unit: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
});
