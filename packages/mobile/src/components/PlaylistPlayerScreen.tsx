import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Track } from 'react-native-track-player';

import { albumArtUrl, OceanWaveMusic, OceanWavePlaylist } from '../api/oceanWaveClient';
import { brand } from '../config/brand';
import { SaveOfflinePlaylistProgress } from '../offline/offlinePlaylists';
import { MobileSyncStatus, PlaylistContentState } from '../hooks/usePlaylistLibrary';
import { formatDuration } from '../utils/time';
import { CachedArtwork } from './CachedArtwork';
import { MiniPlayer } from './MiniPlayer';
import { NavBar } from './NavBar';
import { NowPlayingScreen } from './NowPlayingScreen';
import type { NowPlayingTrack } from './NowPlayingScreen';

type PlaylistOfflineUiStatus = 'none' | { state: 'partial' | 'downloaded'; downloaded: number; total: number; failed: number };

type PlaylistPlayerScreenProps = {
  activeTrack?: Track;
  canControlPlayback: boolean;
  displayedActiveTrackId?: string;
  displayedMiniTrack?: NowPlayingTrack;
  hasPlaybackError: boolean;
  hasSelectedPlaylistOfflineTracks: boolean;
  hasSelectedPlaylistOfflineUpdate: boolean;
  isLoading: boolean;
  playlistContentState: PlaylistContentState;
  isOfflineSaving: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  isSelectedPlaylistOffline: boolean;
  selectedOfflineFailureCount: number;
  syncStatus: MobileSyncStatus;
  offlineSaveProgress?: SaveOfflinePlaylistProgress | null;
  playlistName?: string | null;
  playlistOfflineStatuses: Record<number, PlaylistOfflineUiStatus>;
  playlists: OceanWavePlaylist[];
  progressRatio: number;
  progressDuration: number;
  progressPosition: number;
  searchQuery: string;
  selectedPlaylistId?: number | null;
  selectedProfileName?: string | null;
  serverUrl: string;
  sessionCookie?: string | null;
  showPlaylistSkeleton?: boolean;
  showTrackSkeleton?: boolean;
  totalTrackCount: number;
  visibleLibrary: OceanWaveMusic[];
  onBack: () => void;
  onCreatePlaylist: () => void;
  onNext: () => void;
  onOpenPlaylist: (playlistId: number) => void;
  onPlayTrack: (index: number) => void;
  onPrevious: () => void;
  onContinueOffline: () => void;
  onRetryPlayback: () => void;
  onRetrySync: () => void;
  onSearchQueryChange: (value: string) => void;
  onSeekByStep: (direction: 'backward' | 'forward') => void;
  onSeekRatio: (ratio: number) => void;
  onSignIn: () => void;
  onTogglePlayback: () => void;
  onToggleOffline: () => void;
};

