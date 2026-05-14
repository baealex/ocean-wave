import { memo, useCallback, useEffect, useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Track } from 'react-native-track-player';

import { albumArtUrl, OceanWaveMusic, OceanWavePlaylist } from '../api/oceanWaveClient';
import { brand } from '../config/brand';
import { SaveOfflinePlaylistProgress } from '../offline/offlinePlaylists';
import { MobileSyncStatus, PlaylistContentState } from '../hooks/usePlaylistLibrary';
import { formatDuration } from '../utils/time';
import { CachedArtwork } from './CachedArtwork';
import { MiniPlayer } from './MiniPlayer';
import { NavBar } from './NavBar';

type PlaylistOfflineUiStatus = 'none' | { state: 'partial' | 'downloaded'; downloaded: number; total: number; failed: number };

type PlaylistPlayerScreenProps = {
  activeTrack?: Track;
  canControlPlayback: boolean;
  displayedActiveTrackId?: string;
  displayedMiniTrack?: Track | { artist?: string; artwork?: string; title?: string };
  hasSelectedPlaylistOfflineUpdate: boolean;
  isLoading: boolean;
  playlistContentState: PlaylistContentState;
  isOfflineSaving: boolean;
  isPlaying: boolean;
  isSelectedPlaylistOffline: boolean;
  selectedOfflineFailureCount: number;
  syncStatus: MobileSyncStatus;
  offlineSaveProgress?: SaveOfflinePlaylistProgress | null;
  playlistName?: string | null;
  playlistOfflineStatuses: Record<number, PlaylistOfflineUiStatus>;
  playlists: OceanWavePlaylist[];
  progressRatio: number;
  searchQuery: string;
  selectedPlaylistId?: number | null;
  selectedProfileName?: string | null;
  serverUrl: string;
  sessionCookie?: string | null;
  showPlaylistSkeleton?: boolean;
  showTrackSkeleton?: boolean;
  visibleLibrary: OceanWaveMusic[];
  onBack: () => void;
  onCreatePlaylist: () => void;
  onNext: () => void;
  onOpenPlaylist: (playlistId: number) => void;
  onPlayTrack: (index: number) => void;
  onPrevious: () => void;
  onProgressLayout: (width: number) => void;
  onSearchQueryChange: (value: string) => void;
  onSeek: (event: GestureResponderEvent) => void;
  onTogglePlayback: () => void;
  onToggleOffline: () => void;
};

