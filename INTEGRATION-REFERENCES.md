# Integration references

## Cartesia

Source: https://docs.cartesia.ai/api-reference/tts/bytes

The TTS Bytes endpoint is `POST https://api.cartesia.ai/tts/bytes`; requests require a `Cartesia-Version` header. The current fetched OpenAPI page specifies version `2026-08-14` and required JSON fields `model_id`, `transcript`, `voice`, and `output_format`. Accepted TTS model IDs include `sonic-3.6`, `sonic-3.5`, `sonic-3`, and `sonic-latest`. The voice may be an ID or an object containing the ID. MP3 output format supports sample rate and bitrate; the generated response is audio bytes.

Source: https://docs.cartesia.ai/get-started/authenticate-your-client-applications

Cartesia recommends API keys for trusted servers and short-lived access tokens for browser/client apps. It explicitly warns never to ship an API key in browser or client code because it can be extracted. This project therefore keeps `CARTESIA_API_KEY` only in the backend runtime environment and excludes live values from Android code and source ZIPs.

Source: https://docs.cartesia.ai/api-reference/voices/list

The voice-check endpoint is `GET https://api.cartesia.ai/voices`; the `limit` query supports values from 1 to 100, and the response includes a `data` list plus paging fields. It requires the Cartesia version header and standard API key authentication.

## Shizuku

Source: https://github.com/RikkaApps/Shizuku-API

The official API README documents Maven Central dependencies `dev.rikka.shizuku:api` and `dev.rikka.shizuku:provider`, permission checking/request APIs and the provider declaration. It distinguishes Shizuku started through ADB (shell UID 2000) from root (UID 0), noting that permission sets, SELinux/capabilities, and access to app data are not identical. The README also warns that Shizuku integration resembles system/framework development and that API behavior can require Android source inspection. These facts support documenting this app's audio injector as a device-dependent attempt rather than promising universal game microphone capture.


Source: https://docs.cartesia.ai/build-with-cartesia/capability-guides/advanced-capabilities

The current Sonic 3.6 locale guide lists Bengali (`bn`) and the regional locale `bn-IN`; the TTS endpoint's `language` field accepts base-language or locale codes. The backend default `bn` is therefore a supported base-language value, and admins can set `bn-IN` if that is a better match for an authorized voice.
