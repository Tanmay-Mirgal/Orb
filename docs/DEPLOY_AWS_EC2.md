# Orb ko AWS EC2 par deploy karna — step by step

Ye guide **zero se production tak** ka poora raasta batati hai: AWS account me kya banana hai, server par kaunsi cheez install karni hai, har command, har config value, aur kaam kar raha hai ya nahi ye check karne ke tareeke.

> **Domain example:** is guide me `tanmaymirgal.dev` use hua hai. Dashboard `orb.tanmaymirgal.dev` par hoga aur har project `<project>.orb.tanmaymirgal.dev` par. Apna domain ho to har jagah wahi replace karo.

## 0. Pehle ye samajh lo

### Kya banega

```
Internet ──► Elastic IP ──► EC2 (Ubuntu, Docker)
                              ├─ Caddy      → HTTPS (wildcard cert + custom domains)
                              ├─ web        → dashboard + API
                              ├─ proxy      → deployed sites/apps ko serve karta hai
                              ├─ worker     → git clone + docker build
                              ├─ runner     → customers ke containers chalata hai
                              ├─ postgres   → database
                              └─ redis      → queues / logs
                            S3 bucket       → static sites ki files + build logs
```

Ye **single-server setup** hai: sab kuch ek EC2 par. Shuru karne ke liye sahi hai; baad me runner/worker/proxy ko alag machines par le ja sakte ho ([Part 11](#11-baad-me-scale-karna)).

### Aapke paas ye hona chahiye

| Cheez | Kyun |
|---|---|
| AWS account (billing on) | EC2, S3, Elastic IP |
| Ek domain, jiska DNS **Cloudflare** par ho | wildcard HTTPS certificate (`*.orb.tanmaymirgal.dev`) ke liye DNS-01 challenge. Domain Cloudflare par nahi hai to Cloudflare par free zone bana ke nameservers badal lo (Part 3 me likha hai) |
| GitHub account | OAuth login + webhooks |
| Code GitHub par **push** kiya hua | server isse clone karega |
| Windows/Mac/Linux terminal with `ssh` | server me ghusne ke liye |

### Server ka size (important)

Builds (Next.js build kaafi RAM khata hai) aur customers ke containers **dono usi machine par** chalte hain.

| Use | Instance | Storage |
|---|---|---|
| Testing / chhota launch | `t3.large` (2 vCPU, 8 GB) | 60 GB gp3 |
| Real customers (shuruaat) | `t3.xlarge` (4 vCPU, 16 GB) | 100 GB gp3 |

`t3.medium` (4 GB) par Next.js builds fail ho sakte hain — mat lo. Cost region ke hisaab se badalti hai (t3.large lagbhag $60–70/month on-demand); AWS Pricing Calculator se check kar lo.

---

## 1. Code GitHub par push karo (apne laptop se)

Orb v2 ka sara kaam abhi local me hai. Server ko wahi code chahiye.

```bash
cd D:/orb
git status
git add -A
git commit -m "feat: Orb v2 — multi-tenant platform (services, workers, cron, teams, S3 storage)"
git push origin main
```

Repo **private** hai to server ko clone karne ki permission chahiye — [Part 5](#55-code-server-par-lao) me deploy key ka tareeka hai.

---

## 2. AWS me resources banao

AWS Console kholo → upar **region** chuno (Indian users ke liye `Asia Pacific (Mumbai) ap-south-1`). Poori guide me **same region** use karo.

### 2.1 Key pair (SSH ke liye)

EC2 → **Key Pairs** → **Create key pair**
- Name: `orb-key`
- Type: `RSA`, Format: `.pem`
- Create → `orb-key.pem` download hoti hai. **Ise safe rakho, dobara nahi milegi.**

**Windows par** (PowerShell) permissions theek karo, warna ssh mana kar dega:

```powershell
icacls "C:\Users\tanma\Downloads\orb-key.pem" /inheritance:r
icacls "C:\Users\tanma\Downloads\orb-key.pem" /grant:r "$($env:USERNAME):(R)"
```

**Mac/Linux:**

```bash
chmod 400 ~/Downloads/orb-key.pem
```

### 2.2 Security Group (firewall)

EC2 → **Security Groups** → **Create security group**
- Name: `orb-sg`, Description: `Orb platform`, VPC: default

**Inbound rules** (bas itne hi — aur kuch kholna nahi):

| Type | Protocol | Port | Source | Kyun |
|---|---|---|---|---|
| SSH | TCP | 22 | **My IP** | server me login (sirf aapka IP) |
| HTTP | TCP | 80 | Anywhere-IPv4 `0.0.0.0/0` | certificate challenge + redirect |
| HTTPS | TCP | 443 | Anywhere-IPv4 `0.0.0.0/0` | saara traffic |
| Custom UDP | UDP | 443 | Anywhere-IPv4 `0.0.0.0/0` | HTTP/3 |

Outbound: default (all) rehne do.

> ⚠️ **Kabhi mat kholo:** 3000, 8000, 5432, 6379, 5000, 9100–9102. Ye internal services hain.

### 2.3 EC2 instance launch karo

EC2 → **Instances** → **Launch instances**

| Field | Value |
|---|---|
| Name | `orb-prod` |
| AMI | **Ubuntu Server 24.04 LTS** (64-bit x86) |
| Instance type | `t3.large` (ya `t3.xlarge`) |
| Key pair | `orb-key` |
| Network settings → Security group | **Select existing** → `orb-sg` |
| Storage | `60` GiB, type **gp3** (ya 100 GiB) |

Phir **Advanced details** kholo aur neeche scroll karke ye dono set karo (customers ke containers ko AWS credentials churane se rokta hai):

- **Metadata accessible**: `Enabled`
- **Metadata version**: `V2 only (token required)`
- **Metadata response hop limit**: **`1`**

→ **Launch instance**.

> Pehle se bani instance par bhi kar sakte ho: Instance select → Actions → Instance settings → *Modify instance metadata options*.

### 2.4 Elastic IP (fixed public IP)

EC2 → **Elastic IPs** → **Allocate Elastic IP address** → Allocate.
Phir us IP ko select karke **Actions → Associate Elastic IP address** → Instance: `orb-prod` → Associate.

Ye IP note kar lo (`ELASTIC_IP`). Isi ko DNS me daalna hai.

### 2.5 S3 bucket (static sites + logs ke liye)

S3 → **Create bucket**
- Name: `orb-artifacts-<kuch-unique>` (e.g. `orb-artifacts-tanmay-2026`) — globally unique hona chahiye
- Region: wahi jo EC2 ka hai
- **Block all public access: ON** (default, aise hi rehne do — files proxy ke through serve hongi)
- Versioning: optional (accidental delete se bachata hai)

### 2.6 IAM user (sirf is bucket ki access ke saath)

> Instance role kyun nahi? Humne metadata hop-limit 1 kiya hai taaki customers ke containers credentials na chura sakein. To Orb ke liye alag access key chahiye.

IAM → **Policies** → **Create policy** → **JSON** tab me ye paste karo (bucket ka naam apna daalo):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::orb-artifacts-tanmay-2026"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::orb-artifacts-tanmay-2026/*"
    }
  ]
}
```

Name: `orb-s3-access` → Create.

IAM → **Users** → **Create user** → name `orb-app` (console access **mat** do) → *Attach policies directly* → `orb-s3-access` → Create.
User kholo → **Security credentials** → **Create access key** → use case *Application running outside AWS* → Create.
**Access key ID** aur **Secret access key** copy karke safe jagah rakho (secret dobara nahi dikhega).

---

## 3. DNS (Cloudflare)

### 3.1 Domain Cloudflare par hai?

Nahi hai to: cloudflare.com par free account → **Add a site** → `tanmaymirgal.dev` → Free plan → Cloudflare jo 2 nameservers deta hai unhe apne registrar (GoDaddy/Namecheap/…) me set karo. Active hone me kuch minute–ghante lagte hain. (Route 53 use karna ho to Caddy me `caddy-dns/route53` plugin lagana padega — `deploy/caddy/Dockerfile` dekho.)

### 3.2 DNS records

Cloudflare → domain → **DNS** → **Records** → **Add record**:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `orb` | `ELASTIC_IP` | **DNS only** (grey cloud ☁️) |
| A | `*.orb` | `ELASTIC_IP` | **DNS only** (grey cloud ☁️) |

> Orange cloud (proxied) **mat** karo — Caddy ko TLS khud handle karna hai.

`*.orb` wildcard record `cname.orb.tanmaymirgal.dev` ko bhi cover karta hai — customers apne custom domain ko isi par CNAME karte hain.

### 3.3 Cloudflare API token (wildcard certificate ke liye)

Cloudflare → profile icon → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**
- Permissions: `Zone` → `DNS` → `Edit` **aur** `Zone` → `Zone` → `Read`
- Zone Resources: `Include` → `Specific zone` → `tanmaymirgal.dev`
- Create → token copy karo (`CLOUDFLARE_API_TOKEN`).

---

## 4. GitHub apps banao

Sirf **2 cheezein** chahiye. Dono ke liye domain aur URLs pehle se pata hain, isliye abhi bana lo.

### 4.1 OAuth App (login + repo list)

GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**

| Field | Value |
|---|---|
| Application name | `Orb` |
| Homepage URL | `https://orb.tanmaymirgal.dev` |
| Authorization callback URL | `https://orb.tanmaymirgal.dev/api/auth/callback/github` |

