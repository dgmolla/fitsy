import { StyleSheet } from "react-native";
import { EDITORIAL, FONTS } from "@/lib/brand";

export const filterPopupStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 356,
    maxHeight: "90%",
    borderRadius: 24,
    backgroundColor: EDITORIAL.cream,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 10,
  },

  title: {
    fontFamily: FONTS.frauncesMedium,
    fontSize: 20,
    color: EDITORIAL.green,
    letterSpacing: -0.3,
    marginBottom: 10,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  labelCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  label: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: "600",
    color: EDITORIAL.textMid,
    letterSpacing: -0.2,
  },

  divider: {
    height: 1,
    backgroundColor: EDITORIAL.border,
  },

  applyBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: EDITORIAL.green,
  },
  applyText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: "700",
    color: EDITORIAL.cream,
    letterSpacing: -0.2,
  },
  linkText: { fontFamily: FONTS.nunitoSansSemiBold, color: EDITORIAL.green,
    fontSize: 14, textAlign: 'center', paddingVertical: 12 },
});
