---
name: Cyber-Arcade
colors:
  surface: '#111417'
  surface-dim: '#111417'
  surface-bright: '#37393d'
  surface-container-lowest: '#0b0e11'
  surface-container-low: '#191c1f'
  surface-container: '#1d2023'
  surface-container-high: '#272a2e'
  surface-container-highest: '#323538'
  on-surface: '#e1e2e7'
  on-surface-variant: '#bacbbe'
  inverse-surface: '#e1e2e7'
  inverse-on-surface: '#2e3134'
  outline: '#859589'
  outline-variant: '#3b4a41'
  surface-tint: '#20e19a'
  primary: '#61ffb8'
  on-primary: '#003823'
  primary-container: '#24e39b'
  on-primary-container: '#00603e'
  inverse-primary: '#006c47'
  secondary: '#ffb3b3'
  on-secondary: '#680016'
  secondary-container: '#ac012b'
  on-secondary-container: '#ffb7b8'
  tertiary: '#ffe0ad'
  on-tertiary: '#422d00'
  tertiary-container: '#fabe47'
  on-tertiary-container: '#6e4d00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#50ffb4'
  primary-fixed-dim: '#20e19a'
  on-primary-fixed: '#002112'
  on-primary-fixed-variant: '#005234'
  secondary-fixed: '#ffdad9'
  secondary-fixed-dim: '#ffb3b3'
  on-secondary-fixed: '#40000a'
  on-secondary-fixed-variant: '#920023'
  tertiary-fixed: '#ffdea8'
  tertiary-fixed-dim: '#f9bc46'
  on-tertiary-fixed: '#271900'
  on-tertiary-fixed-variant: '#5e4200'
  background: '#111417'
  on-background: '#e1e2e7'
  surface-variant: '#323538'
typography:
  display-multiplier:
    fontFamily: Space Mono
    fontSize: 72px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: -0.04em
  display-multiplier-mobile:
    fontFamily: Space Mono
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Mono
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: 0.02em
  headline-md:
    fontFamily: Space Mono
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-caps:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  container-max: 1200px
---

## Brand & Style
The design system is engineered to evoke the high-stakes adrenaline of a 1980s neon arcade fused with modern fintech precision. The target audience is a digitally native generation that values speed, visual feedback, and the thrill of the "win" state. 

The design style is a hybrid of **High-Contrast Digital Arcade** and **Retro-Futurism**. It utilizes deep obsidian surfaces to make neon accents "pop" with maximum luminance. Glowing effects are applied selectively to signify active states, multipliers, and successful outcomes, while the overall structure remains rigid and disciplined through a subtle grid-based layout. The interface must feel fast, responsive, and alive, mimicking the tactile feedback of a physical arcade cabinet through digital cues.

## Colors
The palette is built on a "Neon on Noir" foundation to ensure maximum readability and emotional impact.

- **Background (#0B0E11):** A deep, near-black that provides the canvas for high-luminance elements.
- **Primary / Win (#24E39B):** A vibrant neon green used for positive actions, increasing multipliers, and "win" states.
- **Crash / Loss (#FF4C5E):** A sharp neon red for "crash" moments, decreasing values, and high-urgency alerts.
- **Gold / Cash-out (#FFC24B):** Reserved for currency, high-value chips, and the finality of securing a win.
- **Surface (#1A1D23):** A deep charcoal used for card containers and structural elements, accented with 1px borders to maintain definition.

## Typography
Typography is split into two functional roles: **Information** and **Data**.

1.  **Headlines & Multipliers (Space Mono):** Used for all betting odds, multipliers, and section headers. The monospaced nature ensures that ticking numbers do not cause visual "jitter" as values fluctuate. Use uppercase for section headers to lean into the arcade aesthetic.
2.  **UI & Functional Text (Geist):** Used for instructions, settings, and standard UI components. It provides a clean, neutral balance to the aggressive monospaced headers.
3.  **Data Labels (JetBrains Mono):** Used for micro-copy, timestamps, and history logs where tabular alignment is critical for scanning data.

All multipliers over 10x should receive a subtle outer glow (text-shadow) in the primary neon green color.

## Layout & Spacing
The layout follows a **Fixed Grid** model on desktop and a **Fluid Content** model on mobile. A strict 4px baseline rhythm is used to maintain the "digital" feel.

- **Desktop:** 12-column grid with 16px gutters. The main betting action area typically spans 8 columns, with history and social feeds taking up the remaining 4.
- **Mobile:** Single column with 16px side margins. The betting interface is pinned to the bottom of the viewport for thumb-reachability ("Bottom-Heavy" layout).
- **Grid Overlay:** This design system encourages the use of a subtle, low-opacity (5%) background grid pattern to reinforce the digital/technical theme.

## Elevation & Depth
Depth in this design system is achieved through **Tonal Layering** and **Luminous Accents** rather than traditional shadows.

- **Level 0 (Background):** #0B0E11 (Canvas).
- **Level 1 (Surfaces):** #1A1D23. These containers use a 1px solid border (#2D323B) to separate them from the background.
- **Active Elevation:** When a component is interactive or focused, the border color changes to the Primary Green, and a subtle "glow" (0px 0px 8px) is applied using the primary color at 30% opacity.
- **Floating Elements:** Modals and tooltips use a darker background than Level 1 to maintain contrast, with a high-contrast border.

## Shapes
The shape language is **Sharp and Geometric**. To honor the "arcade" and "digital" aesthetic, the system avoids rounded corners entirely.

- **Primary Elements:** 0px border radius (Sharp).
- **Selection Indicators:** Use 45-degree "clipped corner" shapes for active tabs or selected chips to add a futuristic, technical edge.
- **Borders:** Consistently 1px or 2px. Avoid thick, chunky borders.

## Components
- **Buttons:** Large, blocky, and high-contrast. The "Bet" button is Primary Green with black text. The "Cash Out" button is Gold. All buttons use a "pressed" state that shifts the element 2px down and right to simulate a physical microswitch.
- **Chips:** Octagonal or square shapes with the denomination centered in monospaced type. Active chips have a glowing border.
- **Multipliers:** Large-scale display text. When the multiplier is active, it should pulse slightly. When it crashes, the text turns Neon Red and "shakes" horizontally.
- **Input Fields:** Dark background (#0B0E11) with a 1px border. On focus, the border glows. Use tabular figures for numerical input.
- **Lists (History):** Compact rows with alternating background tints. Win/Loss status is indicated by a vertical bar on the left edge in the respective neon color.
- **Progress Bars (Crash Graph):** A 2px solid line that draws in real-time. The area beneath the line should have a faint, vertical scanning-line gradient.