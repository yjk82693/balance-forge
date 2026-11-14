# HackPrinceton — UI Tone & Manner (AI Playtest Platform)

> **한국어 요약 (5줄)**
> 1. 기본 테마는 어두운 슬레이트 다크입니다(순수 검정은 쓰지 않음). 라이트는 대시보드 발표용으로만 선택해서 씁니다. 다크와 라이트는 강조색 값을 따로 둡니다.
> 2. 색은 "상태와 데이터"에만 씁니다. 화면 틀(웹 크롬)은 코드로 그리고, 에셋 PNG는 초상화·게임 썸네일·Phaser 안 HUD에만 씁니다. 글자는 이미지에 넣지 않습니다.
> 3. 글꼴은 Inter 한 가지(OFL)로 통일하고 한글이 필요한 곳만 Noto Sans KR(OFL)을 씁니다. 숫자는 고정폭(tabular)으로 짧게 적습니다: "Win rate 78% · 1,000 games · 12 s".
> 4. 승률 막대는 회색 중립색, 50% 점선 기준선, Wilson 95% 구간 수염으로 그립니다. 이상치는 경고색, 굵은 테두리, "Outlier" 글자 셋을 함께 써서 색만으로 알리지 않습니다. 패치 전후 비교는 빗금 친 빈 막대(전)와 꽉 찬 막대(후)로 구분합니다.
> 5. 말투는 명령하지 않고 초대하듯 짧게 씁니다("Scan to join", "Let the bots play"). 대비는 4.5:1 이상, 휴대폰 터치 목표는 48px 이상(컨트롤러 버튼은 72px 이상)입니다. 맨 끝 CSS 변수 표를 그대로 옮겨 구현합니다.

Workflow: no design-tool step. The text wireframes (07) and token tables (02–04, 10) are the spec and go straight into React + Vite after 20:00.

---

## 01 — Mood

**Near-future Seoul at night: a quiet control room watching loud games.**
The platform (launcher, lobby, dashboard) is the calm instrument panel: dark slate, neutral lines, a single cool accent. The games (Phaser canvas, hero portraits, the per-game UI kits) supply the color and noise. When both share one screen, the game wins attention and the report wins trust.

Principles — what we do / what we don't:

| # | Do | Don't |
|---|---|---|
| P1 | **Color means something.** Neutral slate for chrome; color only for state (success/warn/danger), the game being played, or the hero being measured. | No decorative gradients on panels, no neon glow on borders, no "AI sparkle" icons. |
| P2 | **The game kits stay inside the games.** Chamfered PNG frames live in Phaser and on game tiles. The web chrome is plain, coded, rounded. | Don't skin dashboard panels with the game's chamfered frame PNGs. It reads as a template mash-up. |
| P3 | **Numbers are the headline.** Short, tabular, accent-colored: "78% · 1,000 games · 12 s". Every rate shows its sample size and interval. | No percentages without n. No three-decimal precision ("78.312%"). |
| P4 | **One screen, one story.** Dashboard = game left, evidence right, nothing scrolls during the demo. | No tabs or modals the judges must open to see the result. |
| P5 | **Built like a shipped product, not a mockup.** Grounded in real patterns: Jackbox-style room code plus phone join, Steam-library-style tiles, Grafana/Datadog-style dense dark panels, forest-plot-style intervals (pattern references from memory; nothing copied). | No filler badges ("NEW", "AI-POWERED"), no bilingual labels everywhere, no wall of grey microcopy. |

Example: the lobby is 80% empty slate with a huge room code and a white QR card. The only colors are the three joined players' hero chips.
**Don't:** use pure black `#000` anywhere. Use slate `#0D1219`, which reads as a screen and not a hole.

---

## 02 — Color (Dark ↔ Light side by side)

Dark is the default for every screen. Light is optional and **only for the dashboard when projected in a bright room**. Dark has its **own accent values**: brighter and more saturated so they hold up on slate. Never reuse light values in dark (or the reverse).

### 2.1 Base

| Role | Dark (default) | Light (presentation) | Notes |
|---|---|---|---|
| Background | `#0D1219` | `#F2F4F7` | Page. Not pure black or pure white. |
| Surface 1 (panel, card) | `#141B24` | `#FFFFFF` | Light mode: white cards on grey page (Grafana/Datadog light). |
| Surface 2 (secondary button, table header, hover row) | `#1B2430` | `#EEF1F5` | |
| Surface 3 (selected, pressed) | `#243040` | `#E2E7EE` | Dark: no colored text on S3 except text-1/2. |
| Line | `#2B3747` | `#E2E6EC` | Dividers, table rules. Decorative only (exempt from 3:1). |
| Line strong | `#3D4C60` | `#C9D0DA` | Input borders, chart axes. |
| Text 1 | `#E6EBF1` (13.1:1 on S2) | `#1B2330` (15.8:1 on white) | |
| Text 2 | `#A3AFBD` (7.0:1 on S2) | `#556070` (6.4:1 on white) | Secondary labels. Use sparingly. |
| Text 3 (disabled, placeholder only) | `#7D8A9A` (4.9:1 on S1) | `#6B7685` (4.6:1 on white) | Never for content that matters. |

