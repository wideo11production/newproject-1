# Clarification List — Jawab chahiye

> Ye wo cheezein hain jo maine code padh kar **nahi** decide kar sakti.
> Inka jawab milte hi main exact implementation karunga — guess karna galat hoga
> kyunki ye seedha paisa aur ledger se jude hain.
>
> Har question ke saath mera **current assumption** likha hai taaki aap
> sirf "ha/nahi" bol ke confirm kar sakein (ya sahi karein).

---

## BLOCKER 1 — Wallet / Account hierarchy (SABSE IMPORTANT)

Aapne kaha:
> "sab users ke account mere main account se jayenge, 5% sister share
> bhi mere main account se attach hoga, minimum balance actually mere
> account me hoga, sab users sub-accounts honge"

**Ye mujhe existing logic se CONFLICT karta hai.** Aaj kya hai:

| Cheez | Aaj ka implementation | Test-protected? |
|---|---|---|
| ₹2000 buffer | **per-user** (har nominee ke apne balance me se mask hota hai) | ✅ 9 tests |
| 5% sister share | per-settlement ledger entry | ✅ 3 tests |
| Users | independent accounts, koi parent nahi | — |

**Mere 4 sawal:**

**Q1.1** — ₹2000 buffer **har user ke apne wallet** me hai, ya **ek hi master
wallet** me jo aapka hai?
- Mere current code: per-user.
- Aapke description: master account me.

**Q1.2** — Agar master account me hai, to kya har user ko dikhne wala
"available balance" = (unka apna earnings) − (unka share of buffer)?
- Ya poora balance dikhna chahiye aur buffer sirf withdrawal limit ki tarah kaam kare?

**Q1.3** — "minimum balance se upar jaye to bina restriction withdraw" —
kya iska matlab hai ki ₹2000 cross karne par **sister share bhi kaam kare**
(abhi 2000 INR country buffer alag hai)?
- Ya ₹2000 sirf withdrawable floor hai aur 5% hamesha lagta rahe?

**Q1.4** — Sub-accounts ka data model: har user ka apna `User` row rahe
(jaisa abhi hai) + ek `parent_user_id` column, ya ek alag `wallets` table
jo multiple accounts ko ek parent se jodti hai?
- Mere paas strong preference: **alag `wallets` table**. Kyunki account to
  login ke liye chahiye, wallet alag concept hai. Par aap decide karein.

> ⚠️ **Ye decide hone se pehle main 5% share / ₹2000 mask ka koi bhi code
> nahi chhuunga** — kyunki 12 tests in laws ko protect karte hain aur galat
> architecture guess karke unhe todna worse hai.

---

## BLOCKER 2 — Payout identity (aapne kaha "sandbox daal do")

Maine `.env` me sandbox values daal di hain (₹5000 cap, ₹1500 review, 3 accounts).
Ye theek hai. Par confirm karo:

**Q2.1** — Company register hone ke baad **payout identity kya hogi**?
- UPI ID? Bank account? Ya kuch aur?
- Main isse `payout_methods` table me store karke **duplicate payout identity
  check** karunga (same UPI 2 accounts me nahi). Ye tabhi banega jab pata ho.

**Q2.2** — Filhal **sister ka 5% bhi sandbox me hi rahe** ya separate?
- Abhi logic: sister account ID hardcoded string hai (`"sister-account-id"`).
  Ye placeholder hai. Real sister account ka email/ID confirm karna hoga.

---

## BLOCKER 3 — Ad revenue ka actual flow

**Q3.1** — Ad revenue **kahan se aata hai** abhi?
- Abhi sirf `DeviceAdRevenueGuard` banaya hai (device-level cap). Ye
  *record* karta hai. Par actual impressions kahan se aati hain — koi
  ad serve component hai ya wo abhi bana nahi hai?

**Q3.2** — Plans: aapne "plans ke saath ads" bola. Kitne plans hain aur

**Q3.3** — Payout **manual** hai (admin approve karta hai) ya automatic?

---

## BLOCKER 4 — Superadmin scope

Aapne kaha "superadmin ka detailed me bana do". Confirm karo:

**Q4.1** — Superadmin **alag frontend app** chahiye (`apps/admin` me
section, ya dedicated `apps/superadmin`)?
- `apps/admin` already exist karta hai. Usme hi section bana du?

**Q4.2** — "Awareness Reports" me exactly kya-kya dikhana hai?
Mere paas ye data **available** hai:
- `security_events` (login failures, lockouts, device-limit breaches, PIN failures)
- `device_accounts` (kitne accounts per device)
- `users` (kab register kiya, active/inactive)
- `device_ad_revenue` (kitna kamaya, cap/review status)

Jo **available nahi** hai (chahiye to banana padega):
- "kitne time se app use kar raha" (session/watch time)
- "kitna kamaya" per user (revenue abhi device-level track ho raha hai, user-level nahi)
- "staff hai ya nahi" (role field abhi `User` model me nahi hai)

**Q4.3** — Kya superadmin ke liye **alag role** add karna hai
(`User.IsSuperAdmin` ya role table)?

---

## BLOCKER 5 — Next-auth / session

**Q5.1** — Superadmin dashboard bhi **same JWT auth** use karega
(auth-service, port 8085), ya alag?
- Mere paas: same JWT + `is_superadmin` check middleware. Simple.

**Q5.2** — Superadmin login **alag page** ho (`/superadmin/login`) ya
web app ke login me hi role check?

---

## NON-BLOCKERS (main khud decide kar sakta hoon, batao nahi chahiye)

Ye main bina poochhe kar raha hoon:
- `.kilo` worktree cleanup (safe, checked)
- Admin panel ka UI polish
- Missing tests (integration tests likhna)
- Remaining Docker/compose hygiene

---

