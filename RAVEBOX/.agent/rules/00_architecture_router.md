---
trigger: always_on
---

# VJ Engine Architecture Router

This project has strict mathematical and architectural standards. If you are asked to modify, debug, or analyze any of the following systems, you MUST read the corresponding documentation file BEFORE writing any code or proposing solutions.

## Context Map:

- **Audio, DMX & Vibe Engine:** Read `.agent/docs/audio_flow_explanation.md`
  *(Trigger: user mentions audio, transients, main.py, vibe states, dmx_engine.py, fixtures, LFOs, or hardware translation)*


- **Web UI & Shader Management:** Read `.agent/docs/architecture_ui.md`
  *(Trigger: user mentions player.html, GLSL, WebGL, shaders, frontend styling, or the setup UI)*

**CRITICAL INSTRUCTION:** Do not guess the system constraints. If the user's prompt touches on these domains, immediately use your file-reading tool to ingest the required document.

## 1. UI State Management (Tabs & Sidebars)

> [!CAUTION]
> DO NOT invent new ways to toggle UI visibility. Follow the exact data-attribute pattern defined below.

- **The Pattern:** All tabs, sidebars, and modal switches in the Setup UI use data-attributes (e.g., `data-target="engine-panel"`).
- **CSS Classes:** We strictly use the `.active` and `.hidden` classes to manage visibility. Do NOT manipulate `element.style.display` directly in JavaScript.
- **Event Delegation:** Do not attach individual event listeners to every button. The system uses global event delegation on the document body to listen for clicks on `[data-target]` elements.


## 2. Canvas & Visualizer Standards (EQ, Waveforms)

> [!CAUTION]
> The application maintains exactly ONE global render loop. The AI is strictly forbidden from creating new `requestAnimationFrame` instances or new `setInterval` loops for canvas drawing.

- **Data Source:** Frontend visualizers do NOT calculate audio data. They receive pre-calculated arrays (Bin energies, waveforms) directly from the backend via WebSockets (or SSE). 
- **The Draw Pipeline:** To update the EQ meter or Waveform, you must inject your canvas drawing logic into the existing `renderData()` function. 
- **Canvas Context:** Do not constantly query the DOM for the canvas context (e.g., `getContext('2d')`). Contexts are initialized once on page load and stored in the global `uiState` object. 
- **Performance:** Clear the canvas using `clearRect(0,0,w,h)` at the start of the draw cycle. Do not overlay black rectangles to clear frames.


## 3. Known Anti-Patterns & Reoccurring Bugs
If you are modifying the UI, check this list to ensure you are not re-introducing a known bug:
- **Bug:** The EQ meter freezes when switching tabs.
  - **Why it happens:** The AI accidentally removes the `canvas` element from the DOM when hiding a tab, destroying the WebGL context.
  - **The Fix:** Hide containers using CSS `opacity` or `display: none`. Never delete and recreate the canvas node.
- **Bug:** The sidebar loses its active state styling.
  - **Why it happens:** Applying the `.active` class to the `<a>` tag instead of the parent `<li>` tag.

## 4. Caching and Versioning Anti-Pattern

> [!CAUTION]
> NEVER manually apply cache-busting query strings to file imports in HTML (e.g., `src="engine_tab.js?v=123"`). 

- **The Problem:** Hardcoding versions causes endless caching loops during development. 
- **The Standard:** All caching is handled at the infrastructure level via `dev_server.py` headers and Service Worker bypasses. 
- **Action:** If the user complains that "files are not updating" or "clear the cache," DO NOT append version numbers to HTML script/link tags. Instead, verify that the `dev_server.py` is sending `Cache-Control: no-store` headers.

## 5. Deployment and Pi Node Restarts

> [!CAUTION]
> NEVER execute `./push_update.sh` or run any commands that restart the remote Pi device/services WITHOUT explicit user acknowledgement and confirmation in the chat first. Even if you believe the deployment is complete, ask the user before pushing updates or restarting the Pi.