### 2.2 Accent (platform)

| Role | Dark | Light | Notes |
|---|---|---|---|
| Accent (solid fills, focus ring, links) | `#5AB0FF` | `#1F62D0` | |
| Accent text (numbers, eyebrows) | `#6CB6FF` (8.1:1 on S1) | `#1F62D0` (5.7:1 on white) | |
| Accent gradient (primary button, 6px header bar) | `#3FD8E0 → #5AB0FF 62% → #8E8CFF` at 135° | `#0B7C88 → #1F62D0 62% → #4F46C8` at 135° | "Han River night": teal into blue into periwinkle. |
| Text on gradient | `#0D1219` (worst stop 6.6:1) | `#FFFFFF` (worst stop 4.9:1) | Dark mode uses **dark text** on the gradient. White fails (1.7:1). |
| Badge tint background | `rgba(90,176,255,0.16)` | `rgba(31,98,208,0.10)` | |

### 2.3 Status

| Role | Dark | Light | Use |
|---|---|---|---|
| Success | `#3FCF8E` | `#13804F` | "Balanced", pass, connected. |
| Warning / Outlier | `#F2C14E` | `#9A6700` | Outlier highlight (see 08). Chosen over red so it never collides with Nightcrow red. |
| Danger | `#FF6B6B` | `#C62F37` | Errors, disconnect, failed run. Not used for data. |

Contrast of status as text on S1 (dark): 8.7 / 10.3 / 6.2. On white (light): 5.0 / 4.9 / 5.4.

### 2.4 Game accents (from the UI kits; tile edge, lobby header bar, game tag only)

| Game (folder name, working title) | Dark accent | Dark secondary | Light accent |
|---|---|---|---|
| Hero Arena (`hero_arena`) | teal `#3FD8E0` | — | `#0B7C88` |
| Hero Cards (`hero_cards`) | violet `#A98BFF` | gold `#F2B84B` | `#6A4BD1` / gold `#9A6A00` |
| Sepia Tentacle Run (`sepia_tentacle_run`) | copper `#E08A4F` | orange `#FF9A4D` | `#B4561B` |

### 2.5 Hero colors (identity chips, portrait rings, legend swatches; never bar fills)

| Hero | Dark | Light | Contrast dark on S1 / light on white |
|---|---|---|---|
| Bari | teal `#2EC4B6` | `#0E8578` | 8.0 / 4.5 |
| Real Armor | orange `#FF8A3D` | `#C2560F` | 7.4 / 4.5 |
| Daewi | olive `#A3B65E` | `#66792A` | 7.8 / 4.9 |
| Sepia | purple `#B08AF0` | `#7D52C9` | 6.4 / 5.4 |
| Nightcrow | red `#F0525A` | `#C8323B` | 5.0 / 5.3 (dark: not on S2/S3) |

Example: dashboard row "● Real Armor  78% · n = 1,000". The dot is hero orange, the number is accent text, and the bar is neutral.
**Don't:** fill win-rate bars with hero colors. Red/olive/orange are indistinguishable for about 8% of men (deuteranopia), and it turns the chart into a rainbow.

---

## 03 — Typography

One family, like the reference's single-font discipline. **Inter** for everything (UI, numbers, room code). **Noto Sans KR** only where Korean appears (hero names in Hangul, if any).

| Font | License | Weights | Source |
|---|---|---|---|
| Inter (Rasmus Andersson) | SIL Open Font License 1.1 | 400, 500, 700 | Self-host via `@fontsource/inter` (package MIT, font OFL). No CDN, because venue Wi-Fi is unreliable. |
| Noto Sans KR (Google) | SIL Open Font License 1.1 | 400, 700 | `@fontsource/noto-sans-kr`, Korean subset only |
| Fallback | — | — | `system-ui, -apple-system, "Segoe UI", sans-serif` |

Numbers: always `font-variant-numeric: tabular-nums` so columns and live counters don't jitter. Room code: Inter 700 with letter-spacing 0.08em, and an alphabet without ambiguous glyphs (no I, O, 0, 1, L).

Type scale (px / line-height / weight / tracking):