Register → **Client ID** copy karo → **Generate a new client secret** → secret copy karo.

### 4.2 GitHub App (push par auto-deploy)

GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**

| Field | Value |
|---|---|
| GitHub App name | `orb-deployment` (unique chahiye; busy ho to `orb-deploy-tanmay`) |
| Homepage URL | `https://orb.tanmaymirgal.dev` |
| Webhook → Active | ✅ |
| Webhook URL | `https://orb.tanmaymirgal.dev/api/webhooks/github` |
| Webhook secret | `openssl rand -hex 20` se banao (neeche Part 6) — abhi ek random string likh ke save rakho |
| Repository permissions | **Contents: Read-only**, **Metadata: Read-only** |
| Subscribe to events | ✅ **Push** |
| Where can this be installed? | Any account |

**Create GitHub App** → page par **App ID** dikhega (note karo) → neeche **Generate a private key** → `.pem` file download hogi.

> Samajh lo: webhook sirf un repos ke liye aata hai jahan ye **App install** ho. Har customer ko project banane ke baad App apni repo par install karna hoga: `https://github.com/apps/<app-name>/installations/new`. (Bina install ke manual **Deploy** button kaam karta hai; sirf auto-deploy nahi chalega.)

---

## 5. Server me login aur setup

### 5.1 SSH se connect

