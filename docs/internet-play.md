# Hosting Mythic VTT on the Internet

This guide covers how to run a Mythic VTT game host on the internet so your players can join from anywhere.

**Quick start:** if you have a domain and a firewall you can manage, start with the **tunnel** method (recommended). If you prefer simpler networking, use a **small VPS**. Port forwarding with Caddy is for advanced users with static IPs.

---

## 1. Tunnel (recommended)

A tunnel gives you a public URL without opening your home network or managing DNS. Popular free or cheap options:

- **Cloudflare Tunnel** (Free, for sites on Cloudflare)
- **ngrok** (Free tier, 1 concurrent tunnel)
- **Tailscale Funnel** (Free, if you use Tailscale)
- **Frp** / **Localtunnel** (Free, self-hosted options)

### How it works

The tunnel runs on your machine and opens an outbound connection to the tunnel service. It connects the tunnel's public URL to `localhost:8787` (or your configured port). Players open the public URL; the tunnel forwards their traffic back to your game host.

### Setup with Cloudflare Tunnel

1. **Install `cloudflared`:**

   ```sh
   # macOS
   brew install cloudflare/cloudflare/cloudflared

   # Linux (Debian/Ubuntu)
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```

2. **Start your game host:**

   ```sh
   mythic-host --port 8787  # default port; uses 127.0.0.1 only
   ```

   The host prints the DM link with `#host=...`.

3. **In a new terminal, start the tunnel:**

   ```sh
   cloudflared tunnel --url localhost:8787
   ```

   Cloudflare prints a temporary public URL (e.g., `https://abc-123.trycloudflare.com`).

4. **Set `MYTHIC_PUBLIC_URL` so the DM link uses the public address:**

   ```sh
   export MYTHIC_PUBLIC_URL="https://abc-123.trycloudflare.com"
   # Restart the host (or use --config mythic.config.json with publicUrl set)
   mythic-host --port 8787
   ```

   Now the DM link will print with the public URL, so players can bookmark it.

5. **Share the public URL** (without the `#host=...` fragment) with your players. Keep the DM link private—it can start a new session.

### Setup with ngrok

Similar to Cloudflare but requires a free account:

```sh
# Install ngrok, sign up at ngrok.com, and connect your account
ngrok auth <your-token>

# Start the tunnel
ngrok http 8787

# Set the public URL in your host config or env
export MYTHIC_PUBLIC_URL="https://abc-123.ngrok.io"
mythic-host --port 8787
```

### General tunnel tips

- **Domain-based tunnels** (e.g., Cloudflare with a domain you own) are more stable and persistent than temporary URLs.
- **WebSocket support:** all popular tunnels forward WebSockets (`/ws`), which is required for the game client.
- **Assets:** the same tunnel port serves client, WebSocket and assets (`/assets`). No special setup needed.
- **DM link security:** the `#host=<token>` fragment is single-use and never sent to the server. The public URL without the fragment is safe to share with players. Never post the DM link publicly; it can create a new session.

---

## 2. Port forwarding + Caddy reverse proxy

If you have a static IP, domain and can manage your router firewall, this method runs the host with HTTPS and proper SSL for WebSockets (WSS).

### Prerequisites

- A domain name (e.g., `mygame.example.com`)
- A static public IP or dynamic DNS service (e.g., Duck DNS)
- Router access to forward traffic
- Ability to point DNS to your IP

### Setup

1. **Configure your domain** to point to your public IP. If your IP changes, use a dynamic DNS service.

2. **Open your firewall.** Forward port 80 (HTTP) and 443 (HTTPS) to your game host machine on the same ports, and forward port 8787 (or your configured port) to `127.0.0.1:8787`.

   Example router config (varies by model):

   ```
   External port 443  →  Internal IP 192.168.1.5:443  (protocol TCP)
   External port 80   →  Internal IP 192.168.1.5:80   (protocol TCP)
   ```

3. **Install Caddy** on your game host machine:

   ```sh
   # macOS
   brew install caddy

   # Linux (Debian/Ubuntu)
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.caddy.community/stable/debian/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/caddy-archive-keyring.gpg] https://dl.caddy.community/stable/debian any main" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```

4. **Create a Caddyfile.** Save this as `/etc/caddy/Caddyfile` (Linux) or `~/Caddyfile` (macOS):

   ```caddy
   mygame.example.com {
     reverse_proxy localhost:8787
   }
   ```