| Token | Size | LH | Wt | Tracking | Use |
|---|---|---|---|---|---|
| eyebrow | 12 | 16 | 700 | +0.08em, uppercase | Section label ("BALANCE REPORT"), accent text |
| caption | 12 | 16 | 500 | 0 | Axis labels, n, timestamps |
| small | 14 | 20 | 500 | 0 | Table cells, badges |
| body | 16 | 24 | 400 | 0 | Default |
| h3 | 20 | 28 | 700 | −0.01em | Panel titles |
| h2 | 24 | 32 | 700 | −0.01em | Screen titles |
| h1 | 32 | 40 | 700 | −0.02em | Launcher title |
| kpi | 40 | 44 | 700 | −0.02em | Headline numbers on dashboard |
| display | 64 | 68 | 700 | −0.02em | Lobby "Scan to join" |
| code | 120 | 120 | 700 | +0.08em | Lobby room code |

Laptop minimum is 14px (judges stand about 1 m away). Phone minimum is 16px.

Example: `HERO ARENA` eyebrow (12/700, teal) above "Real Armor wins too often" (h2) above "78% · 1,000 games · 12 s" (kpi, accent).
**Don't:** use a "gamer" display font (Orbitron-style) for UI. It's the fastest way to look generated. The game art already carries the genre.

---

## 04 — Components

### 4.1 Spacing, radius, shadow, motion

| Token | Values |
|---|---|
| Space (4-based) | 4, 8, 12, 16, 24, 32, 48, 64 |
| Radius | 6 (chart bar ends, inputs) · 10 (table row hover, small chips) · 14 (cards, panels) · 20 (QR card, controller pad) · 999 (buttons, badges) |
| Shadow, dark | card `0 3px 10px rgba(0,0,0,.40)` · card hover `0 10px 24px rgba(0,0,0,.55)` · primary button `0 6px 18px rgba(63,216,224,.22)` |
| Shadow, light | card `0 3px 10px rgba(16,24,40,.10)` · hover `0 10px 24px rgba(16,24,40,.14)` · primary `0 6px 18px rgba(31,98,208,.25)` |
| Motion | press 120 ms · hover/color 200 ms · card lift 250 ms · theme switch 300 ms · chart bar update 400 ms. Easing `cubic-bezier(.2,.8,.2,1)` (ease-out). |
| Reduced motion | `prefers-reduced-motion`: no translate, no bar tween. Color changes only. |

### 4.2 Buttons (code-drawn, pill)

Primary = accent gradient fill. Secondary = surface fill. Same structure in both themes; only colors change. Height 48 on laptop, 56 on phone. Padding 0 24px, label 16/700.

| State | Primary | Secondary |
|---|---|---|
| Default | gradient, text-on-gradient, primary shadow | S2 fill, text-1, no border |
| Hover | `brightness(1.05)`, translateY(−2px) | S3 fill |
| Active / pressed | translateY(0), `brightness(.95)`, shadow removed (120 ms) | S3 fill plus inset `0 0 0 1px` line-strong |
| Focus-visible | 2px solid accent outline, 2px offset (always, both themes; never removed) | same |
| Disabled | S2 fill, text-3, no gradient, no shadow, `cursor: not-allowed`, `aria-disabled` | S1 fill, text-3 |
| Loading | label kept, 16px spinner left of label, `aria-busy="true"`, width locked | same |

Example: `[ Let the bots play ]` (primary) next to `[ View last report ]` (secondary).
**Don't:** use more than one primary button per screen, or ghost/outline buttons with grey text (low contrast, reads as disabled).

### 4.3 Panels (code-drawn)

S1 fill, radius 14, padding 24, 1px line border in light mode only (dark relies on the S1/bg step). Header: eyebrow plus h3, right-aligned meta (caption, text-2). No inner shadow, no gradient.
States: default · loading (skeleton bars in S2, 1.2 s shimmer, off under reduced motion) · empty ("No runs yet. Let the bots play to see a report.", one secondary button) · error (danger 4px left rule, message, "Try again").
**Don't:** nest panels in panels. Use a divider line instead.

### 4.4 Badges (code-drawn, pill, 24px tall, 12/700, padding 0 10px)

| Badge | Style |
|---|---|
| `recorded` | Success-tint background (`rgba(63,207,142,.16)` / light `rgba(19,128,79,.10)`), success text, leading 8px filled dot. Means this match is saved into the dataset. |
| `live` | Danger text with a pulsing dot (1.6 s; static under reduced motion). Only during a running match. |
| `outlier` | Warning tint, warning text, leading ▲ glyph. |
| `bot` / `human` | S2 fill, text-2. `human` gets a 1px accent border so human rows stand out without color alone. |
| `before` / `after` | `before`: S2 plus diagonal hatch swatch. `after`: accent-tint plus solid swatch. Mirrors the chart. |

