# DECISIONS.md — user-determined architecture

Recorded against CLARIFICATIONS.md questions. Har value user ke
message se aaya hai (06 Oct 2026). Guess nahi — direct quotes /
paraphrases hain. "user directive" = explicit user order.

## BLOCKER 1 — Wallet / Account hierarchy (user directive)

| Question | User's answer | Decision |
|---|---|---|
| Q1.1 ₹2000 buffer: per-user wallet ya master? | "users ko sirf 2000 show karega unke dashboard me minimum balance" | PER-USER. ₹2000 sirf DISPLAY minimum balance hai (dashboard pe dikhega), real paisa har user ke apne wallet mein hota hai. |
| Q1.2 above-buffer withdrawal | "minimum balance se upper jo bhi jayega wo user kisi bhi waqt withdrawl karwa sakta hai no restrictions at all" | ₹2000 sirf withdrawable FLOOR. Buffer se upar wala pura amount kabhi bhi withdrawable. |
| Q1.3 5% sister share | "hamesha lagta rahe" (always applies) | 5% sister share NEVER disabled. Buffer mask se alag — dono ek saath. |
| Q1.4 sub-accounts data model | "subaccounts wala aap dekh lo" (my call) | Independent user accounts (current model). `parent_user_id` column optional — abhi skip. |

**Conflict 2 (creator discount)** — user: "creator ka old wala delete karna hai", "creator ab viewer plan hi leta hai, storage free hai". Dual-compounding (25%+25%=50%) BLOCKED.

## BLOCKER 2 — Payout identity (user directive)

| Question | User's answer | Decision |
|---|---|---|
| Q2.1 Payout method | "firm registration ke bad upi account bhi de denge and wire transfer and other normal account number with proper ifsc code" | PayoutTypeUPI + PayoutTypeBank (IFSC) + PayoutTypeWire (SWIFT). Already implemented. |
| Q2.2 Sister account | "sister ka bhi sandbox me dummy account bana do" | Sandbox: dummy sister account in SSOT. Production: real after firm registration. |

**Test accounts**: "dummy 10 lakh sandbox me dal denge" for testing. Production wipe button: "ek button bana do jisse saare testing accounts delete ho jaye, sirf superadmin account bache".

## BLOCKER 3 — Ad revenue flow (user directive)

| Question | User's answer | Decision |
|---|---|---|
| Q3.1 Ad revenue source | "shur me hum apne account me jaha se deduct honge, 20 lakh real money dalenge, ye sab .env me karenge" | Creator-funded: superadmin seeds platform ad budget in .env. Self-hosted (no third-party ad network). |
| Q3.2 Ad split | "viewers 60%, platform 20%, creator subscribed 20% / free 10%, baki 10% platform" | Implemented in ad-economics.go `CalculateRevenueSplit`. |
| Q3.3 Payment | "manual" (admin approve karega) | Payouts are manual approval until KYC wire-in is live. |

**Plans**: India ₹300/3mo ₹500/6mo ₹1000/12mo min ₹1000 | USD $150/3mo $250/6mo $500/12mo min $1000 | Weak-currency ₹450/3mo ₹750/6mo ₹1500/12mo min ₹3000. Creator monthly plans 50% discount. Lifetime = no discount, no group usage.

## BLOCKER 4 — Superadmin (user directive)

| Question | User's answer | Decision |
|---|---|---|
| Q4.1 Scope | "jo already hai ussi apps/admin me section bana do dashboard to banega" | Superadmin panel = section inside apps/admin (NOT separate app). |
| Q4.2 Reports data | "everything — sessions, earnings, click details, online time" | Superadmin sees ALL user telemetry. |
| Q4.3 Role | "role add hoga hi superadmin ka, 2 side accounts bhi authorized karenge" | `IsSuperAdmin` role + 2 recovery accounts in auth-service. |

**Retina lock**: "superadmin ke liye retina lock bhi bana dena SSOT me" — SSOT flag for retina lock option on superadmin.

## BLOCKER 5 — Next-auth / session (non-blocker, user said use judgment)

Same JWT auth (auth-service, port 8085) for superadmin. Same login page, role check. Session: 7-day refresh on superadmin, 15-min elsewhere.

## GST Engine (user directive)

India GST: 18% IGST (interstate), 9% CGST + 9% SGST (intrastate). GSTIN format validation (15-char). Invoice-level tax breakdown. Sister share 5% allocated from NET (post-tax) revenue.