```bash
ssh -i ~/Downloads/orb-key.pem ubuntu@ELASTIC_IP
```

Windows PowerShell:

```powershell
ssh -i "C:\Users\tanma\Downloads\orb-key.pem" ubuntu@ELASTIC_IP
```

Pehli baar `Are you sure you want to continue connecting?` → `yes`.

> Ab se **saari commands server ke andar** chalani hain (jab tak likha na ho).

### 5.2 System update + basic tools

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates gnupg unzip htop
sudo timedatectl set-timezone Asia/Kolkata
```

Agar kernel update hua to reboot karo, phir dobara ssh karo:

```bash
sudo reboot
```

### 5.3 Swap lagao (RAM spike me builds ko mar-ne se bachata hai)

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### 5.4 Docker install (official repo se)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Apne user ko docker group me daalo (taaki har baar `sudo` na lagana pade) aur session refresh karo:

```bash
sudo usermod -aG docker $USER
exit
```

Dobara ssh karo, phir check:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

`Hello from Docker!` dikhe to sab theek.

### 5.5 Code server par lao

**Public repo:**

```bash
cd ~
git clone https://github.com/<TUMHARA_USERNAME>/<REPO_NAME>.git Orb
```

**Private repo (deploy key):**

```bash
ssh-keygen -t ed25519 -C "orb-server" -f ~/.ssh/orb_deploy -N ""
cat ~/.ssh/orb_deploy.pub
```

Jo public key print hui use copy karo → GitHub repo → **Settings → Deploy keys → Add deploy key** (Title `orb-server`, *Allow write access* **off**) → Add.
Phir:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/orb_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh-keyscan github.com >> ~/.ssh/known_hosts
git clone git@github.com:<TUMHARA_USERNAME>/<REPO_NAME>.git ~/Orb
```

Check:

```bash
cd ~/Orb && ls && git log --oneline | head -3
```

(`deploy/docker-compose.prod.yml`, `Dockerfile`, `Caddyfile` dikhne chahiye.)

---

## 6. Configuration (`.env`)

### 6.1 File banao aur secrets generate karo

```bash
cd ~/Orb
cp .env.example .env
chmod 600 .env

# 4 random secrets apne aap bhar do
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=\"$(openssl rand -hex 32)\"|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"|" .env
sed -i "s|^INTERNAL_API_TOKEN=.*|INTERNAL_API_TOKEN=\"$(openssl rand -hex 32)\"|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=\"$(openssl rand -hex 24)\"|" .env
```

> 🔐 **`ENCRYPTION_KEY` ka backup lo** (password manager me). Ye gaya to customers ke saare environment variables hamesha ke liye unreadable ho jayenge.

### 6.2 Baaki values bharo

```bash
nano .env
```

(Save: `Ctrl+O`, `Enter`; exit: `Ctrl+X`.) In lines ko **apni values** se badlo:

