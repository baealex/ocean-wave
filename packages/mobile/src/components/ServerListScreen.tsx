import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ServerProfile } from '../app/serverProfiles';
import { brand } from '../config/brand';

type ServerListScreenProps = {
  profiles: ServerProfile[];
  isLoading: boolean;
  message: string;
  onAddServer: () => void;
  onConnect: (profile: ServerProfile) => void;
  onDelete: (profileId: string) => void;
};

export function ServerListScreen({
  profiles,
  isLoading,
  message,
  onAddServer,
  onConnect,
  onDelete,
}: ServerListScreenProps) {
  return (
    <View style={styles.fullPage}>
      <View style={styles.header}>
        <Text style={styles.kicker}>OCEAN WAVE</Text>
        <Text style={styles.title}>Choose a server</Text>
        <Text style={styles.description}>Pick a saved server, try the local demo, or add your own library.</Text>
      </View>

      <View style={styles.serverList}>
        {profiles.map(profile => (
          <Pressable key={profile.id} disabled={isLoading} onPress={() => onConnect(profile)} style={styles.serverCard}>
            <View style={styles.serverAvatar}><Text style={styles.serverAvatarText}>{profile.isDemo ? 'D' : profile.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.serverCardText}>
              <Text numberOfLines={1} style={styles.serverTitle}>{profile.name}</Text>
              <Text numberOfLines={1} style={styles.serverUrl}>{profile.url}</Text>
            </View>
            {!profile.isDemo ? (
              <Pressable
                hitSlop={10}
                onPress={event => {
                  event.stopPropagation();
                  Alert.alert('Delete server?', profile.name, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(profile.id) },
                  ]);
                }}
                style={styles.deleteButton}
              >
                <TrashIcon />
              </Pressable>
            ) : null}
            <ChevronIcon />
          </Pressable>
        ))}
        <Pressable disabled={isLoading} onPress={onAddServer} style={[styles.serverCard, styles.addServerCard]}>
          <View style={styles.addIcon}><PlusIcon /></View>
          <View style={styles.serverCardText}>
            <Text style={styles.serverTitle}>Add server</Text>
            <Text style={styles.serverUrl}>Save a personal Ocean Wave server.</Text>
          </View>
        </Pressable>
      </View>
      {isLoading ? <ActivityIndicator color={brand.primary} /> : null}
      <Text style={styles.status}>{message}</Text>
    </View>
  );
}

function PlusIcon() {
  return (
    <View style={styles.plusIcon}>
      <View style={styles.plusHorizontal} />
      <View style={styles.plusVertical} />
    </View>
  );
}

function TrashIcon() {
  return (
    <View style={styles.trashIcon}>
      <View style={styles.trashLid} />
      <View style={styles.trashCan} />
    </View>
  );
}

function ChevronIcon() {
  return (
    <View style={styles.chevronIcon}>
      <View style={styles.chevronStroke} />
    </View>
  );
}

const styles = StyleSheet.create({
  fullPage: { flex: 1, gap: 18, padding: 20, backgroundColor: brand.background },
  header: { gap: 8, paddingTop: 10 },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: brand.text, fontSize: 32, fontWeight: '900', letterSpacing: -1.4 },
  description: { color: brand.muted, fontSize: 15, lineHeight: 22 },
  serverList: { gap: 10 },
  serverCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, padding: 14, borderRadius: 20, backgroundColor: brand.surfaceRaised, borderWidth: 1, borderColor: brand.border },
  addServerCard: { borderStyle: 'dashed', backgroundColor: brand.surface },
  serverAvatar: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(139,92,246,0.16)' },
  serverAvatarText: { color: brand.primary, fontSize: 16, fontWeight: '900' },
  addIcon: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 14, backgroundColor: brand.primary },
  plusIcon: { alignItems: 'center', justifyContent: 'center', width: 20, height: 20 },
  plusHorizontal: { position: 'absolute', width: 18, height: 3, borderRadius: 999, backgroundColor: brand.background },
  plusVertical: { position: 'absolute', width: 3, height: 18, borderRadius: 999, backgroundColor: brand.background },
  serverCardText: { flex: 1, minWidth: 0, gap: 3 },
  serverTitle: { color: brand.text, fontSize: 16, fontWeight: '800' },
  serverUrl: { color: brand.muted, fontSize: 12 },
  deleteButton: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 20, backgroundColor: '#27272a' },
  trashIcon: { alignItems: 'center', width: 18, height: 20 },
  trashLid: { width: 14, height: 3, borderRadius: 2, backgroundColor: brand.muted },
  trashCan: { marginTop: 2, width: 13, height: 14, borderWidth: 2, borderTopWidth: 0, borderColor: brand.muted, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  chevronIcon: { alignItems: 'center', justifyContent: 'center', width: 24, height: 40 },
  chevronStroke: { width: 10, height: 10, borderTopWidth: 2, borderRightWidth: 2, borderColor: brand.muted, transform: [{ rotate: '45deg' }] },
  status: { color: brand.muted, fontSize: 13, lineHeight: 19 },
});
