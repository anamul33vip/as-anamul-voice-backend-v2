# TODO

## Android Studio client: identity, branding and RGB interface
- [x] Create an Android Studio/Kotlin project named `AS ANAMUL VOICE` with package ID `com.anamul.voice`.
- [x] Use the user-supplied app image as the icon/profile artwork and include Telegram contact `https://t.me/crackffpanel`.
- [x] Apply a stylish RGB/neon theme without flashing; provide an accessible dark interface, readable controls, a draggable bottom-positioned floating panel, and compact profile/voice identity.
- [x] Include server status, overlay controls, voice chips, text input/send, replay, save-to-card and sound-card actions.

## Android audio, voice and sound-card behavior
- [x] Support authorized Cartesia voice IDs selected from backend configuration; send TTS requests to the backend, then play the returned audio.
- [x] Import local audio files as sound cards; tapping a card starts playback and tapping the same card again stops it.
- [x] Display a playback progress line with elapsed and total duration while audio plays; keep the timeline on-screen during playback.
- [x] Provide ordinary Android speaker playback when injection is off.
- [x] Provide an explicitly user-enabled, visible Root/Shizuku best-effort injection attempt inspired by the supplied APK: start an `app_process` injector, attempt an AudioPolicy/AudioMix route with compatible sample-rate/channel alternatives, convert audio to PCM, feed it to AudioTrack, support stop/quit commands and show diagnostics/errors.
- [x] Label injection as an attempt and do not claim that the target game has received the audio unless independently tested on that device/game. Include no stealth, anti-cheat evasion or hidden microphone recording.
- [x] Set Android target API to 36 (Android 16); document actual tested API versions and mark Android 17+ as unsupported/unverified rather than promising forward compatibility.

## Node.js backend and admin panel
- [x] Provide a Node.js server and responsive web admin panel in a separate project ZIP.
- [x] Keep Cartesia credentials only in trusted server environment configuration; do not embed them in the Android client, browser code, `.env.example`, logs, screenshots or ZIP files.
- [x] Implement health/status checks, safe client configuration, voice list/allowlist, admin voice/settings controls and server-side TTS proxy endpoints.
- [x] Protect admin/configuration endpoints with authentication, input validation, rate limiting and security headers; do not ship a default password.
- [x] Use the current documented Cartesia TTS Bytes API shape, required version header, server-side bearer auth and supported output format; handle provider/network errors without exposing secrets.
- [x] Persist admin settings in SQLite without bundling user data or secrets; keep local sound files on the phone unless the user chooses export.

## Documentation, validation and delivery
- [x] Write Bengali/English setup notes explaining backend environment variables, HTTPS deployment, admin bootstrap, Android Studio build, Shizuku pairing, Root setup, diagnostics and compatibility limits.
- [x] Include a manual test matrix through Android 16 for normal speaker playback, overlay, audio import/stop/progress, TTS, Shizuku and Root injection attempts, with explicit pass/fail/unknown fields.
- [ ] Build and validate source-level artifacts where the available toolchain permits; distinguish code compilation, injector initialization and verified game-side microphone reception. Backend syntax and auth/config flow were tested; Android Gradle configuration succeeds, but APK compilation is blocked because SDK licenses were not accepted. Physical-device/game microphone reception is untested.
- [x] Deliver clean, separate `AS-ANAMUL-VOICE-Android.zip` and `AS-ANAMUL-VOICE-Backend-Admin.zip`, excluding secrets, signing keys, runtime databases, generated data, and compiled APKs.
