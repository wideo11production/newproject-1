# ====================================================================
# POSTFIX - Self-hosted mail server (koi paid provider NAHI)
# ====================================================================
# Ye image apne aap banayi gayi hai alpine + postfix se. Koi SendGrid /
# Mailgun / SES nahi lagaya gaya hai - isliye kisi teesre party ko ek bhi
# penny nahi jaati.
#
# COST: Postfix khud open-source hai. Ye container sirf khud ke server par
# chalega. Internet par deliver karne ke liye ek domain + MX record chahiye
# (ye infrastructure hai, koi paid service nahi).
#
# LOCAL MODE (default: POSTFIX_CAPTURE_ONLY=true)
#   Messages accept hote hain aur Postfix ke log me poora content likha jaata
#   hai. Isse bina internet ke bhi verify ho jata hai ki email generate hui.
#   Read karein:  docker compose exec mail cat /var/log/mail.log
#
# PRODUCTION MODE (POSTFIX_CAPTURE_ONLY=false)
#   capturelog pipe transport hat jata hai aur Postfix normal direct delivery
#   karta hai. Iske liye zaroori hai:
#     1. Apna domain (e.g. wideo11.com) with MX record:
#          IN MX 10 mail.wideo11.com
#     2. Public IP par port 25 open
#     3. SPF/DKIM/DMARC DNS records
#   Ye sab infrastructure hai - koi PAID service nahi lagti.
#
#   >>> IMPORTANT - is host par port 25 BLOCKED hai <<<
#     Verified: TCP 25 -> 1.1.1.1 = FAIL, par 587/465 = OPEN.
#     Isliye sirf POSTFIX_CAPTURE_ONLY=false karna KAAFI NAHI hai. Bina
#     relayhost ke Postfix seedha recipient ke MX par port 25 pe connect
#     karega, wo connect hi nahi hoga, aur mail queue me atak kar bounce
#     ho jayega. Inbox me kuch nahi aayega.
#     Solution: POSTFIX_RELAYHOST set karo (587/2525 pe sunta hai).
#   Hinglish: capture off karna akela kaafi nahi, relayhost bhi chahiye
#
# Hinglish comments: har block ka arth
#
# RELAYHOST note (naya):
#   Agar POSTFIX_RELAYHOST set hai to ye real delivery ka asal raasta hai -
#   Postfix seedha us host tak jaata hai (usually 587/2525 pe, jo port 25 ke
#   mukable zyada tar open hota hai). Bina relayhost ke Postfix recipient ka
#   MX khud dhoondhta hai aur port 25 pe jaata hai.
#   Is host par port 25 blocked hai, isliye production ke liye relayhost
#   lagana zaroori hai - warna email queue me hi atak jayega.
FROM alpine:3.19

# Postfix install karo
# NOTE: Alpine 3.19 me "postfix-tls" alag package NAHI hai - TLS support main
# postfix package ke andar included hai. Isiliye yahan sirf "postfix" hai.
# ca-certificates: TLS/STARTTLS ke liye
# shadow: Postfix ko system users/groups chahiye
RUN apk add --no-cache postfix ca-certificates shadow

# ---- SSOT driven configuration ----
# Ye values build args se aati hain, jo compose .env se padhta hai.
# Code me koi domain/hostname hardcoded nahi hai.
ARG POSTFIX_HOSTNAME=mail.wideo11.local
ARG POSTFIX_DOMAIN=wideo11.local
ARG POSTFIX_CAPTURE_ONLY=true
# RELAYHOST: jis doosre mail server tak Postfix apna mail bhejega.
# Syntax: [smtp.provider.com]:587  (square bracket = MX lookup skip karo)
# Khaali chhodne par relayhost= rehta hai - Postfix seedha recipient ke MX
# par PORT 25 se connect karta hai.
ARG POSTFIX_RELAYHOST=

