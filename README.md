# AS ANAMUL VOICE — Backend ও Admin panel

এটি Android client-এর জন্য self-host করা Node.js/Express API এবং private responsive admin panel। Cartesia TTS key শুধু trusted server environment-এ থাকে; Android app, admin browser, log বা source ZIP-এ যায় না। Admin URL: `/admin`।

## Local setup

প্রয়োজন: Node.js 22.13+ এবং project-এ pin করা pnpm 10.10.0।

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

`.env`-এ নিজের `ADMIN_USERNAME`, অন্তত 16 অক্ষরের শক্ত `ADMIN_PASSWORD`, এবং নতুন/rotated Cartesia standard API key `CARTESIA_API_KEY` দিন। Chat-এ আগে দেওয়া API key পুনরায় ব্যবহার করবেন না। Node server project-root `.env` load করে; `.env` Git/ZIP-এ অন্তর্ভুক্ত নয়। এরপর `pnpm dev` চালিয়ে `http://localhost:3000/admin` খুলুন। HTTPS deployment-এ `NODE_ENV=production` ব্যবহার করুন।

প্রথম server start-এ admin row না থাকলে environment থেকে admin তৈরি হয়। পরে শুধু environment password বদলালে existing DB admin password বদলায় না—এটি ইচ্ছাকৃত, যাতে restart থেকে গোপনে credentials না বদলায়। Password হারালে protected environment বা owner-only `.env`-এ একই `ADMIN_USERNAME` রেখে নতুন `ADMIN_PASSWORD` দিন, তারপর server host-এ `pnpm admin:reset` চালান। এটি existing account-এর password rotate করে এবং ওই admin-এর সব পুরনো session revoke করে; password output করে না। `DATA_DIR`-এ SQLite database থাকতে হবে। Username rename বা account addition ইচ্ছেমতো startup-এ হয় না।

SQLite database ও directory process owner ছাড়া অন্যের জন্য readable নয় (`0700` directory, `0600` database; process umask `0077`)। Backup private রাখুন। `DATA_DIR`-এ persistent writable volume mount করুন; public web root হিসেবে serve করবেন না।

## Admin থেকে Android app configure

Admin-এ sign in করে **Voice profiles**-এ নিজের Cartesia voice ID ও display name যোগ করুন—নিজের বা স্পষ্ট অনুমতিপ্রাপ্ত voice-ই ব্যবহার করুন। **App settings**-এ `sonic-3.6`, transcript language (`bn` বা প্রয়োজনে `bn-IN`), default voice ও Telegram display URL দিন। **Test connection** Cartesia-র authenticated voice-list endpoint server থেকে কল করে; এটি TTS generation চালায় না। **App access keys**-এ Android installation-এর জন্য app key তৈরি করুন; key একবারই দেখায়, তাই copy করে গোপনে রাখুন। Admin panel থেকে key disable/revoke করলে ওই key-এর বিদ্যমান app sessions-ও আর গ্রহণ করা হয় না।

Android login screen-এ backend-এর **HTTPS URL** এবং ওই app access key দিন—Cartesia API key নয়। App-এ TTS text backend-এ যায়, server enabled voice allowlist দিয়ে যাচাই করে Cartesia থেকে MP3 এনে দেয়। ফোনের imported/generated sound card স্থানীয়; তা server-এ upload হয় না।

## API সংক্ষিপ্ত তালিকা

| Method ও route | Access | কাজ / সীমা |
|---|---|---|
| `GET /healthz` | Public | Minimal liveness; কোনো key-state প্রকাশ নয় |
| `GET /api/health` | Public | Service online timestamp; Cartesia key configured কি না বলে না |
| `POST /api/admin/login` | Same-origin browser request | JSON `{ "username", "password" }`; HttpOnly session cookie, 12 ঘণ্টা |
| `POST /api/admin/logout` | Admin session + same-origin Origin/Referer | Current admin session revoke |
| `/api/admin/status`, `/cartesia-check`, `/settings`, `/voices`, `/client-keys` | Admin session | Provider status, settings ও allowlist/key পরিচালনা |
| `POST /api/client/login` | App key | JSON `{ "accessKey", "deviceId" }`; 60 দিনের bearer session |
| `GET /api/client/config`, `GET /api/client/voices` | Bearer app session | Non-secret app config ও enabled voices |
| `POST /api/client/tts` | Bearer app session | JSON `{ "text", "voiceId" }`; enabled voice বাধ্যতামূলক, 1–1,500 character; MP3 bytes ফেরত |

