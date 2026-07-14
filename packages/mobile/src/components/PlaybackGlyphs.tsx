import { StyleSheet, View } from 'react-native';

import { brand } from '../config/brand';

export function PlayGlyph() {
  return <View style={styles.playGlyph} />;
}

export function PauseGlyph() {
  return (
    <View style={styles.pauseGlyph}>
      <View style={styles.pauseBar} />
      <View style={styles.pauseBar} />
    </View>
  );
}

export function TransportGlyph({ direction }: { direction: 'previous' | 'next' }) {
  const isNext = direction === 'next';

  return (
    <View style={styles.transportGlyph}>
      {!isNext ? <View style={styles.transportBar} /> : null}
      <View style={isNext ? styles.nextTriangle : styles.previousTriangle} />
      {isNext ? <View style={styles.transportBar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  playGlyph: { marginLeft: 3, width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.colors.white },
  pauseGlyph: { flexDirection: 'row', gap: brand.icon.pauseGap },
  pauseBar: { width: 5, height: 18, borderRadius: brand.radius.full, backgroundColor: brand.colors.white },
  transportGlyph: { flexDirection: 'row', alignItems: 'center', gap: brand.icon.transportGap },
  transportBar: { width: 3, height: 16, borderRadius: brand.radius.full, backgroundColor: brand.colors.text },
  previousTriangle: { width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderRightWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: brand.colors.text },
  nextTriangle: { width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderLeftWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: brand.colors.text },
});
