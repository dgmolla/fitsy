import { StyleSheet } from 'react-native';
import { EDITORIAL, FONTS } from '@/lib/brand';
const HERO_H = 320;
const DISH_CARD_H = 138;

export const s = StyleSheet.create({
  previewTourButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: EDITORIAL.creamCard },
  previewIntro: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 8, gap: 7 },
  previewHint: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 19, color: EDITORIAL.textMid },
  previewLink: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, lineHeight: 20, color: EDITORIAL.green },
  previewBack: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 18 },
  masthead: {
    backgroundColor: EDITORIAL.cream,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  mastheadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: EDITORIAL.green },
  logo: {
    fontSize: 24,
    fontFamily: FONTS.frauncesDisplayBold,
    color: EDITORIAL.green,
    letterSpacing: -0.6,
  },
  locationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: EDITORIAL.border,
  },
  locationText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: EDITORIAL.textSoft },
  issueLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 10, fontWeight: '700', color: EDITORIAL.textSoft,
    letterSpacing: 2.5, textTransform: 'uppercase',
  },

  // Macro target strip: a row of `value / label` columns separated by hairlines,
  // capped on the right by an Edit pill. Layout principles:
  //  - The whole row is `alignItems: 'stretch'` so dividers can fill the
  //    available height without hard-coded numbers - the strip's intrinsic
  //    height comes from the tallest child (the Edit pill).
  //  - Each column is its own flex unit; `justifyContent: 'center'` keeps the
  //    value+label pair vertically centered against the pill.
  //  - Edit pill height is set via paddingVertical so it dictates strip height.
  // Macro target strip - value + label per macro, hairline dividers, Edit
  // pill on the right. Mirrors the original v3 layout: substantial values,
  // readable labels, tall dividers that frame each column, Edit button
  // sized as a proper pill rather than a chip.
  // Macro strip: row aligned center so each child takes its natural height
  // (column = val+lbl ≈ 28pt; Edit pill matches via explicit padding). Strip
  // padding adds a uniform 6pt breathing room on all sides.
  macroStrip: {
    flexDirection: 'row', alignItems: 'center',
    // Lighter than the search bar (creamCard) so the two stacked rows don't
    // read as one redundant block - the strip's border + dividers keep it
    // delineated against the page.
    backgroundColor: EDITORIAL.cream,
    borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.border,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  macroItem: { flex: 1, alignItems: 'center', gap: 0 },
  macroVal: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 12,
    color: EDITORIAL.text,
  },
  macroLbl: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 9,
    color: EDITORIAL.textSoft,
    letterSpacing: 0.3,
  },
  macroDivider: { width: 1, height: 20, backgroundColor: EDITORIAL.creamDeep },
  editBtn: {
    backgroundColor: EDITORIAL.green, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8,
  },
  editBtnText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    color: EDITORIAL.cream,
    letterSpacing: 0.2,
  },

  // Collapsed icon pill - compact, left-aligned (auto width, not a full row).
  // Search row - matches the restaurant detail screen's menu search input
  // (app/restaurant/[id].tsx): ⌕ glyph + × clear, creamCard pill, radius 14.
  search: {
    marginHorizontal: 18, marginBottom: 8,
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1, borderColor: EDITORIAL.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  searchIco: { fontFamily: FONTS.nunitoSans, fontSize: 16, color: EDITORIAL.textSoft },
  searchInput: { fontFamily: FONTS.nunitoSans, flex: 1, fontSize: 13.5, lineHeight: 20, minHeight: 24, color: EDITORIAL.text, padding: 0, textAlignVertical: 'center' },
  searchClear: { fontFamily: FONTS.nunitoSans, fontSize: 18, color: EDITORIAL.textSoft, paddingHorizontal: 4 },

  restSection: { marginTop: 22 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, marginBottom: 10,
  },
  sectionIndex: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 32, color: EDITORIAL.creamDeep,
    lineHeight: 34, letterSpacing: -1,
  },
  sectionTitleBlock: { flex: 1 },
  sectionRestName: {
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 20, color: EDITORIAL.text, letterSpacing: -0.5, lineHeight: 24,
  },
  sectionSub: { fontFamily: FONTS.nunitoSans, fontSize: 11, fontWeight: '500', color: EDITORIAL.textSoft, marginTop: 2 },
  viewMenu: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: EDITORIAL.greenAccent, paddingHorizontal: 20, marginTop: 6 },

  lockedCard: { marginHorizontal: 16, marginTop: 22, marginBottom: 6 },

  lockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 18, marginBottom: 4,
    backgroundColor: EDITORIAL.creamDeep, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  lockedBannerText: { flex: 1, fontFamily: FONTS.nunitoSans, fontSize: 12.5, color: EDITORIAL.text, lineHeight: 17 },

  inlineEmpty: { alignItems: 'center', paddingTop: 50, paddingBottom: 30, gap: 8 },
  inlineEmptyText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, fontWeight: '600', color: EDITORIAL.textSoft },
  inlineEmptyHint: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft, textAlign: 'center', lineHeight: 20 },
  waitlistBtn: {
    marginTop: 12,
    backgroundColor: EDITORIAL.green,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  waitlistBtnPressed: { opacity: 0.85 },
  waitlistBtnText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, fontWeight: '700', color: EDITORIAL.cream },
  footerSpinner: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    marginHorizontal: 16, marginTop: 16, borderRadius: 8, padding: 12,
    backgroundColor: '#FEF2F2',
  },
  errorText: { fontFamily: FONTS.nunitoSans, fontSize: 14, textAlign: 'center', color: '#DC2626' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontFamily: FONTS.nunitoSans, fontSize: 16, fontWeight: '500', color: EDITORIAL.textSoft },
});

