# MinIO IAM policies — least privilege

Ye JSON files MinIO ke IAM policies hain. `mc admin policy create` inhe
MinIO me import karta hai, aur phir kisi bhi IAM user/service account
se attach ho jaati hain.

## KYUN ye zaroori hai

Root credentials (`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) ka matlab hai
"admin: everything". Ye credentials jahan bhi leak ho jaayein — ek `.env`
git me chala gaya, ek log line, ek screenshot — attacker ke paas poore
cluster ka admin access hota hai: buckets delete, policies badalna, nayi
users banana.

Isliye har service ko apna **scoped** account milta hai, jo sirf uski
apni bucket tak pahunch sakta hai. Root sirf `minio-init` (provisioning)
ke paas rahega, jo chal kar exit ho jaata hai.

## Policies in this directory

| File | Account | Bucket | Permissions |
|---|---|---|---|
| `auth-avatars.json` | `MINIO_AUTH_ACCESS_KEY` | `avatars` | list bucket, read/write/delete objects |

## Kya ALLOWED nahi hai (deliberate)

`auth-avatars.json` me ye actions **jaan-boojh kar nahi** hain:

- `s3:CreateBucket` — nayi bucket nahi bana sakta
- `s3:DeleteBucket` — koi bucket delete nahi kar sakta
- `s3:PutBucketPolicy` / `s3:DeleteBucketPolicy` — bucket ki public-read
  policy nahi badal sakta
- `s3:*` on any other bucket — `video` / `thumbnails` tak pahunch hi
  nahi sakta

Iska matlab: auth-service ke credentials leak bhi ho jaayein, to damage
sirf avatars bucket tak limited hai. Usse puri storage compromise nahi
kar sakte.

Bucket creation aur public-read policy **root** karta hai (`minio-init`),
isliye auth-service ko ye permissions chahiye hi nahi — isiliye
`STORAGE_MANAGE_BUCKET=false` kiya gaya hai.

## Policies kaise lagti hain

`minio-init` container (`docker-compose.yml`) root ke saath login karta
hai aur:

1. `mc admin policy create local wideo11-auth-avatars /policies/auth-avatars.json`
2. `mc admin user add local "$MINIO_AUTH_ACCESS_KEY" "$MINIO_AUTH_SECRET_KEY"`
3. `mc admin policy attach local wideo11-auth-avatars --user "$MINIO_AUTH_ACCESS_KEY"`

`user add` idempotent nahi hai — dobara chalane par error deta hai. Isliye
init script me `|| true` lagaya hai, taaki restart par fail na ho.

## Credentials kahan se aati hain

`.env` se (`MINIO_AUTH_ACCESS_KEY` / `MINIO_AUTH_SECRET_KEY`). Isliye
credentials bhi SSOT rehte hain — code me hardcoded kuch nahi.

## Rotate kaise karein

1. `.env` me naye values daalein
2. `docker compose up -d --force-recreate minio-init auth-service`
3. Verify: purani key se login fail hona chahiye, nayi se pass

Purana account ghanton baad:

```powershell
docker exec wideo11-minio mc admin user info local <OLD_ACCESS_KEY>
docker exec wideo11-minio mc admin user remove local <OLD_ACCESS_KEY>
```
