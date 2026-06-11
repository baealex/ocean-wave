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
          <View key={profile.id} style={styles.serverCard}>
            <Pressable
              accessibilityLabel={`Connect to ${profile.name}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: isLoading }}
              disabled={isLoading}
              onPress={() => onConnect(profile)}
              style={({ pressed }) => [styles.serverMainButton, pressed && !isLoading && styles.pressedSurface]}
            >
              <View style={styles.serverAvatar}><Text style={styles.serverAvatarText}>{profile.isDemo ? 'D' : profile.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.serverCardText}>
                <Text numberOfLines={1} style={styles.serverTitle}>{profile.name}</Text>
                <Text numberOfLines={1} style={styles.serverUrl}>{profile.url}</Text>
              </View>
              <ChevronIcon />
            </Pressable>
            {!profile.isDemo ? (
              <Pressable
                accessibilityLabel={`Delete ${profile.name}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: isLoading }}
                disabled={isLoading}
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
          </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: isLoading }} disabled={isLoading} onPress={onAddServer} style={({ pressed }) => [styles.serverCard, styles.addServerCard, pressed && !isLoading && styles.pressedSurface, isLoading && styles.disabledButton]}>
          <View style={styles.addIcon}><PlusIcon /></View>
          <View style={styles.serverCardText}>
            <Text style={styles.serverTitle}>Add server</Text>
            <Text style={styles.serverUrl}>Save a personal Ocean Wave server.</Text>
          </View>
        </Pressable>
      </View>
      {isLoading ? <ActivityIndicator accessibilityLabel="Connecting to server" color={brand.colors.primary} /> : null}
      <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>
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
  fullPage: { flex: 1, gap: brand.space.xl, padding: brand.space.xl, ...brand.components.page },
  header: { gap: brand.space.sm, paddingTop: brand.space.md },
  kicker: { color: brand.colors.primary, ...brand.typography.kicker },
  title: { color: brand.colors.text, ...brand.typography.title },
  description: { color: brand.colors.textMuted, ...brand.typography.body },
  serverList: { gap: brand.space.md },
  serverCard: { flexDirection: 'row', alignItems: 'stretch', minHeight: brand.layout.serverCardMinHeight, overflow: 'hidden', borderRadius: brand.radius.lg, ...brand.components.raisedCard },
  serverMainButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: brand.space.md, paddingVertical: brand.space.lg, paddingLeft: brand.space.lg, paddingRight: brand.space.sm },
  addServerCard: { borderStyle: 'dashed', ...brand.components.surfaceCard },
  disabledButton: { ...brand.components.disabledButton },
  pressedSurface: { ...brand.components.pressedSurface },
  serverAvatar: { width: brand.layout.listArtworkSize, height: brand.layout.listArtworkSize, borderRadius: brand.radius.md, backgroundColor: brand.colors.primarySubtle, ...brand.components.centeredControl },
  serverAvatarText: { color: brand.colors.primary, ...brand.typography.sectionTitle },
  addIcon: { width: brand.layout.listArtworkSize, height: brand.layout.listArtworkSize, borderRadius: brand.radius.md, backgroundColor: brand.colors.primary, ...brand.components.centeredControl },
  plusIcon: { width: 20, height: 20, ...brand.components.centeredControl },
  plusHorizontal: { position: 'absolute', width: 18, height: 3, borderRadius: brand.radius.full, backgroundColor: brand.colors.background },
  plusVertical: { position: 'absolute', width: 3, height: 18, borderRadius: brand.radius.full, backgroundColor: brand.colors.background },
  serverCardText: { flex: 1, minWidth: 0, gap: brand.space.xs },
  serverTitle: { color: brand.colors.text, ...brand.typography.listTitle },
  serverUrl: { color: brand.colors.textMuted, ...brand.typography.caption },
  deleteButton: { alignSelf: 'center', marginRight: brand.space.md, width: brand.control.deleteButtonSize, height: brand.control.deleteButtonSize, borderRadius: brand.radius.full, backgroundColor: brand.colors.border, ...brand.components.centeredControl },
  trashIcon: { alignItems: 'center', width: 18, height: 20 },
  trashLid: { width: 14, height: 3, borderRadius: brand.icon.trashLidRadius, backgroundColor: brand.colors.textMuted },
  trashCan: { marginTop: 2, width: 13, height: 14, borderWidth: 2, borderTopWidth: 0, borderColor: brand.colors.textMuted, borderBottomLeftRadius: brand.icon.trashCanRadius, borderBottomRightRadius: brand.icon.trashCanRadius },
  chevronIcon: { width: 24, height: 40, ...brand.components.centeredControl },
  chevronStroke: { width: 10, height: 10, borderTopWidth: 2, borderRightWidth: 2, borderColor: brand.colors.textMuted, transform: [{ rotate: '45deg' }] },
  status: { color: brand.colors.textMuted, ...brand.typography.status },
});
