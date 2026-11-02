# AWS cost kam karne ke tareeke (Orb)

Orb ka bill mostly **ek EC2 machine ki RAM/CPU** aur thoda sa EBS/S3/data-transfer hai. Isliye sabse bada saving is baat se aati hai ki **free (Hobby) users ke containers 24×7 na chalein**. Neeche pehle wo changes hain jo code me ho chuke hain, phir AWS side ke settings jo tum console me kar sakte ho.

> Rupaye/dollar ke numbers sirf andaaza hain (region ke hisaab se badalte hain). Final number ke liye [AWS Pricing Calculator](https://calculator.aws/) dekho.

---

## 1. Code me kya badla (ab apne aap hota hai)

| Change | Kya karta hai | Cost par asar |
|---|---|---|
| **Scale-to-zero for Hobby web services** | 20 minute bina traffic ke baad free plan ki web service stop ho jaati hai. Agli request par edge proxy use dobara start karta hai aur "Waking this app up" page dikhata hai (3 s me reload). Static sites par koi asar nahi. | Free users ki RAM ka bada hissa free ho jaata hai. 20 free services me se aksar 2-3 hi ek saath awake hoti hain. |
| **Hobby par container projects ki limit (2)** | 5 projects me se sirf 2 web service/worker/cron ho sakte hain; static sites unlimited (5 tak) kyunki unka cost sirf S3 storage hai. | Ek free user ka worst-case compute 5 → 2 containers. |
| **Team banane ki limit (3 per user)** | Har team ko 5 free projects milte hain; bina limit ke ek aadmi 100 teams bana ke free tier multiply kar sakta tha. Paid team hone par limit 25. | Abuse band. |
| **Plan expire hone par Hobby sizes** | Paid plan khatam → projects ka instance size/count Hobby par reset (agle deploy se lagu) aur preview deployments band. | Lapsed customers bade instances par muft nahi chalte. |
| **Purane images ka cleanup** | Jab deployment ARCHIVED hoti hai to uski Docker image `docker rmi` se hat jaati hai. | EBS disk growth ruk jaati hai (EBS per GB-month charge hota hai). |
| **E-mail = plain nodemailer (SMTP)** | Alerts/invites ke liye koi AWS service nahi; Gmail app password ya koi bhi SMTP. | AWS bill par zero. |

Control: `.env` me `IDLE_SLEEP_MINUTES` (khaali = 20 min, `0` = sleep band). Plan ke numbers `packages/shared/src/plans.ts` me hain (`maxContainerProjects`, `idleSleepMinutes`).

**Dhyan rakho:** koi bhi uptime-monitor jo free service ko ping karta hai usse jagaaye rakhega - ye expected hai.

---

## 2. AWS console me karne wali cheezein

### 2.1 Graviton (ARM) instance - ~20% sasta
`t3.large` ki jagah **`t4g.large`** (same 2 vCPU / 8 GB). Orb ke saare Docker images multi-arch base images par bante hain (`node:22-bookworm-slim`, `docker:27-cli`), aur build usi machine par hota hai, to kuch badalna nahi padta. Naya instance launch karo, `deploy/docker-compose.prod.yml` wahin chalao.
Customers ke apne Dockerfiles bhi ARM par build honge - x86-only binaries wale projects ke liye note rakho.

### 2.2 Savings Plan / Reserved
Agar server hamesha chalna hai (1+ saal), **Compute Savings Plan (1 year, no upfront)** ~30-40% tak bachata hai. Pehle 2-3 mahine on-demand chalake dekh lo kitna size chahiye.

### 2.3 EBS volume sahi size ka
`60 GB gp3` kaafi hai shuruaat me. gp3 default IOPS (3000) free hai - extra IOPS mat lo. Disk 70% se upar jaye tab hi badhao (online resize ho jaata hai).

### 2.4 S3 lifecycle - build logs aur adhoora uploads
Static sites ki files `sites/<deploymentId>/…` me aur build logs `logs/…` me jaate hain. Ye rule bucket par laga do (Console → S3 → bucket → Management → Lifecycle rules, ya CLI):

```json
{
  "Rules": [
    { "ID": "abort-incomplete-uploads", "Status": "Enabled", "Filter": {}, "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } },
    { "ID": "expire-build-logs", "Status": "Enabled", "Filter": { "Prefix": "logs/" }, "Expiration": { "Days": 30 } },
    { "ID": "expire-old-versions", "Status": "Enabled", "Filter": {}, "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration --bucket orb-artifacts-tanmay-2026 --lifecycle-configuration file://lifecycle.json
```
(Bucket ka naam apna daalo. Agar bucket par versioning off hai to teesra rule hata do.)

### 2.5 Jo cheezein **mat** lagao (silent cost)
- **NAT Gateway / Application Load Balancer / RDS / ElastiCache** - single-server setup me inki zaroorat nahi. Sirf NAT Gateway ~$32+/month hota hai. Postgres aur Redis Docker me chal rahe hain.
- **CloudWatch detailed monitoring / lambdas** - nahi chahiye; Orb ke apne `/metrics` endpoints hain.
- Extra **Elastic IP** - ek hi rakho (attached rehne par bhi public IPv4 ka hourly charge lagta hai, ~ $3.6/month).
- Unused EBS snapshots / unattached volumes / purani AMIs - mahine me ek baar delete kar do.

### 2.6 Data transfer (internet ko jaane wala traffic)
EC2 se bahar jaane wala data sabse bada "surprise" hota hai. Static sites ka traffic bahut ho to **Cloudflare ka free proxy** (orange cloud) sirf `*.orb` ke static content ke saamne lagane ka sochna - ye egress kam karta hai. (Caddy ke on-demand TLS ke saath proxy on karne se pehle test kar lo.)

### 2.7 AWS Budgets alert
Console → Billing → **Budgets** → monthly cost budget (e.g. ₹5,000) with e-mail alert at 80%. 2 minute ka kaam hai aur galti se bade bill se bachata hai.

---

## 3. Rough monthly picture (single server, Mumbai, andaaza)

| Item | Pehle | Ab |
|---|---|---|
| EC2 `t3.large` on-demand | ~$65 | `t4g.large` ~$52 → Savings Plan ke baad ~$35 |
| EBS 60 GB gp3 | ~$6 | ~$6 |
| Elastic/public IPv4 | ~$3.6 | ~$3.6 |
| S3 (static sites + logs) | thoda, logs hamesha rehte the | lifecycle ke baad bounded |
| E-mail (nodemailer + Gmail SMTP) | - | AWS par ₹0 |
| **Compute capacity ki zaroorat** | 20 free web services ≈ 5 GB RAM hamesha | awake hone wali services hi RAM leti hain (aksar < 1 GB) |

Matlab ek hi machine par kaafi zyada free users aa sakte hain - aur instance `t4g.xlarge` ki jagah `t4g.large` par rukne ki gunjaish banti hai.

---

## 4. Agle kadam (agar user base badhe)
1. Worker (builds) ko alag chhoti machine par - build ke time CPU spike hota hai, usse live traffic ko asar na pade.
2. Runner nodes ko **Spot** par chalao (stateless containers; reschedule `reconcile` job khud kar deta hai). Postgres/Redis/Caddy ko on-demand rakho.
3. Registry ko S3-backed banao taaki multi-node pull sasta aur stable ho.
