# Hosting the AI Recovery Tracker

## Quick Start — Temporary Public URL (No Account Required)

Double-click **`start-public.bat`** — it starts the server and opens a Cloudflare tunnel. A public HTTPS URL appears in the console (e.g. `https://xxxx.trycloudflare.com`). The URL changes each time you restart.

---

## Permanent Public URL — Cloudflare Named Tunnel (Free)

To get a stable subdomain that never changes:

### Prerequisites
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A domain managed in Cloudflare DNS (you can get one free with Cloudflare Registrar or transfer an existing one)

### Setup

1. **Log in to Cloudflare from the terminal:**
   ```
   cloudflared.exe login
   ```
   A browser window opens — choose your account and authorize.

2. **Create a named tunnel:**
   ```
   cloudflared.exe tunnel create recovery-tracker
   ```
   This creates a tunnel credential file at `%USERPROFILE%\.cloudflared\<UUID>.json`.

3. **Create the config file** — save as `%USERPROFILE%\.cloudflared\config.yml`:
   ```yaml
   tunnel: recovery-tracker
   credentials-file: C:\Users\<YourName>\.cloudflared\<UUID>.json

   ingress:
     - hostname: recovery.yourdomain.com
       service: http://localhost:3001
     - service: http_status:404
   ```
   Replace `recovery.yourdomain.com` with your chosen subdomain and `<UUID>` with the ID from step 2.

4. **Add DNS record:**
   ```
   cloudflared.exe tunnel route dns recovery-tracker recovery.yourdomain.com
   ```

5. **Test the named tunnel:**
   ```
   cloudflared.exe tunnel run recovery-tracker
   ```

6. **Install as a Windows Service** (auto-starts on boot):
   ```
   cloudflared.exe service install
   ```

Your app will then be permanently available at `https://recovery.yourdomain.com`.

---

## Security Checklist for Public Hosting

Before exposing the app publicly:

1. **Set a strong JWT secret** in `.env` — generate one with:
   ```
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
   Then add to `.env`:
   ```
   JWT_SECRET=<paste the generated value here>
   ```

2. **Create a user account** (Settings → Create Account) and log in before sharing the URL. The app is open to registration until the first account is created.

3. **Don't share your `.env` file** — it contains your API key and JWT secret.

---

## Run as a Windows Service (Server Always On)

To keep the Node.js server running in the background automatically:

```bash
npm install -g pm2
pm2 start server.js --name "recovery-tracker"
pm2 startup
pm2 save
```

Then run the Cloudflare tunnel as a service (see step 6 above).

---

## Local Network Only (No Internet)

If you only want the app accessible on your home network (not public internet), just run `start-server.bat` and access it from other devices using your PC's local IP address:

```
http://192.168.1.x:3001
```

Find your IP with: `ipconfig` → look for IPv4 Address.