export function PlaylistPlayerScreen({
  activeTrack,
  canControlPlayback,
  displayedActiveTrackId,
  displayedMiniTrack,
  hasSelectedPlaylistOfflineUpdate,
  isLoading,
  playlistContentState,
  isOfflineSaving,
  isPlaying,
  isSelectedPlaylistOffline,
  selectedOfflineFailureCount,
  syncStatus,
  offlineSaveProgress,
  playlistName,
  playlistOfflineStatuses,
  playlists,
  progressRatio,
  searchQuery,
  selectedPlaylistId,
  selectedProfileName,
  serverUrl,
  sessionCookie,
  showPlaylistSkeleton = false,
  showTrackSkeleton = false,
  visibleLibrary,
  onBack,
  onCreatePlaylist,
  onNext,
  onOpenPlaylist,
  onPlayTrack,
  onPrevious,
  onProgressLayout,
  onSearchQueryChange,
  onSeek,
  onTogglePlayback,
  onToggleOffline,
}: PlaylistPlayerScreenProps) {
  const offlineButtonLabel = isOfflineSaving
    ? offlineSaveProgress ? `${offlineSaveProgress.completed}/${offlineSaveProgress.total}${offlineSaveProgress.failed ? ` · ${offlineSaveProgress.failed} failed` : ''}` : 'Downloading…'
    : selectedOfflineFailureCount > 0 ? 'Retry' : hasSelectedPlaylistOfflineUpdate ? 'Update' : isSelectedPlaylistOffline ? 'Downloaded' : 'Download';
  const contentLabel = playlistContentState === 'showing-offline'
    ? 'Offline copy'
    : playlistContentState === 'showing-cache' ? 'Cached'
      : playlistContentState === 'refreshing' ? 'Refreshing'
        : playlistContentState === 'failed' && visibleLibrary.length > 0 ? 'Stale data'
          : null;
  const syncLabel = syncStatus === 'idle'
    ? null
    : syncStatus === 'offline' ? 'Offline'
      : syncStatus === 'syncing' ? 'Syncing…'
        : syncStatus === 'synced' ? 'Synced'
          : syncStatus === 'authRequired' ? 'Sign in needed'
            : 'Sync failed';
  const onPlayTrackRef = useRef(onPlayTrack);
  useEffect(() => {
    onPlayTrackRef.current = onPlayTrack;
  }, [onPlayTrack]);
  const handlePlayTrackByIndex = useCallback((index: number) => {
    onPlayTrackRef.current(index);
  }, []);

  return (
    <View style={styles.playerPage}>
      <NavBar onBack={onBack} title={selectedProfileName ?? 'Ocean Wave'} />

      {syncLabel ? (
        <View style={[styles.syncPill, syncStatus === 'synced' && styles.syncPillSynced, syncStatus === 'offline' && styles.syncPillOffline, syncStatus === 'failed' && styles.syncPillFailed, syncStatus === 'authRequired' && styles.syncPillWarning]}>
          <View style={[styles.syncDot, syncStatus === 'synced' && styles.syncDotSynced, syncStatus === 'offline' && styles.syncDotOffline, syncStatus === 'failed' && styles.syncDotFailed, syncStatus === 'authRequired' && styles.syncDotWarning]} />
          <Text style={styles.syncPillText}>{syncLabel}</Text>
        </View>
      ) : null}

      {playlists.length || showPlaylistSkeleton ? (
        <View style={styles.playlistPanel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistRail}>
            {!showPlaylistSkeleton ? <Pressable onPress={onCreatePlaylist} style={[styles.playlistChip, styles.addPlaylistChip]}>
              <View style={styles.addPlaylistIcon}>
                <View style={styles.addPlaylistHorizontal} />
                <View style={styles.addPlaylistVertical} />
              </View>
              <Text style={styles.playlistName}>New playlist</Text>
              <Text style={styles.playlistMeta}>Opens web</Text>
            </Pressable> : null}
            {showPlaylistSkeleton ? Array.from({ length: 3 }).map((_, index) => (
              <View key={`playlist-skeleton-${index}`} style={[styles.playlistChip, styles.skeletonCard]}>
                <View style={[styles.skeletonBlock, styles.skeletonTitle]} />
                <View style={[styles.skeletonBlock, styles.skeletonMeta]} />
                <View style={[styles.skeletonBlock, styles.skeletonBadge]} />
              </View>
            )) : null}
            {playlists.map(playlist => {
              const offlineStatus = playlistOfflineStatuses[playlist.id] ?? 'none';
              const offlineLabel = offlineStatus === 'none'
                ? null
                : offlineStatus.state === 'downloaded' ? `Downloaded ${offlineStatus.downloaded}/${offlineStatus.total}` : `Partial ${offlineStatus.downloaded}/${offlineStatus.total}`;
              const failedLabel = offlineStatus !== 'none' && offlineStatus.failed ? `${offlineStatus.failed} failed` : null;

              return (
                <Pressable key={playlist.id} onPress={() => onOpenPlaylist(playlist.id)} style={[styles.playlistChip, selectedPlaylistId === playlist.id && styles.playlistChipActive]}>
                  <Text numberOfLines={1} style={styles.playlistName}>{playlist.name}</Text>
                  <View style={styles.playlistMetaRow}>
                    <Text style={styles.playlistMeta}>{playlist.musicCount.toLocaleString()} tracks</Text>
                  </View>
                  {offlineLabel ? <Text style={[styles.playlistOfflineBadge, offlineStatus !== 'none' && offlineStatus.state === 'partial' && styles.playlistOfflineBadgePartial]}>{offlineLabel}</Text> : null}
                  {failedLabel ? <Text style={styles.playlistOfflineFailed}>{failedLabel}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {playlistName ? (
        <>
          <View style={styles.playlistStatusRow}>
            {contentLabel ? <Text style={[styles.contentSourceBadge, playlistContentState === 'showing-offline' && styles.contentSourceBadgeOffline, playlistContentState === 'failed' && styles.contentSourceBadgeFailed]}>{contentLabel}</Text> : null}
            {playlistContentState === 'refreshing' ? <Text style={styles.refreshingHint}>Updating in background…</Text> : null}
          </View>
          <View style={styles.playlistActionPanel}>
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={onSearchQueryChange} placeholder="Search in playlist" placeholderTextColor="#71717a" style={styles.searchInput} value={searchQuery} />
            <Pressable accessibilityLabel={selectedOfflineFailureCount > 0 ? 'Retry failed offline downloads' : hasSelectedPlaylistOfflineUpdate ? 'Update downloaded playlist' : isSelectedPlaylistOffline ? 'Remove downloaded playlist' : 'Download playlist for offline playback'} disabled={isOfflineSaving || !visibleLibrary.length} onPress={onToggleOffline} style={[styles.offlineButton, (isOfflineSaving || !visibleLibrary.length) && styles.disabledButton, isSelectedPlaylistOffline && styles.offlineButtonSaved]}>
              <Text style={[styles.offlineButtonText, isSelectedPlaylistOffline && styles.offlineButtonTextSaved]}>{offlineButtonLabel}</Text>
            </Pressable>
          </View>

          <FlatList
            data={visibleLibrary}
            getItemLayout={(_, index) => ({ length: 92, offset: 92 * index, index })}
            initialNumToRender={8}
            keyExtractor={item => String(item.id)}
            maxToRenderPerBatch={8}
            removeClippedSubviews
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={showTrackSkeleton ? <TrackListSkeleton /> : <Text style={styles.empty}>{isLoading ? 'Loading…' : 'No songs in this playlist.'}</Text>}
            renderItem={({ item, index }) => (
              <PlaylistTrackRow
                active={displayedActiveTrackId === String(item.id)}
                index={index}
                item={item}
                onPlayTrack={handlePlayTrackByIndex}
                serverUrl={serverUrl}
                sessionCookie={sessionCookie}
              />
            )}
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
        activeTrack={displayedMiniTrack ?? activeTrack}
        canControlPlayback={canControlPlayback}
        isPlaying={isPlaying}
        onNext={onNext}
        onPrevious={onPrevious}
        onProgressLayout={onProgressLayout}
        onSeek={onSeek}
        onTogglePlayback={onTogglePlayback}
        playlistName={playlistName}
        progressRatio={progressRatio}
        sessionCookie={sessionCookie}
      />
    </View>
  );
}


type PlaylistTrackRowProps = {
  active: boolean;
  index: number;
  item: OceanWaveMusic;
  onPlayTrack: (index: number) => void;
  serverUrl: string;
  sessionCookie?: string | null;
};

const PlaylistTrackRow = memo(function PlaylistTrackRow({
  active,
  index,
  item,
  onPlayTrack,
  serverUrl,
  sessionCookie,
}: PlaylistTrackRowProps) {
  return (
    <Pressable onPress={() => onPlayTrack(index)} style={[styles.row, active && styles.activeRow]}>
      <CachedArtwork active={active} cookie={sessionCookie} uri={albumArtUrl(serverUrl, item.album?.cover)} />
      <View style={styles.rowMain}>
        <View style={styles.songTitleRow}>
          <Text numberOfLines={1} style={[styles.songTitle, active && styles.activeText]}>{item.name}</Text>
        </View>
        <Text numberOfLines={1} style={styles.songMeta}>{item.artist?.name ?? 'Unknown Artist'} · {item.album?.name ?? 'Unknown Album'}</Text>
      </View>
      <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
    </Pressable>
  );
});

function TrackListSkeleton() {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: 7 }).map((_, index) => (
        <View key={`track-skeleton-${index}`} style={[styles.row, styles.skeletonRow]}>
          <View style={[styles.skeletonBlock, styles.skeletonArtwork]} />
          <View style={styles.skeletonRowMain}>
            <View style={[styles.skeletonBlock, styles.skeletonTrackTitle]} />
            <View style={[styles.skeletonBlock, styles.skeletonTrackMeta]} />
          </View>
          <View style={[styles.skeletonBlock, styles.skeletonDuration]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  playerPage: { flex: 1, gap: 12, paddingHorizontal: 16, paddingTop: 4, backgroundColor: brand.background },
  disabledButton: { opacity: 0.42 },
  syncPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(139,92,246,0.12)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.22)' },
  syncPillSynced: { backgroundColor: 'rgba(16,185,129,0.11)', borderColor: 'rgba(16,185,129,0.22)' },
  syncPillOffline: { backgroundColor: 'rgba(113,113,122,0.14)', borderColor: 'rgba(161,161,170,0.18)' },
  syncPillFailed: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.22)' },
  syncPillWarning: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.22)' },
  syncDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: brand.primary },
  syncDotSynced: { backgroundColor: '#34d399' },
  syncDotOffline: { backgroundColor: '#a1a1aa' },
  syncDotFailed: { backgroundColor: '#f87171' },
  syncDotWarning: { backgroundColor: '#fbbf24' },
  syncPillText: { color: brand.text, fontSize: 11, fontWeight: '800' },
  playlistPanel: { gap: 8 },
  playlistRail: { gap: 8, paddingRight: 16 },
  playlistChip: { width: 150, gap: 5, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#121214', borderWidth: 1, borderColor: brand.border },
  playlistChipActive: { borderColor: 'rgba(139,92,246,0.75)', backgroundColor: 'rgba(139,92,246,0.14)' },
  addPlaylistChip: { alignItems: 'flex-start', justifyContent: 'center', borderStyle: 'dashed', backgroundColor: '#09090b' },
  addPlaylistIcon: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.16)' },
  addPlaylistHorizontal: { position: 'absolute', width: 14, height: 2.5, borderRadius: 999, backgroundColor: brand.primary },
  addPlaylistVertical: { position: 'absolute', width: 2.5, height: 14, borderRadius: 999, backgroundColor: brand.primary },
  playlistName: { color: brand.text, fontSize: 13, fontWeight: '800' },
  playlistMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playlistMeta: { color: brand.muted, fontSize: 11 },
  playlistOfflineBadge: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(16,185,129,0.16)', color: '#34d399', fontSize: 9, fontWeight: '900' },
  playlistOfflineBadgePartial: { backgroundColor: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  playlistOfflineFailed: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(239,68,68,0.14)', color: '#f87171', fontSize: 9, fontWeight: '900' },
  emptyPlaylistState: { gap: 10, padding: 16, borderRadius: 20, backgroundColor: '#121214', borderWidth: 1, borderColor: brand.border },
  emptyPlaylistTitle: { color: brand.text, fontSize: 16, fontWeight: '900' },
  emptyPlaylistBody: { color: brand.muted, fontSize: 13, lineHeight: 20 },
  emptyPlaylistButton: { alignSelf: 'flex-start', minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 14, backgroundColor: 'rgba(139,92,246,0.16)' },
  emptyPlaylistButtonText: { color: brand.primary, fontSize: 12, fontWeight: '900' },
  playlistActionPanel: { flexDirection: 'row', gap: 8 },
  playlistStatusRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  contentSourceBadge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(139,92,246,0.14)', color: brand.primary, fontSize: 10, fontWeight: '900' },
  contentSourceBadgeOffline: { backgroundColor: 'rgba(16,185,129,0.14)', color: '#34d399' },
  contentSourceBadgeFailed: { backgroundColor: 'rgba(245,158,11,0.14)', color: '#fbbf24' },
  refreshingHint: { color: brand.muted, fontSize: 11, fontWeight: '700' },
  searchInput: { flex: 1, minHeight: 42, borderRadius: 14, paddingHorizontal: 14, color: brand.text, backgroundColor: '#09090b', borderWidth: 1, borderColor: brand.border },
  offlineButton: { minWidth: 112, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingHorizontal: 12, backgroundColor: 'rgba(139,92,246,0.16)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.32)' },
  offlineButtonSaved: { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: 'rgba(16,185,129,0.34)' },
  offlineButtonText: { color: brand.primary, fontSize: 12, fontWeight: '900' },
  offlineButtonTextSaved: { color: '#34d399' },
  listContent: { gap: 8, paddingBottom: 108 },
  empty: { paddingVertical: 36, textAlign: 'center', color: brand.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#09090b', borderWidth: 1, borderColor: '#18181b' },
  activeRow: { borderColor: 'rgba(139,92,246,0.55)', backgroundColor: 'rgba(139,92,246,0.12)' },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  songTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  songTitle: { flex: 1, color: brand.text, fontSize: 15, fontWeight: '700' },
  activeText: { color: brand.primary },
  songMeta: { color: brand.muted, fontSize: 12 },
  duration: { color: '#71717a', fontSize: 12, fontVariant: ['tabular-nums'] },
  skeletonArtwork: { width: 44, height: 44, borderRadius: 12 },
  skeletonBadge: { width: 74, height: 17, borderRadius: 999 },
  skeletonBlock: { backgroundColor: '#27272a', opacity: 0.72 },
  skeletonCard: { justifyContent: 'center' },
  skeletonDuration: { width: 34, height: 12, borderRadius: 999 },
  skeletonList: { gap: 8, paddingVertical: 2 },
  skeletonMeta: { width: 62, height: 11, borderRadius: 999 },
  skeletonRow: { borderColor: '#18181b' },
  skeletonRowMain: { flex: 1, gap: 8 },
  skeletonTitle: { width: 104, height: 13, borderRadius: 999 },
  skeletonTrackMeta: { width: '62%', height: 12, borderRadius: 999 },
  skeletonTrackTitle: { width: '84%', height: 15, borderRadius: 999 },
});