Login limit: প্রতি IP-তে 15 মিনিটে 12টি attempt। TTS limit: প্রতি IP-তে মিনিটে 100 request এবং প্রতি client access key-তে মিনিটে 20 request; এক server process-এ সর্বোচ্চ 4টি concurrent TTS। TTS response 12 MiB-তে bounded। Rate-limit store memory-based: restart হলে counters reset হয়; একাধিক replica চালালে shared limiter store ও shared persistent database architecture যোগ করুন। `deviceId` hash আকারে login record-এ থাকে, কিন্তু device-lock হিসেবে enforcement করা হয় না। Valid login-এ expired client sessions পরিষ্কার হয়; admin key revoke তাৎক্ষণিকভাবে session invalid করে।

Admin cookie cross-site Preview frame-এ কাজের জন্য `SameSite=None; Secure; HttpOnly`; admin write route-গুলো `Origin`/`Referer`-এর host-কে request `Host`-এর সঙ্গে মিলিয়ে দেখে, এবং HTTPS ছাড়া non-local origin reject করে। Production-এ HTTPS বাধ্যতামূলক। Admin page/API একই origin-এ serve করুন; broad CORS খুলবেন না।

## HTTPS reverse proxy ও Docker

`Dockerfile` lockfile-সহ `pnpm install --prod --frozen-lockfile` চালায়; `/data` persistent volume হিসেবে mount করুন। Container/host-এ `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `CARTESIA_API_KEY`, `PORT`, `DATA_DIR=/data`, `NODE_ENV=production`, `CARTESIA_VERSION=2026-08-14` সেট করুন। Node app direct public ingress নয়, একটি trusted HTTPS reverse proxy-র পেছনে চালান। Proxy-টি client-supplied `X-Forwarded-*` headers মুছে নিজের header বসায় এবং request host preserve করে—তবেই `TRUST_PROXY=true` করুন; এই সেটিং ঠিক এক trusted hop মানে। Direct ingress বা অজানা proxy chain-এ `TRUST_PROXY=false` রাখুন।

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm start
```

Container উদাহরণ:

```sh
docker build -t as-anamul-voice-backend .
docker run --rm -p 3000:3000 -v asav-data:/data \
  -e NODE_ENV=production -e DATA_DIR=/data \
  -e ADMIN_USERNAME='your-admin' -e ADMIN_PASSWORD='replace-with-a-strong-secret' \
  -e CARTESIA_API_KEY='set-in-your-host-secret-manager' \
  as-anamul-voice-backend
```

Command-line example-এ real production secret দেবেন না; hosting secret manager ব্যবহার করুন। `.env`, SQLite database, app access key, provider key, signing key বা compiled APK source ZIP-এ রাখবেন না।

## Cartesia reference এবং Android সীমা

Backend `POST https://api.cartesia.ai/tts/bytes`, required `Cartesia-Version: 2026-08-14`, model, transcript, enabled voice ID, Bengali-সহ selected language/locale এবং MP3 format ব্যবহার করে। Provider-র raw error body/API key client-এ ফেরত যায় না। Cartesia docs: [TTS Bytes](https://docs.cartesia.ai/api-reference/tts/bytes), [List Voices](https://docs.cartesia.ai/api-reference/voices/list), [Bengali ও অন্যান্য locale](https://docs.cartesia.ai/build-with-cartesia/capability-guides/advanced-capabilities).

Associated Android app `minSdk=26`, `targetSdk=36` (Android 16)। Root/Shizuku AudioPolicy route শুধু অ্যাপের দৃশ্যমান control থেকে স্পষ্টভাবে চালু হয়; “ready” শুধু local route initialization—game/microphone receipt নয়। Manufacturer/game policy ও Android version অনুযায়ী ফল বদলায়; real device/game test matrix Android source ZIP-এ আছে। Android 17+ verified নয়; stealth/anti-cheat bypass নেই।
