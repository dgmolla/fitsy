import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { EDITORIAL } from '@/lib/brand';
import { MACRO_COLORS } from '@/lib/macroColors';

// Compact cause-specific badge for Discovery's empty cards (#1004). 'range' is "we are not
// here yet" (a pin); 'macros' is "your targets are too tight" (three sliders in the macro colors).
const TINT = '#DEECE2';
const TRACK = '#CDDED3';

export function EmptyStateBadge({ kind, size = 56 }: { kind: 'range' | 'macros'; size?: number }) {
  return <View testID={`empty-badge-${kind}`} style={{ width: size, height: size }}>
    <Svg width={size} height={size} viewBox="0 0 56 56">
      <Circle cx="28" cy="28" r="28" fill={TINT} />
      {kind === 'range' ? <>
        <Circle cx="28" cy="29" r="18" fill="none" stroke={EDITORIAL.greenAccent} strokeWidth="1.5" />
        <Circle cx="28" cy="24" r="7" fill={EDITORIAL.green} />
        <Path d="M22.5 27 L33.5 27 L28 37 Z" fill={EDITORIAL.green} />
        <Circle cx="28" cy="23" r="2.6" fill={EDITORIAL.cream} />
      </> : <>
        {[{ y: 18, x: 31, c: MACRO_COLORS.protein }, { y: 28, x: 24, c: MACRO_COLORS.carbs }, { y: 38, x: 34, c: MACRO_COLORS.fat }].map(row => <React.Fragment key={row.y}>
          <Line x1="12" y1={row.y} x2="44" y2={row.y} stroke={TRACK} strokeWidth="2" strokeLinecap="round" />
          <Circle cx={row.x} cy={row.y} r="4.5" fill={row.c} />
        </React.Fragment>)}
      </>}
    </Svg>
  </View>;
}
