# Ocean Wave Pocket

Android-first React Native companion player for Ocean Wave.

The web app remains the full Ocean Wave experience. The Android app focuses on
mobile-native listening: background playback, notification/lock-screen controls,
playlist playback, and offline playlist downloads.

## Current scope

- Save and reconnect to Ocean Wave servers, including the public demo server
- Password auth through the server JSON auth routes
- Playlist browsing and playback
- Background playback, notification controls, and lock-screen controls through `react-native-track-player`
- Offline playlist download/update/remove flows
- Cached playlist summaries so the app can render local content before server sync finishes
- Offline and sync-state feedback when the phone has no network or the server is unreachable
- Opening the connected Ocean Wave web app for full browsing and management

## Still out of scope

- Visualizer
- Equalizer
- Mix-in controls
- Dashboard/management screens
- Full album/artist management UI
- Release-signed Android distribution

## Try the demo server

Use the built-in **Demo Ocean Wave** server profile or manually add:

```text
https://demo-ocean-wave.baejino.com
```

The demo is useful for trying playback, playlist switching, and mobile offline
flows without running your own server.

## Requirements

- Node.js `22.12+`
- pnpm `10.25.0`
- Android Studio or Android SDK command-line tools
- Android SDK platform `36`
- Android SDK build tools `36.0.0`
- Android NDK `27.1.12297006`
- JDK `21` recommended; Android Studio's bundled JBR also works for local debug builds

On macOS, install a JDK if `java -version` fails:

```bash
brew install --cask temurin
```

For local Android builds, make sure Gradle can find the Android SDK. One option
is to create `packages/mobile/android/local.properties`:

```properties
sdk.dir=/Users/<you>/Library/Android/sdk
```

You can also export the Android Studio JBR/SDK paths for the current shell:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## Local development

From the repository root, install dependencies first:

```bash
pnpm install
```

Start Metro in one terminal:

```bash
pnpm dev:mobile
```

Run the Android app in another terminal:

```bash
pnpm android:mobile
```

Direct package commands are also available:

```bash
pnpm --filter ocean-wave-mobile start
pnpm --filter ocean-wave-mobile android
pnpm --filter ocean-wave-mobile type-check
pnpm --filter ocean-wave-mobile lint
```

## Server URL for testing

Start the Ocean Wave server first:

```bash
pnpm dev:server
```

Use one of these URLs in the mobile app:

- Android emulator to host machine: `http://10.0.2.2:44100`
- Physical device on the same Wi-Fi: `http://<host-lan-ip>:44100`

Find the macOS Wi-Fi IP with:

```bash
ipconfig getifaddr en0
```

## Auth flow

The companion app uses the server JSON auth routes:

- `GET /api/auth/session` checks whether the server is open or password-protected.
- `POST /api/auth/login` accepts `{ "password": "..." }` and returns the session state.
- `POST /api/auth/logout` clears the server session cookie.

Server profiles and captured session cookies are persisted through the app's
native key-value storage. Mobile `fetch` calls still use `credentials: omit` and
send explicit `Cookie` headers so the native cookie jar does not become a second,
implicit session store.

## Player and offline controls

The mobile shell exposes a native playback surface:

- current track title/artist/artwork
- play/pause, previous/next
- tappable progress bar
- playlist rail with the active playlist highlighted
- playlist search
- `Download`, `Update`, and `Downloaded` states for the selected playlist
- playlist chip badges for downloaded or partial offline content
- `New playlist` / `Open web` entry points back to the connected server

Offline playlist updates reuse already-downloaded audio files, download newly
added tracks, update the manifest order to match the server, and remove files for
tracks that are no longer in the playlist.

## Network resilience

The app renders cached playlist summaries and offline playlists before waiting on
server auth or GraphQL requests. On Android, native connectivity detection skips
network fetches entirely when the phone has no active network.

When the device has network connectivity but the server is unreachable, mobile
server requests use a short timeout and retry transient failures once. The UI
keeps local content interactive while server sync is pending or failed.

Album artwork falls back to the server-hosted `/default-artwork.jpg` when a track
has no cover.

## Deep links

The Android app handles Ocean Wave playback links from the web app:

- `oceanwave://play/music/:id?server=<encoded-server-origin>`
- `oceanwave://play/playlist/:id?server=<encoded-server-origin>`

When a link includes `server`, the app switches to that server URL, checks the
session when network is available, asks for login when needed, then builds and
starts the requested queue. Local ADB validation example:

```bash
adb shell am start -W -a android.intent.action.VIEW -d "oceanwave://play/playlist/7?server=http%3A%2F%2F10.0.2.2%3A44100" com.baealex.oceanwave
```

## CI debug APK artifact

Pull requests that touch mobile or workflow paths run the `android mobile assemble`
job. The job builds the debug APK and uploads it as a GitHub Actions artifact:

- Artifact name: `ocean-wave-pocket-debug-apk`
- Artifact path in CI: `packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- Retention: 14 days

To download the latest debug APK from GitHub:

1. Open the latest `CI` workflow run for `main` or the target pull request.
2. Download the `ocean-wave-pocket-debug-apk` artifact.
3. Extract the artifact and install `app-debug.apk` on an Android device with USB
   debugging enabled.

This debug APK is for development validation only. It is not release-signed and
should not be treated as a production build. Do not use older Dropbox APK links;
they are stale and no longer represent the current Android app.

## Android branding

- App label: `Ocean Wave Pocket`
- React Native app registry name: `OceanWave`
- Android application ID / namespace: `com.baealex.oceanwave`
- Launcher icons are generated from `packages/client/public/brand-logo.svg` so the companion app uses the same primary app mark as the web product.

## Patched native dependency

`react-native-track-player@4.1.2` is patched through pnpm in
`patches/react-native-track-player@4.1.2.patch`.

The patch only covers a Kotlin nullability mismatch observed with the current
React Native/Kotlin toolchain. Remove it once upstream ships a compatible fix and
`android mobile assemble` stays green without the patch.