**Don't:** add badges that carry no decision ("beta", "AI", "v2"). If removing a badge loses no information, remove it.

### 4.5 Table rows (code-drawn)

Row height 48 (laptop), cells 14/500, numbers right-aligned tabular. Header: caption 12/700 uppercase text-2, S2 background, sticky.

| State | Style |
|---|---|
| Default | transparent, line divider bottom |
| Hover | S2 background, radius 10 |
| Selected (row drives the game view) | S3 background plus 3px accent left bar |
| Outlier row | 3px warning left bar, `outlier` badge, warning-colored value. Background stays neutral. |
| Human-match row | `human` badge, hero portrait 32px, "recorded" badge when saved |
| New row arriving | fades in from S3 to default over 400 ms (none under reduced motion) |

### 4.6 PNG asset vs code — where each is used

| Use PNG assets (`web-assets/assets/…`) | Draw in code |
|---|---|
| Hero `portrait.png` (256²): launcher tile corner, lobby player chips (masked to 40–64px circle with 2px hero-color ring), dashboard row avatars (32px) | All buttons, panels, cards, badges, tables, tooltips |
| Hero `full_body.png` (512², pivot bottom-center): phone controller header (cropped), lobby empty-slot silhouettes at 30% opacity | All charts: bars, intervals, baseline, axes |
| Game `backgrounds/*` as tile key-art (cover crop, 40% bottom scrim in code for title legibility) | QR code (SVG, black on white) |
| Per-game UI kit (`ui/*`, nine-slice per manifest), effects, sprites: **inside Phaser only** | Phone stick, three action buttons, connection status |
| Kit icons (`skill_melee`, `skill_projectile`, `skill_guard`) as 32px glyphs inside code-drawn phone buttons (Hero Arena only) | All text: titles, labels, numbers. No text baked into images. Kit banners (`title_banner`, `turn_banner`) get code-rendered text on top in Phaser. |

**Don't:** scale the chamfered kit `dialog_panel.png` up as a web panel background. It blurs at 1080p and clashes with the coded chrome.

---

## 05 — Card Interaction (launcher tiles, lobby player chips)

Cards float. On hover (pointer devices) a card rises 4px and its shadow deepens. In dark mode the shadow must be heavy (black 40% → 55%), or the lift is invisible on slate. Light-mode values (10% → 14%) are never reused in dark.

| State | Transform | Shadow (dark) | Other |
|---|---|---|---|
| Default | none | `0 3px 10px rgba(0,0,0,.40)` | S1, radius 14 |
| Hover | translateY(−4px), 250 ms | `0 10px 24px rgba(0,0,0,.55)` | Game-accent 2px top edge fades in |
| Pressed | translateY(−1px), 120 ms | `0 3px 10px rgba(0,0,0,.40)` | |
| Focus-visible | same as hover | same as hover | plus 2px accent outline, 2px offset (keyboard demo works) |
| Disabled ("coming soon") | none | none | key-art desaturated to 30%, text-3 label "Not testable yet", no hover |

Example tile: key-art top (16:9), then `HERO ARENA` eyebrow in teal, "5 heroes · real-time", "Last run 54% max · 1,000 games".
**Don't:** use 3D tilt, parallax, or glow-on-hover. Lift plus shadow is the whole effect.

---

## 06 — Voice / Copy

English first (judges). Short, plain, inviting rather than commanding. The voice is the same in dark and light; only color changes.

| # | Rule | Yes | No |
|---|---|---|---|
| V1 | Invite, don't order | "Scan to join" · "Let the bots play" · "Try the patch" · "Run it again" | "CLICK TO START" · "Execute simulation" |
| V2 | Numbers short and plain | "78% · 1,000 games · 12 s" · "78% → 54% after patch" | "The win-rate metric is 78.31% (n=1000)" |
| V3 | Say what's true, not what's impressive | "Real Armor wins too often" · "Within normal range" | "AI detected a critical imbalance anomaly!" |
| V4 | Errors say what to do next | "Lost the connection. Tap to rejoin." | "Error 1006" |
| V5 | Sentence case; no exclamation marks; no emoji | "Waiting for players · 2 of 4 here" | "Waiting For Players!!! 🎮" |

Screen copy set:
- Launcher: title "Pick a game to test"; tile action "Open lobby".
- Lobby: "Scan to join" · "or go to `<host>/join` and enter" plus code · "2 of 4 here" · primary "Start match".
- Phone: join "Pick your hero" · in-match "You're Bari. Watch the big screen." · after "Thanks for playing. Your match is recorded."
- Dashboard: "Let the bots play" · "Balance report" · "Suggested patch" · "Try the patch" · "Run it again" · result "Back within range: 49–55%".

**Don't:** write "AI-powered", "revolutionary", "seamless", or label every element twice in two languages.

