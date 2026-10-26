import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EDITORIAL, FONTS } from '@/lib/brand';

export interface CoachMarkStep {
  key: string;
  title: string;
  body: string;
  /** The on-screen element the pointer anchors to. Measured when the step shows. */
  target: React.RefObject<View | null>;
  /** Which side of the target the bubble sits on. Default: below. */
  placement?: 'below' | 'above';
  nextDisabled?: boolean;
}

interface Rect { x: number; y: number; width: number; height: number }

/** Convert a target's window measurement into the overlay's local coordinates. */
export function relativeToOverlay(target: Rect, overlay: Rect): Rect {
  return { ...target, x: target.x - overlay.x, y: target.y - overlay.y };
}

interface CoachMarksProps {
  visible: boolean;
  steps: CoachMarkStep[];
  onDone: () => void;
  doneLabel?: string;
  onBeforeStep?: (step: CoachMarkStep) => Promise<void>;
  onStepShown?: (step: CoachMarkStep, index: number) => void;
  onStepLeaving?: () => void;
  /** Native scroll/content/viewport changes can move an already-visible target. */
  layoutVersion?: number;
}

function measureTarget(target: View | null, overlay: View | null, fallback: Rect, show: (bounds: Rect) => void) {
  if (!target || !overlay?.measureInWindow) { show(fallback); return; }
  target.measureInWindow((x, y, width, height) => {
    if (width === 0 || height === 0) { show(fallback); return; }
    overlay.measureInWindow((overlayX, overlayY, overlayW, overlayH) => {
      show(overlayW === 0 || overlayH === 0 ? fallback
        : relativeToOverlay({ x, y, width, height }, { x: overlayX, y: overlayY, width: overlayW, height: overlayH }));
    });
  });
}

const CUTOUT_PAD = 6;
const CUTOUT_RADIUS = 12;
const BUBBLE_GAP = 14;
const BUBBLE_MAX_W = 320;
// Rough bubble height used only to keep it inside the window before layout.
const BUBBLE_EST_H = 170;
const SCRIM = 'rgba(15,31,21,0.55)';

/**
 * Sequential coach marks: a scrim with a cutout around the current target,
 * a dark bubble (same palette as LockedUnlockCard) with a pointer, and
 * Next / Got it. Targets are measured in window coordinates when their step
 * shows; an unavailable target gets an unanchored tip so no lesson is skipped.
 */