5. **Start Caddy:**

   ```sh
   # macOS
   caddy start

   # Linux (systemd)
   sudo systemctl start caddy
   ```

   Caddy automatically obtains a Let's Encrypt certificate and handles HTTPS + WSS upgrade.

6. **Start your game host** on localhost only:

   ```sh
   export MYTHIC_PUBLIC_URL="https://mygame.example.com"
   mythic-host --port 8787  # listens on 127.0.0.1 by default
   ```

7. **Test:** open `https://mygame.example.com` in your browser. Caddy redirects to your host. The DM link will show the public URL.

### Dynamic DNS

If your IP changes, use a dynamic DNS service:

- **Duck DNS:** free; update your IP with a cron job:
  ```sh
  0 * * * * curl -s "https://www.duckdns.org/update?domains=myname&token=YOUR_TOKEN&ip=" >> /dev/null
  ```
- Configure Caddyfile to use the dynamic domain (e.g., `myname.duckdns.org`).

### Security notes

- Caddy only listens on :80 and :443 publicly. The game host still listens on `127.0.0.1:8787` (private). Nothing is exposed directly.
- Keep your domain and Caddy certificate secure.
- Regularly update Caddy and your OS.

---

## 3. Small VPS

Rent a small Virtual Private Server from a provider like DigitalOcean, Linode or Hetzner. The host runs there all the time, accessible worldwide.

### Setup

1. **Rent a VPS** with:
   - 1–2 GB RAM (plenty for ~10 players)
   - 20–50 GB disk (depends on assets and saves)
   - Public IPv4, a domain or static IP

2. **Connect via SSH** and update the OS:

   ```sh
   ssh root@YOUR_VPS_IP
   apt update && apt upgrade -y
   apt install -y git curl nodejs npm  # or use the latest Node LTS
   ```

3. **Install Mythic VTT:**

   ```sh
   # Clone the repo (or download a release binary when available)
   git clone https://github.com/MythicTomes/mythic-vtt.git
   cd mythic-vtt
   pnpm install
   pnpm build
   ```

   Or, when a binary release is available:

   ```sh
   # Download mythic-host binary
   curl -L -o /usr/local/bin/mythic-host https://releases.example.com/mythic-host-linux
   chmod +x /usr/local/bin/mythic-host
   ```

4. **Create a systemd unit file** at `/etc/systemd/system/mythic-host.service`:

   ```ini
   [Unit]
   Description=Mythic VTT Game Host
   After=network.target

   [Service]
   Type=simple
   User=mythic
   WorkingDirectory=/opt/mythic-vtt
   Environment="MYTHIC_PORT=8787"
   Environment="MYTHIC_PUBLIC_URL=https://mygame.example.com"
   Environment="MYTHIC_DATA_DIR=/var/lib/mythic-vtt"
   ExecStart=/usr/local/bin/mythic-host
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   Create the data directory and user:

   ```sh
   useradd -m -s /bin/false mythic
   mkdir -p /var/lib/mythic-vtt
   chown mythic:mythic /var/lib/mythic-vtt
   ```

5. **Configure reverse proxy with Caddy** (see section 2) or use a managed DNS proxy.

6. **Start the host:**

   ```sh
   systemctl daemon-reload
   systemctl enable mythic-host
   systemctl start mythic-host
   systemctl status mythic-host
   ```

7. **Back up regularly.** Copy `/var/lib/mythic-vtt` to cloud storage (e.g., S3, Backblaze B2) or your machine:

   ```sh
   # Automated backup via cron
   0 2 * * * tar -czf /backups/mythic-vtt-$(date +\%Y\%m\%d).tar.gz /var/lib/mythic-vtt
   ```

8. **Update Mythic VTT** when new versions release:
   ```sh
   cd /opt/mythic-vtt
   git pull
   pnpm install && pnpm build
   systemctl restart mythic-host
   ```

---

## Configuration

All hosting methods use the same settings. Choose one way to set them:

| Setting                | Flag               | Env var             | Config file | Default       |
| ---------------------- | ------------------ | ------------------- | ----------- | ------------- |
| Port                   | `--port 8787`      | `MYTHIC_PORT`       | `port`      | `8787`        |
| Bind address           | `--host 127.0.0.1` | `MYTHIC_HOST`       | `host`      | `127.0.0.1`   |
| Listen on LAN          | `--lan`            | `MYTHIC_LAN=1`      | `lan`       | false         |
| Data directory         | `--data-dir /path` | `MYTHIC_DATA_DIR`   | n/a         | `./data`      |
| Public URL for DM link | —                  | `MYTHIC_PUBLIC_URL` | `publicUrl` | localhost URL |

Precedence: flags > environment > config file > defaults.

Example with environment variables:

```sh
export MYTHIC_PORT=8787
export MYTHIC_PUBLIC_URL="https://mygame.example.com"
export MYTHIC_DATA_DIR="/var/lib/mythic-vtt"
mythic-host
```

Example with config file at `/data/mythic.config.json`:

```json
{
  "port": 8787,
  "host": "127.0.0.1",
  "publicUrl": "https://mygame.example.com",
  "campaignId": "campaign-uuid-here"
}
```

---

## Security checklist

- [ ] **Protect the DM link.** The `#host=<token>` fragment is single-use. Never share it; it can start a new session. Bookmark the public URL without the fragment for players.
- [ ] **Keep the host on 127.0.0.1 (localhost) only.** Use a reverse proxy (Caddy, nginx) in front, not `--lan` or `--host 0.0.0.0`. This keeps the host off the public internet.
- [ ] **Don't expose Docker.** If running in Docker, never expose port 8787 directly with `-p 8787:8787`. Use a reverse proxy or Caddy inside the container, listening on localhost.
- [ ] **Back up your data directory.** Campaigns and secrets live in `MYTHIC_DATA_DIR` (default `./data`). Back up weekly to cloud storage or a secure external drive.
- [ ] **Keep software updated.** Run `apt update && apt upgrade -y` regularly, and update Mythic VTT when releases are available.
- [ ] **Firewall rules.** Only allow ports 80 (HTTP) and 443 (HTTPS) from the internet. Keep SSH restricted to your IP if possible.

