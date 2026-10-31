import React, { useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ImageStyle, type ImageRequireSource } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL } from '@/lib/brand';

/** Restaurant imagery is never presented as a verified photo of a dish. */
export function RestaurantPhoto({ uri, source, name, style, thumbnail = false }: { uri?: string; source?: ImageRequireSource; name: string; style: StyleProp<ImageStyle>; thumbnail?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | number>();
  const image = source ?? uri;
  if (image && failedSource !== image) {
    return <Image source={source ?? { uri }} style={style} resizeMode="cover" accessibilityLabel={`Photo of ${name}`} onError={() => setFailedSource(image)} />;
  }
  return <View style={[style, s.placeholder, thumbnail && s.thumbnail]} accessibilityLabel={`Photo unavailable for ${name}`}>
    <Ionicons name="restaurant-outline" size={30} color={EDITORIAL.cream} />
  </View>;
}

const s = StyleSheet.create({
  placeholder: { backgroundColor: EDITORIAL.green, alignItems: 'center', paddingTop: 20 },
  thumbnail: { paddingTop: 0, justifyContent: 'center' },
});
