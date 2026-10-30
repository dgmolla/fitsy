import React, { useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL } from '@/lib/brand';

/** Restaurant imagery is never presented as a verified photo of a dish. */
export function RestaurantPhoto({ uri, name, style, thumbnail = false }: { uri?: string; name: string; style: StyleProp<ImageStyle>; thumbnail?: boolean }) {
  const [failedUri, setFailedUri] = useState<string>();
  if (uri && failedUri !== uri) {
    return <Image source={{ uri }} style={style} resizeMode="cover" accessibilityLabel={`Photo of ${name}`} onError={() => setFailedUri(uri)} />;
  }
  return <View style={[style, s.placeholder, thumbnail && s.thumbnail]} accessibilityLabel={`Photo unavailable for ${name}`}>
    <Ionicons name="restaurant-outline" size={30} color={EDITORIAL.cream} />
  </View>;
}

const s = StyleSheet.create({
  placeholder: { backgroundColor: EDITORIAL.green, alignItems: 'center', paddingTop: 20 },
  thumbnail: { paddingTop: 0, justifyContent: 'center' },
});
