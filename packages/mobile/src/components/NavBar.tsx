import { Pressable, StyleSheet, Text, View } from 'react-native';

import { brand } from '../config/brand';

type NavBarProps = {
  title: string;
  onBack: () => void;
};

export function NavBar({ title, onBack }: NavBarProps) {
  return (
    <View style={styles.navBar}>
      <Pressable accessibilityLabel="Go back" hitSlop={8} onPress={onBack} style={styles.navIconButton}>
        <BackIcon />
      </Pressable>
      <Text numberOfLines={1} style={styles.navTitle}>{title}</Text>
      <View style={styles.navIconButton} />
    </View>
  );
}

function BackIcon() {
  return (
    <View style={styles.backIconFrame}>
      <View style={styles.backIconStroke} />
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 0, paddingTop: 4, paddingBottom: 4 },
  navIconButton: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 24 },
  backIconFrame: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28 },
  backIconStroke: { width: 13, height: 13, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderColor: brand.text, transform: [{ rotate: '45deg' }] },
  navTitle: { flex: 1, textAlign: 'center', color: brand.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 8 },
});
