# Movavi-style UI/UX spec — for port 3002 (`apps/video-editor`)

> Ye wahi numbers hain jo maine apne editor me lagaye hain. Har ek ka
> *reason* bhi hai — koi bhi number "Movavi me bhi aisa hi hai" ki wajah se
> nahi rakha gaya, balki isliye rakha gaya ki editor ka kaam usse behtar
> lage. Jahan Movavi se jaanbujh kar hataya hai, wo bhi likha hai.

## 1. The measurements

| Thing | Value | Why this number |
|---|---|---|
| **Toolbar icon** | `20×20` box, `16×16` glyph (`h-4 w-4`) | Dense strip, 40+ buttons. 24px wala icon strip ki height 2× kar deta hai. |
| **Rail icon** | `32×32` hit box, `14×14` glyph | Rail me 13 icons hain. Bada hit box accessibility deta hai, chhota glyph clutter kam karta hai. |
| **Toolbar button** | `28×28`, `gap-2` | Ek haath me 12–15 tools aane chahiye. |
| **Menu bar height** | `32px` (`h-8`) | Top line sabse shaant hoti hai — isliye session controls yahan hain, toolbar me nahi. |
| **Toolbar height** | `40px` (`h-10`) | |
| **Player bar** | `40px` | |
| **Status strip** | `28px` | |
| **Track lane height** | `56px` default, 40–200 draggable | 56 ek thumb strip + waveform ko bina label chhupaye dikhata hai. |
| **Body font** | `12px` | 12 se chhota UI text padhne layak nahi hota. |
| **Icon-ish / meta font** | `10px` | Sirf timecode, frame counts, byte sizes — jo padhna zaroori nahi. |
| **Timecode font** | `14px`, `tabular-nums` | `tabular-nums` ke bina timecode har frame pe khichhti hai, jo dikhta hai. |
| **Micro labels** | `9px`, `uppercase`, `tracking-wide` | Track header ka type, status ka save-state. |
| **Corner radius** | clip `3px`, panel `6px`, modal `8px` | |
| **Separation** | **`1px` line** — neeche, #1e293b | Yahi Movavi ka trick hai. Line + colour se lanes alag dikhte hain; sirf colour se nahi, sirf line se bhi nahi. |
| **Scrollbar** | **`2px`** track transparent, thumb `#2c3235` | 1px par cursor us par nahi tikta. 2px clickable hai aur deewar jaisi nahi lagti. |
| **Grid** | `4px` | Tailwind default `0.25rem`. |
| **Tool group gap** | `2px` | |

## 2. Colour — lanes alag colour se, line se bhi

Ek hi accent sab kuch blue kar deta hai aur aapko "kaunsa video, kaunsa audio"
nahi pata chalta. Ye 4 roles hain:

| Role | Token | Dark | Light |
|---|---|---|---|
| Video clip | `--ve-clip-video` | `rgb(7 47 73)` | **same** |
| Audio clip | `--ve-clip-audio` | `rgb(46 16 101)` | **same** |
| Text/title | `--ve-clip-text` | `rgb(69 39 5)` | **same** |
| Image clip | `--ve-clip-image` | `rgb(4 47 36)` | **same** |

**Clip dono theme me dark rehte hain — jaanbujh kar.** Clip media hai,
chrome nahi. Resolve aur Premiere bhi aise hi karte hain. Maine pehle
translucent accent use kiya tha (`bg-sky-500/25`) — dark me theek tha, light me
pale ho gaya aur **saare clip names invisible** ho gaye. Opaque tokens ne wo
class ka bug khatam kar diya.

Lane ke neeche `1px` line: `--ve-edge` (#1e293b dark, #d6dee9 light).

## 3. Selected state — ring nahi, glow

Pehle `ring-2 ring-white` tha. Ab per-lane glow:

```css
.ve-glow      { box-shadow: 0 0 0 1px rgb(255 255 255 / .75), 0 0 14px -2px rgb(56 189 248 / .55); }  /* video  */
.ve-glow-audio{ ... rgb(167 139 250 / .55) }  /* audio */
.ve-glow-text { ... rgb(251 191 36 / .5)  }  /* text   */
```

**Rule: animation information carry nahi karta.** Selection static glow hai —
3-second ka loop kabhi readable phase par hoga hi nahi. Glow static hai, sirf
texture (shimmer) animate hoti hai.

## 4. Filmstrip — frames, poster nahi

- Thumbnail **56px wide, fixed**. Clip width ke hisaab se stretch hoti to zoom karne par detail nahi badhti — wahi problem jo single poster me thi.
- Density: **1 frame / 400ms**, 2 se 24 frames ke beech bounded.
- Frame **slice ke centre** pe lete hain, start pe nahi — start pe liya to har strip ek frame late dikhti.
- Frame **clip ke apne span** se: `sourceIn` se `sourceIn + duration × speed`. Nahi to 12s pe shuru hua clip bilkul galat 12 second dikhaye.
- **Compositor ka wahi element** use hota hai. Alag `<video>` pehli baar banaya tha — `readyState 0` pe atak gaya, 3 extractions in-flight, strip khali. Preview usi waqt perfectly render kar raha tha. Lesson: ek hi file ka do decoder banane ki zaroorat hi nahi thi.

## 5. Ruler

- **Pixels per frame** zoom ka unit hai, seconds-per-pixel ka multiplier nahi. Multiplier frame rate ke saath badal jaata hai — 30→60 pe zoom chupke se double.
- Range `0.05 → 64` px/frame. 64 pe ek frame plainly dikhta hai.
- **Alt+wheel** zoom, pointer pe anchored. **Wheel** scroll.
- Labels zoom ke hisaab se: bare frame number → fractional seconds → `MM:SS`.
- **Do band:** upar scrub, neeche measure. Koi mode flag nahi — click karna hi batata hai ki kya karna hai.
- Band boundary **55%** par, aur **scrub uska owner** hai. 50% par click measure karta tha, yaani ruler par sabse obvious kaam invisible ho jata tha.

## 6. Water / logo

- **Sirf jab player khaali ho.** Ek logo jis clip ke upar burnt ho sabse irritating cheez hai — aur woh permanent hota hai, har still export me.
- Company characters **Wino / Rino / Tino** — abhi initials on tinted discs, dashed frame ke andar, aur neeche "Logo placeholder" likha hai. Dashed isliye ki koi finished brand na samjhe.
- `pointer-events-none` — warna watermark us canvas ko churayega jise user scrub karta hai.

## 7. Jo jaanbujh kar hataya

| Cheez | Kyun nahi rakhi |
|---|---|
| Floating toolbar | Ye single-window editor hai, tabbed workspace nahi. |
| 2px selection ring | Glow better hai, aur ring thin borders ke saath compete karti thi. |
| Ribbon-style tabs | 13 tools rail me hain; ribbon unhe chhupa deta hai. |
| Clip par 5 icons | Sirf selected clip par, warna 13 clips × 5 = 65 icons. |

---

## Kya live hai (73/73 checks)

Frames aaye ✔ · watermark clip ke niche chhup jaata hai ✔ · naam poora dikhta hai (trim handle pehle 8px cover kar raha tha) ✔ · playhead `00:00:00:00` ✔ · rail 32px tight selector ✔ · auth icons top strip ke extreme right ✔ · 4px scrollbar ✔ · help modal + Wino/Mino/Rino ✔ · context menu ✔

**Jo abhi bhi pending hai:** Phase D3 (daily backup service) aur timeline me audio attach/detach ka visible option — aapne pucha tha, wo agle round ka pehla kaam hai.
