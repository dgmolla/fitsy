import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { EDITORIAL, FONTS } from '@/lib/brand';

const ROW_H = 40;
const VISIBLE_ROWS = 7;
const COLUMN_H = ROW_H * VISIBLE_ROWS;
const PAD = (COLUMN_H - ROW_H) / 2;

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  formatter?: (v: number) => string;
}

export function StatPicker({ min, max, value, onChange, formatter = String }: Props) {
  const data = useMemo(() => {
    const arr: number[] = [];
    for (let v = min; v <= max; v++) arr.push(v);
    return arr;
  }, [min, max]);

  const listRef = useRef<FlatList<number>>(null);
  const lastIdxRef = useRef(value - min);
  const [selectedIdx, setSelectedIdx] = useState(value - min);

  // Re-center when min/value change (e.g., unit toggle).
  useEffect(() => {
    const idx = Math.max(0, Math.min(data.length - 1, value - min));
    listRef.current?.scrollToOffset({ offset: idx * ROW_H, animated: false });
    lastIdxRef.current = idx;
    setSelectedIdx(idx);
  }, [data.length, value, min]);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ROW_H);
    if (idx === lastIdxRef.current) return;
    if (idx < 0 || idx >= data.length) return;
    lastIdxRef.current = idx;
    setSelectedIdx(idx);
    onChange(data[idx]!);
    Haptics.selectionAsync();
  }

  return (
    <View style={s.col}>
      <View pointerEvents="none" style={s.indicator} />

      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => String(item)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW_H}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
        contentContainerStyle={s.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => (
          <View style={s.row}>
            <Text style={[s.num, index === selectedIdx && s.numOn]}>
              {formatter(item)}
            </Text>
          </View>
        )}
      />

      <LinearGradient
        pointerEvents="none"
        colors={[EDITORIAL.cream, 'rgba(253,251,247,0)']}
        style={s.fadeTop}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(253,251,247,0)', EDITORIAL.cream]}
        style={s.fadeBot}
      />
    </View>
  );
}

const s = StyleSheet.create({
  col: {
    width: 96,
    height: COLUMN_H,
    position: 'relative',
  },
  listContent: {
    paddingVertical: PAD,
  },
  row: {
    height: ROW_H,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 14,
  },
  num: {
    fontFamily: FONTS.newsreaderRegular,
    fontSize: 18,
    color: EDITORIAL.textSoft,
    letterSpacing: -0.3,
  },
  numOn: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 22,
    color: EDITORIAL.text,
  },
  indicator: {
    position: 'absolute',
    top: PAD + (ROW_H - 28) / 2,
    left: 0,
    width: 4,
    height: 28,
    backgroundColor: EDITORIAL.greenAccent,
    borderRadius: 2,
    zIndex: 2,
  },
  fadeTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: PAD,
  },
  fadeBot: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: PAD,
  },
});
