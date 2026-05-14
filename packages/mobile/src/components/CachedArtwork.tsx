import { memo, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { brand } from '../config/brand';
import { cacheRemoteImage } from '../storage/nativeKeyValue';

type CachedArtworkProps = {
  active?: boolean;
  cookie?: string | null;
  size?: number;
  uri?: string | null;
};

const artworkCache = new Map<string, string>();
const artworkFailureCache = new Map<string, number>();
const ARTWORK_RETRY_DELAY_MS = 1000 * 60 * 5;

export const CachedArtwork = memo(function CachedArtwork({
  active = false,
  cookie,
  size = 44,
  uri,
}: CachedArtworkProps) {
  const remoteUri = uri ?? null;
  const [artworkUri, setArtworkUri] = useState(remoteUri ? artworkCache.get(remoteUri) ?? remoteUri : null);

  useEffect(() => {
    if (!remoteUri) {
      setArtworkUri(null);
      return undefined;
    }

    let isMounted = true;
    const cachedUri = artworkCache.get(remoteUri);
    const failureKey = `${remoteUri}::${cookie ?? ''}`;
    const lastFailureAt = artworkFailureCache.get(failureKey) ?? 0;
    setArtworkUri(cachedUri ?? remoteUri);

    if (cachedUri || Date.now() - lastFailureAt < ARTWORK_RETRY_DELAY_MS) {
      return () => {
        isMounted = false;
      };
    }

    cacheRemoteImage(remoteUri, cookie)
      .then(nextUri => {
        artworkCache.set(remoteUri, nextUri);
        artworkFailureCache.delete(failureKey);
        if (isMounted) setArtworkUri(nextUri);
      })
      .catch(() => {
        artworkFailureCache.set(failureKey, Date.now());
      });

    return () => {
      isMounted = false;
    };
  }, [cookie, remoteUri]);

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: Math.round(size * 0.28) }, active && styles.activeFrame]}>
      {artworkUri ? (
        <Image resizeMode="cover" source={{ uri: artworkUri }} style={{ width: size, height: size }} />
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  activeFrame: { borderColor: brand.primary },
  frame: { overflow: 'hidden', backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  placeholder: { flex: 1, backgroundColor: '#18181b' },
});
