import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const VIEW_W = 44;
const VIEW_H = 60;

// Stem: a single quadratic bezier that starts and ends close to the inner
// (content) edge and bows outward through the middle — a parenthesis-like
// arch. Two mirrored copies flank content to read as a laurel wreath wrapped
// around it.
const P0 = { x: 8, y: 56 };
const P1 = { x: 42, y: 30 };
const P2 = { x: 10, y: 4 };

function bezierPoint(t: number): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * P0.x + 2 * mt * t * P1.x + t * t * P2.x,
    y: mt * mt * P0.y + 2 * mt * t * P1.y + t * t * P2.y,
  };
}

function bezierTangentAngle(t: number): number {
  const dx = 2 * (1 - t) * (P1.x - P0.x) + 2 * t * (P2.x - P1.x);
  const dy = 2 * (1 - t) * (P1.y - P0.y) + 2 * t * (P2.y - P1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function stemPath(): string {
  return `M${P0.x},${P0.y} Q${P1.x},${P1.y} ${P2.x},${P2.y}`;
}

function rotatePoint(px: number, py: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: px * cos - py * sin, y: px * sin + py * cos };
}

// A pointed leaf (lens shape) centered at (cx, cy) and rotated by angleDeg,
// with the rotated/translated coordinates baked directly into the path data.
// react-native-svg's iOS renderer doesn't reliably apply `transform` strings
// on <Path> — the fill silently drops and only a hairline of the curve
// survives — so we do the rotation/translation ourselves instead of relying
// on an SVG transform.
function leafPath(cx: number, cy: number, angleDeg: number, length: number, width: number): string {
  const h = length / 2;
  const toAbs = (lx: number, ly: number) => {
    const r = rotatePoint(lx, ly, angleDeg);
    return { x: r.x + cx, y: r.y + cy };
  };
  const start = toAbs(-h, 0);
  const end = toAbs(h, 0);
  const ctrl1 = toAbs(0, -width);
  const ctrl2 = toAbs(0, width);
  return `M${start.x},${start.y} Q${ctrl1.x},${ctrl1.y} ${end.x},${end.y} Q${ctrl2.x},${ctrl2.y} ${start.x},${start.y} Z`;
}

const LEAF_POSITIONS = [0.06, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9];

interface Props {
  color: string;
  mirrored?: boolean;
  size?: number;
}

export function LaurelWreath({ color, mirrored = false, size = 1 }: Props) {
  return (
    <View style={mirrored ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Svg width={VIEW_W * size} height={VIEW_H * size} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <Path d={stemPath()} stroke={color} strokeWidth={1.2} fill="none" strokeLinecap="round" />
        {LEAF_POSITIONS.map((t, i) => {
          const { x, y } = bezierPoint(t);
          const tangent = bezierTangentAngle(t);
          // Leaves taper toward the tip of the branch.
          const taper = 1 - t * 0.55;
          const length = 13 * taper;
          const width = 4.4 * taper;
          // Leaves swing forward off the stem, away from the wreath's center.
          const angle = tangent + 55;
          return <Path key={i} d={leafPath(x, y, angle, length, width)} fill={color} />;
        })}
      </Svg>
    </View>
  );
}