export function PlaylistPlayerScreen({
  activeTrack,
  canControlPlayback,
  displayedActiveTrackId,
  displayedMiniTrack,
  hasPlaybackError,
  hasSelectedPlaylistOfflineTracks,
  hasSelectedPlaylistOfflineUpdate,
  isLoading,
  playlistContentState,
  isOfflineSaving,
  isBuffering,
  isPlaying,
  isSelectedPlaylistOffline,
  selectedOfflineFailureCount,
  syncStatus,
  offlineSaveProgress,
  playlistName,
  playlistOfflineStatuses,
  playlists,
  progressDuration,
  progressPosition,
  progressRatio,
  searchQuery,
  selectedPlaylistId,
  selectedProfileName,
  serverUrl,
  sessionCookie,
  showPlaylistSkeleton = false,
  showTrackSkeleton = false,
  totalTrackCount,
  visibleLibrary,
  onBack,
  onCreatePlaylist,
  onNext,
  onOpenPlaylist,
  onPlayTrack,
  onPrevious,
  onContinueOffline,
  onRetryPlayback,
  onRetrySync,
  onSearchQueryChange,
  onSeekByStep,
  onSeekRatio,
  onSignIn,
  onTogglePlayback,
  onToggleOffline,
}: PlaylistPlayerScreenProps) {
  const offlineButtonLabel = isOfflineSaving
    ? offlineSaveProgress ? `${offlineSaveProgress.completed}/${offlineSaveProgress.total}${offlineSaveProgress.failed ? ` · ${offlineSaveProgress.failed} failed` : ''}` : 'Downloading…'
    : selectedOfflineFailureCount > 0 ? 'Retry' : hasSelectedPlaylistOfflineUpdate ? 'Update' : isSelectedPlaylistOffline ? 'Downloaded' : 'Download';
  const contentLabel = playlistContentState === 'showing-offline'
    ? 'Offline copy'
    : playlistContentState === 'showing-cache' ? 'Cached'
      : playlistContentState === 'failed' && visibleLibrary.length > 0 ? 'Stale data'
        : null;
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const needsRecovery = syncStatus === 'failed'
    || syncStatus === 'authRequired'
    || (syncStatus === 'offline' && !hasSelectedPlaylistOfflineTracks);
  const selectedPlaylist = playlists.find(playlist => playlist.id === selectedPlaylistId);
  const selectedTrackCount = selectedPlaylist?.musicCount ?? totalTrackCount;
  const hasMiniPlayer = Boolean(displayedMiniTrack ?? activeTrack);
  const onPlayTrackRef = useRef(onPlayTrack);
  useEffect(() => {
    if (!hasMiniPlayer) setIsNowPlayingOpen(false);
  }, [hasMiniPlayer]);
  useEffect(() => {
    onPlayTrackRef.current = onPlayTrack;
  }, [onPlayTrack]);
  const handlePlayTrackByIndex = useCallback((index: number) => {
    onPlayTrackRef.current(index);
  }, []);

  return (
    <View style={styles.playerPage}>
      <NavBar onBack={onBack} title={selectedProfileName ?? 'Ocean Wave'} />
      <FlatList
        data={playlistName ? visibleLibrary : []}
        initialNumToRender={8}
        keyExtractor={item => String(item.id)}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        contentContainerStyle={[styles.listContent, !hasMiniPlayer && styles.listContentWithoutPlayer]}
        style={styles.trackList}
        ListHeaderComponent={(
          <View style={styles.trackListHeader}>
            {needsRecovery ? (
              <RecoveryStatusBanner
                hasOfflineContent={hasSelectedPlaylistOfflineTracks}
                onContinueOffline={onContinueOffline}
                onRetry={onRetrySync}
                onSignIn={onSignIn}
                playlistName={playlistName}
                status={syncStatus}
              />
            ) : syncStatus === 'syncing' ? (
              <View accessibilityLiveRegion="polite" style={styles.syncPill}>
                <View style={styles.syncDot} />
                <Text style={styles.syncPillText}>Syncing…</Text>
              </View>
            ) : null}

            {playlistName ? (
              <View style={styles.playlistHeading}>
                <View style={styles.playlistHeadingCopy}>
                  <Text numberOfLines={1} style={styles.playlistHeadingTitle}>{playlistName}</Text>
                  <Text style={styles.playlistHeadingMeta}>{selectedTrackCount.toLocaleString()} tracks</Text>
                </View>
                {contentLabel ? <Text style={[styles.contentSourceBadge, playlistContentState === 'showing-offline' && styles.contentSourceBadgeOffline, playlistContentState === 'failed' && styles.contentSourceBadgeFailed]}>{contentLabel}</Text> : null}
              </View>
            ) : null}

            {playlists.length || showPlaylistSkeleton ? (
              <View style={styles.playlistPanel}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistRail}>
                  {!showPlaylistSkeleton ? <Pressable accessibilityLabel="Create a playlist in the web app" accessibilityRole="button" onPress={onCreatePlaylist} style={({ pressed }) => [styles.addPlaylistChip, pressed && styles.pressedSurface]}>
                    <View style={styles.addPlaylistIcon}>
                      <View style={styles.addPlaylistHorizontal} />
                      <View style={styles.addPlaylistVertical} />
                    </View>
                    <Text style={styles.playlistName}>New</Text>
                  </Pressable> : null}
                  {showPlaylistSkeleton ? Array.from({ length: 3 }).map((_, index) => (
                    <View key={`playlist-skeleton-${index}`} style={[styles.playlistChip, styles.skeletonCard]}>
                      <View style={[styles.skeletonBlock, styles.skeletonTitle]} />
                      <View style={[styles.skeletonBlock, styles.skeletonMeta]} />
                    </View>
                  )) : null}
                  {playlists.map(playlist => {
                    const offlineStatus = playlistOfflineStatuses[playlist.id] ?? 'none';
                    const offlineLabel = offlineStatus === 'none'
                      ? null
                      : offlineStatus.state === 'downloaded' ? 'Offline' : `${offlineStatus.downloaded}/${offlineStatus.total} offline`;
                    const failedLabel = offlineStatus !== 'none' && offlineStatus.failed ? `${offlineStatus.failed} failed` : null;
                    const selectorMeta = [
                      `${playlist.musicCount.toLocaleString()} tracks`,
                      offlineLabel,
                      failedLabel,
                    ].filter(Boolean).join(' · ');

                    return (
                      <Pressable
                        key={playlist.id}
                        accessibilityLabel={`${playlist.name}, ${selectorMeta}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: selectedPlaylistId === playlist.id }}
                        onPress={() => onOpenPlaylist(playlist.id)}
                        style={({ pressed }) => [styles.playlistChip, selectedPlaylistId === playlist.id && styles.playlistChipActive, pressed && styles.pressedSurface]}>
                        <View style={styles.playlistChipCopy}>
                          <Text numberOfLines={1} style={styles.playlistName}>{playlist.name}</Text>
                          <Text numberOfLines={1} style={[styles.playlistMeta, failedLabel && styles.playlistMetaFailed]}>{selectorMeta}</Text>
                        </View>
                        {offlineLabel ? <View style={[styles.playlistOfflineDot, offlineStatus !== 'none' && offlineStatus.state === 'partial' && styles.playlistOfflineDotPartial, failedLabel && styles.playlistOfflineDotFailed]} /> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {playlistName ? (
              <View style={styles.playlistActionPanel}>
                <TextInput accessibilityLabel="Search in playlist" autoCapitalize="none" autoCorrect={false} onChangeText={onSearchQueryChange} placeholder="Search in playlist" placeholderTextColor={brand.colors.textSubtle} style={styles.searchInput} value={searchQuery} />
                <Pressable accessibilityLabel={selectedOfflineFailureCount > 0 ? 'Retry failed offline downloads' : hasSelectedPlaylistOfflineUpdate ? 'Update downloaded playlist' : isSelectedPlaylistOffline ? 'Remove downloaded playlist' : 'Download playlist for offline playback'} accessibilityRole="button" accessibilityState={{ disabled: isOfflineSaving || !totalTrackCount, busy: isOfflineSaving, selected: isSelectedPlaylistOffline }} disabled={isOfflineSaving || !totalTrackCount} onPress={onToggleOffline} style={({ pressed }) => [styles.offlineButton, (isOfflineSaving || !totalTrackCount) && styles.disabledButton, isSelectedPlaylistOffline && styles.offlineButtonSaved, pressed && !isOfflineSaving && totalTrackCount > 0 && styles.pressedSurface]}>
                  <Text style={[styles.offlineButtonText, isSelectedPlaylistOffline && styles.offlineButtonTextSaved]}>{offlineButtonLabel}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={playlistName
          ? showTrackSkeleton ? <TrackListSkeleton /> : <Text style={styles.empty}>{isLoading ? 'Loading…' : 'No songs in this playlist.'}</Text>
          : (
            <View style={styles.emptyPlaylistState}>
              <Text style={styles.emptyPlaylistTitle}>Choose a playlist</Text>
              <Text style={styles.emptyPlaylistBody}>Create a playlist on the web, then come back here to play it.</Text>
              <Pressable accessibilityRole="button" onPress={onCreatePlaylist} style={({ pressed }) => [styles.emptyPlaylistButton, pressed && styles.pressedSurface]}>
                <Text style={styles.emptyPlaylistButtonText}>Open web</Text>
              </Pressable>
            </View>
          )}
        renderItem={({ item, index }) => (
          <PlaylistTrackRow
            active={displayedActiveTrackId === String(item.id)}
            buffering={isBuffering && displayedActiveTrackId === String(item.id)}
            index={index}
            item={item}
            onPlayTrack={handlePlayTrackByIndex}
            serverUrl={serverUrl}
            sessionCookie={sessionCookie}
          />
        )}
      />
      {hasMiniPlayer ? (
        <MiniPlayer
          activeTrack={displayedMiniTrack ?? activeTrack}
          canControlPlayback={canControlPlayback}
          hasPlaybackError={hasPlaybackError}
          isBuffering={isBuffering}
          isPlaying={isPlaying}
          onNext={onNext}
          onOpen={() => setIsNowPlayingOpen(true)}
          onRetryPlayback={onRetryPlayback}
          onTogglePlayback={onTogglePlayback}
          playlistName={playlistName}
          progressRatio={progressRatio}
          sessionCookie={sessionCookie}
        />
      ) : null}
      <NowPlayingScreen
        activeTrack={displayedMiniTrack ?? activeTrack}
        canControlPlayback={canControlPlayback}
        hasPlaybackError={hasPlaybackError}
        isBuffering={isBuffering}
        isPlaying={isPlaying}
        onClose={() => setIsNowPlayingOpen(false)}
        onNext={onNext}
        onPrevious={onPrevious}
        onRetryPlayback={onRetryPlayback}
        onSeekByStep={onSeekByStep}
        onSeekRatio={onSeekRatio}
        onTogglePlayback={onTogglePlayback}
        playlistName={playlistName}
        progressDuration={progressDuration}
        progressPosition={progressPosition}
        progressRatio={progressRatio}
        sessionCookie={sessionCookie}
        visible={isNowPlayingOpen && hasMiniPlayer}
      />
    </View>
  );
}

function RecoveryStatusBanner({
  hasOfflineContent,
  onContinueOffline,
  onRetry,
  onSignIn,
  playlistName,
  status,
}: {
  hasOfflineContent: boolean;
  onContinueOffline: () => void;
  onRetry: () => void;
  onSignIn: () => void;
  playlistName?: string | null;
  status: MobileSyncStatus;
}) {
  const title = status === 'authRequired'
    ? 'Sign in to sync'
    : status === 'offline' ? 'You’re offline' : 'Sync unavailable';
  const primaryLabel = status === 'authRequired' ? 'Sign in' : 'Retry';
  const handlePrimaryAction = status === 'authRequired' ? onSignIn : onRetry;
  const contentName = playlistName ?? 'Downloaded music';
  const message = status === 'authRequired'
    ? hasOfflineContent
      ? `Sign in to sync updates. ${contentName} remains available.`
      : 'Sign in to stream tracks and sync this server.'
    : status === 'offline'
      ? 'Reconnect to stream tracks and sync this server.'
      : hasOfflineContent
        ? `Sync failed, but ${contentName} remains available.`
        : 'Check the server connection and try syncing again.';

  return (
    <View
      accessibilityLiveRegion="assertive"
      style={[
        styles.recoveryBanner,
        status === 'authRequired' && styles.recoveryBannerWarning,
        status === 'failed' && styles.recoveryBannerFailed,
      ]}
    >
      <View style={styles.recoveryCopy}>
        <Text style={styles.recoveryTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.recoveryMessage}>{message}</Text>
      </View>
      <View style={styles.recoveryActions}>
        {hasOfflineContent && status !== 'offline' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onContinueOffline}
            style={({ pressed }) => [styles.recoverySecondaryButton, pressed && styles.pressedSurface]}
          >
            <Text style={styles.recoverySecondaryText}>Keep listening</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={handlePrimaryAction}
          style={({ pressed }) => [styles.recoveryPrimaryButton, pressed && styles.pressedPrimary]}
        >
          <Text style={styles.recoveryPrimaryText}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}


type PlaylistTrackRowProps = {
  active: boolean;
  buffering: boolean;
  index: number;
  item: OceanWaveMusic;
  onPlayTrack: (index: number) => void;
  serverUrl: string;
  sessionCookie?: string | null;
};

const PlaylistTrackRow = memo(function PlaylistTrackRowComponent({
  active,
  buffering,
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
      <View style={styles.durationSlot}>
        {buffering ? <ActivityIndicator color={brand.colors.primary} size="small" /> : <Text style={styles.duration}>{formatDuration(item.duration)}</Text>}
      </View>
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
  pressedPrimary: { ...brand.components.pressedPrimary },
  pressedSurface: { ...brand.components.pressedSurface },
  syncPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: brand.space.sm, paddingVertical: brand.space.xs, paddingHorizontal: brand.space.md, borderRadius: brand.radius.full, backgroundColor: brand.colors.neutralWash, borderWidth: 1, borderColor: brand.colors.neutralBorder },
  syncDot: { width: brand.layout.syncDotSize, height: brand.layout.syncDotSize, borderRadius: brand.radius.full, backgroundColor: brand.colors.textMuted },
  syncPillText: { color: brand.colors.text, ...brand.typography.kicker },
  recoveryBanner: { gap: brand.space.sm, padding: brand.space.md, borderRadius: brand.radius.lg, backgroundColor: brand.colors.neutralWash, borderWidth: 1, borderColor: brand.colors.neutralBorder },
  recoveryBannerWarning: { backgroundColor: brand.colors.warningWash, borderColor: brand.colors.warningBorder },
  recoveryBannerFailed: { backgroundColor: brand.colors.dangerWash, borderColor: brand.colors.dangerBorder },
  recoveryCopy: { gap: brand.space.xs },
  recoveryTitle: { color: brand.colors.text, ...brand.typography.sectionTitle },
  recoveryMessage: { color: brand.colors.textMuted, ...brand.typography.status },
  recoveryActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: brand.space.sm },
  recoverySecondaryButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: brand.space.lg, borderRadius: brand.radius.full, backgroundColor: brand.colors.control, borderWidth: 1, borderColor: brand.colors.controlBorder },
  recoverySecondaryText: { color: brand.colors.text, ...brand.typography.label },
  recoveryPrimaryButton: { ...brand.components.primaryButton, minHeight: 48, paddingHorizontal: brand.space.lg, borderRadius: brand.radius.full },
  recoveryPrimaryText: { color: brand.colors.white, ...brand.typography.label },
  playlistHeading: { minHeight: 48, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: brand.space.md },
  playlistHeadingCopy: { flex: 1, minWidth: 0, gap: brand.space.xs },
  playlistHeadingTitle: { color: brand.colors.text, fontSize: 24, lineHeight: 29, fontWeight: '900' },
  playlistHeadingMeta: { color: brand.colors.textMuted, ...brand.typography.caption },
  playlistPanel: { gap: brand.space.sm },
  playlistRail: { alignItems: 'center', gap: brand.space.sm, paddingRight: brand.space.lg },
  playlistChip: { width: 168, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: brand.space.sm, paddingVertical: 6, paddingHorizontal: brand.space.md, borderRadius: brand.radius.lg, ...brand.components.inputSurface },
  playlistChipActive: { ...brand.components.selectedSurface },
  playlistChipCopy: { flex: 1, minWidth: 0, gap: 1 },
  addPlaylistChip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: brand.space.sm, paddingHorizontal: brand.space.md, borderRadius: brand.radius.lg, borderStyle: 'dashed', ...brand.components.surfaceCard },
  addPlaylistIcon: { width: 24, height: 24, borderRadius: brand.radius.full, backgroundColor: brand.colors.primarySubtle, ...brand.components.centeredControl },
  addPlaylistHorizontal: { position: 'absolute', width: 12, height: 2, borderRadius: brand.radius.full, backgroundColor: brand.colors.primary },
  addPlaylistVertical: { position: 'absolute', width: 2, height: 12, borderRadius: brand.radius.full, backgroundColor: brand.colors.primary },
  playlistName: { color: brand.colors.text, ...brand.typography.label },
  playlistMeta: { color: brand.colors.textMuted, ...brand.typography.caption },
  playlistMetaFailed: { color: brand.colors.danger },
  playlistOfflineDot: { width: 8, height: 8, borderRadius: brand.radius.full, backgroundColor: brand.colors.success },
  playlistOfflineDotPartial: { backgroundColor: brand.colors.warning },
  playlistOfflineDotFailed: { backgroundColor: brand.colors.danger },
  emptyPlaylistState: { gap: brand.space.sm, padding: brand.space.lg, borderRadius: brand.radius.lg, ...brand.components.inputSurface },
  emptyPlaylistTitle: { color: brand.colors.text, ...brand.typography.sectionTitle },
  emptyPlaylistBody: { color: brand.colors.textMuted, ...brand.typography.status },
  emptyPlaylistButton: { alignSelf: 'flex-start', minHeight: brand.control.buttonHeightSmall, borderRadius: brand.radius.full, paddingHorizontal: brand.space.lg, ...brand.components.softPrimaryButton },
  emptyPlaylistButtonText: { color: brand.colors.primary, ...brand.typography.buttonLabel },
  playlistActionPanel: { flexDirection: 'row', gap: brand.space.sm },
  trackList: { flex: 1 },
  trackListHeader: { gap: brand.space.md, paddingBottom: brand.space.xs },
  contentSourceBadge: { ...brand.components.statusBadge, backgroundColor: brand.colors.neutralWash, color: brand.colors.textMuted, ...brand.typography.badge },
  contentSourceBadgeOffline: { backgroundColor: brand.colors.successSubtle, color: brand.colors.success },
  contentSourceBadgeFailed: { backgroundColor: brand.colors.warningSubtle, color: brand.colors.warning },
  searchInput: { flex: 1, minHeight: brand.control.buttonHeightCompact, borderRadius: brand.radius.md, paddingHorizontal: brand.space.lg, color: brand.colors.text, ...brand.components.surfaceCard },
  offlineButton: { minWidth: 112, minHeight: brand.control.buttonHeightCompact, borderRadius: brand.radius.md, paddingHorizontal: brand.space.md, ...brand.components.softPrimaryButton },
  offlineButtonSaved: { backgroundColor: brand.colors.successSubtle, borderColor: brand.colors.successBorderStrong },
  offlineButtonText: { color: brand.colors.primary, ...brand.typography.buttonLabel },
  offlineButtonTextSaved: { color: brand.colors.success },
  listContent: { gap: brand.space.sm, paddingBottom: brand.layout.miniPlayerClearance },
  listContentWithoutPlayer: { paddingBottom: brand.space.lg },
  empty: { paddingVertical: brand.layout.emptyStatePadding, textAlign: 'center', color: brand.colors.textMuted, ...brand.typography.status },
  row: { flexDirection: 'row', alignItems: 'center', gap: brand.space.md, paddingVertical: brand.space.md, paddingHorizontal: brand.space.md, borderRadius: brand.radius.lg, ...brand.components.surfaceCard, borderColor: brand.colors.surfaceRaised },
  activeRow: { ...brand.components.activeSurface },
  rowMain: { flex: 1, minWidth: 0, gap: brand.space.xs },
  songTitleRow: { flexDirection: 'row', alignItems: 'center', gap: brand.space.sm },
  songTitle: { flex: 1, color: brand.colors.text, ...brand.typography.trackTitle },
  activeText: { color: brand.colors.primary },
  songMeta: { color: brand.colors.textMuted, ...brand.typography.caption },
  durationSlot: { width: 40, alignItems: 'flex-end' },
  duration: { color: brand.colors.textSubtle, ...brand.typography.caption, fontVariant: ['tabular-nums'] },
  skeletonArtwork: { width: brand.layout.listArtworkSize, height: brand.layout.listArtworkSize, borderRadius: brand.radius.md },
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