```dotenv
# ── URLs ─────────────────────────────────────────
BASE_DOMAIN="orb.tanmaymirgal.dev"
NEXT_PUBLIC_BASE_DOMAIN="orb.tanmaymirgal.dev"
NEXT_PUBLIC_APP_URL="https://orb.tanmaymirgal.dev"
BETTER_AUTH_URL="https://orb.tanmaymirgal.dev"
PUBLIC_HTTPS="true"
PUBLIC_PORT=""
DASHBOARD_HOST="orb.tanmaymirgal.dev"
ACME_EMAIL="tum@tanmaymirgal.dev"
PLATFORM_IPS="ELASTIC_IP"            # apex custom domains (example.com) ke A record ke liye

# ── Cloudflare (wildcard certificate) ────────────
CLOUDFLARE_API_TOKEN="<Part 3.3 ka token>"

# ── GitHub ───────────────────────────────────────
GITHUB_CLIENT_ID="<Part 4.1 Client ID>"
GITHUB_CLIENT_SECRET="<Part 4.1 secret>"
GITHUB_APP_ID="<Part 4.2 App ID>"
GITHUB_APP_WEBHOOK_SECRET="<Part 4.2 me jo webhook secret daala tha>"
GITHUB_APP_INSTALLATION_URL="https://github.com/apps/orb-deployment"
GITHUB_APP_PRIVATE_KEY=""            # neeche 6.3 dekho

# ── Storage: AWS S3 ──────────────────────────────
STORAGE_DRIVER="s3"
S3_BUCKET="orb-artifacts-tanmay-2026"
S3_REGION="ap-south-1"
S3_ENDPOINT=""                       # AWS S3 ke liye khali
S3_ACCESS_KEY_ID="<Part 2.6 Access key ID>"
S3_SECRET_ACCESS_KEY="<Part 2.6 Secret>"
S3_FORCE_PATH_STYLE=""

# ── Single server: registry ki zaroorat nahi ─────
REGISTRY_URL=""
```

Baaki sab defaults rehne do. `GITHUB_APP_WEBHOOK_SECRET` ko exactly wahi rakho jo GitHub App me save kiya tha.

### 6.3 GitHub App ki private key ko `.env` me daalna

`.pem` file multi-line hoti hai; `.env` me **ek line** chahiye (newlines `\n` me badal ke). Apne **laptop** par (jahan `.pem` download hui):

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' ~/Downloads/orb-deployment.private-key.pem
```

Jo ek lambi line print ho use copy karo, server par `nano .env` me daalo:

```dotenv
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
```

> Abhi v2 me ye key sirf tab use hoti hai jab project ka `installation_id` set ho (private repo ke liye GitHub App token). Normal flow me private repos user ke OAuth token se clone hoti hain. Webhook secret **zaroori** hai; private key abhi optional.

### 6.4 Ek baar sab values check karo

```bash
grep -E '^(BASE_DOMAIN|DASHBOARD_HOST|STORAGE_DRIVER|S3_BUCKET|S3_REGION|PUBLIC_HTTPS|NEXT_PUBLIC_APP_URL)=' .env
grep -cE '^(BETTER_AUTH_SECRET|ENCRYPTION_KEY|INTERNAL_API_TOKEN|POSTGRES_PASSWORD)="[0-9a-f]{40,}"' .env   # 4 aana chahiye
```

---

## 7. Start karo 🚀

Roz ki commands chhoti karne ke liye alias bana lo:

```bash
echo "alias orb='docker compose -f ~/Orb/deploy/docker-compose.prod.yml --env-file ~/Orb/.env'" >> ~/.bashrc
source ~/.bashrc
```

Ab pehli baar build + start (**10–20 minute** lagte hain, images bann rahi hain):

```bash
cd ~/Orb
orb up -d --build
```

Progress dekhne ke liye (doosre terminal me ya baad me):

```bash
orb ps
orb logs -f --tail=50 migrate web
```

Expected: `migrate` container `Exited (0)` hoga ("Migrations are up to date"), baaki sab `running` / `healthy`.

### 7.1 Check list

```bash
# 1. Sab containers up?
orb ps

# 2. Dashboard health (Postgres + Redis OK?)
curl -s https://orb.tanmaymirgal.dev/api/health
# → {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}

# 3. Runner node registered?
orb exec redis redis-cli smembers orb:nodes
# → "node-1"

# 4. Wildcard certificate mila?
orb logs caddy | grep -iE "certificate obtained|error" | tail
```

Browser me **https://orb.tanmaymirgal.dev** kholo → **Login with GitHub**. Pehla login ho gaya = DB, auth, redis sab kaam kar rahe hain. Aapko apne aap ek personal team mil jati hai.

> Certificate me 1–2 minute lag sakte hain. Caddy logs me `dns` / `403` / `Invalid request headers` jaise errors dikhein to [Troubleshooting](#13-troubleshooting) dekho.

---

## 8. Pehla deployment test karo

### 8.1 Static site

1. Dashboard → **New** → **Frontend Framework** → apni koi Vite/React repo chuno.
2. Framework, build command, output directory **auto-detect** ho jayenge → **Deploy**.
3. Project page par live build log aayega. Aakhir me `✓ Ready at https://<slug>.orb.tanmaymirgal.dev`.
4. Us URL ko browser me kholo.

### 8.2 Backend service

Ek chhota Node server repo lo (yaad rakho: `process.env.PORT` par sunna hai, `0.0.0.0` par):

