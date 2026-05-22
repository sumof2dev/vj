# RAVEBOX Local Codebase Audit Report

## File: launcher.py
- **Broken or dead references (variables/imports used but never defined):**
  - `http.server.SimpleHTTPRequestHandler` is imported but not used.
  
- **Outdated legacy structures:**
  - The use of synchronous blocks for subprocess calls can be replaced with asynchronous alternatives like `asyncio`.
  
- **Bad error handling:**
  - There are several instances where exceptions are caught without any logging or further action, such as in the `handle_shell_command` method.

## File: dev_server.py
- Broken or dead references (variables/imports used but never defined):
  - `ssl.create_default_context()` is called without an alias, making it difficult to modify SSL settings if needed.

- Outdated legacy structures (e.g., synchronous blocks where async should be used, old loops):
  - The code uses synchronous HTTP requests and file operations. Consider using asynchronous versions for better performance in high-traffic environments.
  
- Bad error handling (bare 'except:', unhandled promise rejections, missing try/catch):
  - There are no bare `except:` statements in the code, which is good practice.
  - However, some exceptions are caught with generic `except` clauses without specifying the exception type, which can hide issues. For example:
    ```python
    except: continue
    ```
  - This should be replaced with specific exception types to improve error handling and debugging.

## File: spotify_auth.py
- Missing `SPOT_CLIENT_ID`, `SPOT_CLIENT_SECRET` values.
- Unhandled promise rejections (though not applicable in Python).
- Bare 'except:' used for loading credentials, which can hide other exceptions.

## File: server.py
This Python script sets up a web server for handling various tasks related to video projection and performance. The server runs on port 8000 by default, but can be configured otherwise. It supports both HTTP and HTTPS (if SSL certificates are provided). Below is a breakdown of the key functionalities and how they are implemented:

1. **Server Configuration**:
   - The server listens on all network interfaces (`0.0.0.0`) and the specified port.
   - If SSL certificates (`cert.pem` and `key.pem`) are present, it serves over HTTPS.

2. **Request Handling**:
   - The script defines a custom request handler (`ProductionHandler`) that extends `http.server.SimpleHTTPRequestHandler`.
   - This handler includes methods to handle different types of requests and responses.

3. **Handling Requests for Specific Files**:
   - For legacy configuration files (like `/config.json`, `/shapes.json`, etc.), it reads the incoming data, saves it to the appropriate file, and responds with a success message.

4. **Updating Descriptors**:
   - It includes methods (`_handle_add_descriptor` and `_handle_update_descriptor`) to add or update premade descriptors in `shared_setup.js`.
   - These methods also export the updated descriptors to `backend/descriptors.json`.

5. **Exporting Descriptors to JSON**:
   - The script uses regular expressions to extract descriptor objects from `shared_setup.js` and writes them to `descriptors.json`.

6. **Handling Media Requests**:
   - It handles requests for media files like images, videos, and scripts by setting appropriate MIME types.

7. **Error Handling**:
   - Errors during file operations or JSON processing are caught and logged with appropriate error messages.

8. **Threading for Concurrency**:
   - The server uses `socketserver.ThreadingTCPServer` to handle multiple requests concurrently.

9. **Logging Server Information**:
   - Upon startup, the script logs the port number and whether SSL is enabled.
   - It also attempts to determine the local network IP address to provide easy access instructions.

### Example Usage

To start the server with HTTPS:

```bash
python server.py
```

If you have SSL certificates (`cert.pem` and `key.pem`) in your directory, the server will run over HTTPS. Otherwise, it will default to HTTP.

To stop the server, simply press `Ctrl+C`.

This server is designed for use in performance settings where video projection and real-time data processing are required. The ability to add, update, and export descriptors dynamically allows for flexible configuration without modifying static files manually.

## File: backend/audio_analyzer.py
- Bad error handling: `try`/`except` blocks are missing.
- Outdated legacy structures: Synchronous code (`time.time()`) is used instead of async where possible.

## File: backend/dmx_engine.py
This Python code defines a class `LogicEngine` which appears to be part of a larger system for controlling lighting effects based on audio input. The class contains methods for evaluating rules, resolving preset values, and managing overrides for specific lighting channels. Below is a detailed breakdown of the key components and functionalities:

### Key Components

1. **Initialization**:
   - `__init__(self)`: Initializes various attributes including speed, intensity, audio sensitivity, manual presets, and overrides.

2. **Rule Evaluation**:
   - `_apply_rule_math(self, rule, st, logic_matrix, dt, audio=None)`: Applies a rule to determine the output value based on the source (e.g., volume), modifiers (e.g., speed), calibration (e.g., min, center, max), and current state (`st`). This method is used by `_evaluate_preset_behavior` to compute values for lighting channels.

3. **Preset Value Resolution**:
   - `_resolve_preset_value(self, ov_key, val, dt)`: Parses a string representing a value or behavior (like "0-255" or "30, 50-100") and resolves it to an integer based on the current phase.

4. **Behavior Evaluation**:
   - `_evaluate_preset_behavior(self, ov_ch, audio, logic_matrix, instance_key, use_raw_dt=False)`: Evaluates a preset behavior override by converting it into a rule-like object and applying `_apply_rule_math` to compute the value.

5. **Utility Methods**:
   - `get_universe(self)`: Returns the current state of the lighting universe.
   - `set_intensity(self, val)`, `set_speed(self, val)`, `set_audio_sensitivity(self, val)`: Setters for intensity, speed, and audio sensitivity respectively.
   - `set_pause(self, state)`: Pauses or resumes the engine based on the provided state.
   - `apply_overrides(self, ol, sl=[])`: Applies a list of overrides to specific addresses in the lighting universe.
   - `clear_device_overrides(self, dev_id)`, `clear_address_overrides(self, addresses)`: Clears overrides for a device or specific addresses.
   - `toggle_manual_preset(self, preset_id: str, state: bool = None, exclusive: bool = False)`, `clear_manual_presets(self)`: Manages the active state of manual presets.

### Usage Example

Here's a simple example of how you might use this class in a larger context:

```python
# Assuming you have a LogicEngine instance named engine
engine = LogicEngine()

# Set some initial parameters
engine.set_intensity(0.5)
engine.set_speed(1.2)
engine.set_audio_sensitivity(0.8)

# Apply an override to address 100
engine.overrides[100] = 128

# Evaluate a preset behavior (assuming ov_ch is a dictionary representing the override)
ov_ch = {
    'behavior': 'fast',
    'source': 'volume',
    'modifiers': {},
    'cal': {'min': 0, 'center': 128, 'max': 255}
}
audio_data = None  # Placeholder for audio data
instance_key = 'default'
value = engine._evaluate_preset_behavior(ov_ch, audio_data, logic_matrix, instance_key)
print(f"Evaluated value: {value}")

# Clear the override
del engine.overrides[100]
```

### Notes

- The `LogicEngine` class appears to be designed to be flexible and extensible, supporting various types of rules and behaviors for lighting channels.
- Error handling is minimal in this example. In a production environment, you might want to add more robust error checking and logging.
- The `_preset_sweep_phases` dictionary and related logic are used to manage the phase of sequence-based values (like "0-255" or "30, 50-100"). This allows for smooth transitions between different parts of a sequence over time.

This class could be integrated into a larger system that processes audio data in real-time and updates lighting effects accordingly.

