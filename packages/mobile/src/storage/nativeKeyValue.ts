import { NativeModules } from 'react-native';

type OceanWaveStorageModule = {
  cacheRemoteImage?(url: string, cookie?: string | null): Promise<string>;
  deleteLocalFile?(fileUri: string): Promise<boolean>;
  downloadRemoteFile?(url: string, fileName: string, cookie?: string | null): Promise<string>;
  getString(key: string): Promise<string | null>;
  isNetworkAvailable?(): Promise<boolean>;
  setString(key: string, value: string): Promise<boolean>;
  removeString(key: string): Promise<boolean>;
};

const memoryFallback = new Map<string, string>();
const nativeStorage = NativeModules.OceanWaveStorage as OceanWaveStorageModule | undefined;

export async function getStoredString(key: string) {
  if (!nativeStorage) return memoryFallback.get(key) ?? null;

  try {
    return await nativeStorage.getString(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

export async function setStoredString(key: string, value: string) {
  memoryFallback.set(key, value);
  if (!nativeStorage) return;

  try {
    await nativeStorage.setString(key, value);
  } catch {
    // Keep the in-memory fallback alive instead of crashing the app.
  }
}

export async function removeStoredString(key: string) {
  memoryFallback.delete(key);
  if (!nativeStorage) return;

  try {
    await nativeStorage.removeString(key);
  } catch {
    // Keep storage best-effort. A failed cleanup should not block navigation.
  }
}

export async function cacheRemoteImage(url: string, cookie?: string | null) {
  if (!nativeStorage?.cacheRemoteImage) return url;

  try {
    return await nativeStorage.cacheRemoteImage(url, cookie);
  } catch {
    return url;
  }
}

export async function isNetworkAvailable() {
  if (!nativeStorage?.isNetworkAvailable) return true;

  try {
    return await nativeStorage.isNetworkAvailable();
  } catch {
    return true;
  }
}

export async function downloadRemoteFile(url: string, fileName: string, cookie?: string | null) {
  if (!nativeStorage?.downloadRemoteFile) {
    throw new Error('Offline downloads require the native storage module.');
  }

  return nativeStorage.downloadRemoteFile(url, fileName, cookie);
}

export async function deleteLocalFile(fileUri: string) {
  if (!nativeStorage?.deleteLocalFile) return false;

  try {
    return await nativeStorage.deleteLocalFile(fileUri);
  } catch {
    return false;
  }
}