---

## Troubleshooting

| Problem                                            | Cause                                                            | Solution                                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebSocket connection fails behind proxy**        | Reverse proxy doesn't forward the `Upgrade` header               | Ensure your reverse proxy (Caddy, nginx) sets `Connection: Upgrade` and `Upgrade: websocket`. Most do this automatically; check the logs.                                                                        |
| **Mixed content error**                            | Client loaded over HTTPS, but tried to connect via WS (not WSS)  | Set `MYTHIC_PUBLIC_URL` to an HTTPS URL. The client will use `wss://` (secure WebSocket).                                                                                                                        |
| **Players see wrong public URL in the browser**    | `MYTHIC_PUBLIC_URL` not set or incorrect                         | Check the environment variable: `echo $MYTHIC_PUBLIC_URL`. It must match your reverse proxy's public address.                                                                                                    |
| **Players can't connect from outside the network** | Network is blocked, firewall rule missing, or DNS not configured | Check: (1) Domain resolves to your IP: `nslookup mygame.example.com`. (2) Firewall rule forwards port 443 to your machine. (3) Reverse proxy is running: `curl https://mygame.example.com` should load the game. |
| **Slow asset downloads**                           | Large images / models, no CDN                                    | For production, consider uploading assets to a CDN (Cloudflare, jsDelivr). In the MVP, assets are served from the game host; optimize images before upload.                                                      |
| **Certificate errors (self-signed)**               | Not using HTTPS, or using a self-signed cert                     | Use Let's Encrypt via Caddy (free). Self-signed certs will trigger browser warnings and break WebSocket upgrades.                                                                                                |
| **Data loss on VPS reboot**                        | Systemd unit not configured to restart the host                  | Check the service: `systemctl status mythic-host`. Ensure `Restart=on-failure` is set.                                                                                                                           |

---

## FAQ

**Q: Do players need an account?**
A: No. Players open the link, type a name and join a seat. No account or install needed.

**Q: Can I use my home internet?**
A: Yes, but your home IP may be blocked (many ISPs filter port 80/443). Try a tunnel first (Cloudflare, ngrok). For stable long-term hosting, a VPS is recommended.

**Q: What if the host crashes?**
A: The game state is saved in `MYTHIC_DATA_DIR` (default `./data`). Restart the host; it loads the last session and players can reconnect.

**Q: How do I back up campaigns?**
A: Copy the `data/campaigns/` folder. Or use the in-app export feature (coming soon) to download a zip.

**Q: Is there a hosted version?**
A: Yes, Mythic Cloud (optional). But self-hosting is free and fully featured.

---

## Next steps

- Check the [README](../README.md) for local LAN testing (`pnpm dev:table`).
- Review [DESIGN.md](../DESIGN.md) section 8 for the self-hosting philosophy.
- Report issues or ask questions on the [GitHub repo](https://github.com/MythicTomes/mythic-vtt).