---

## 07 — Screen layouts (text wireframes)

Laptop canvas 1920×1080 (renders cleanly at 1440×900 by scaling; Phaser canvas keeps 16:9). Phone 390×844 portrait. Outer padding 24, gap 24.

### 7.1 Launcher (1920×1080)

```
┌──────────────────────────────────────────────────────────────────────────────┐ 0
│ [logo] Playtest                                   [theme ◐]   [● 3 bots idle]│ 64 top bar (S1)
├──────────────────────────────────────────────────────────────────────────────┤
│  BOTS PLAY · AI PATCHES · YOU VERIFY      (eyebrow, accent)                  │ 120
│  Pick a game to test                      (h1)                               │
│  ━━━━━  (6px accent gradient bar, 220px)                                     │
│                                                                              │ 280
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐          │
│  │  key-art 16:9    │   │  key-art 16:9    │   │  key-art 16:9    │  3 tiles │
│  │  (arena_floor)   │   │  (cards bg)      │   │  (sepia bg)      │  560 w   │
│  │            (◯ portrait 64)               │   │                  │  each    │
│  ├──────────────────┤   ├──────────────────┤   ├──────────────────┤          │
│  │ HERO ARENA       │   │ HERO CARDS       │   │ SEPIA RUN        │ eyebrow  │
│  │ 5 heroes ·       │   │ deck duel ·      │   │ endless run ·    │ game col │
│  │ real-time        │   │ turn-based       │   │ boss phases      │          │
│  │ Last run: 78% max│   │ Not run yet      │   │ Last run: 61% max│          │
│  │ [ Open lobby ]   │   │ [ Open lobby ]   │   │ [ Open lobby ]   │          │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘ ~620 h  │
│  tiles: 3×560 + 2×48 gap = 1776, centered                                    │
└──────────────────────────────────────────────────────────────────────────────┘ 1080
```
Whole tile is the click target. The button is the visible affordance and the keyboard focus target.

