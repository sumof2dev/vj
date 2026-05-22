# VJ Web UI: Architecture & Standards

This document defines the architectural standards for the RaveBox management and setup interfaces.

---

## 1. UI State Management (Tabs & Sidebars)

> [!CAUTION]
> DO NOT invent new ways to toggle UI visibility. Follow the exact data-attribute pattern defined below.

- **The Pattern**: All tabs, sidebars, and modal switches in the Setup UI use data-attributes (e.g., `data-target="engine-panel"`).
- **CSS Classes**: We strictly use the `.active` and `.hidden` classes to manage visibility. Do NOT manipulate `element.style.display` directly in JavaScript.
- **Event Delegation**: Do not attach individual event listeners to every button. The system uses global event delegation on the document body to listen for clicks on `[data-target]` elements.

---

## 2. Canvas & Visualizer Standards (EQ, Waveforms)

> [!CAUTION]
> The application maintains exactly ONE global render loop. The AI is strictly forbidden from creating new `requestAnimationFrame` instances or new `setInterval` loops for canvas drawing.

- **Data Source**: Frontend visualizers do NOT calculate audio data. They receive pre-calculated arrays (Bin energies, waveforms) directly from the backend via WebSockets (or SSE). 
- **The Draw Pipeline**: To update the EQ meter or Waveform, you must inject your canvas drawing logic into the existing `renderData()` function. 
- **Canvas Context**: Do not constantly query the DOM for the canvas context (e.g., `getContext('2d')`). Contexts are initialized once on page load and stored in the global `uiState` object. 
- **Performance**: Clear the canvas using `clearRect(0,0,w,h)` at the start of the draw cycle. Do not overlay black rectangles to clear frames.

---

## 3. Dynamic Backgrounds & Visual Effects

To maintain a premium, immersive aesthetic, the `manager.html` dashboard utilizes a multi-layered background system.

### 3.1 Ken Burns Tunnel Effect
- **Implementation**: 4 layered PNG images (`background.png` to `background4.png`) stacked with absolute positioning.
- **Animation**: A 32-second staggered CSS cycle (`tunnel-move`) that scales and crossfades images to create a continuous forward-motion illusion.
- **Filter**: Images are brightness-limited (`brightness(0.6)`) and overlaid with a dark gradient to ensure high contrast for UI text.

### 3.2 Alternating Scanlines
- **Effect**: A CRT-style overlay (`.scanlines`) using a repeating `linear-gradient` with a slow scrolling animation.
- **Toggle Logic**: Visibility is toggled on **every page refresh/load** using the `localStorage` key `vj_show_scanlines`. This provides a "fresh" visual experience each time the user returns to the dashboard.
- **Placement**: Must be positioned at a high `z-index` relative to the background but below the interactive UI containers.

### 3.3 Spotify Background Rotation
- **Rotation Interval**: 60 seconds.
- **Behavior**: If Spotify is active, the background alternates between the **Album Art** and the **Tunnel Effect** every minute.
- **Art Zoom**: The Spotify background art uses a dedicated Ken Burns scaling animation (`spotify-move`) to maintain visual consistency with the tunnel effect.

---

## 4. Known Anti-Patterns & Reoccurring Bugs

- **Bug**: The EQ meter freezes when switching tabs.
  - **The Fix**: Hide containers using CSS `opacity` or `display: none`. Never delete and recreate the canvas node.
- **Bug**: The sidebar loses its active state styling.
  - **Why it happens**: Applying the `.active` class to the `<a>` tag instead of the parent `<li>` tag.
- **Bug**: Stale UI assets in development.
  - **The Standard**: All caching is handled at the infrastructure level via `dev_server.py` headers and Service Worker bypasses. **NEVER** manually apply cache-busting query strings to file imports in HTML (e.g., `src="engine_tab.js?v=123"`).

---
*Technical Ref: UI-ARCH v1.1 / Aesthetic-Standards*
