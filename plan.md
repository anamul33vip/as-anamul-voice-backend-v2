# AS ANAMUL VOICE — Implementation Plan

## Product scope

Deliver two independent source ZIPs: (1) an Android Studio/Kotlin Android application with package ID `com.anamul.voice`; (2) a Node.js backend and browser-based administration panel. The Android app uses the supplied 512×512 logo and Telegram link `https://t.me/crackffpanel`. The key user requirement is to attempt playback of TTS and saved sound-card PCM through a visible Root/Shizuku `AudioPolicy`/`AudioTrack` injector similar in purpose to the supplied APK. Injection is experimental and best-effort; no universal game/device guarantee is claimed. Do not implement stealth, anti-cheat evasion, or a hidden recorder. Android microphone recording is not needed.

## Components and implementation

### Android Studio client

Use Kotlin, Gradle Kotlin DSL and an Android Studio-compatible project. Target Android API 36 (Android 16); set an explicit minimum SDK and document behavior on later Android releases as unverified. Implement a neon RGB app/overlay UI, user-supplied logo, floating overlay with profile identity, text-to-speech composer, voice chips, send/replay/save controls and sound cards. Local sound cards support audio import and playback/stop; show elapsed/progress/duration while playing. Use normal speaker playback when injection is off. When the user explicitly enables the injector, convert audio to mono signed 16-bit PCM at 48 kHz, start a visible Shizuku/Root service process, attempt AudioPolicy loopback mix registration with device format fallbacks, and write PCM to the resulting AudioTrack. Show honest setup, running, failure and diagnostic states; running means only that the audio track route started, not that a game confirmed receipt. No anti-cheat bypass or concealment.

### Node.js backend and admin

Use Node.js/Express and a small persistent SQLite store. Keep Cartesia API access exclusively server-side using `CARTESIA_API_KEY`; do not put live credentials in Android BuildConfig, web assets, `.env.example`, documentation, or either ZIP. Backend routes include health/status, safe client configuration, voice list, authorized voice selection, and TTS byte generation via Cartesia. Validate request size, voice allowlist, model, language and parameters; apply authentication, rate limiting, security headers, timeouts and structured error responses. The admin panel has a protected login and controls for enabled voice IDs/names, default voice, language, model and server status. App configuration may expose only public settings, never secrets. Local sound files remain on the device unless explicitly exported by the user.

### Integration and delivery

Keep server base URL configurable at build time. Document local server setup, environment variables, HTTPS deployment, first-admin creation, Cartesia configuration, Android Studio sync/build/install steps, Shizuku pairing and root diagnostics. Include a device-test matrix through Android 16 and clearly mark untested devices/games. Produce `AS-ANAMUL-VOICE-Android.zip` and `AS-ANAMUL-VOICE-Backend-Admin.zip`; never include signing keys, API keys, built-in passwords, APK, or user data.

## Project structure

- Backend Webdev project root: `server/` Express API, `admin/` static admin panel, `public/manus-routes.json`, `data/` runtime SQLite data (ignored from source), `.env.example`, `Dockerfile`, and deployment/build docs. The same project will contain a sanitized source ZIP.
- Android project: `app/src/main/` Kotlin activities/services, audio conversion/player/injector modules, manifest, layouts/themes/drawables; Gradle wrapper/build files; README and compatibility matrix.
- Staging: a temporary shared source tree used to build the two clean ZIPs, with secrets and generated data excluded.

## Design

**Movement:** Neon arcade-control console inspired by the supplied Free Fire gaming mark, adapted for a compact floating audio tool rather than copying the reference APK screen-for-screen.

**Core principles:** Keep the core actions one tap away; distinguish ordinary speaker playback from experimental mic routing; use compact readable overlays; show real progress and explicit status.

**Color philosophy:** Black/graphite surfaces provide contrast; cyan, magenta, electric blue and lime RGB accents echo the supplied logo. Animated RGB light is decorative and must not obscure labels or status.

**Layout paradigm:** A narrow, draggable bottom-docked control panel with a compact header/profile strip, horizontal voice chips, a large TTS field/send row, and a scrollable sound-card list. Full admin views use a left navigation rail and practical status/configuration panes.

**Signature elements:** A subtle animated RGB edge; user-supplied neon mascot mark; a live playback scrubber with elapsed time and total duration.

**Interaction philosophy:** Tap once to play, tap again to stop; persistent but non-intrusive status tells whether output is speaker playback or a route attempt. Ask for overlay and Shizuku/Root only when the user turns those features on.

**Animation:** Slow RGB hue drift and restrained card pulse. Playback progress updates smoothly; no rapid flashing or high-frequency strobe.

**Typography:** Android system sans-serif for readability, with a bold condensed display face where available for headings; admin uses a modern sans-serif with clear numeric/status hierarchy.

**Brand essence:** A compact gaming soundboard and authorized-voice TTS controller; vivid, practical, transparent.

**Brand voice:** Short, direct labels. Example: “মাইকে পাঠানোর চেষ্টা” and “প্লেব্যাক চলছে · থামাতে আবার চাপুন”.

**Wordmark & logo:** Use the supplied circular “ANAMUL MODZ” image as the launcher/profile mark; wordmark `AS ANAMUL VOICE` in a custom-styled text lockup.

**Signature brand color:** Electric cyan, anchored by RGB accents from the supplied emblem.