### 7.2 Lobby (1920×1080)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Games   HERO ARENA (teal eyebrow)                       [theme] [● online] │ 64
├──────────────────────────────────────┬───────────────────────────────────────┤
│                                      │                                       │
│  Scan to join            (display 64)│   PLAYERS · 2 of 4 here  (eyebrow)    │
│                                      │   ┌───────────────────────────────┐   │
│  ┌────────────────┐  ROOM CODE       │   │ ◯ Bari        human  ● ready  │   │ chips 72 h
│  │                │  K 7 W Q         │   │ ◯ Nightcrow   human  ● ready  │   │
│  │   QR (SVG)     │  (code 120,      │   │ ◌ open slot   "Waiting…"      │   │
│  │   black/white  │   tabular)       │   │ ◌ open slot   or [ Add a bot ]│   │
│  │   360×360,     │                  │   └───────────────────────────────┘   │
│  │   white card   │  or open         │                                       │
│  │   radius 20,   │  host.local/join │   Bots fill empty slots when you      │
│  │   pad 24       │  (body, text-2)  │   start. (caption)                    │
│  └────────────────┘                  │                                       │
│                                      │   [ Start match ]  (primary, 56 h)    │
│  left 1080 w                         │   right 768 w                         │
└──────────────────────────────────────┴───────────────────────────────────────┘
```
States: 0 players → "Start match" disabled with the reason under it ("Waiting for at least 1 player"); player leaves → chip fades to open slot plus caption "Bari left"; QR fails to render → show URL and code larger (never a blank box).

### 7.3 Phone controller (390×844 portrait)

```
┌────────────────────────────┐ 0   (safe-area top inset respected)
│ ◯ Bari   ● connected  K7WQ │ 56  header S1: portrait 32, hero ring, status (dot + word)
├────────────────────────────┤
│ You're Bari.               │
│ Watch the big screen.      │ 160 body 16, text-2
│                            │
│   HP ███████░░░ 70%        │ 220 optional mirror of HP (code, hero color + %)
│                            │
│                            │
│                            │
│  ┌──────────┐      (B)     │ 520  B = Guard   72×72
│  │          │   (A)        │      A = Attack  88×88 (primary thumb, largest)
│  │   ( ● )  │      (C)     │      C = Skill   72×72
│  │  stick   │              │      gap ≥ 16 between buttons
│  │ 200×200  │              │      labels under each button, 12/700
│  └──────────┘              │
│  zone left half, knob 72   │ 780
├────────────────────────────┤
│        [ Leave ]  (S2)     │ 844 − safe-area bottom
└────────────────────────────┘
```
- Stick: dynamic origin. The touch-down point anywhere in the left half becomes the center; the drawn 200px ring is a hint. Knob 72px.
- Buttons: code-drawn circles, S2 fill plus 2px line-strong, kit glyph 32px plus text label. Pressed = S3, scale .94, 120 ms, plus `navigator.vibrate(10)` where supported.
- Disconnected: full-width danger bar under the header "Lost the connection. Tap to rejoin." Controls dimmed and inactive.
- Landscape: show "Turn your phone upright" (no forced lock dependency).

### 7.4 Dashboard: game plus report on one laptop screen (1920×1080)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ HERO ARENA · Run #3 (after patch)        [ Run it again ] [ Try the patch ] [◐]  │ 64
├───────────────────────────────────────────────────┬──────────────────────────────────┤ 88
│                                                   │ BALANCE REPORT        n = 1,000  │
│                                                   │ Real Armor wins too often (h2)   │
│        PHASER CANVAS 1152×648 (16:9)            │ 78% · 1,000 games · 12 s (kpi)   │
│        live bot or human match                    │──────────────────────────────────│
│        [● live] badge top-left (code overlay)     │ WIN RATE BY HERO   0  25  50 75 100│
│                                                   │ ◯ Real Armor ▲ ████████████┼─┤ 78%│ outlier
│                                                   │ ◯ Bari         ██████┼┤      51% │
│                                                   │ ◯ Daewi        █████├┼┤      47% │
│                                                   │ ◯ Sepia        ████├┤┆       42% │
│                                                   │ ◯ Nightcrow    █████├┼┤      46% │
│                                                   │        ┆ = 50% dashed baseline   │
│                                                   │──────────────────────────────────│
│                                                   │ PATCH  before → after            │
│                                                   │ Real Armor  ▨▨▨▨▨▨▨▨ 78%         │
│                                                   │             ████▌ 54%  −24 pts   │
│                                                   │ armor 40 → 28 · dash cd 3 → 4 s  │
├───────────────────────────────────────────────────┤──────────────────────────────────│ 736
│ MATCHES                                 live feed │ "Back within range: 46–55%"      │
│ #  Players            Winner      Time   Status   │  (success, shown after re-run)   │
│ 1042 Bari(h) v Crow   Bari   1:12  [human][recorded]                                 │
│ 1041 bot v bot        Daewi  0:48  [recorded]     │                                  │
│ 1040 bot v bot        R.Armor 0:31 [recorded]     │                                  │
│ (rows 48 h, 5 visible, no scroll during demo)     │                                  │
└───────────────────────────────────────────────────┴──────────────────────────────────┘ 1080
 left col 1152 w                                     right col 696 w (24 gaps)
```
Geometry: 24 + 1152 + 24 + 696 + 24 = 1920. Height: 64 top + 24 + 648 canvas + 24 + 296 matches + 24 = 1080. The report column is one panel stack and never scrolls; overflow detail goes behind "Details" for after the demo.
Click a row in MATCHES → that replay loads in the canvas (selected-row style). Human rows always pin to the top with `human` plus `recorded`.

---

## 08 — Data visualization rules

| Element | Rule |
|---|---|
| Win-rate bar | Horizontal, 0–100% fixed scale (never auto-zoom), 20px tall, radius 6 at the end only. Fill **neutral** `--viz-bar` (dark `#5B6B80`, light `#8A97A8`). Hero identity = 10px hero-color dot plus portrait before the label, not the bar color. Value label right of the bar, tabular, text-1. |
| Wilson 95% interval | 2px line in text-1 across [low, high] with 8px end caps, drawn over the bar end. The point estimate is a 2px tick. Tooltip/caption: "95% CI 75–81% · n = 1,000". Always computed (Wilson, not normal approximation) so small-n human rows don't show impossible ranges. |
| 50% baseline | Vertical dashed line `4 4`, 1px, text-2, label "50%" at the top axis. Drawn above bars, below intervals. |
| Balanced band (optional) | Light shaded band 45–55% (`--viz-band`, 6% text-1 alpha) so "inside/outside fair range" is visible without reading numbers. |
| Outlier | Defined by data rule (interval entirely outside the balanced band). Encoded **three ways**: bar fill switches to `--warning`, a ▲ glyph plus "Outlier" badge next to the name, and the row gets a 3px warning left bar. Only outliers are colored; everything else stays neutral. |
| Before vs after patch | Paired bars per hero, before on top. **Before** = hollow bar, 1.5px `--viz-before` outline plus 45° hatch at 30% (shape, not color). **After** = solid accent fill. Delta text right: "78% → 54% · −24 pts" (accent text). Same scale, same baseline. |
| Color-blind safety | Palette checked for deuteranopia/protanopia: neutral vs warning (luminance gap) and hatch vs solid (texture) carry meaning; blue/yellow over red/green. Never red-vs-green to mean bad/good. Test by toggling grayscale (`filter: grayscale(1)`): every distinction must survive. |
| Numbers | Integers for %, one decimal only when n ≥ 10,000. Thousands separators. Times as "12 s", "1:12". |
| Animation | Bars tween 400 ms on new data. The interval appears after the bar settles. No bounce. |
| Empty / small data | n < 30: bar drawn hatched-grey with "Too few games yet". The outlier rule is suppressed (no false alarms on stage). |