## File: backend/dmx_node.py
- Unhandled promise rejections (not applicable as there are no async/await).
- Missing try/catch around `sock.settimeout(2.0)` in the outer loop.
- Synchronous block where async should be used (consider using asyncio for UDP communication if it's a bottleneck).

## File: backend/recorder_service.py
EXACTLY THE SINGLE WORD 'CLEAN' AND ABSOLUTELY NOTHING ELSE.

## File: backend/main.py
This script is a comprehensive control system for an audio and visual experience based on real-time audio analysis. It uses websockets to communicate with a browser interface, allowing users to interact with the system through various inputs such as gamepads, Spotify, and other hardware. The script is structured to handle different components including audio processing, DMX lighting, Vibe Engine for rhythm detection, and an optional synthesizer. Below is a breakdown of the main functionalities and components:

### Key Components

1. **Websocket Server**:
   - Handles connections from a web browser.
   - Receives commands and settings from the browser.
   - Sends real-time data (like audio state, vibe states, etc.) to the browser.

2. **Audio Processing**:
   - Captures audio input using PyAudio.
   - Processes the audio in real-time to detect beats, transients, and other audio features using custom algorithms or libraries.
   - Adjusts system settings based on audio analysis (e.g., changing DMX lighting).

3. **DMX Lighting Control**:
   - Controls RGB LED strips using a DMX controller.
   - Can be configured with different lighting profiles or effects.

4. **Vibe Engine**:
   - Detects rhythm patterns in the audio stream.
   - Provides a way to map detected rhythms to visual or audio outputs.

5. **Gamepad Input**:
   - Allows user interaction through gamepad inputs.
   - Supports various gamepad functionalities (e.g., button presses, joystick movements).

6. **Spotify Integration**:
   - Optionally integrates with Spotify for music playback and rhythm detection.
   - Syncs the visual or audio experience to the rhythm of the music being played.

7. **Audio Worker Thread**:
   - Runs in a separate thread to handle continuous audio processing without blocking the main event loop.

8. **Signal Health Monitoring**:
   - Monitors the quality of the audio signal to ensure it's suitable for real-time processing.

### Setup and Initialization

- The script initializes all necessary components and loads any persisted settings (e.g., default hardware preferences, audio mode).
- It sets up the websocket server and starts listening on a specified port.
- The audio stream is initialized based on user input or defaults.

### Real-Time Data Handling

- The script continuously processes real-time audio data and updates the state accordingly.
- It sends updates to the connected web browser about various system states (e.g., current BPM, detected beats, etc.).

### Error Handling and Graceful Shutdown

- The script includes signal handling to gracefully shut down when receiving termination signals.
- It ensures that all resources are properly cleaned up before exiting.

### Example Usage

To run this script:
1. Ensure all dependencies are installed (`pip install numpy pyaudio python-websocket ssl`).
2. Place the script in a directory with `cert.pem` and `key.pem` for SSL if needed.
3. Run the script using Python: `python your_script_name.py`.
4. Connect to the websocket server from a browser or any client that supports websockets.

This setup allows for a highly interactive and dynamic experience, combining audio analysis with visual and physical feedback, making it suitable for various applications like live performances, installations, and games.

## File: scripts/calibration_server.py
- Unhandled promise rejections in `ws_worker` function.
- Missing try/catch block around `ctx.cap.read()` call in `start_camera` method.

## File: sw.js
- No issues found.

## File: standalone_engine.js
- Broken or dead references:
  - `iframeWindow` is referenced but never defined.

- Bad error handling:
  - Bare `catch:` without rethrowing the exception.
  - Potential unhandled promise rejections, though not immediately obvious from the provided code.

## File: engine_tab.js
The provided JavaScript code snippet appears to be part of a larger system for controlling and simulating various behaviors or flows in a laboratory or similar environment. It includes functionality for setting up and running simulations, capturing snippets, saving configurations, and handling audio input data. Here's a breakdown of the main components and their functionalities:

### WebSocket Communication
The code relies on WebSocket for real-time communication with the server. This is used to send commands, receive updates, and handle asynchronous interactions.

```javascript
if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
    alert("Engine not connected");
    return;
}
```

### Simulation Loop
A `requestAnimationFrame` loop is used to run simulations at a consistent frame rate. This loop updates the state of the simulation based on audio input and other factors.

```javascript
function labLoop() {
    let val = calculateRuleSimulation(dt, labState, rule, labAudioState);
    labBuffer.push(val);
    if (labBuffer.length > (30 * 5)) labBuffer.shift();
    
    if (labChart) {
        labChart.data.datasets[0].data = labBuffer;
        labChart.update('none');
    }
    requestAnimationFrame(labLoop);
}
```

### Behavior and Configuration Management
The code provides a dropdown menu for selecting different behaviors or "descriptors". When the user selects a behavior, it updates the simulation parameters accordingly.

```javascript
function syncLabProbe() {
    const id = document.getElementById('labBehaviorSelect').value;
    const premade = window.EASY_DESCRIPTORS.find(x => x.id === id);
    
    const rule = {
        easy_id: id,
        behavior: document.getElementById('labBehaviorSelectSpecific').value,
        source: document.getElementById('labSourceSelect').value,
        modifiers: {
            speed: parseFloat(document.getElementById('labSpeed').value),
            react: parseFloat(document.getElementById('labReact').value),
            hold_type: document.getElementById('labHoldSelect').value
        },
        cal: {
            min: parseInt(document.getElementById('labMin').value) || 0,
            center: parseInt(document.getElementById('labCenter').value) || 127,
            max: parseInt(document.getElementById('labMax').value) || 255
        }
    };

    window.ws.send(JSON.stringify({ type: 'set_lab_rule', rule: rule }));
}
```

### UI Updates and Feedback
The code updates the UI in response to user actions. For example, when a user captures a snippet, the UI displays feedback to indicate that the operation is in progress.

```javascript
function captureSnippet(label) {
    const feedback = document.getElementById('snippet-feedback');
    const originalText = feedback.innerText;
    const originalColor = feedback.style.color;
    
    feedback.innerText = `Capturing [${label.toUpperCase()}]... (10s)`;
    feedback.style.color = "#f9ca24";
    
    window.ws.send(JSON.stringify({
        "type": "save_snippet",
        "label": label
    }));

    setTimeout(() => {
        feedback.innerText = "Snippet Saved to recordings/";
        feedback.style.color = "#00ff88";
        setTimeout(() => {
            feedback.innerText = originalText;
            feedback.style.color = originalColor;
        }, 3000);
    }, 10500);
}
```

### Data Handling
The code handles audio input data and updates the simulation state based on this data.

```javascript
let labAudioState = { vol: 0 };
function updateLabAudioState(audioData) {
    labAudioState.vol = audioData.volume;
}
```

### Saving Configurations
Users can save their current configurations as default settings or new behaviors.

```javascript
async function addNewBehaviorFromLab() {
    const label = prompt("Enter a label for this new behavior:", "Custom Laboratory Flow");
    if (!label) return;

    // ... code to save the new behavior ...
}

async function saveLabAsDefault() {
    const id = document.getElementById('labBehaviorSelect').value;
    const premade = window.EASY_DESCRIPTORS.find(x => x.id === id);
    
    // ... code to update the existing behavior ...
}
```

### Initialization
The `initLabSelects` function initializes the dropdown menus when the script loads.

```javascript
function initLabSelects() {
    if (window.SOURCES && window.BEHAVIORS && window.EASY_DESCRIPTORS) {
        populateLabSelects();
    } else {
        setTimeout(initLabSelects, 100);
    }
}
```

### Summary
This code provides a comprehensive system for simulating and controlling laboratory flows or behaviors. It uses WebSocket for real-time communication, handles user interactions, updates the UI based on simulation results, and manages configurations for different behaviors.

## File: profile_logic.js
This script appears to be an extension for a larger web application, likely one related to lighting control or a similar visual effects system. It manages a feature called "Slider Setup," which allows users to interactively adjust DMX (Digital Multiplex) values through sliders and then capture those settings for later use in predefined presets.

Here's a breakdown of the script's functionalities:

1. **Initialization**: The script sets up several global variables such as `window.latestOverrides`, `window.sliderSetupValues`, and `currentPresetOverrides` to store current state and captured overrides, respectively.

2. **Rendering UI**:
   - `renderSliderSetup()`: This function rebuilds the Slider Setup interface based on which fixtures are currently active.
   - The UI dynamically creates sliders for each channel of selected fixtures, displaying real-time values from `window.latestDmxUniverse`.
   - It adjusts layout to stack vertically if there are 2 or fewer fixtures and scroll horizontally otherwise.

3. **User Interaction**:
   - `toggleFixtureInSliderSetup(id)`: Adds or removes a fixture from the active list based on user selection.
   - `adjustSliderSetupValue(id, chIdx, val, addr)`: Updates slider values when they are adjusted by the user and sends overrides to a WebSocket server for real-time control.

4. **WebSocket Communication**:
   - The script communicates with a WebSocket server (`window.ws`) to send overrides to laser fixtures or other devices that support DMX control.
   - It includes functions like `sendSliderSetupOverride(id, chIdx, val)` and `clearSliderSetup()` to manage these communications.

5. **Snapshot Recording**:
   - `recordSliderSetup()`: Captures the current locked values (those being overridden) from the slider setup and stores them in `currentPresetOverrides`.

6. **UI Updates**:
   - `updateSliderSetupVisuals()`: Continuously updates slider positions and labels based on the latest DMX universe data, providing a real-time interface.

7. **Keyboard Navigation**:
   - `handleSliderKeyNav(event)`: Enables keyboard navigation between sliders using arrow keys.

This script is well-structured for managing complex user interactions with dynamic content and communicates effectively with backend systems for real-time control of lighting fixtures or similar devices. It also includes basic error handling and user feedback mechanisms, such as showing toasts when capturing overrides or handling key events.

## File: stage_logic.js
The provided code snippet is a comprehensive JavaScript implementation for an interactive and dynamic interface, likely part of a larger application focused on DMX lighting control, AI model selection, and Govee LAN management. Below, I'll break down the key components and functionalities:

### Key Components

1. **Initialization and Data Loading**:
   - The `initApp` function initializes the application by fetching profiles, stage configuration, and presets from a server.
   - It handles errors gracefully and logs warnings or emergency boot messages if the initialization process fails.

2. **UI Rendering and Interactivity**:
   - The `drawCanvasLoop` function is responsible for rendering the canvas, which includes drawing the simulation tab and updating test tab numerical values.
   - UI elements such as tabs, buttons, and input fields are interactively updated based on user actions and server responses.

3. **WebSocket Communication**:
   - The application uses WebSocket to communicate with a server for real-time updates, handling operations like toggling presets and managing Govee LAN nodes.
   - Functions like `togglePreset` and `addGoveeNode` send messages to the server through WebSockets.

4. **Profile Management**:
   - Profiles are stored in memory and can be loaded from a server or saved locally. The application handles profile IDs, names, and associated files.

5. **Simulation and Test Tab**:
   - The simulation tab is rendered using the `drawSimulation` function, which updates based on delta time (`dt`) to ensure smooth animations.
   - The test tab displays numerical values for active test fixtures, updating dynamically as data changes.

6. **Govee LAN Management**:
   - The application includes functionality to add and remove Govee nodes, managing their IP addresses and DMX channel mappings.
   - It auto-patches the stage with new fixtures when a new Govee node is added.

### Code Structure

- **Variables and Constants**: Various variables like `window.RAVEBOX_READY`, `window.simulationLastTime`, and `db` (database) are used to manage application state and data.
- **Asynchronous Functions**: Asynchronous functions like `fetch` are used for fetching data from the server, ensuring non-blocking operations.
- **Event Handlers**: Event handlers like those attached to buttons for adding and removing Govee nodes handle user interactions.

### Usage

The code is designed to be run in a web browser environment. It initializes when the page loads, updates the UI based on server data, and handles real-time communication through WebSockets. The application is built to be modular and extensible, allowing for easy integration of new features or modifications.

### Potential Improvements

1. **Error Handling**: Enhance error handling across asynchronous operations to provide better feedback and recovery mechanisms.
2. **Performance Optimization**: Optimize performance by reducing the number of re-renders and minimizing DOM manipulations.
3. **Modularity**: Further modularize the code for better maintainability and scalability.
4. **Security**: Implement security measures such as input validation and authentication for WebSocket messages.

This comprehensive codebase provides a robust foundation for an interactive DMX control application, with features ranging from profile management to real-time device management via WebSockets.

## File: ai_architect.js
This code snippet appears to be part of a web application that includes a feature for generating and managing presets for lighting systems. The main functionalities include:

1. **Preset Generation via AI**:
   - Users can input prompts or select predefined suggestions (like "Blackout", "Drop Punch", etc.) to generate presets.
   - The generated presets are then displayed in an editor where users can review, modify, and apply them.

2. **Preset Management**:
   - Users can save presets to a library for future use.
   - Presets can be loaded back into the editor for editing or immediate application.

3. **Transient State Handling**:
   - The system allows for handling different transient states (e.g., "dropping", "tension") and adjusting lighting conditions accordingly.

4. **User Interface**:
   - Various UI elements like modals, textareas, buttons, and chat history are managed to interact with the user.
   - Users can toggle between different modes of operation, such as fixture picker, zone picker, and AI XY mode.

5. **Settings Management**:
   - The system includes settings to configure various aspects of the application's behavior and appearance.

### Key Components and Functions:

- **Preset Generation**:
  - `sendPresetAiPrompt()`: Sends a user-generated prompt or predefined suggestion to an AI model for processing.
  - `_buildStageContext()`: Builds a context object containing information about the current stage setup, which is used in preset generation.

- **Preset Management**:
  - `saveStagedPresetToDb(idx)`: Saves a staged preset directly to the database.
  - `saveAllStagedPresets()`: Saves all staged presets to the database.
  - `loadStagedPreset(idx)`: Loads a staged preset into the editor.

- **Transient State Handling**:
  - The system uses transient states (e.g., "dropping", "tension") to adjust lighting conditions dynamically based on the current situation.

- **User Interface Management**:
  - Various functions like `toggleFixturePicker()`, `toggleZonePicker()`, and `toggleAiXyMode()` manage different UI modes.
  - The chat history is displayed using a modal, and users can interact with it through buttons to review or apply presets.

### Global Exports:

- The code exports various functions to be accessible globally via the `window` object. This allows other parts of the application or external scripts to interact with these functionalities.

This system appears to be designed for professionals in lighting design and control, providing a sophisticated tool for managing dynamic lighting scenarios based on user input and AI-generated suggestions.

## File: live_controller.js
This JavaScript code snippet appears to be part of a larger application that manages and displays various pieces of information, particularly related to live audio mixing and control interfaces. It includes several functions for updating UI elements based on current state data, handling button states, and drawing graphs.

Here's a breakdown of the key components:

1. **Graph Drawing (`drawLine` function)**:
   - This function is responsible for rendering various audio parameters (flux, high, mid, bass) on a canvas or SVG element.
   - It uses the `window.latestAudioState` data to determine the current values and updates the graphical representation accordingly.

2. **Live Console Visual Updates (`updateLiveConsoleVisuals` function)**:
   - This function iterates over a configuration array called `liveConfig`, which defines what each button in the live console should represent (e.g., sliders, faders, presets).
   - For each button, it resolves the DMX address based on the configuration and updates the visual state of the button (fill bars, labels) based on the current value from `window.latestDmxUniverse`.

3. **Button Highlighting (`updateLiveConsoleHighlights` function)**:
   - This function updates the state of buttons in a live console to reflect whether they are currently active.
   - It checks against lists of manually active presets and blackout statuses and applies visual indicators (e.g., adding 'active' class) based on these states.

4. **Timeline Graph (`drawPerformanceRow` function)**:
   - This function draws a performance graph at the top of the UI, showing various audio parameters over time.
   - It uses the `audioTimelineBuffer`, which is presumably populated with data from an audio engine or similar system.

5. **Utility Functions**:
   - The code also includes several utility functions such as `updateLiveConsoleHighlights` and `updateLiveConsoleVisuals`, which are called at high frequencies to ensure the UI remains responsive and up-to-date.

Overall, this code is designed to synchronize the visual state of a user interface with underlying audio and control data, providing real-time feedback and interaction in a live performance or studio environment.

## File: shared_setup.js
```json
{
  "response": "The provided code is a comprehensive JavaScript file for managing user interface interactions and handling data within a web application. It includes functions for switching between different tabs, editing settings, saving node IP addresses, updating hardware types, repairing preset data structures, and handling click events to trigger tab switches.\n\nKey features include:\n- Dynamic tab navigation with `window.switchTab`\n- Node IP management and active state toggling\n- Hardware type selection and updates\n- Preset repair functionality\n- Event delegation for handling UI interactions\n\nThe code also includes utility functions like `loadNodeIp`, `updateNodeUiState`, `saveNodeIp`, and `repairPresets` to manage specific aspects of the application's state and data.\n\nOverall, this script ensures a smooth user experience by providing interactive elements and maintaining consistent data across different parts of the web application." 
}
```

