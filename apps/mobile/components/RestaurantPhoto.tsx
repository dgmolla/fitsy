import React, { useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

/** Restaurant imagery is never presented as a verified photo of a dish. */
export function RestaurantPhoto({ uri, name, style, identifyRestaurant = false }: { uri?: string; name: string; style: StyleProp<ImageStyle>; identifyRestaurant?: boolean }) {
  const [failedUri, setFailedUri] = useState<string>();
  if (uri && failedUri !== uri) {
    return <><Image source={{ uri }} style={style} resizeMode="cover" accessibilityLabel={`Photo of ${name}`} onError={() => setFailedUri(uri)} />{identifyRestaurant && <Text style={s.caption}>Restaurant photo</Text>}</>;
  }
  return <View style={[style, s.placeholder]} accessibilityLabel={`Photo unavailable for ${name}`}>
    <Ionicons name="restaurant-outline" size={30} color={EDITORIAL.cream} />
  </View>;
}

const s = StyleSheet.create({
  caption: { position: 'absolute', top: 10, left: 12, zIndex: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.45)', color: EDITORIAL.cream, fontFamily: FONTS.nunitoSans, fontSize: 10 },
  placeholder: { backgroundColor: EDITORIAL.green, alignItems: 'center', paddingTop: 20 },
});
