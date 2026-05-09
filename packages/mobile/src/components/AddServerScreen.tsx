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
        <TextInput onChangeText={onChangeServerName} placeholder="My Ocean Wave" placeholderTextColor="#71717a" style={styles.input} value={serverName} />
        <Text style={styles.label}>Server URL</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} inputMode="url" onChangeText={onChangeServerUrl} placeholder="http://192.168.0.10:44100" placeholderTextColor="#71717a" style={styles.input} value={serverUrl} />
        <Text style={styles.label}>Password</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={onChangePassword} placeholder="Only if required" placeholderTextColor="#71717a" secureTextEntry style={styles.input} value={password} />
        <Pressable disabled={isLoading} onPress={onSave} style={styles.wideButton}>
          {isLoading ? <ActivityIndicator color={brand.background} /> : <Text style={styles.wideButtonText}>Save and connect</Text>}
        </Pressable>
        <Text style={styles.status}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullPage: { flex: 1, gap: 18, padding: 20, backgroundColor: brand.background },
  header: { gap: 8, paddingTop: 10 },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: brand.text, fontSize: 32, fontWeight: '900', letterSpacing: -1.4 },
  description: { color: brand.muted, fontSize: 15, lineHeight: 22 },
  card: { gap: 12, padding: 14, borderRadius: 22, backgroundColor: brand.surface, borderWidth: 1, borderColor: brand.border },
  label: { color: brand.text, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#111113', borderWidth: 1, borderColor: brand.border, fontSize: 15 },
  wideButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: brand.primary },
  wideButtonText: { color: brand.background, fontSize: 14, fontWeight: '900' },
  status: { color: brand.muted, fontSize: 13, lineHeight: 19 },
});
