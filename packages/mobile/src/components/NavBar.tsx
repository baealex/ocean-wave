import { Pressable, StyleSheet, Text, View } from 'react-native';

import { brand } from '../config/brand';

type NavBarProps = {
  title: string;
  onBack: () => void;
};

export function NavBar({ title, onBack }: NavBarProps) {
  return (
    <View style={styles.navBar}>
      <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={onBack} style={styles.navIconButton}>
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
  navBar: { flexDirection: 'row', alignItems: 'center', minHeight: brand.layout.navBarMinHeight, paddingHorizontal: brand.layout.navBarHorizontalPadding, paddingTop: brand.space.xs, paddingBottom: brand.space.xs },
  navIconButton: { width: brand.control.navButtonSize, height: brand.control.navButtonSize, borderRadius: brand.radius.full, ...brand.components.centeredControl },
  backIconFrame: { width: 28, height: 28, ...brand.components.centeredControl },
  backIconStroke: { width: 13, height: 13, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderColor: brand.colors.text, transform: [{ rotate: '45deg' }] },
  navTitle: { flex: 1, textAlign: 'center', color: brand.colors.text, ...brand.typography.navTitle, paddingHorizontal: brand.space.sm },
});
