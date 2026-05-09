import type { GestureResponderEvent } from 'react-native';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Track } from 'react-native-track-player';

import { OceanWaveMusic, OceanWavePlaylist } from '../api/oceanWaveClient';
import { brand } from '../config/brand';
import { formatDuration } from '../utils/time';
import { MiniPlayer } from './MiniPlayer';
import { NavBar } from './NavBar';

type PlaylistPlayerScreenProps = {
  activeTrack?: Track;
  canControlPlayback: boolean;
  displayedActiveTrackId?: string;
  isLoading: boolean;
  isPlaying: boolean;
  library: OceanWaveMusic[];
  playlistName?: string | null;
  playlists: OceanWavePlaylist[];
  progressRatio: number;
  queueLabel: string;
  searchQuery: string;
  selectedPlaylistId?: number | null;
  selectedProfileName?: string | null;
  visibleLibrary: OceanWaveMusic[];
  onBack: () => void;
  onCreatePlaylist: () => void;
  onNext: () => void;
  onOpenPlaylist: (playlistId: number) => void;
  onPlayPlaylist: () => void;
  onPlayTrack: (index: number) => void;
  onPrevious: () => void;
  onProgressLayout: (width: number) => void;
  onSearchQueryChange: (value: string) => void;
  onSeek: (event: GestureResponderEvent) => void;
  onTogglePlayback: () => void;
};

