# DatesIdea karaoke helper

This is the small Windows service that downloads YouTube karaoke audio over your home connection. Keep it running only while you are comfortable exposing its Cloudflare Tunnel URL: it accepts requests only with `HELPER_SECRET`.

## 1. Install the prerequisites

Open **PowerShell as Administrator** and run:

```powershell
winget install --id yt-dlp.yt-dlp -e
winget install --id Cloudflare.cloudflared -e
winget install --id OpenJS.NodeJS.LTS -e
```

Close PowerShell, open a new normal PowerShell window, then confirm the installs:

```powershell
yt-dlp --version
cloudflared --version
node --version
```

Node must report version 20 or newer. This helper has no npm dependencies, so do **not** run `npm install`.

## 2. Set the environment variables

Generate a secret, keep it private, and put the same value in the deployed app's `HELPER_SECRET` setting (never a `NEXT_PUBLIC_` setting):

```powershell
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
$secret
setx HELPER_SECRET $secret
setx APP_URL "https://your-app.vercel.app"
setx ALLOWED_ORIGIN "https://your-app.vercel.app"
```

Replace both example URLs with the exact deployed app origin. Open a **new** PowerShell window after `setx` so it receives those values.

## 3. Start it

One window, one command:

```powershell
cd D:\dev\DatesIdea\helper
node index.mjs
```

Do **not** set `TUNNEL_URL`. Leaving it unset is what makes this unattended: the helper starts `cloudflared` itself, reads the hostname out of its output, and registers that. A quick tunnel gets a new hostname every time it starts, so one written down by hand is stale after the next reboot.

You should see:

```
Karaoke helper listening on http://127.0.0.1:8787
Quick tunnel is at https://word-word-word.trycloudflare.com
Helper tunnel URL registered.
```

That third line is the one that matters — it means the app can now find this machine. Registration repeats every 10 minutes.

Check it locally with `http://127.0.0.1:8787/health`, which should report `{ "ok": true, "version": "1.0.0" }`.

If you have a **named** Cloudflare Tunnel with a stable hostname, set `TUNNEL_URL` to it instead and the helper will use that and start no tunnel of its own.

## 4. Start it at Windows boot

Now that the helper runs its own tunnel, this is a single task. Run PowerShell as Administrator, correcting the paths if your installs differ:

```powershell
$helper = '"C:\Program Files\nodejs\node.exe" "D:\dev\DatesIdea\helper\index.mjs"'
schtasks /create /tn "DatesIdea Karaoke Helper" /tr $helper /sc onstart /ru $env:USERNAME /rl limited /f
```

To remove it later:

```powershell
schtasks /delete /tn "DatesIdea Karaoke Helper" /f
```

If `cloudflared` is not on the system `PATH` for the scheduled task, set `CLOUDFLARED_PATH` to its full location with `setx`.

## Notes

The requested yt-dlp selector prefers M4A but falls back to any best audio stream. With no ffmpeg (by design), that fallback can be WebM/Opus even though the wire contract labels the response `audio/mp4`; use an M4A-available video for guaranteed MP4 bytes.