**Don't:** use pie charts, 3D bars, dual axes, gradient-filled bars, or a truncated axis that starts at 30%.

---

## 09 — Accessibility

| Rule | Target |
|---|---|
| Text contrast | ≥ 4.5:1 for all text (body, small, badge, axis labels). All tokens above are measured: worst dark text pair Text 3 on S1 4.9:1; worst light pair hero Bari on white 4.5:1. Large display text still held to 4.5. |
| Non-text contrast | ≥ 3:1 for focus rings, chart bars vs background, input borders, stick ring. |
| Colored text placement | Dark: hero/status colors on bg/S1/S2 only (Nightcrow red on bg/S1 only). Light: colored text on white surfaces only, not on the grey page. |
| Touch targets (phone) | ≥ 48×48px for everything; controller action buttons 72–88px; ≥ 16px gap between action buttons; Leave button separated (bottom, needs deliberate tap). |
| Pointer targets (laptop) | ≥ 44px height for buttons and rows (we use 48). |
| No color-only meaning | Status = dot + word ("● connected"); outlier = color + glyph + badge; before/after = texture + label; human rows = badge + border. |
| No text in images | All text is live text (selectable, scalable, translatable). PNG banners carry text overlaid in code. |
| Focus | Visible 2px accent ring on every interactive element; logical tab order: top bar → main → side. The launcher works with keyboard only. |
| Motion | Respect `prefers-reduced-motion`; no flashing above 3 Hz (hit sparks live inside the game only). |
| Semantics | Charts have a text alternative (visually hidden table of hero, rate, CI, n). Live match feed uses `aria-live="polite"`. |
| Language | `lang="en"`; Korean spans get `lang="ko"` plus Noto Sans KR. |

---

## 10 — CSS variable list (for implementation)

Dark values go on `:root` / `[data-theme="dark"]`, light values on `[data-theme="light"]`. Names are final. Implement them as-is after 20:00.