export function PlaylistPlayerScreen({
  activeTrack,
  canControlPlayback,
  displayedActiveTrackId,
  isLoading,
  isPlaying,
  library,
  playlistName,
  playlists,
  progressRatio,
  queueLabel,
  searchQuery,
  selectedPlaylistId,
  selectedProfileName,
  visibleLibrary,
  onBack,
  onCreatePlaylist,
  onNext,
  onOpenPlaylist,
  onPlayPlaylist,
  onPlayTrack,
  onPrevious,
  onProgressLayout,
  onSearchQueryChange,
  onSeek,
  onTogglePlayback,
}: PlaylistPlayerScreenProps) {
  return (
    <View style={styles.playerPage}>
      <NavBar onBack={onBack} title={selectedProfileName ?? 'Ocean Wave'} />

      <View style={styles.playerHeader}>
        <Text style={styles.kicker}>{playlistName ? 'PLAYLIST' : 'PLAYLISTS'}</Text>
        <Text style={styles.playerHeading}>{playlistName ?? 'Choose a playlist'}</Text>
        <Text style={styles.description}>{queueLabel}</Text>
      </View>

      {playlists.length ? (
        <View style={styles.playlistPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.panelLabel}>{playlistName ? 'Switch queue' : 'Choose queue'}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistRail}>
            <Pressable onPress={onCreatePlaylist} style={[styles.playlistChip, styles.addPlaylistChip]}>
              <View style={styles.addPlaylistIcon}>
                <View style={styles.addPlaylistHorizontal} />
                <View style={styles.addPlaylistVertical} />
              </View>
              <Text style={styles.playlistName}>New playlist</Text>
              <Text style={styles.playlistMeta}>Opens web</Text>
            </Pressable>
            {playlists.map(playlist => (
              <Pressable key={playlist.id} disabled={isLoading} onPress={() => onOpenPlaylist(playlist.id)} style={[styles.playlistChip, selectedPlaylistId === playlist.id && styles.playlistChipActive]}>
                <Text numberOfLines={1} style={styles.playlistName}>{playlist.name}</Text>
                <Text style={styles.playlistMeta}>{playlist.musicCount.toLocaleString()} tracks</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {playlistName ? (
        <>
          <View style={styles.playlistActionPanel}>
            <Pressable disabled={!library.length} onPress={onPlayPlaylist} style={[styles.playPlaylistButton, !library.length && styles.disabledButton]}>
              <Text style={styles.playPlaylistIcon}>▶</Text>
              <View style={styles.playPlaylistTextBlock}>
                <Text style={styles.playPlaylistTitle}>Play playlist</Text>
                <Text style={styles.playPlaylistSubtitle}>Starts from the first track and continues in order</Text>
              </View>
            </Pressable>
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={onSearchQueryChange} placeholder="Search in playlist" placeholderTextColor="#71717a" style={styles.searchInput} value={searchQuery} />
          </View>

          <FlatList
            data={visibleLibrary}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading…' : 'No songs in this playlist.'}</Text>}
            renderItem={({ item, index }) => {
              const active = displayedActiveTrackId === String(item.id);
              return (
                <Pressable onPress={() => onPlayTrack(index)} style={[styles.row, active && styles.activeRow]}>
                  <View style={[styles.queueNumber, active && styles.queueNumberActive]}>
                    <Text style={[styles.queueNumberText, active && styles.queueNumberTextActive]}>{active ? '♪' : index + 1}</Text>
                  </View>
                  <View style={styles.rowMain}>
                    <View style={styles.songTitleRow}>
                      <Text numberOfLines={1} style={[styles.songTitle, active && styles.activeText]}>{item.name}</Text>
                      {active ? <Text style={styles.nowBadge}>NOW</Text> : null}
                    </View>
                    <Text numberOfLines={1} style={styles.songMeta}>{item.artist?.name ?? 'Unknown Artist'} · {item.album?.name ?? 'Unknown Album'}</Text>
                  </View>
                  <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
                </Pressable>
              );
            }}
          />
        </>
      ) : (
        <View style={styles.emptyPlaylistState}>
          <Text style={styles.emptyPlaylistTitle}>Choose a playlist</Text>
          <Text style={styles.emptyPlaylistBody}>Create a playlist on the web, then come back here to play it.</Text>
          <Pressable onPress={onCreatePlaylist} style={styles.emptyPlaylistButton}>
            <Text style={styles.emptyPlaylistButtonText}>Open web</Text>
          </Pressable>
        </View>
      )}
      <MiniPlayer
        activeTrack={activeTrack}
        canControlPlayback={canControlPlayback}
        isPlaying={isPlaying}
        onNext={onNext}
        onPrevious={onPrevious}
        onProgressLayout={onProgressLayout}
        onSeek={onSeek}
        onTogglePlayback={onTogglePlayback}
        playlistName={playlistName}
        progressRatio={progressRatio}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  playerPage: { flex: 1, gap: 12, paddingHorizontal: 16, paddingTop: 4, backgroundColor: brand.background },
  kicker: { color: brand.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  description: { color: brand.muted, fontSize: 15, lineHeight: 22 },
  disabledButton: { opacity: 0.42 },
  playerHeader: { gap: 4, paddingHorizontal: 2 },
  playerHeading: { color: brand.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playlistPanel: { gap: 8 },
  panelLabel: { color: brand.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  playlistRail: { gap: 8, paddingRight: 16 },
  playlistChip: { width: 150, gap: 5, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#121214', borderWidth: 1, borderColor: brand.border },
  playlistChipActive: { borderColor: 'rgba(139,92,246,0.75)', backgroundColor: 'rgba(139,92,246,0.14)' },
  addPlaylistChip: { alignItems: 'flex-start', justifyContent: 'center', borderStyle: 'dashed', backgroundColor: '#09090b' },
  addPlaylistIcon: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.16)' },
  addPlaylistHorizontal: { position: 'absolute', width: 14, height: 2.5, borderRadius: 999, backgroundColor: brand.primary },
  addPlaylistVertical: { position: 'absolute', width: 2.5, height: 14, borderRadius: 999, backgroundColor: brand.primary },
  playlistName: { color: brand.text, fontSize: 13, fontWeight: '800' },
  playlistMeta: { color: brand.muted, fontSize: 11 },
  emptyPlaylistState: { gap: 10, padding: 16, borderRadius: 20, backgroundColor: '#121214', borderWidth: 1, borderColor: brand.border },
  emptyPlaylistTitle: { color: brand.text, fontSize: 16, fontWeight: '900' },
  emptyPlaylistBody: { color: brand.muted, fontSize: 13, lineHeight: 20 },
  emptyPlaylistButton: { alignSelf: 'flex-start', minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 14, backgroundColor: 'rgba(139,92,246,0.16)' },
  emptyPlaylistButtonText: { color: brand.primary, fontSize: 12, fontWeight: '900' },
  playlistActionPanel: { gap: 10 },
  playPlaylistButton: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, borderRadius: 18, backgroundColor: brand.primary },
  playPlaylistIcon: { color: brand.background, fontSize: 18, fontWeight: '900' },
  playPlaylistTextBlock: { flex: 1, minWidth: 0, gap: 2 },
  playPlaylistTitle: { color: brand.background, fontSize: 15, fontWeight: '900' },
  playPlaylistSubtitle: { color: 'rgba(9,9,11,0.72)', fontSize: 12, fontWeight: '700' },
  searchInput: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#09090b', borderWidth: 1, borderColor: brand.border },
  listContent: { gap: 8, paddingBottom: 108 },
  empty: { paddingVertical: 36, textAlign: 'center', color: brand.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#09090b', borderWidth: 1, borderColor: '#18181b' },
  activeRow: { borderColor: 'rgba(139,92,246,0.55)', backgroundColor: 'rgba(139,92,246,0.12)' },
  queueNumber: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, backgroundColor: '#18181b' },
  queueNumberActive: { backgroundColor: brand.primary },
  queueNumberText: { color: brand.muted, fontSize: 13, fontWeight: '900' },
  queueNumberTextActive: { color: brand.background, fontSize: 16 },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  songTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  songTitle: { flex: 1, color: brand.text, fontSize: 15, fontWeight: '700' },
  nowBadge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, color: brand.background, backgroundColor: brand.primary, fontSize: 10, fontWeight: '900' },
  activeText: { color: brand.primary },
  songMeta: { color: brand.muted, fontSize: 12 },
  duration: { color: '#71717a', fontSize: 12, fontVariant: ['tabular-nums'] },
});