```js
// server.js
import http from 'node:http';
http.createServer((req, res) => res.end('hello from orb\n')).listen(process.env.PORT || 3000, '0.0.0.0');
```

Dashboard → **New** → **Backend Web Service** → repo → Start command `node server.js` (ya `npm start`), Port `3000` → Deploy.
Log me `[scheduler] ✓ Instance … healthy` dikhega, phir `Live`. **Runtime Logs** tab me app ke logs aate hain.

### 8.3 Rollback test

Project → **Deployments** → purane `READY` deployment par **Rollback to this** → turant live.

### 8.4 Custom domain test

Project → **Domains** → `app.example.com` daalo → dashboard 2 DNS records dikhayega:

| Type | Name | Value | Kaam |
|---|---|---|---|
| TXT | `_orb-challenge.app.example.com` | `orb-verification=…` | domain tumhara hai ye saabit karna |
| CNAME | `app.example.com` | `cname.orb.tanmaymirgal.dev` | traffic yahan bhejna |

Apne domain ke DNS me ye dono banao → **Verify DNS** dabao (ya 5 minute ruko, worker khud check karta hai). Status `Active` hone par `https://app.example.com` chalega aur certificate apne aap ban jayega.
Apex domain (`example.com`) ke liye CNAME ki jagah **A record → ELASTIC_IP** banta hai (dashboard wahi dikhata hai kyunki `PLATFORM_IPS` set hai).

---

## 9. Pehle se v1 (PM2 + MinIO) chal raha hai? — migration

Agar isi (ya purane) EC2 par purana Orb chal raha hai, to **is Part ko Part 6 se pehle** karo. Data bachane ka order:

```bash
# 1. Purani .env ka backup (secrets yahin hain — BETTER_AUTH_SECRET wahi rakhoge to users logged-in rahenge)
cp ~/Orb/.env ~/orb-v1.env

# 2. Database dump (v1 ka postgres container: orb-postgres)
docker exec orb-postgres pg_dump -U orb -d orb --no-owner > ~/orb-v1-backup.sql
ls -lh ~/orb-v1-backup.sql

# 3. Purani cheezein band karo (ports 80/443 khali honi chahiye)
pm2 delete all && pm2 save
sudo systemctl stop caddy && sudo systemctl disable caddy
cd ~/Orb && docker compose down          # purana compose (minio/postgres/redis); volumes bache rahenge

# 4. Naya code lao
git pull origin main
```

Phir **Part 6** (`.env`) karo — `BETTER_AUTH_SECRET` aur `GITHUB_CLIENT_*` `~/orb-v1.env` se wahi copy kar sakte ho. Phir:

```bash
# 5. Sirf naya postgres chalao aur purana data restore karo
orb up -d postgres
until orb exec -T postgres pg_isready -U orb -d orb; do sleep 2; done
orb exec -T postgres psql -U orb -d orb < ~/orb-v1-backup.sql

# 6. Ab poora stack — migrate service v1 schema ko apne aap v2 me badal degi
orb up -d --build

# 7. Purane plaintext env vars ko encrypt karo (ek baar)
orb run --rm migrate npm run db:encrypt-legacy
```

Dhyan rakho:
- Har purane user ko ek personal team mil jati hai aur projects usme chale jaate hain.
- **Purane deployments serve nahi honge** (wo MinIO zip files thi). Har project me ek baar **Deploy** dabao.
- Sab theek chalne ke baad purane volumes hata sakte ho: `docker volume ls` → `docker volume rm <purane volume>`.

---

## 10. Security hardening (public launch se pehle zaroor karo)

Customers ka code aapke server par chalta hai, isliye ye steps skip mat karo.

### 10.1 Customers ke containers ko andar ke network se rokna

Containers ko internet milna chahiye, par AWS metadata (credentials), aapke VPC ke doosre resources, aur doosre customers ke published ports **nahi**.

(Metadata endpoint par IMDSv2 hop-limit 1 pehle hi laga diya — Part 2.3.)

