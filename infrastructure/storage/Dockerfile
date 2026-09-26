# ====================================================================
# MINIO - Self-hosted S3-compatible object storage (NO paid provider)
# ====================================================================
# Ye image MinIO Community Edition hai - apne server pe chalta hai.
# AWS S3 / GCS / Bunny CDN kuch nahi. Isliye kisi teesre party ko ek bhi
# penny nahi jaati.
#
# COST: MinIO free aur self-hosted hai. Storage sirf apni disk par hai.
# Internet par bhi serve kar sakta hai (apne domain + TLS ke saath).
#
# Hinglish comments: har block ka arth
FROM minio/minio:RELEASE.2024-01-16T16-07-38Z

# Root user credentials env se aayenge (SSOT - kuch bhi hardcoded nahi)
# MinIO ye variables padhta hai apne aap
ENV MINIO_ROOT_USER=${MINIO_ROOT_USER}
ENV MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}

# API + Console dono ek hi container me chalte hain
# Console 9001 par hai (browser se access)
EXPOSE 9000 9001

# Data directory - named volume par mount hoga taaki container recreate
# hone par data na ude (pVC Retain policy ka equivalent)
VOLUME /data

# `server /data --console-address :9001`:
#   server   = MinIO start
#   /data    = storage root
#   --console-address :9001 = console UI ka port
CMD ["server", "/data", "--console-address", ":9001"]
