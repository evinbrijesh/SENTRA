---
name: Sentra
colors:
  surface: '#111318'
  surface-dim: '#111318'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#1e2024'
  surface-container-high: '#282a2e'
  surface-container-highest: '#333539'
  on-surface: '#e2e2e8'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#c4c6d3'
  on-secondary: '#2d303a'
  secondary-container: '#444651'
  on-secondary-container: '#b3b4c1'
  tertiary: '#bcc7de'
  on-tertiary: '#263143'
  tertiary-container: '#8691a7'
  on-tertiary-container: '#1f2a3c'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#e0e2ef'
  secondary-fixed-dim: '#c4c6d3'
  on-secondary-fixed: '#181b25'
  on-secondary-fixed-variant: '#444651'
  tertiary-fixed: '#d8e3fb'
  tertiary-fixed-dim: '#bcc7de'
  on-tertiary-fixed: '#111c2d'
  on-tertiary-fixed-variant: '#3c475a'
  background: '#111318'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  component-gap: 8px
  sidebar-width: 260px
---

## Brand & Style
The design system is engineered for high-stakes Security Operations Center (SOC) environments where rapid data synthesis and zero-latency decision-making are critical. The brand personality is authoritative, precise, and vigilant. 

The aesthetic blends **Modern Corporate** structure with **Glassmorphism** and **Technical Minimalism**. It utilizes a "Mission Control" visual language characterized by deep, layered backgrounds that reduce eye strain during long shifts, punctuated by high-intensity functional accents. The UI maintains high information density without sacrificing clarity, using thin borders and subtle translucent layers to distinguish between nested data modules.

## Colors
The palette is rooted in a "Deep Space" darkness to maximize the visibility of status indicators. 

- **Primary Canvas**: `#0A0C10` serves as the base application background.
- **Surface Elevation**: `#11141D` is used for primary containers and cards.
- **Borders & Dividers**: `#1E293B` provides high-contrast structural definition.
- **Actionable Blue**: `#3B82F6` (Electric Blue) is reserved for primary interactions and active states.
- **Semantic Logic**: Emerald (`#10B981`) for cleared/low-risk, Amber (`#F59E0B`) for items requiring review, and Crimson (`#EF4444`) for critical high-risk alerts.

## Typography
This design system employs a dual-typeface strategy to separate UI narrative from technical data.

- **UI Narrative**: **Inter** is used for all headers, navigation, and instructional text. Its neutral, grotesque form ensures legibility at small sizes within dense layouts.
- **Technical Data**: **JetBrains Mono** is used for all machine-generated content, including IP addresses, timestamps, logs, and risk scores. The monospaced nature ensures that vertical alignment is maintained in data tables and log streams.
- **Hierarchy**: Use `display-lg` sparingly for dashboard-level summaries. `data-mono` should be the default for any value that requires precise comparison.

## Layout & Spacing
The layout follows a **Fixed-Fluid Hybrid** model. The sidebar remains fixed at 260px for immediate tool access, while the main content area uses a fluid 12-column grid.

- **Density**: A 4px baseline grid governs all spacing.
- **Grid**: Use 16px gutters between dashboard widgets to maintain a "tiled" look. 
- **Adaptation**: On smaller screens (Tablets), the sidebar collapses into an icon-only rail, and 3-column widget rows reflow into a single column.
- **Margins**: A consistent 24px outer margin ensures content does not bleed into the bezel of professional monitors.

## Elevation & Depth
Depth is conveyed through **Glassmorphism** and **Tonal Layering** rather than traditional shadows.

- **Base Layer**: Background `#0A0C10`.
- **Card Layer**: Surfaces use `#11141D` with a subtle `backdrop-filter: blur(8px)`.
- **Border Treatment**: Every elevated surface must have a 1px solid border of `#1E293B`. For active or high-priority cards, the border may transition to a subtle glow using the primary or semantic colors.
- **Overlay Layer**: Modals and dropdowns use a slightly lighter surface (`#1E293B`) to stand out against the card layer, accompanied by a 20% opacity black outer glow.

## Shapes
The shape language is "Soft-Industrial." All primary UI components (Buttons, Cards, Inputs) use a **4px (0.25rem)** corner radius. This provides a clean, professional look that feels modern but retains the structural rigidity expected of military-grade or high-security software. 

- **Status Pills**: Use a fully rounded (pill) shape to differentiate status indicators from interactive buttons.
- **Nodes**: In topology maps, use sharp 0px corners to denote technical endpoints.

## Components
- **Buttons**: Primary buttons are solid `#3B82F6` with white text. Secondary buttons use a ghost style with `#1E293B` borders and Inter Medium weight text.
- **Data Tables**: Rows use a subtle hover state transition (`#1E293B`). Use `data-mono` for all cell content except for row titles.
- **Risk Badges**: Small, high-contrast pills with a subtle background tint (e.g., 10% opacity Crimson background with 100% opacity Crimson text) for instant risk categorization.
- **KPI Cards**: Feature a `title-sm` header, a large `data-mono` value, and a simplified SVG sparkline in the background using the relevant semantic color.
- **Input Fields**: Dark backgrounds (`#0A0C10`) with a 1px border. The border glows Electric Blue on `:focus`.
- **Interactive Sidebar**: Icon-heavy with `body-sm` labels. Active states are indicated by a 2px vertical "light bar" on the left edge of the menu item.