```bash
# VPC ka CIDR dekho: EC2 console → instance → Networking → VPC → CIDR (default VPC: 172.31.0.0/16)
sudo tee /usr/local/bin/orb-firewall.sh >/dev/null <<'EOF'
#!/bin/bash
# Customers ke containers (network orb-apps) ke liye outbound restrictions.
set -euo pipefail
VPC_CIDR="172.31.0.0/16"          # <-- apna VPC CIDR

docker network inspect orb-apps >/dev/null 2>&1 || \
  docker network create --driver bridge -o com.docker.network.bridge.enable_icc=false --label orb.managed=true orb-apps

SUBNET=$(docker network inspect orb-apps -f '{{(index .IPAM.Config 0).Subnet}}')

add() { iptables -C DOCKER-USER "$@" 2>/dev/null || iptables -I DOCKER-USER "$@"; }
add -s "$SUBNET" -d 169.254.0.0/16 -j DROP     # metadata endpoint
add -s "$SUBNET" -d 172.17.0.0/16 -j DROP      # docker0: doosre customers ke published ports
add -s "$SUBNET" -d "$VPC_CIDR"  -j DROP       # aapke VPC ke doosre servers / databases
add -s "$SUBNET" -d 10.0.0.0/8   -j DROP
add -s "$SUBNET" -d 192.168.0.0/16 -j DROP
# Host ki apni services (SSH, etc.) tak bhi customers ke containers na pahunch sakein
iptables -C INPUT -s "$SUBNET" -j DROP 2>/dev/null || iptables -I INPUT -s "$SUBNET" -j DROP
EOF
sudo chmod +x /usr/local/bin/orb-firewall.sh

sudo tee /etc/systemd/system/orb-firewall.service >/dev/null <<'EOF'
[Unit]
Description=Orb tenant network restrictions
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/orb-firewall.sh

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now orb-firewall.service
sudo systemctl status orb-firewall.service --no-pager
```

**Test karo** (pehli do commands me `BLOCKED (good)` aana chahiye):

```bash
docker run --rm --network orb-apps curlimages/curl -s -m 4 http://169.254.169.254/latest/meta-data/ || echo "BLOCKED (good)"
# doosre customers ke published ports: ek test container docker0 par publish karo
docker run -d --rm --name blocktest -p 172.17.0.1:18080:80 nginx:alpine
docker run --rm --network orb-apps curlimages/curl -s -m 4 http://172.17.0.1:18080 || echo "BLOCKED (good)"
docker rm -f blocktest
docker run --rm --network orb-apps curlimages/curl -s -m 4 -o /dev/null -w "internet: %{http_code}\n" https://example.com
```

Aakhri command `internet: 200` dikhaye (outbound internet chalna chahiye).

### 10.2 Automatic security updates + SSH hardening

```bash
sudo apt-get install -y unattended-upgrades fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades      # "Yes" select karo
sudo systemctl enable --now fail2ban
```

SSH par password login band hai (key-only) — verify:

```bash
sudo grep -E '^(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf
```

### 10.3 Worker aur runner ke baare me sach