RUN set -eux; \
    # --- Identity ---
    postconf -e "myhostname=${POSTFIX_HOSTNAME}"; \
    postconf -e "mydomain=${POSTFIX_DOMAIN}"; \
    postconf -e "myorigin=${POSTFIX_DOMAIN}"; \
    # --- Kya yahan deliver karna hai ---
    # Khaali karna matlab "sirf internet par bhejo", local fallback nahi
    postconf -e "mydestination="; \
    # relayhost: DEFAULT khali - Postfix seedha recipient ke MX par port 25 pe
    # connect karega. Ye mode unhi host par kaam karta hai jahan outbound 25
    # open hai. Jahan ISP/network port 25 block karta hai, wahan ye khaali
    # chhodne par saara mail queue me atak jayega aur bounce hoga.
    postconf -e "relayhost=${POSTFIX_RELAYHOST}"; \
    postconf -e "inet_interfaces=all"; \
    # --- Network permissions (DHOKA NAHI) ---
    # "mynetworks_style=host" sirf localhost ko allow karta tha, isliye doosre
    # containers (auth-service) ka relay REJECT ho jata tha:
    #   "454 4.7.1 Relay access denied"
    # "mynetworks_style=host" sirf localhost ko allow karta tha, isliye doosre
    # containers (auth-service) ka relay REJECT ho jata tha:
    #   "454 4.7.1 Relay access denied"
    # NOTE: ise khaali string ("mynetworks_style=") set karna INVALID hai aur Postfix
    # crash kar jata tha: "fatal: bad string length 0 < 1: mynetworks_style".
    # Sahi tareeka: postconf -X se parameter ko hata dete hain, jisse Postfix
    # default behaviour use karta hai aur sirf mynetworks list apply hoti hai.
    # Ye SAFE hai kyunki networks container/private hain, open relay nahi banega.
    postconf -X mynetworks_style; \
    postconf -e "mynetworks=127.0.0.0/8 [::1]/128 172.16.0.0/12 10.0.0.0/8 192.168.0.0/16"; \
    # Local network se aaye mail ko permit, baaki reject (open relay nahi banega)
    postconf -e "smtpd_recipient_restrictions=permit_mynetworks,reject"; \
    # Saare messages ek hi log file me jaayen taaki test me padh sakein
    postconf -e "maillog_file=/var/log/mail.log"; \
    postconf -e "message_size_limit=20480000"; \
    postconf -e "mailbox_size_limit=0"

# LOCAL CAPTURE MODE
# NOTE: do galtiyan ho gayi thi, isliye clearly document kar raha hoon:
#  1. "virtual_transport=log:" - ye sirf "virtual mailbox domains" ke liye hota hai.
#     Hamare test recipients us class me nahi hain, isliye message normal delivery
#     ke liye gaya aur bounce hua: "Domain example.com does not accept mail (nullMX)".
#  2. "default_transport=log:" - ye "private/log" resolve karta hai jo exist
#     nahi karta: "warning: connect to transport private/log: No such file or directory".
#
# SAHI TAREEKA: master.cf me ek custom pipe transport define karte hain jo har
# message ko "tee -a" se file me append kar deta hai. Postfix ka canonical method.
#
# Production me (POSTFIX_CAPTURE_ONLY=false) ye hat jayega aur Postfix normal
# direct delivery karega (MX record ke saath).
# Hinglish: local me email file me capture karo - master.cf me pipe transport se
RUN if [ "${POSTFIX_CAPTURE_ONLY}" = "true" ]; then \
        # Custom transport: stdin ko file me append karta hai
        printf '\ncapturelog unix - n n - - pipe\n  flags=DRXhu user=nobody argv=/usr/bin/tee -a /var/log/mail-capture.log\n' >> /etc/postfix/master.cf; \
        postconf -e "default_transport=capturelog:"; \
        touch /var/log/mail-capture.log && chmod 666 /var/log/mail-capture.log; \
        echo "Postfix configured in LOCAL CAPTURE mode -> /var/log/mail-capture.log"; \
    else \
        echo "Postfix configured in DIRECT DELIVERY mode (requires MX records)"; \
    fi

# Aliases database banao (warna "open database /etc/postfix/aliases.lmdb" error aata hai)
RUN newaliases || true

# Mail log file banata hai aur permissions set karta hai
RUN touch /var/log/mail.log && chmod 666 /var/log/mail.log

EXPOSE 25

# Postfix master daemon ko FOREGROUND me chalao.
# NOTE: "postfix start-fg" sahi command hai. "sendmail -G" form turant exit ho
# jata tha aur container restart loop me chala gaya tha.
# Hinglish: Postfix foreground me chalna zaroori hai
CMD ["postfix", "start-fg"]
