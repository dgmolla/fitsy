import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { EDITORIAL, FONTS } from '@/lib/brand';

export interface CoachMarkStep {
  key: string;
  title: string;
  body: string;
  /** The on-screen element the pointer anchors to. Measured when the step shows. */
  target: React.RefObject<View | null>;
  /** Which side of the target the bubble sits on. Default: below. */
  placement?: 'below' | 'above';
}

interface Rect { x: number; y: number; width: number; height: number }

interface CoachMarksProps {
  visible: boolean;
  steps: CoachMarkStep[];
  onDone: () => void;
  onStepShown?: (step: CoachMarkStep, index: number) => void;
}

const CUTOUT_PAD = 6;
const CUTOUT_RADIUS = 12;
const BUBBLE_GAP = 14;
const BUBBLE_MAX_W = 320;
const SCRIM = 'rgba(15,31,21,0.55)';

/**
 * Sequential coach marks: a scrim with a cutout around the current target,
 * a dark bubble (same palette as LockedUnlockCard) with a pointer, and
 * Next / Got it. Targets are measured in window coordinates when their step
 * shows; a target that isn't mounted is skipped so the tour never blocks.
 */
export function CoachMarks({ visible, steps, onDone, onStepShown }: CoachMarksProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (!step) {
      onDone();
      return;
    }
    setRect(null);
    let cancelled = false;
    // Small delay so a header that just re-rendered has laid out.
    const t = setTimeout(() => {
      const node = step.target.current;
      if (!node) {
        setIndex((i) => i + 1);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        if (width === 0 && height === 0) {
          setIndex((i) => i + 1);
          return;
        }
        setRect({ x, y, width, height });
        onStepShown?.(step, index);
      });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // onStepShown/onDone are callbacks from the parent; re-measuring on their
    // identity would flicker the cutout on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, step, index]);

  if (!visible || !step) return null;

  const isLast = index === steps.length - 1;
  const next = () => {
    if (isLast) onDone();
    else setIndex((i) => i + 1);
  };

  let cutout: Rect | null = null;
  let bubbleStyle: { top?: number; bottom?: number; left: number; width: number } | null = null;
  let arrowStyle: { top?: number; bottom?: number; left: number } | null = null;
  if (rect) {
    cutout = {
      x: Math.max(rect.x - CUTOUT_PAD, 0),
      y: Math.max(rect.y - CUTOUT_PAD, 0),
      width: rect.width + CUTOUT_PAD * 2,
      height: rect.height + CUTOUT_PAD * 2,
    };
    const bubbleW = Math.min(BUBBLE_MAX_W, winW - 32);
    const targetCx = rect.x + rect.width / 2;
    const left = Math.min(Math.max(targetCx - bubbleW / 2, 16), winW - 16 - bubbleW);
    const placement = step.placement ?? 'below';
    if (placement === 'below') {
      const top = cutout.y + cutout.height + BUBBLE_GAP;
      bubbleStyle = { top, left, width: bubbleW };
      arrowStyle = { top: top - 7, left: targetCx - 7 };
    } else {
      const bottom = winH - cutout.y + BUBBLE_GAP;
      bubbleStyle = { bottom, left, width: bubbleW };
      arrowStyle = { bottom: bottom - 7, left: targetCx - 7 };
    }
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
        {cutout ? (
          <>
            <Pressable style={[s.scrim, { top: 0, left: 0, right: 0, height: cutout.y }]} onPress={next} />
            <Pressable style={[s.scrim, { top: cutout.y + cutout.height, left: 0, right: 0, bottom: 0 }]} onPress={next} />
            <Pressable style={[s.scrim, { top: cutout.y, left: 0, width: cutout.x, height: cutout.height }]} onPress={next} />
            <Pressable style={[s.scrim, { top: cutout.y, left: cutout.x + cutout.width, right: 0, height: cutout.height }]} onPress={next} />
            <View
              pointerEvents="none"
              style={[s.ring, { top: cutout.y, left: cutout.x, width: cutout.width, height: cutout.height }]}
            />
          </>
        ) : (
          <Pressable style={[s.scrim, StyleSheet.absoluteFill]} onPress={next} />
        )}

        {bubbleStyle && arrowStyle && (
          <>
            <View pointerEvents="none" style={[s.arrow, arrowStyle]} />
            <View style={[s.bubble, bubbleStyle]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={s.counter}>{index + 1} of {steps.length}</Text>
              <Text style={s.title}>{step.title}</Text>
              <Text style={s.body}>{step.body}</Text>
              <View style={s.actions}>
                {!isLast && (
                  <Pressable onPress={onDone} hitSlop={8} accessibilityRole="button" accessibilityLabel="Skip tour">
                    <Text style={s.skip}>Skip</Text>
                  </Pressable>
                )}
                <Pressable
                  style={({ pressed }) => [s.nextBtn, pressed && s.nextBtnPressed]}
                  onPress={next}
                  accessibilityRole="button"
                  accessibilityLabel={isLast ? 'Got it' : 'Next tip'}
                >
                  <Text style={s.nextTxt}>{isLast ? 'Got it' : 'Next'}</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { position: 'absolute', backgroundColor: SCRIM },
  ring: {
    position: 'absolute',
    borderRadius: CUTOUT_RADIUS,
    borderWidth: 2,
    borderColor: EDITORIAL.cream,
  },
  arrow: {
    position: 'absolute',
    width: 14,
    height: 14,
    backgroundColor: EDITORIAL.text,
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
  },
  bubble: {
    position: 'absolute',
    backgroundColor: EDITORIAL.text,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 4,
  },
  counter: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    color: 'rgba(253,251,247,0.55)',
    textTransform: 'uppercase',
  },
  title: { fontFamily: FONTS.frauncesDisplay, fontSize: 19, color: EDITORIAL.cream, marginTop: 2 },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 13.5, lineHeight: 19, color: 'rgba(253,251,247,0.78)' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 18, marginTop: 12 },
  skip: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, fontWeight: '600', color: 'rgba(253,251,247,0.65)' },
  nextBtn: { backgroundColor: EDITORIAL.greenAccent, borderRadius: 20, paddingVertical: 9, paddingHorizontal: 18 },
  nextBtnPressed: { opacity: 0.85 },
  nextTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, fontWeight: '700', color: EDITORIAL.cream },
});