export function CoachMarks({ visible, steps, onDone, onStepShown, onStepLeaving, onBeforeStep, layoutVersion = 0, doneLabel = 'Got it' }: CoachMarksProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const overlayRef = useRef<View>(null);
  const [overlayReady, setOverlayReady] = useState(false);
  const moving = useRef(false);
  const [bubbleHeight, setBubbleHeight] = useState(BUBBLE_EST_H);
  const [visited, setVisited] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];
  const stepKey = step?.key;

  useEffect(() => {
    if (visible) { setIndex(0); setVisited([]); }
  }, [visible]);

  useEffect(() => {
    if (!visible || !overlayReady) return;
    if (!step) {
      onDone();
      return;
    }
    setRect(null);
    let cancelled = false;
    // Small delay so a header that just re-rendered has laid out.
    const measure = () => {
      if (cancelled) return;
      const show = (bounds: Rect) => {
        if (cancelled) return;
        moving.current = false;
        setRect(bounds);
        setVisited(previous => previous.includes(index) ? previous : [...previous, index]);
        onStepShown?.(step, index);
      };
      const fallback = { x: winW / 2, y: winH / 2, width: 0, height: 0 };
      // Screen and native Modal window origins can differ.
      measureTarget(step.target.current, overlayRef.current, fallback, show);
    };
    const t = setTimeout(() => {
      if (onBeforeStep) void onBeforeStep(step).then(measure).catch(() => { if (!cancelled) onDone(); });
      else measure();
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // Keyed on the step's key, not the step object or the parent callbacks:
    // parents rebuild step arrays and callbacks on re-render, and re-measuring
    // then would flicker the cutout and double-fire onStepShown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, overlayReady, stepKey, index, winW, winH]);

  const anchored = rect !== null;
  useEffect(() => {
    if (!visible || !overlayReady || !anchored || !step) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      measureTarget(step.target.current, overlayRef.current,
        { x: winW / 2, y: winH / 2, width: 0, height: 0 }, bounds => {
          if (cancelled) return;
          setRect(previous => previous && previous.x === bounds.x && previous.y === bounds.y
            && previous.width === bounds.width && previous.height === bounds.height ? previous : bounds);
        });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
    // Refresh geometry only; parent renders must not restart preparation or demos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, overlayReady, anchored, stepKey, index, layoutVersion, winW, winH]);

  if (!visible || !step) return null;

  const isLast = index === steps.length - 1;
  const next = () => {
    if (step.nextDisabled || moving.current) return;
    moving.current = true;
    onStepLeaving?.();
    if (isLast) onDone();
    else setIndex(index + 1);
  };

  const previous = visited.filter(value => value < index).at(-1);
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
    const safeTop = insets.top + 12;
    const safeBottom = winH - insets.bottom - 16;
    const spaceBelow = safeBottom - (cutout.y + cutout.height);
    const placement = step.placement ?? (spaceBelow >= bubbleHeight + BUBBLE_GAP ? 'below' : 'above');
    const desiredTop = placement === 'below' ? cutout.y + cutout.height + BUBBLE_GAP : cutout.y - BUBBLE_GAP - bubbleHeight;
    const top = Math.max(safeTop, Math.min(desiredTop, safeBottom - bubbleHeight));
    bubbleStyle = { top, left, width: bubbleW };
    arrowStyle = { top: placement === 'below' ? top - 7 : top + bubbleHeight - 7, left: Math.max(left + 12, Math.min(targetCx - 7, left + bubbleW - 26)) };
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <View ref={overlayRef} collapsable={false} testID="coachmark-overlay" onLayout={() => setOverlayReady(true)} style={StyleSheet.absoluteFill} accessibilityViewIsModal>
        {cutout && rect && rect.width > 0 ? (
          <>
            <View accessible={false} testID="coachmark-scrim" style={[s.scrim, { top: 0, left: 0, right: 0, height: cutout.y }]} />
            <View accessible={false} testID="coachmark-scrim" style={[s.scrim, { top: cutout.y + cutout.height, left: 0, right: 0, bottom: 0 }]} />
            <View accessible={false} testID="coachmark-scrim" style={[s.scrim, { top: cutout.y, left: 0, width: cutout.x, height: cutout.height }]} />
            <View accessible={false} testID="coachmark-scrim" style={[s.scrim, { top: cutout.y, left: cutout.x + cutout.width, right: 0, height: cutout.height }]} />
            <View
              pointerEvents="none"
              testID="coachmark-ring"
              style={[s.ring, { top: cutout.y, left: cutout.x, width: cutout.width, height: cutout.height }]}
            />
          </>
        ) : (
          <View accessible={false} testID="coachmark-scrim" style={[s.scrim, StyleSheet.absoluteFill]} />
        )}

        {bubbleStyle && arrowStyle && (
          <>
            {rect && rect.width > 0 && <View pointerEvents="none" style={[s.arrow, arrowStyle]} />}
            {/* The overlay owns the modal boundary; a modal bubble hides its sibling highlight from iOS accessibility. */}
            <ScrollView style={[s.bubble, bubbleStyle, { maxHeight: winH - insets.top - insets.bottom - 28 }]} contentContainerStyle={s.bubbleContent} onContentSizeChange={(_width, h) => setBubbleHeight(Math.min(h, winH - insets.top - insets.bottom - 28))}>
              <View style={s.heading}>
                <Text style={s.counter}>{index + 1} of {steps.length}</Text>
                <Pressable testID="coachmark-skip" onPress={onDone} style={s.textButton} accessibilityRole="button" accessibilityLabel="Skip tour"><Text style={s.skip}>Skip</Text></Pressable>
              </View>
              <Text style={s.title}>{step.title}</Text>
              <Text style={s.body}>{step.body}</Text>
              <View style={s.actions}>
                {previous !== undefined && <Pressable testID="coachmark-back" style={[s.textButton, s.backButton]} onPress={() => { if (moving.current) return; moving.current = true; onStepLeaving?.(); setIndex(previous); }} accessibilityRole="button" accessibilityLabel="Previous tip"><Text style={s.skip}>Back</Text></Pressable>}
                <Pressable
                  style={({ pressed }) => [s.nextBtn, pressed && s.nextBtnPressed]}
                  onPress={next}
                  disabled={step.nextDisabled}
                  accessibilityState={{ disabled: Boolean(step.nextDisabled) }}
                  accessibilityRole="button"
                  testID="coachmark-next"
                  accessibilityLabel={isLast ? doneLabel : 'Next tip'}
                >
                  <Text style={s.nextTxt}>{step.nextDisabled ? 'Finding meals…' : isLast ? doneLabel : 'Next'}</Text>
                </Pressable>
              </View>
            </ScrollView>
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
  },
  bubbleContent: { paddingHorizontal: 18, paddingBottom: 16, paddingTop: 6, gap: 4 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  // Loading changes Next's width; Back must remain a stationary tap target.
  backButton: { marginRight: 'auto' },
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
  nextBtn: { backgroundColor: EDITORIAL.greenAccent, borderRadius: 20, minHeight: 44, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 18 },
  nextBtnPressed: { opacity: 0.85 },
  nextTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, fontWeight: '700', color: EDITORIAL.cream },
});
