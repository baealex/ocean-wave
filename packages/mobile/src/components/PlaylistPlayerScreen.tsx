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
  onSeekByStep: (direction: 'backward' | 'forward') => void;
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
  onSeekByStep,
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
        <View accessibilityLiveRegion="polite" style={[styles.syncPill, syncStatus === 'synced' && styles.syncPillSynced, syncStatus === 'offline' && styles.syncPillOffline, syncStatus === 'failed' && styles.syncPillFailed, syncStatus === 'authRequired' && styles.syncPillWarning]}>
          <View style={[styles.syncDot, syncStatus === 'synced' && styles.syncDotSynced, syncStatus === 'offline' && styles.syncDotOffline, syncStatus === 'failed' && styles.syncDotFailed, syncStatus === 'authRequired' && styles.syncDotWarning]} />
          <Text style={styles.syncPillText}>{syncLabel}</Text>
        </View>
      ) : null}

      {playlists.length || showPlaylistSkeleton ? (
        <View style={styles.playlistPanel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistRail}>
            {!showPlaylistSkeleton ? <Pressable accessibilityRole="button" onPress={onCreatePlaylist} style={({ pressed }) => [styles.playlistChip, styles.addPlaylistChip, pressed && styles.pressedSurface]}>
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
                <Pressable
                  key={playlist.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedPlaylistId === playlist.id }}
                  onPress={() => onOpenPlaylist(playlist.id)}
                  style={({ pressed }) => [styles.playlistChip, selectedPlaylistId === playlist.id && styles.playlistChipActive, pressed && styles.pressedSurface]}>
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
          <View accessibilityLiveRegion="polite" style={styles.playlistStatusRow}>
            {contentLabel ? <Text style={[styles.contentSourceBadge, playlistContentState === 'showing-offline' && styles.contentSourceBadgeOffline, playlistContentState === 'failed' && styles.contentSourceBadgeFailed]}>{contentLabel}</Text> : null}
            {playlistContentState === 'refreshing' ? <Text style={styles.refreshingHint}>Updating in background…</Text> : null}
          </View>
          <View style={styles.playlistActionPanel}>
            <TextInput accessibilityLabel="Search in playlist" autoCapitalize="none" autoCorrect={false} onChangeText={onSearchQueryChange} placeholder="Search in playlist" placeholderTextColor={brand.colors.textSubtle} style={styles.searchInput} value={searchQuery} />
            <Pressable accessibilityLabel={selectedOfflineFailureCount > 0 ? 'Retry failed offline downloads' : hasSelectedPlaylistOfflineUpdate ? 'Update downloaded playlist' : isSelectedPlaylistOffline ? 'Remove downloaded playlist' : 'Download playlist for offline playback'} accessibilityRole="button" accessibilityState={{ disabled: isOfflineSaving || !visibleLibrary.length, busy: isOfflineSaving, selected: isSelectedPlaylistOffline }} disabled={isOfflineSaving || !visibleLibrary.length} onPress={onToggleOffline} style={({ pressed }) => [styles.offlineButton, (isOfflineSaving || !visibleLibrary.length) && styles.disabledButton, isSelectedPlaylistOffline && styles.offlineButtonSaved, pressed && !isOfflineSaving && visibleLibrary.length > 0 && styles.pressedSurface]}>
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
          <Pressable accessibilityRole="button" onPress={onCreatePlaylist} style={({ pressed }) => [styles.emptyPlaylistButton, pressed && styles.pressedSurface]}>
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
        onSeekByStep={onSeekByStep}
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
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onPlayTrack(index)} style={({ pressed }) => [styles.row, active && styles.activeRow, pressed && styles.pressedSurface]}>
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
  playerPage: { flex: 1, gap: brand.space.md, paddingHorizontal: brand.space.lg, paddingTop: brand.space.xs, ...brand.components.page },
  disabledButton: { ...brand.components.disabledButton },
  pressedSurface: { ...brand.components.pressedSurface },
  syncPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: brand.space.sm, paddingVertical: brand.space.xs, paddingHorizontal: brand.space.md, borderRadius: brand.radius.full, backgroundColor: brand.colors.neutralWash, borderWidth: 1, borderColor: brand.colors.neutralBorder },
  syncPillSynced: { backgroundColor: brand.colors.successWash, borderColor: brand.colors.successBorder },
  syncPillOffline: { backgroundColor: brand.colors.neutralWash, borderColor: brand.colors.neutralBorder },
  syncPillFailed: { backgroundColor: brand.colors.dangerWash, borderColor: brand.colors.dangerBorder },
  syncPillWarning: { backgroundColor: brand.colors.warningWash, borderColor: brand.colors.warningBorder },
  syncDot: { width: brand.layout.syncDotSize, height: brand.layout.syncDotSize, borderRadius: brand.radius.full, backgroundColor: brand.colors.textMuted },
  syncDotSynced: { backgroundColor: brand.colors.success },
  syncDotOffline: { backgroundColor: brand.colors.textMuted },
  syncDotFailed: { backgroundColor: brand.colors.danger },
  syncDotWarning: { backgroundColor: brand.colors.warning },
  syncPillText: { color: brand.colors.text, ...brand.typography.kicker },
  playlistPanel: { gap: brand.space.sm },
  playlistRail: { gap: brand.space.sm, paddingRight: brand.space.lg },
  playlistChip: { width: brand.layout.playlistChipWidth, gap: brand.space.xs, paddingVertical: brand.space.md, paddingHorizontal: brand.space.md, borderRadius: brand.radius.lg, ...brand.components.inputSurface },
  playlistChipActive: { ...brand.components.selectedSurface },
  addPlaylistChip: { alignItems: 'flex-start', justifyContent: 'center', borderStyle: 'dashed', ...brand.components.surfaceCard },
  addPlaylistIcon: { width: brand.layout.playlistAddIconSize, height: brand.layout.playlistAddIconSize, borderRadius: brand.radius.sm, backgroundColor: brand.colors.primarySubtle, ...brand.components.centeredControl },
  addPlaylistHorizontal: { position: 'absolute', width: 14, height: 2.5, borderRadius: brand.radius.full, backgroundColor: brand.colors.primary },
  addPlaylistVertical: { position: 'absolute', width: 2.5, height: 14, borderRadius: brand.radius.full, backgroundColor: brand.colors.primary },
  playlistName: { color: brand.colors.text, ...brand.typography.label },
  playlistMetaRow: { flexDirection: 'row', alignItems: 'center', gap: brand.space.sm },
  playlistMeta: { color: brand.colors.textMuted, ...brand.typography.caption },
  playlistOfflineBadge: { ...brand.components.statusBadge, backgroundColor: brand.colors.successSubtle, color: brand.colors.success, ...brand.typography.tinyBadge },
  playlistOfflineBadgePartial: { backgroundColor: brand.colors.warningSubtle, color: brand.colors.warning },
  playlistOfflineFailed: { ...brand.components.statusBadge, backgroundColor: brand.colors.dangerSubtle, color: brand.colors.danger, ...brand.typography.tinyBadge },
  emptyPlaylistState: { gap: brand.space.sm, marginBottom: brand.layout.miniPlayerClearance, padding: brand.space.lg, borderRadius: brand.radius.lg, ...brand.components.inputSurface },
  emptyPlaylistTitle: { color: brand.colors.text, ...brand.typography.sectionTitle },
  emptyPlaylistBody: { color: brand.colors.textMuted, ...brand.typography.status },
  emptyPlaylistButton: { alignSelf: 'flex-start', minHeight: brand.control.buttonHeightSmall, borderRadius: brand.radius.full, paddingHorizontal: brand.space.lg, ...brand.components.softPrimaryButton },
  emptyPlaylistButtonText: { color: brand.colors.primary, ...brand.typography.buttonLabel },
  playlistActionPanel: { flexDirection: 'row', gap: brand.space.sm },
  playlistStatusRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: brand.space.sm },
  contentSourceBadge: { ...brand.components.statusBadge, backgroundColor: brand.colors.neutralWash, color: brand.colors.textMuted, ...brand.typography.badge },
  contentSourceBadgeOffline: { backgroundColor: brand.colors.successSubtle, color: brand.colors.success },
  contentSourceBadgeFailed: { backgroundColor: brand.colors.warningSubtle, color: brand.colors.warning },
  refreshingHint: { color: brand.colors.textMuted, ...brand.typography.kicker },
  searchInput: { flex: 1, minHeight: brand.control.buttonHeightCompact, borderRadius: brand.radius.md, paddingHorizontal: brand.space.lg, color: brand.colors.text, ...brand.components.surfaceCard },
  offlineButton: { minWidth: 112, minHeight: brand.control.buttonHeightCompact, borderRadius: brand.radius.md, paddingHorizontal: brand.space.md, ...brand.components.softPrimaryButton },
  offlineButtonSaved: { backgroundColor: brand.colors.successSubtle, borderColor: brand.colors.successBorderStrong },
  offlineButtonText: { color: brand.colors.primary, ...brand.typography.buttonLabel },
  offlineButtonTextSaved: { color: brand.colors.success },
  listContent: { gap: brand.space.sm, paddingBottom: brand.layout.miniPlayerClearance },
  empty: { paddingVertical: brand.layout.emptyStatePadding, textAlign: 'center', color: brand.colors.textMuted, ...brand.typography.status },
  row: { flexDirection: 'row', alignItems: 'center', gap: brand.space.md, paddingVertical: brand.space.md, paddingHorizontal: brand.space.md, borderRadius: brand.radius.lg, ...brand.components.surfaceCard, borderColor: brand.colors.surfaceRaised },
  activeRow: { ...brand.components.activeSurface },
  rowMain: { flex: 1, minWidth: 0, gap: brand.space.xs },
  songTitleRow: { flexDirection: 'row', alignItems: 'center', gap: brand.space.sm },
  songTitle: { flex: 1, color: brand.colors.text, ...brand.typography.trackTitle },
  activeText: { color: brand.colors.primary },
  songMeta: { color: brand.colors.textMuted, ...brand.typography.caption },
  duration: { color: brand.colors.textSubtle, ...brand.typography.caption, fontVariant: ['tabular-nums'] },
  skeletonArtwork: { width: brand.layout.listArtworkSize, height: brand.layout.listArtworkSize, borderRadius: brand.radius.md },
  skeletonBadge: { width: brand.layout.skeleton.badge.width, height: brand.layout.skeleton.badge.height, borderRadius: brand.radius.full },
  skeletonBlock: { backgroundColor: brand.colors.skeleton, opacity: 0.72 },
  skeletonCard: { justifyContent: 'center' },
  skeletonDuration: { width: brand.layout.skeleton.duration.width, height: brand.layout.skeleton.duration.height, borderRadius: brand.radius.full },
  skeletonList: { gap: brand.space.sm, paddingVertical: brand.space.xxs },
  skeletonMeta: { width: brand.layout.skeleton.meta.width, height: brand.layout.skeleton.meta.height, borderRadius: brand.radius.full },
  skeletonRow: { borderColor: brand.colors.surfaceRaised },
  skeletonRowMain: { flex: 1, gap: brand.space.sm },
  skeletonTitle: { width: brand.layout.skeleton.title.width, height: brand.layout.skeleton.title.height, borderRadius: brand.radius.full },
  skeletonTrackMeta: { width: '62%', height: brand.layout.skeleton.trackMetaHeight, borderRadius: brand.radius.full },
  skeletonTrackTitle: { width: '84%', height: brand.layout.skeleton.trackTitleHeight, borderRadius: brand.radius.full },
});