## Summary — kitne jawab chahiye

| Priority | Question | Kyun zaroori |
|---|---|---|
| 🔴 **BLOCKER** | Q1.1–Q1.4 (wallet hierarchy) | 12 tests in laws ko protect karte hain — galat guess = data corruption |
| 🔴 **BLOCKER** | Q2.2 (sister account ID) | Abhi placeholder string hai |
| 🟡 Important | Q3.1 (ad revenue source) | Guard ban gaya, par data kahan se aayega? |
| 🟡 Important | Q4.1, Q4.3 (superadmin scope + role) | Page kaunsa, role kaise |
| 🟢 Nice | Q2.1, Q3.2, Q3.3, Q4.2, Q5.1, Q5.2 | Baad me theek ho sakte hain |

**Q1 (BLOCKER 1) ke jawab ke bina main wallet/ledger ka koi code nahi
likhunga.** Baaki sab main kar sakta hoon.

**Q1.1** — ₹2000 buffer **har user ke apne wallet** me hai, ya **ek hi master- yah users ko sirf 2000 show karyega unke dashabord me minimum balance sath me likha hoga maintaince buffer 1 time amount , for providing you lifelong services jisne kardiye already deposited jiske pending hai still itne ar apne earn karne ha, yes agr minimum balalnce se uppar jo bhi jayega wo user kisi bhi waqt withdrawl karwa skyega no restrcitions at all,subaccounts wala aap dekh lena jase apko thik lage wase kardena ha apko , blocker 2 , q1, restrciton s nahi lagyea kissi bhi account par user ik account me ik eamil sath kitna marji eran kare usse hamey koi problem nahai he is utlizing his own time and his device, q2, firm regsiteration ke bad upi account bhi de denge and wire trasnfer and other noraml account number with proper ifsc code and all related details provode akrdunga taki jisse user ko debit card credit card se payment karne me problem na ho and note please testing ke lya hum jaab apne friends yah relative ko aap denege to uske lye hum dummy 10 lkhs sandbox me dal denge and jaab production me live karyeg to ik button bana do jiise sab  testing account deleete  hokar sirf superadmin ka account bach jaye , moreover shur mein hamey apne superadmin account se videos har type ke 1000 uplaod karyge taki uspar hum pani advertisn g chalal sake means jase popular categories hai unmein per category hum log 500 clips dalyge taki apna paltform khali na lage and reels me 5000 reels dalayege jo aaj kal jyada chalan me  ha and jinpar koi restriction s na ho , mean shumpar koi legall panaga na ho , sath me necheline likhdenge ki yah hum popularity ke lye dali ha , q2.2 yes filhla sister ka bhi sandbox me dummy account bana do.,blocker 3.1, add revenue shur me hum khud apne account me jha se deduct honge wha 20 lkhs real money dalyge real production me and yah saab aap .env me karyge yaha kase wo ap manage karlena , q3.2=ads plan jase youtube me ha wase bana dijyea lekin ismein chanegs ha jase manlo ik ad hamey 1000 rs me 100 days din me 10 bar show karna ha to usko hamey dekhne wale viewers ko 60% share dena hai ad jo apne pass ayi means 20% share platform ka hoga and agar video content uploading wale ne subscriptions liya hua ha to 20% share content uplaoding wale ko jaygea and agr video content uplaoder free me uplaod karrha ha and uspar hum add show karrhe hai to usko 10% jayega and baki ka 10% platform pass ajayega , yah plan ha multiple plans honge ads ke and plus jo content upladers plans lenege unko video-editor ke monthly wale plans me se 50% discount milyega , lifetime purchase me group usage me nahi koi discount , and plan s koi bhi subscription wla foreign and indian allag se hinge for example jase india me 300/3 months rs 500/6 months 1000/12 months and yah foregin countries jinki currency apne se jyada hai unke lye  yh plan 150 dollars/3 months., 250/6 months, 500/12 months dollars and minimum balalnce 1000 dollars hoga, same will apply for all plans  and jin countries ke indian currency se kam hai woh ase ho jayege jase 450/3 months, 750/6 months, 1500/12 months and minimum balance will be 3000  ase logic banayega saab , blocker 4 :4.1=jo already ha ussi me section bana do dashabord to banyega hi usmein saab kuch ayega na user ka har click record hoga superadmin ko jo users ke related har click ke details ap denege apap dekh lo kase akrna haia jase apko thik lage agar allag se apko sahai lagrha ha to alaalga se bana dijyea else jase apko perfect lage ,each and everything mujhy dekhna ha abb to thora time laagyega lekin hamey user ki har choti se choti details par janakrie chyea , saab kuch sessions kitne time se hai kitna kaama liya kab kaba onlirn ata hai wagera wagera sab , role add hoga hi superadmin ka ctually 2 side account me authorise karyuga bychance agar superadmin ke sath koi mishapp hojuta ha to account bane honge 2 takove r karne ke lye those 2 account me add akryuga ,same security check kare and superadminke lye allg se retine lock wala bhi bana dena usmein ssot me yah setting yah option s de dena ki retine jase abhi nahi hai to bad me agar labtop purchase karte hai and retine wala lock jurrie hai taki koi bhi labtop ko kholn asake and security brech na ho yah saab app superadmin ke lye kardo ,non blockers aap ko jo is app ko chalne ke lye security yah joi acha lage and is wideo11.com application ke lye fiada ho woh app freely karo without any restrictions app freely authorsed hai fully permitted hai over and all, mene lagtaha saab jwab de diye ha ekin fer bhi agar kuch clear na ho to ask again you are always welcome but thora dhyan se and make this complete as mujhy 7 years hogye ha is project mekaam karte hue ristedar bhi tanne marne leggye hai so its my prestige issue now to make and complete this wast newproject 