export const hero = StyleSheet.create({
  container: {
    height: HERO_H,
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
    marginTop: 4,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: HERO_H * 0.75 },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, gap: 4 },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
  },
  indexBadge: {
    backgroundColor: 'rgba(253,251,247,0.22)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  indexText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '800', color: 'rgba(253,251,247,0.95)', letterSpacing: 0.5 },
  badgeRow: { flexDirection: 'row', gap: 4 },
  badge: {
    backgroundColor: 'rgba(253,251,247,0.18)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 9, fontWeight: '700', color: 'rgba(253,251,247,0.9)', letterSpacing: 1 },
  distText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.65)', marginLeft: 'auto' },
  restName: {
    // Heavier display cut on the photo overlay - the 450 weight reads thin
    // against busy hero images, so use the 600 we already bake for splashes.
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 28, color: EDITORIAL.cream, letterSpacing: -0.8, lineHeight: 32,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dishName: {
    // Italic serif gives the editorial accent the webapp uses for the dish.
    fontFamily: FONTS.newsreaderItalic,
    fontSize: 17, color: 'rgba(253,251,247,0.92)', letterSpacing: -0.2,
    fontStyle: 'italic',
  },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  macroText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.6)' },
  dot: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: 'rgba(253,251,247,0.3)' },
  calText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '700', color: 'rgba(253,251,247,0.88)' },

  lockedWrap: { marginTop: 4, height: 34, justifyContent: 'center', gap: 5, overflow: 'hidden', borderRadius: 6 },
  lockedBarWide: { width: '55%', height: 14, borderRadius: 4, backgroundColor: 'rgba(253,251,247,0.55)' },
  lockedBarNarrow: { width: '35%', height: 10, borderRadius: 3, backgroundColor: 'rgba(253,251,247,0.4)' },
});

export const dc = StyleSheet.create({
  container: {
    height: DISH_CARD_H, borderRadius: 16, overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
    marginHorizontal: 16,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: DISH_CARD_H * 0.9 },
  info: { position: 'absolute', bottom: 12, left: 14, right: 14 },
  dishName: {
    // Heavier display cut + slight shadow so dish copy stays readable against
    // busy food photos.
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 16, color: EDITORIAL.cream, letterSpacing: -0.3, lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cal: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11, color: 'rgba(253,251,247,0.85)', marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  lockedWrap: { height: 34, justifyContent: 'center', gap: 5, overflow: 'hidden', borderRadius: 6 },
  lockedBarWide: { width: '65%', height: 14, borderRadius: 4, backgroundColor: 'rgba(253,251,247,0.55)' },
  lockedBarNarrow: { width: '45%', height: 10, borderRadius: 3, backgroundColor: 'rgba(253,251,247,0.4)' },

});
