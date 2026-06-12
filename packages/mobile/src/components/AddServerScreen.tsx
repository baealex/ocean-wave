import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { brand } from '../config/brand';

type AddServerScreenProps = {
  header: ReactNode;
  isLoading: boolean;
  message: string;
  password: string;
  serverName: string;
  serverUrl: string;
  onChangePassword: (value: string) => void;
  onChangeServerName: (value: string) => void;
  onChangeServerUrl: (value: string) => void;
  onSave: () => void;
};

export function AddServerScreen({
  header,
  isLoading,
  message,
  password,
  serverName,
  serverUrl,
  onChangePassword,
  onChangeServerName,
  onChangeServerUrl,
  onSave,
}: AddServerScreenProps) {
  return (
    <View style={styles.fullPage}>
      {header}
      <View style={styles.header}>
        <Text style={styles.kicker}>SERVER</Text>
        <Text style={styles.title}>Add your library</Text>
        <Text style={styles.description}>Connect once. If the server needs a password, this app saves the authenticated session.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <TextInput accessibilityLabel="Server name" onChangeText={onChangeServerName} placeholder="Server name" placeholderTextColor={brand.colors.textSubtle} style={styles.input} value={serverName} />
        <Text style={styles.label}>Server URL</Text>
        <TextInput accessibilityLabel="Server URL" autoCapitalize="none" autoCorrect={false} inputMode="url" onChangeText={onChangeServerUrl} placeholder="Enter server URL" placeholderTextColor={brand.colors.textSubtle} style={styles.input} value={serverUrl} />
        <Text style={styles.label}>Password</Text>
        <TextInput accessibilityLabel="Password" autoCapitalize="none" autoCorrect={false} onChangeText={onChangePassword} placeholder="Only if required" placeholderTextColor={brand.colors.textSubtle} secureTextEntry style={styles.input} value={password} />
        <Pressable
          accessibilityLabel={isLoading ? 'Saving server' : 'Save and connect'}
          accessibilityRole="button"
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
          disabled={isLoading}
          onPress={onSave}
          style={[styles.wideButton, isLoading && styles.disabledButton]}
        >
          {isLoading ? <ActivityIndicator accessibilityLabel="Saving server" color={brand.colors.background} /> : <Text style={styles.wideButtonText}>Save and connect</Text>}
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullPage: { flex: 1, gap: brand.space.xl, padding: brand.space.xl, ...brand.components.page },
  header: { gap: brand.space.sm, paddingTop: brand.space.md },
  kicker: { color: brand.colors.primary, ...brand.typography.kicker },
  title: { color: brand.colors.text, ...brand.typography.title },
  description: { color: brand.colors.textMuted, ...brand.typography.body },
  card: { gap: brand.space.md, padding: brand.space.lg, borderRadius: brand.radius.xl, ...brand.components.surfaceCard },
  label: { color: brand.colors.text, ...brand.typography.label },
  input: { minHeight: brand.control.buttonHeightPrimary, borderRadius: brand.radius.md, paddingHorizontal: brand.space.lg, color: brand.colors.text, ...brand.components.inputSurface, ...brand.typography.body },
  wideButton: { minHeight: brand.control.buttonHeightPrimary, borderRadius: brand.radius.md, ...brand.components.primaryButton },
  disabledButton: { ...brand.components.disabledButton },
  wideButtonText: { color: brand.colors.background, ...brand.typography.buttonLabel },
  status: { color: brand.colors.textMuted, ...brand.typography.status },
});
