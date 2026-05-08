# Ocean Wave Mobile

Android-first React Native companion player for Ocean Wave.

The web app remains the main Ocean Wave experience. The Android app exists to
cover mobile-native playback needs: background playback, notification controls,
lock-screen controls, and a small queue/player surface.

## Scope

- Server connection
- Queue/player surface
- Background playback, notification controls, and lock-screen controls through `react-native-track-player`

## Out of scope for mobile MVP

- Visualizer
- Equalizer
- Mix-in controls
- Dashboard/management screens
- Full album/artist management UI

## Requirements

- Node.js `22.12+`
- pnpm `10.25.0`
- Android Studio or Android SDK command-line tools
- Android SDK platform `36`
- Android SDK build tools `36.0.0`
- Android NDK `27.1.12297006`
- JDK `21` recommended

On macOS, install a JDK if `java -version` fails:

```bash
brew install --cask temurin
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
```

## Server URL for testing

Start the Ocean Wave server first:

```bash
pnpm dev:server
```

Use one of these URLs in the mobile app:

- Android emulator to host machine: `http://10.0.2.2:3000`
- Physical device on the same Wi-Fi: `http://<host-lan-ip>:3000`

Find the macOS Wi-Fi IP with:

```bash
ipconfig getifaddr en0
```

## Auth flow

The companion app uses the server JSON auth routes:

- `GET /api/auth/session` checks whether the server is open or password-protected.
- `POST /api/auth/login` accepts `{ "password": "..." }` and returns the session state.
- `POST /api/auth/logout` clears the server session cookie.

For the current MVP, the Android app keeps the captured `ocean-wave.sid` cookie in memory and sends it through explicit `Cookie` headers for GraphQL and audio stream requests. Mobile `fetch` calls use `credentials: omit` so the native cookie jar does not become a second, implicit session store. Durable secure storage is intentionally left for the next auth-hardening pass.

## Player controls

The mobile shell exposes the first native playback surface:

- current track title/artist
- play/pause, previous/next
- ±15 second seek controls
- tappable progress bar
- queue list with the active track highlighted

Queue playback still comes from the loaded server library in this MVP. Durable queue restore and real-device notification/lock-screen verification remain follow-up tasks.

## CI debug APK artifact

Pull requests that touch mobile or workflow paths run the `android mobile assemble`
job. The job builds the debug APK and uploads it as a GitHub Actions artifact:

- Artifact name: `ocean-wave-mobile-debug-apk`
- Artifact path in CI: `packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- Retention: 14 days

This debug APK is for development validation only. It is not release-signed and
should not be treated as a production build.

## Android branding

- App label: `Ocean Wave`
- React Native app registry name: `OceanWave`
- Android application ID / namespace: `com.baealex.oceanwave`
- Launcher icons are generated from `packages/client/public/brand-logo.svg` so the companion app uses the same primary app mark as the web product.

## Patched native dependency

`react-native-track-player@4.1.2` is patched through pnpm in
`patches/react-native-track-player@4.1.2.patch`.

The patch only covers a Kotlin nullability mismatch observed with the current
React Native/Kotlin toolchain. Remove it once upstream ships a compatible fix and
`android mobile assemble` stays green without the patch.