Dono containers `/var/run/docker.sock` mount karte hain — iska matlab host par root-jaisi power. Is single-server setup me ye chalta hai agar server par aapke apne secrets/databases ke alawa kuch nahi hai. Jab bahut customers aa jayein to **builds aur customer containers alag EC2 machines par** le jao ([Part 11](#11-baad-me-scale-karna)).

---

## 11. Baad me scale karna

| Samasya | Kya karo |
|---|---|
| Builds slow / queue lambi | Naya EC2 lo (sirf worker), usi `.env` + `REGISTRY_URL` ke saath `docker compose up -d worker` |
| Customers ke apps ke liye jagah kam | Naya EC2 jis par sirf `runner` chale: `NODE_ID=node-2`, `RUNNER_ADDRESS`/`RUNNER_BIND_IP` = us machine ka **private IP**, `CONTROL_PLANE_URL`, `INTERNAL_API_TOKEN`, Redis ka private address, aur **registry** (ECR ya apna `registry:2` TLS ke saath) |
| Traffic zyada | `proxy` aur `web` ke replicas alag instances par, aage ALB/Cloudflare |
| Database | RDS PostgreSQL (`DATABASE_URL` badlo), connections ke liye PgBouncer |
| Redis | ElastiCache (`REDIS_URL` badlo) |

Multi-node ke liye ek **shared registry zaroori** hai (`REGISTRY_URL`) taaki runner nodes images pull kar sakein. Poori scaling guide: `README.md` → *Scaling guide*.

---

## 12. Roz ka kaam (operations)

### Update karna (naya code deploy)

```bash
cd ~/Orb
git pull origin main
orb up -d --build          # migrations apne aap chalte hain
orb ps
```

### Logs

```bash
orb logs -f --tail=100 web
orb logs -f --tail=100 worker
orb logs -f --tail=100 runner
orb logs -f --tail=100 proxy
orb logs -f --tail=100 caddy
```

### Restart / stop

```bash
orb restart worker
orb stop            # sab band (data volumes safe)
orb up -d           # wapas chalu
```

### Backup (database) — roz raat 3 baje

```bash
cat > ~/backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
mkdir -p ~/backups
docker compose -f ~/Orb/deploy/docker-compose.prod.yml --env-file ~/Orb/.env exec -T postgres pg_dump -U orb orb | gzip > ~/backups/orb-$(date +%F).sql.gz
find ~/backups -name 'orb-*.sql.gz' -mtime +14 -delete
EOF
chmod +x ~/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * $HOME/backup.sh >> $HOME/backup.log 2>&1") | crontab -
~/backup.sh && ls -lh ~/backups
```

Iske saath EBS snapshots ka schedule bhi lagao: EC2 → **Lifecycle Manager** → Create lifecycle policy (daily, 7 snapshots). Aur `.env` + `ENCRYPTION_KEY` ka alag backup rakho.

### Disk saaf rakhna

Har deployment ka Docker image disk par rehta hai (rollback ke liye). Mahine me ek baar dekho:

```bash
df -h /
docker system df
docker builder prune -f --filter until=168h     # purana build cache hatao (safe)
```

### Restore (database)

```bash
gunzip -c ~/backups/orb-YYYY-MM-DD.sql.gz | orb exec -T postgres psql -U orb -d orb
```

### Monitoring (optional par recommended)

CloudWatch → Alarms: `CPUUtilization > 80%` (15 min), `StatusCheckFailed`. Disk ke liye CloudWatch agent ya simple cron + email. Har service par `/metrics` (Prometheus) hai (ports 9100–9102 sirf andar se).

---

## 12b. Payments (Razorpay), e-mail aur cost controls

Ye teen cheezein naye `.env` variables se chalti hain (poori list `.env.example` me hai). Server ke `.env` me ye add karo, phir `orb up -d --build` (migration `0002`/`0003` apne aap chalti hai).

**Razorpay**
1. Dashboard → *Account & Settings → API keys*: `NEXT_PUBLIC_RAZORPAY_KEY_ID` aur `RAZORPAY_KEY_SECRET`. Pehle `rzp_test_…` keys se ek test payment karke dekh lo; `rzp_live_…` par asli paisa katta hai.
2. Dashboard → *Webhooks → Add*: URL `https://orb.<tumhara-domain>/api/webhooks/razorpay`, events `payment.captured`, `order.paid`, `payment.failed`. Jo secret tum yahan set karoge wahi `RAZORPAY_WEBHOOK_SECRET` me daalo. (Isse wo case bhi cover hota hai jab buyer payment ke baad tab band kar de.)
3. Plans prepaid hain (1 mahina / 1 saal), apne aap renew nahi hote. Prices `packages/shared/src/plans.ts` me (`priceInrMonth`, `priceInrYear`).

**E-mail (invitations, deploy/domain alerts, receipts)**
- Koi AWS service nahi, sirf nodemailer + SMTP. Sabse simple: Gmail. Google Account → Security → 2-Step Verification on → *App passwords* → ek 16-character password banao. Phir `.env` me sirf do lines:
  ```
  SMTP_USER=tumhara@gmail.com
  SMTP_PASSWORD=abcd efgh ijkl mnop
  ```
  (`@gmail.com` user ho to host `smtp.gmail.com` aur sender wahi address apne aap ban jaata hai; spaces password me se hata diye jaate hain.) Gmail ki limit ~500 mails/din hai, jo alerts + invites ke liye kaafi hai. Aur bada chahiye to koi bhi doosra SMTP (`SMTP_HOST`, `SMTP_PORT`) chalega.
- `SMTP_USER`/`SMTP_HOST` khaali ho to mail sirf log hoti hai (app phir bhi chalta hai).

**Owner ka complimentary Team plan**
`tanmaymirgal26@gmail.com` ko 5 saal ka Team plan migration `0003_owner_plan_grant.sql` se milta hai (table `plan_grants`). Wo email sign-in par verified honi chahiye. Is user ki saari owned teams (nayi bhi) Team plan par rehti hain. Aur kisi ko dena ho:
```bash
orb exec postgres psql -U orb -d orb -c "insert into plan_grants (email, plan, expires_at, note) values ('naam@example.com','pro', now() + interval '1 year', 'gift')"
```

**Cost:** scale-to-zero, limits aur AWS settings ke liye `docs/COST_OPTIMIZATION.md`.

---

## 12c. Ecosystem connector (Hub) enable karna

Ye feature **default me band** hai (`CONNECTOR_ENABLED=false`). Band rehne par koi naya route, table write, worker job ya extra query nahi chalti, to AWS cost par koi farak nahi. Enable karne par bhi cost almost zero hai: worker har 5 second me ek chhoti indexed query chalata hai aur ek ghante me ek cleanup job; naya server, queue service ya S3 bucket nahi chahiye.

Poora protocol, curl examples aur event list: `docs/CONNECTOR.md`.

**Enable karne ke steps**
1. Secrets banao (har ek ke liye alag `openssl rand -hex 32`) aur server ke `.env` me daalo:
   ```
   CONNECTOR_ENABLED="true"
   CONNECTOR_HUB_NAME="Hub"
   CONNECTOR_HUB_CLIENT_ID="hub"
   CONNECTOR_HUB_CLIENT_SECRET="<openssl rand -hex 32>"
   CONNECTOR_HUB_REDIRECT_URIS="https://hub.<tumhara-domain>/connect/orb/callback"   # exact match, https
   CONNECTOR_TOKEN_PEPPER="<openssl rand -hex 32>"
   CONNECTOR_ENCRYPTION_KEY="<openssl rand -hex 32>"      # pepper se alag value
   ```
   Koi value missing ya chhoti hui to `web` aur `worker` start hi nahi honge aur message me batayenge kya galat hai.
2. Migration `0005_connector` apne aap chalti hai: `orb up -d --build` (ya `npm run db:migrate`).
3. **Web aur worker dono restart** karo. (Sirf web restart karoge to webhooks deliver nahi honge, kyunki dispatcher worker me chalta hai.)
4. Check: `curl https://orb.<tumhara-domain>/.well-known/ecosystem-connector.json` JSON de, aur Settings me **Connected apps** tab dikhe.
5. Hub ko `client id`, `client secret` aur discovery URL de do.

**Dhyan rakho**
- `CONNECTOR_TOKEN_PEPPER` badla to har connected app logout ho jaata hai (users ko dobara Allow karna padega).
- `CONNECTOR_ENCRYPTION_KEY` badlo to purani key `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` me rakho, warna purane webhook secrets padhe nahi jaayenge.
- Band karna ho: `CONNECTOR_ENABLED="false"` + restart. Data tables me rehta hai.
- `CONNECTOR_ALLOW_PRIVATE_WEBHOOKS` sirf local development ke liye hai, production me ignore hota hai.

---

## 13. Troubleshooting

| Dikkat | Kaaran / Fix |
|---|---|
| `orb up` me `POSTGRES_PASSWORD` required error | `.env` me `POSTGRES_PASSWORD` khali hai → Part 6.1 ki `sed` command dobara chalao |
| Site par certificate error / `ERR_SSL_PROTOCOL_ERROR` | `orb logs caddy`. Aksar: Cloudflare token ki permissions galat (Zone:DNS:Edit + Zone:Read), DNS records orange-cloud hain, ya `*.orb` record nahi hai |
| `curl https://orb…/api/health` par 502 | `orb ps` dekho: `web` unhealthy? `orb logs web` — aksar `.env` value galat ya DB password mismatch |
| Login ke baad `redirect_uri_mismatch` | GitHub OAuth App ka callback exactly `https://orb.tanmaymirgal.dev/api/auth/callback/github` hona chahiye |
| Build `docker: command not found` / permission denied | worker container me `/var/run/docker.sock` mount hona chahiye (`orb exec worker docker version`) |
| Deployment `No runner nodes are online` | `orb logs runner`. `INTERNAL_API_TOKEN` set hai? Docker socket mount hai? `orb exec redis redis-cli smembers orb:nodes` khali to runner crash ho raha hai |
| Service `Health check … did not pass` | App `process.env.PORT` par `0.0.0.0` se sun raha hai? Project Settings me Port aur Health path sahi hain? Runtime Logs me error dekho |
| Service build ho gaya par site `503 Service starting` | Instance healthy nahi; **Runtime Logs** aur `orb logs runner` dekho |
| Webhook se auto-deploy nahi ho raha | GitHub App → *Advanced → Recent Deliveries*: `401` = webhook secret mismatch; `ignored` = GitHub App us repo par install nahi; Project Settings me *Auto-deploy* on hai? |
| Static site par `503 Deployment unavailable` | S3 credentials / bucket / region galat: `orb logs worker` me `AccessDenied` ya `NoSuchBucket` |
| `no space left on device` | `df -h`, `docker system df`; `docker builder prune -af`; zarurat ho to EBS volume badhao (EC2 → Volumes → Modify, phir `sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1`) |
| Builds `Killed` / out of memory | bada instance lo (`t3.xlarge`) ya swap badhao |
| Custom domain `pending` hi rehta hai | TXT record exactly `_orb-challenge.<domain>` par hai? `dig TXT _orb-challenge.app.example.com +short` |
| Domain verified par certificate nahi | `dig app.example.com +short` aapke Elastic IP / CNAME par point kare; port 80 open ho; `orb logs caddy` |

Aur kuch atke to ye teen output bhejo: `orb ps`, `orb logs --tail=80 <service>`, aur `.env` ke **bina secrets** wale hisse.

---

## Quick cheat-sheet

```bash
orb ps                                   # status
orb up -d --build                        # start / update
orb logs -f --tail=100 worker            # logs
orb restart runner                       # ek service restart
orb exec redis redis-cli smembers orb:nodes   # runner nodes
orb run --rm migrate npm run db:migrate  # migrations manually
cd ~/Orb && git pull origin main && orb up -d --build   # update
```

Poora design, scaling aur security model: `README.md`.