| Variable | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0D1219` | `#F2F4F7` | page |
| `--surface-1` | `#141B24` | `#FFFFFF` | panel, card |
| `--surface-2` | `#1B2430` | `#EEF1F5` | secondary btn, table header, row hover |
| `--surface-3` | `#243040` | `#E2E7EE` | selected, pressed |
| `--line` | `#2B3747` | `#E2E6EC` | dividers |
| `--line-strong` | `#3D4C60` | `#C9D0DA` | borders, axes |
| `--text-1` | `#E6EBF1` | `#1B2330` | primary text |
| `--text-2` | `#A3AFBD` | `#556070` | secondary text |
| `--text-3` | `#7D8A9A` | `#6B7685` | disabled, placeholder |
| `--accent` | `#5AB0FF` | `#1F62D0` | focus ring, solid accent |
| `--accent-text` | `#6CB6FF` | `#1F62D0` | numbers, eyebrows, links |
| `--accent-tint` | `rgba(90,176,255,.16)` | `rgba(31,98,208,.10)` | badge bg, after-bar tint |
| `--grad-1` | `#3FD8E0` | `#0B7C88` | gradient stop 0% |
| `--grad-2` | `#5AB0FF` | `#1F62D0` | gradient stop 62% |
| `--grad-3` | `#8E8CFF` | `#4F46C8` | gradient stop 100% |
| `--on-grad` | `#0D1219` | `#FFFFFF` | text on primary button |
| `--success` | `#3FCF8E` | `#13804F` | ok, recorded |
| `--success-tint` | `rgba(63,207,142,.16)` | `rgba(19,128,79,.10)` | recorded badge bg |
| `--warning` | `#F2C14E` | `#9A6700` | outlier |
| `--warning-tint` | `rgba(242,193,78,.16)` | `rgba(154,103,0,.10)` | outlier badge bg |
| `--danger` | `#FF6B6B` | `#C62F37` | error, live, disconnect |
| `--danger-tint` | `rgba(255,107,107,.16)` | `rgba(198,47,55,.10)` | error bar bg |
| `--game-arena` | `#3FD8E0` | `#0B7C88` | Hero Arena accent |
| `--game-cards` | `#A98BFF` | `#6A4BD1` | Hero Cards accent |
| `--game-cards-2` | `#F2B84B` | `#9A6A00` | Hero Cards gold |
| `--game-sepia` | `#E08A4F` | `#B4561B` | Sepia Run copper |
| `--game-sepia-2` | `#FF9A4D` | `#B4561B` | Sepia Run orange |
| `--hero-bari` | `#2EC4B6` | `#0E8578` | Bari |
| `--hero-real-armor` | `#FF8A3D` | `#C2560F` | Real Armor |
| `--hero-daewi` | `#A3B65E` | `#66792A` | Daewi |
| `--hero-sepia` | `#B08AF0` | `#7D52C9` | Sepia |
| `--hero-nightcrow` | `#F0525A` | `#C8323B` | Nightcrow |
| `--viz-bar` | `#5B6B80` | `#8A97A8` | neutral win-rate bar |
| `--viz-before` | `#8C98A8` | `#6B7685` | before-patch outline/hatch |
| `--viz-band` | `rgba(230,235,241,.06)` | `rgba(27,35,48,.05)` | 45–55% balanced band |
| `--viz-baseline` | `#A3AFBD` | `#556070` | 50% dashed line |
| `--qr-bg` | `#FFFFFF` | `#FFFFFF` | QR card (always white) |
| `--qr-fg` | `#000000` | `#000000` | QR modules (the only allowed black) |
| `--shadow-card` | `0 3px 10px rgba(0,0,0,.40)` | `0 3px 10px rgba(16,24,40,.10)` | card rest |
| `--shadow-card-hover` | `0 10px 24px rgba(0,0,0,.55)` | `0 10px 24px rgba(16,24,40,.14)` | card hover |
| `--shadow-primary` | `0 6px 18px rgba(63,216,224,.22)` | `0 6px 18px rgba(31,98,208,.25)` | primary button |
| `--font-sans` | `"Inter", "Noto Sans KR", system-ui, -apple-system, "Segoe UI", sans-serif` | same | all text |
| `--font-ko` | `"Noto Sans KR", "Inter", system-ui, sans-serif` | same | `lang="ko"` spans |
| `--fs-eyebrow` / `--fs-caption` | `12px` | same | |
| `--fs-small` | `14px` | same | |
| `--fs-body` | `16px` | same | |
| `--fs-h3` | `20px` | same | |
| `--fs-h2` | `24px` | same | |
| `--fs-h1` | `32px` | same | |
| `--fs-kpi` | `40px` | same | |
| `--fs-display` | `64px` | same | |
| `--fs-code` | `120px` | same | room code |
| `--fw-regular` / `--fw-medium` / `--fw-bold` | `400` / `500` / `700` | same | |
| `--space-1` … `--space-8` | `4px` `8px` `12px` `16px` `24px` `32px` `48px` `64px` | same | |
| `--radius-xs` | `6px` | same | bar ends, inputs |
| `--radius-sm` | `10px` | same | row hover, chips |
| `--radius-md` | `14px` | same | cards, panels |
| `--radius-lg` | `20px` | same | QR card, controller pad |
| `--radius-pill` | `999px` | same | buttons, badges |
| `--focus-ring` | `0 0 0 2px var(--bg), 0 0 0 4px var(--accent)` | same | focus-visible |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | same | all motion |
| `--dur-press` | `120ms` | same | |
| `--dur-hover` | `200ms` | same | |
| `--dur-lift` | `250ms` | same | card hover |
| `--dur-theme` | `300ms` | same | |
| `--dur-data` | `400ms` | same | bar tween, row arrive |
| `--lift-card` | `-4px` | same | card hover translateY |
| `--lift-btn` | `-2px` | same | primary hover translateY |
| `--btn-h` / `--btn-h-touch` | `48px` / `56px` | same | |
| `--touch-min` | `48px` | same | phone minimum |
| `--pad-btn-action` / `--pad-btn-main` | `72px` / `88px` | same | controller button diameters |
| `--stick-zone` / `--stick-knob` | `200px` / `72px` | same | controller stick |
| `--row-h` | `48px` | same | table row |
| `--topbar-h` | `64px` | same | laptop top bar |

---

### Verification notes / 확인 메모
- Contrast ratios were computed with the WCAG 2.x relative-luminance formula against the token values above (script run on 2026-11-13). They were not yet checked on a rendered screen; that happens after 20:00 with screenshots at 1920×1080 and 390×844, dark and light.
- Asset colors were read by eye from `hero_arena/ui/dialog_panel.png`, `hero_cards/ui/button_normal.png`, `sepia_tentacle_run/ui/button_normal.png` (PIL is not available for sampling). Game accent hex values are close approximations, tuned for contrast, not exact pixel picks.
- Real-product pattern references (Jackbox, Steam library, Grafana/Datadog, forest plots) are from general knowledge; no external pages were fetched for this doc.
