import React, { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { Camera, RefreshCw, X, Trash, Cloud, Layers, Sparkles, Settings, Key, Cpu, Save, Edit, Download, Home } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT = `You are a legendary VJ and graphics programmer building audio-reactive WebGL fragment shaders.
CRITICAL REQUIREMENTS:
1. Performance is paramount. NEVER use heavy 3D raymarching or extensive loops. You MUST aim for 60fps on a Pi 5 GPU.
2. Output ONLY the raw GLSL code wrapped in \`\`\`glsl ... \`\`\`. Very important!

Available uniforms:
uniform float u_time;
uniform float u_clock; // audio-modulated integrated time for continuous smooth rotation
uniform float u_bass; // 0.0 to 1.5, synchronized to bass impact
uniform float u_flux; // 0.0 to 1.5, synchronized to overall energy flux
uniform float u_high; // 0.0 to 1.5, synchronized to high-frequency / hi-hat energy
uniform float u_vol;  // 0.0 to 1.5, tied to overall volume
uniform float u_beat_phase; // 0.0 to 1.0, sawtooth ramp synchronized to the beat
uniform float u_beat_pulse; // 1.0 to 0.0, exponential decay pulse on every beat
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform sampler2D u_image2;
uniform float u_strobe;   // 0.0 or 1.0, flips at ~10Hz when strobe command active
uniform float u_blackout; // 1.0 when blackout command active

Must contain:
precision highp float;
varying vec2 vUv;
void main() { ... gl_FragColor = vec4(color, 1.0); }`;

const DEFAULT_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_clock;
uniform float u_bass;
uniform float u_high;
uniform float u_beat_pulse;
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform float u_hue;
uniform float u_invert;

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    float radius = length(uv);
    float angle = atan(uv.y, uv.x);
    
    // Beat pulse expands segments
    float segments = 4.0 + floor((u_bass + u_beat_pulse * 0.2) * 4.0) * 2.0;
    angle = mod(angle, 6.28318 / segments);
    angle = abs(angle - (3.14159 / segments));
    
    vec2 polarUv = vec2(cos(angle), sin(angle)) * radius;
    polarUv *= 0.8 - (u_bass * 0.2) - (u_high * 0.15); 
    polarUv += u_clock * 0.2; 
    
    vec3 color = texture2D(u_image, fract(polarUv)).rgb;
    // Beat pulse adds brightness spikes
    color += u_beat_pulse * 0.1;
    color = clamp((color - 0.1) / 0.9, 0.0, 1.0);
    gl_FragColor = vec4(color, 1.0);
}`;

const KALEIDO_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_bass;
uniform float u_high;
uniform float u_dual;
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform sampler2D u_image2;

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    float radius = length(uv);
    float angle = atan(uv.y, uv.x);
    
    float segments = 4.0 + floor(u_bass * 4.0) * 2.0;
    float segmentAngle = 6.28318 / segments;
    
    angle = mod(angle, segmentAngle);
    angle = abs(angle - (segmentAngle / 2.0));
    
    vec2 polarUv = vec2(cos(angle), sin(angle)) * radius;
    polarUv *= 0.8 - (u_bass * 0.2); 
    polarUv += u_clock * 0.2; 
    
    vec3 tex1 = texture2D(u_image, fract(polarUv)).rgb;
    vec3 tex2 = texture2D(u_image2, fract(polarUv)).rgb;
    
    // Luma-Punch: Reveal tex2 through the highlights of tex1
    float luma = dot(tex1, vec3(0.299, 0.587, 0.114));
    float threshold = 0.5 - (u_bass * 0.25);
    float mask = smoothstep(threshold - 0.1, threshold + 0.1, luma);
    
    vec3 color = mix(tex1, tex2, mask * u_dual);
    
    color = clamp((color - 0.1) / 0.9, 0.0, 1.0);
    gl_FragColor = vec4(color, 1.0);
}`;

const RGB_GLITCH_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_flux;
uniform float u_high;
uniform float u_bass;
uniform float u_beat_pulse;
uniform vec2 u_resolution;
uniform sampler2D u_image;

float rand(float n){return fract(sin(n) * 43758.5453123);}

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    // Slices jitter aggressively on the beat pulse
    float sliceLine = floor(uv.y * (30.0 + u_bass * 20.0) + u_clock * 8.0);
    
    if (rand(sliceLine) < (u_flux * 0.5 + u_beat_pulse * 0.3)) {
        uv.x += (u_flux * 0.2 + u_beat_pulse * 0.1) * sin(u_clock * 20.0 + sliceLine);
    }
    
    float split = (u_high * 0.08 + u_beat_pulse * 0.05) * rand(sliceLine + 1.0);
    
    float r = texture2D(u_image, fract(vec2(uv.x + split, uv.y) + 0.5)).r;
    float g = texture2D(u_image, fract(uv + 0.5)).g;
    float b = texture2D(u_image, fract(vec2(uv.x - split, uv.y) + 0.5)).b;
    
    vec3 color = vec3(r, g, b);
    // Double pulse on the beat
    color += (u_bass * 0.15) + (u_beat_pulse * 0.2);
    
    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}
`;

const FLUX_MELT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_bass;
uniform float u_flux;
uniform vec2 u_resolution;
uniform sampler2D u_image;

float random (in vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
float noise (in vec2 st) {
    vec2 i = floor(st); vec2 f = fract(st);
    float a = random(i); float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0)); float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(in vec2 st) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(st); st *= 2.0; a *= 0.5; }
    return v;
}

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    // Base scroll
    vec2 scrollUv = uv + vec2(u_clock * 0.1, u_clock * 0.05);
    
    // u_flux drives the intensity of the liquid distortion
    float meltPower = 0.05 + (u_flux * 0.3);
    
    vec2 q = vec2(fbm(scrollUv), fbm(scrollUv + 1.0));
    vec2 r = vec2(fbm(scrollUv + q + vec2(1.7,9.2) + 0.15*u_clock), 
                  fbm(scrollUv + q + vec2(8.3,2.8) + 0.126*u_clock));
                  
    // Add sharp ripple on bass impact
    r += sin(length(uv) * 20.0 - u_clock * 10.0) * (u_bass * 0.05);
    
    vec3 color = texture2D(u_image, fract(uv + r * meltPower + 0.5)).rgb;
    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}`;

const DEEP_TUNNEL_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_flux;
uniform float u_bass;
uniform float u_high;
uniform float u_beat_pulse;
uniform vec2 u_resolution;
uniform sampler2D u_image;

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    float radius = length(uv); 
    float angle = atan(uv.y, uv.x);
    
    angle += (u_flux * 1.5 + u_beat_pulse * 0.5) * radius;
    
    vec2 tunnelUv;
    tunnelUv.x = (angle / 3.14159);
    tunnelUv.y = (0.2 / (radius + 0.05)) + u_clock * 0.5 + u_bass * 0.2 + u_beat_pulse * 0.1;
    
    tunnelUv.x += (u_high * 0.05 + u_beat_pulse * 0.03) * sin(tunnelUv.y * 50.0);
    
    vec3 color = texture2D(u_image, fract(tunnelUv)).rgb;
    // Tunnel walls flash with intensity on beat
    color *= (smoothstep(0.01, 0.4, radius) + u_beat_pulse * 0.3);
    
    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}
`;

const FRACTAL_CRYSTAL_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_bass;
uniform float u_flux;
uniform float u_high;
uniform vec2 u_resolution;
uniform sampler2D u_image;

mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    vec2 z = uv;
    float scale = 1.0;
    
    // KIFS Space Folding: Fold the space over itself 4 times
    for(int i = 0; i < 4; i++) {
        // u_bass opens and closes the geometric folds
        z = abs(z) - (0.3 + u_bass * 0.15); 
        
        // Twist each fold slightly differently
        z *= rot(u_clock * 0.3 + float(i) * 0.5); 
        
        // Scale up the space
        z *= 1.4; 
        scale *= 1.4;
    }
    
    // Map the folded coordinates back to the texture space
    vec2 sampleUv = (z / scale) + 0.5;
    
    // u_high adds chromatic aberration to the sharp edges
    float split = u_high * 0.05;
    float r = texture2D(u_image, fract(sampleUv + split)).r;
    float g = texture2D(u_image, fract(sampleUv)).g;
    float b = texture2D(u_image, fract(sampleUv - split)).b;
    
    vec3 color = vec3(r, g, b);
    
    // Draw neon lines exactly where the math folds the space
    float edge = exp(-15.0 * abs(z.x * z.y));
    color += vec3(edge) * (0.5 + u_flux);
    
    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}`;

const HEX_MIRROR_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_time;
uniform float u_bass;
uniform float u_flux;
uniform float u_high;
uniform float u_dual;
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform sampler2D u_image2;

vec4 hexCoords(vec2 uv) {
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = uv - gv;
    return vec4(gv.x, gv.y, id.x, id.y);
}

float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    float gridScale = 8.0 - (u_bass * 3.0);
    vec4 hex = hexCoords(uv * gridScale);
    
    vec2 localUv = hex.xy;
    vec2 cellId = hex.zw;
    float cellRand = rand(cellId);
    
    localUv *= rot(cellRand * 6.28 + u_clock + (u_flux * 2.0));
    localUv *= 1.0 - (u_high * 0.5 * cellRand);
    
    vec2 sampleUv = (localUv / gridScale) + 0.5;
    sampleUv += u_clock * 0.1; 
    
    vec3 tex1 = texture2D(u_image, fract(sampleUv)).rgb;
    vec3 tex2 = texture2D(u_image2, fract(sampleUv)).rgb;
    
    // Luma-Punch with Random ID modulation
    float luma = dot(tex1, vec3(0.299, 0.587, 0.114));
    float threshold = 0.5 - (u_bass * 0.2) - (cellRand * 0.1);
    float mask = smoothstep(threshold - 0.1, threshold + 0.1, luma);
    
    vec3 color = mix(tex1, tex2, mask * u_dual);
    
    float hexEdge = max(abs(hex.x), abs(hex.x * 0.5 + hex.y * 0.866025));
    float border = smoothstep(0.4, 0.45, hexEdge);
    float flash = step(0.9, fract(cellRand + u_time * 5.0)) * u_high;
    color = mix(color + flash, vec3(0.0), border);
    
    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}`;

const CONCENTRIC_RINGS_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_bass;
uniform float u_flux;
uniform float u_high;
uniform float u_dual;
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform sampler2D u_image2;

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    float radius = length(uv);
    float angle = atan(uv.y, uv.x);

    float ringCount = 6.0 + floor(u_bass * 3.0) * 2.0;
    float scaledRadius = radius * ringCount;
    float ringId = floor(scaledRadius);
    
    float dir = mod(ringId, 2.0) == 0.0 ? 1.0 : -1.0;
    angle += dir * (u_clock * 0.3 + u_flux * 0.8) * (1.0 + ringId * 0.05);
    
    vec2 polarUv = vec2(cos(angle), sin(angle)) * radius;
    vec2 sampleUv = polarUv + 0.5;
    
    vec3 tex1 = texture2D(u_image, fract(sampleUv)).rgb;
    vec3 tex2 = texture2D(u_image2, fract(sampleUv)).rgb;
    
    // Luma-Punch: Ring Id alternates between bright-punch and dark-punch
    float luma = dot(tex1, vec3(0.299, 0.587, 0.114));
    float isInverse = mod(ringId, 2.0);
    float threshold = mix(0.5 - (u_bass * 0.3), 0.5 + (u_bass * 0.3), isInverse);
    float mask = smoothstep(threshold - 0.1, threshold + 0.1, luma);
    if (isInverse > 0.5) mask = 1.0 - mask;
    
    vec3 color = mix(tex1, tex2, mask * u_dual);
    
    float ringFract = fract(scaledRadius);
    float borderMask = smoothstep(0.0, 0.03, ringFract) * smoothstep(1.0, 0.97, ringFract);
    vec3 gapColor = vec3(u_high * 0.8);
    color = mix(gapColor, color, borderMask);
    
    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}`;

const CHECKERBOARD_DEPTH_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_clock;
uniform float u_bass;
uniform float u_flux;
uniform float u_high;
uniform vec2 u_resolution;
uniform sampler2D u_image;

mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    
    // Slowly rotate the entire grid structure
    uv *= rot(u_clock * 0.05);

    // Dynamic grid size based on energy
    float gridSize = 6.0 + floor(u_flux * 2.0) * 2.0; 
    vec2 gridUv = uv * gridSize;
    
    // Get cell ID and local coordinates within the cell
    vec2 id = floor(gridUv);
    vec2 localUv = fract(gridUv) - 0.5;

    // Checkerboard math (returns 0.0 or 1.0)
    float check = mod(id.x + id.y, 2.0);

    // u_bass drives how far the alternate tiles sink into the screen
    float depth = check * (u_bass * 1.5 + (u_high * 0.5)); 

    // Scale local UVs to create the faux-3D push away effect
    localUv *= 1.0 + depth;

    // Map back to global UV space
    vec2 sampleUv = (id + localUv + 0.5) / gridSize;
    
    // Pan the image smoothly underneath the grid structure
    sampleUv += u_clock * 0.15;

    vec3 color = texture2D(u_image, fract(sampleUv)).rgb;

    // Add faux 3D shadows so sunken tiles actually look darker
    color *= 1.0 - (check * min(depth * 0.4, 0.8));

    // Draw sharp black grid lines to frame the windows
    vec2 box = abs(localUv) / (1.0 + depth);
    float edge = max(box.x, box.y);
    float border = smoothstep(0.46, 0.5, edge);
    color = mix(color, vec3(0.0), border);

    gl_FragColor = vec4(clamp((color - 0.1) / 0.9, 0.0, 1.0), 1.0);
}`;

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PRESET_WARPS = [
    { name: 'KALEID', code: KALEIDO_SHADER },
    { name: 'GLITCH', code: RGB_GLITCH_SHADER },
    { name: 'MELT', code: FLUX_MELT_SHADER },
    { name: 'TUNNEL', code: DEEP_TUNNEL_SHADER },
    { name: 'CRYSTAL', code: FRACTAL_CRYSTAL_SHADER },
    { name: 'HEX', code: HEX_MIRROR_SHADER },
    { name: 'CHECKER', code: CHECKERBOARD_DEPTH_SHADER },
    { name: 'RINGS', code: CONCENTRIC_RINGS_SHADER }
];

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState("Connecting...");
    const [statusColor, setStatusColor] = useState("text-amber-400");
    const [showToolbar, setShowToolbar] = useState(false);
    const [autoCycle, setAutoCycle] = useState(true);
    const autoCycleRef = useRef(true);
    const [hasUploadedImage, setHasUploadedImage] = useState(false);
    const [fps, setFps] = useState(60);

    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const libraryRef = useRef<any[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [filterTab, setFilterTab] = useState<'tex' | 'base' | 'fx'>('tex');

    // UI Toggles
    const [showAiInput, setShowAiInput] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [geminiKey, setGeminiKey] = useState(localStorage.getItem('vj_gemini_key') || '');
    const [aiModel, setAiModel] = useState(localStorage.getItem('vj_ai_model') || 'gemini-2.5-flash');

    const [geminiPrompt, setGeminiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [unsavedShader, setUnsavedShader] = useState<{ code: string, prompt: string, category: string } | null>(null);
    const [undoHistory, setUndoHistory] = useState<{ base: string | null, fx: string | null }>({ base: null, fx: null });
    const [activeShaderId, setActiveShaderId] = useState<string | null>(null);
    const [activeWarpIndex, setActiveWarpIndex] = useState<number | null>(null);
    const [currentSpotifyArt, setCurrentSpotifyArt] = useState<string | null>(null);

    // Audio Sync Vibe
    const vibeRef = useRef('mid');
    const spotifyTextureRef = useRef<THREE.Texture | null>(null);
    const lastSpotifyUrlRef = useRef<string | null>(null);

    const { wsUrl, apiBase } = useMemo(() => {
        const savedHost = localStorage.getItem('vj_backend_host') || window.location.hostname;
        const isLocal = savedHost === "localhost" || savedHost === "127.0.0.1";
        
        // Finalize the Box Name (e.g. 'ravebox.love' or '1234.ravebox.love')
        const boxName = (savedHost === 'ravebox') ? 'ravebox.love' : ((savedHost && !savedHost.includes('.') && !isLocal) ? `${savedHost}.ravebox.love` : savedHost);
        
        // Detect if we are on a consolidated custom tunnel (e.g. 419.ravebox.love)
        // Rule: If it starts with a number or contains '-evt', it's Flow B.
        const isConsolidated = /^\d+\./.test(boxName) || boxName.includes('-evt');
        
        const useSSL = window.location.protocol === "https:" || boxName.includes('ravebox.love');
        
        if (isConsolidated) {
            // Flow B: Consolidated Path-Based Routing (Trial Run / EVT)
            return {
                wsUrl: `${useSSL ? "wss:" : "ws:"}//${boxName}/ws`,
                apiBase: `${useSSL ? "https:" : "http:"}//${boxName}`
            };
        } else if (boxName === 'ravebox.love') {
            // Primary domain legacy logic
            return {
                wsUrl: "wss://wss.ravebox.love/",
                apiBase: "https://ravebox.love"
            };
        } else {
            // Flow A: Standard Dev Case (Corrected for setup.md)
            // User is on {BOX}.ravebox.love (Port 8000)
            // Data API is on same host (Port 8000 - Server)
            // WebSocket is on ws-{BOX}.ravebox.love (Port 8765 - Engine)
            const baseHost = boxName.replace(/^api-|^ws-/, '');
            return {
                wsUrl: `${useSSL ? "wss:" : "ws:"}//ws-${baseHost}`,
                apiBase: `${useSSL ? "https:" : "http:"}//${baseHost}`
            };
        }
    }, [window.location.hostname, window.location.protocol]);

    const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const fetchLibraries = async () => {
        try {
            const [imgRes, aiRes, aiResOld] = await Promise.all([
                fetch(`${apiBase}/api/images/list`),
                fetch(`${apiBase}/api/usergen2/list`),
                fetch(`${apiBase}/api/usergen/list`)
            ]);

            const imgs = imgRes.ok ? await imgRes.json() : [];
            const ais = aiRes.ok ? await aiRes.json() : [];
            const aisOld = aiResOld.ok ? await aiResOld.json() : [];

            const combined = [
                ...imgs.map((i: any) => ({ ...i, category: 'tex' })),
                ...ais.map((a: any) => ({ ...a, category: a.type || 'base', path: 'library2' })),
                ...aisOld.map((a: any) => ({ ...a, category: a.type || 'base', path: 'library' }))
            ];

            combined.sort((a, b) => b.mtime - a.mtime);
            setLibraryItems(combined);
            libraryRef.current = combined;
        } catch (err) { console.error("Library load failed:", err); }
    };

    useEffect(() => { fetchLibraries(); }, []);

    const saveImageToServer = async (base64Data: string) => {
        try {
            const resp = await fetch(`${apiBase}/api/images/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data })
            });
            if (resp.ok) fetchLibraries();
        } catch (err) { }
    };

    const handleSaveUnsavedShader = async () => {
        if (!unsavedShader) return;
        try {
            setStatus("💾 Saving Shader...");
            await fetch(`${apiBase}/api/usergen2/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: unsavedShader.code, prompt: unsavedShader.prompt, layer_type: unsavedShader.category })
            });
            setUnsavedShader(null);
            setStatus("✅ Shader Saved");
            setStatusColor("text-emerald-400");
            fetchLibraries();
        } catch (e) {
            setStatus("❌ Save Failed");
            setStatusColor("text-rose-400");
        }
    };

    const renameLibraryItem = async (item: any) => {
        if (item.category === 'tex') return;
        const newPrompt = window.prompt("Rename shader:", item.prompt);
        if (!newPrompt || newPrompt === item.prompt) return;

        try {
            const endpoint = item.path === 'library' ? '/api/usergen/rename' : '/api/usergen2/rename';
            const res = await fetch(`${apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: item.file, new_prompt: newPrompt })
            });
            if (res.ok) fetchLibraries();
        } catch (err) { }
    };

    const handleTouchStart = (item: any) => {
        touchTimeoutRef.current = setTimeout(() => {
            renameLibraryItem(item);
        }, 800);
    };

    const handleTouchEnd = () => {
        if (touchTimeoutRef.current) {
            clearTimeout(touchTimeoutRef.current);
            touchTimeoutRef.current = null;
        }
    };

    const deleteLibraryItem = async (item: any) => {
        if (!confirm(`Permanently delete this ${item.category}?`)) return;
        try {
            let res;
            if (item.category === 'tex') {
                res = await fetch(`${apiBase}/api/images/delete?file=${item.name}`, { method: 'DELETE' });
            } else if (item.path === 'library') {
                res = await fetch(`${apiBase}/api/usergen/delete?file=${item.file}`, { method: 'DELETE' });
            } else {
                res = await fetch(`${apiBase}/api/usergen2/delete?file=${item.file}`, { method: 'DELETE' });
            }
            if (res && res.ok) fetchLibraries();
        } catch (err) { }
    };

    const applyNewTexture = (texture: THREE.Texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        if (uniformsRef.current.u_image.value && uniformsRef.current.u_image.value.image) {
            uniformsRef.current.u_image2.value = uniformsRef.current.u_image.value;
        }
        uniformsRef.current.u_image.value = texture;
        setHasUploadedImage(true);
    };

    const loadFromLibrary = (item: any, styleIndex?: number) => {
        if (item.category === 'spotify') {
            if (spotifyTextureRef.current) {
                applyNewTexture(spotifyTextureRef.current);
                setActiveShaderId('spotify-art');

                const warpIdx = (styleIndex !== undefined)
                    ? (styleIndex % PRESET_WARPS.length)
                    : (activeWarpIndex !== null ? activeWarpIndex : Math.floor(Math.random() * PRESET_WARPS.length));

                if (styleIndex !== undefined || activeWarpIndex === null) {
                    setActiveWarpIndex(warpIdx);
                }

                applyNewShader(PRESET_WARPS[warpIdx].code, 'tex');
                setStatus("🎵 Spotify Art Live");
                setStatusColor("text-emerald-400");
            }
            return;
        }

        setActiveShaderId(item.file);
        setStatus(`📂 Loading Image...`);
        new THREE.TextureLoader().load(`${apiBase}/${item.file}`, (texture) => {
            applyNewTexture(texture);

            const warpIdx = (styleIndex !== undefined)
                ? (styleIndex % PRESET_WARPS.length)
                : (activeWarpIndex !== null ? activeWarpIndex : Math.floor(Math.random() * PRESET_WARPS.length));

            if (activeWarpIndex === null || styleIndex !== undefined) {
                setActiveWarpIndex(warpIdx);
            }

            applyNewShader(PRESET_WARPS[warpIdx].code, 'tex');
            setStatus("📸 Texture Live!");
            setStatusColor("text-emerald-400");
        });
    };

    const loadAiShader = async (item: any) => {
        try {
            setActiveShaderId(item.file);
            setStatus(`✨ Compiling AI Shader...`);
            const libPath = item.path || 'library2';
            const res = await fetch(`${apiBase}/${libPath}/${item.file}`);
            if (res.ok) {
                const code = await res.text();
                if (item.category === 'base') setActiveWarpIndex(null);
                applyNewShader(code, item.category);
            }
        } catch (e) {
            setStatus("❌ Failed to load AI Shader");
            setStatusColor("text-rose-400");
        }
    };

    // Auto-inject any uniform declarations that the shader uses but forgot to declare.
    // This is a safety net for AI-generated shaders.
    const ensureUniforms = (code: string): string => {
        const defs: Record<string, string> = {
            u_time: 'uniform float u_time;',
            u_clock: 'uniform float u_clock;',
            u_bass: 'uniform float u_bass;',
            u_flux: 'uniform float u_flux;',
            u_high: 'uniform float u_high;',
            u_vol: 'uniform float u_vol;',
            u_beat_phase: 'uniform float u_beat_phase;',
            u_resolution: 'uniform vec2 u_resolution;',
            u_image: 'uniform sampler2D u_image;',
            u_image2: 'uniform sampler2D u_image2;',
            u_strobe: 'uniform float u_strobe;',
            u_blackout: 'uniform float u_blackout;',
            u_spin: 'uniform float u_spin;',
            u_spin_angle: 'uniform float u_spin_angle;',
            u_zoom: 'uniform float u_zoom;',
            u_hue: 'uniform float u_hue;',
            u_invert: 'uniform float u_invert;',
            vUv: 'varying vec2 vUv;',
        };
        const toInject = Object.entries(defs)
            .filter(([name, decl]) => {
                const usedInCode = new RegExp(`\\b${name}\\b`).test(code);
                const alreadyDeclared = new RegExp(`(uniform|varying)\\s+\\S+\\s+${name}\\s*[;,]`).test(code);
                // ALWAYS include hue/invert if they aren't declared, as we auto-inject logic that uses them
                const isGlobalFX = (name === 'u_hue' || name === 'u_invert');
                return (usedInCode || isGlobalFX) && !alreadyDeclared;
            })
            .map(([, decl]) => decl);
        if (toInject.length === 0) return code;
        const preamble = toInject.join('\n');
        let finalCode = code;
        const precisionMatch = finalCode.match(/precision\s+\w+\s+\w+\s*;/);
        if (precisionMatch) {
            const endIdx = finalCode.indexOf(precisionMatch[0]) + precisionMatch[0].length;
            finalCode = finalCode.slice(0, endIdx) + '\n' + preamble + '\n' + finalCode.slice(endIdx);
        } else {
            finalCode = preamble + '\n' + finalCode;
        }

        // GLOBAL FX INJECTION: Append to the end of main()
        const lastBrace = finalCode.lastIndexOf('}');
        if (lastBrace > 0 && finalCode.includes('gl_FragColor')) {
            const fxLogic = `
    // Global FX Phase 1
    if (u_invert > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, 1.0 - gl_FragColor.rgb, u_invert);
    if (u_hue > 0.0) {
        vec3 c_fx = gl_FragColor.rgb;
        const vec3 k_fx = vec3(0.57735);
        float cosA_fx = cos(u_hue * 6.28318);
        gl_FragColor.rgb = c_fx * cosA_fx + cross(k_fx, c_fx) * sin(u_hue * 6.28318) + k_fx * dot(k_fx, c_fx) * (1.0 - cosA_fx);
    }
`;
            finalCode = finalCode.slice(0, lastBrace) + fxLogic + '\n}';
        }
        return finalCode;
    };

    const applyNewShader = (code: string, category: string = 'base') => {
        try {
            const safeCode = ensureUniforms(code);
            const newMat = new THREE.ShaderMaterial({
                vertexShader: VERTEX_SHADER,
                fragmentShader: safeCode,
                uniforms: uniformsRef.current,
                transparent: category === 'fx',
                blending: category === 'fx' ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: false,
            });

            if (category === 'fx') {
                if (fxMeshRef.current) {
                    fxMeshRef.current.material.dispose();
                    fxMeshRef.current.material = newMat;
                    fxMeshRef.current.visible = true;
                }
            } else {
                if (baseMeshRef.current) {
                    baseMeshRef.current.material.dispose();
                    baseMeshRef.current.material = newMat;
                }
                // Separating warped images from overlays
                if (category === 'tex' && fxMeshRef.current) {
                    fxMeshRef.current.visible = false;
                }
            }
            setStatus(`✅ ${category.toUpperCase()} Live`);
            setStatusColor("text-indigo-400");
        } catch (err: any) {
            setStatus(`❌ Shader error`);
            setStatusColor("text-rose-400");
            console.error('Shader compile error:', err);
        }
    };

    const handleGenerateAi = async (action: 'new' | 'refine') => {
        if (!geminiPrompt) return;

        let targetCategory = filterTab;
        let prmpt = geminiPrompt.trim();

        // Handle Undo Command
        if (action === 'refine' && (prmpt.toLowerCase() === 'undo' || prmpt.toLowerCase() === 'revert')) {
            const previousCode = targetCategory === 'base' ? undoHistory.base : undoHistory.fx;
            if (previousCode) {
                applyNewShader(previousCode, targetCategory);
                setGeminiPrompt('');
                setStatus("⏪ Edit Reverted");
                setStatusColor("text-indigo-400");
                return;
            } else {
                setStatus("⚠️ Nothing to undo");
                setStatusColor("text-rose-400");
                return;
            }
        }

        const apiKey = geminiKey || localStorage.getItem('vj_gemini_key');
        if (!apiKey) {
            setShowSettings(true);
            setStatus("⚠️ Enter API Key in Settings");
            return;
        }

        setIsGenerating(true);
        setStatus("🧠 AI Thinking...");
        setStatusColor("text-fuchsia-400");

        try {
            // Grab Current Code for Refine and Undo
            let currentCode = '';
            if (targetCategory === 'base' && baseMeshRef.current) {
                currentCode = (baseMeshRef.current.material as THREE.ShaderMaterial).fragmentShader;
            } else if (targetCategory === 'fx' && fxMeshRef.current) {
                currentCode = (fxMeshRef.current.material as THREE.ShaderMaterial).fragmentShader;
            }

            // Save Undo state
            setUndoHistory(prev => ({ ...prev, [targetCategory]: currentCode }));

            let userMessage: string;
            if (action === 'refine' && currentCode) {
                userMessage = `USER COMMAND: Refine the following shader.\n\n### EXISTING CODE ###\n${currentCode}\n\n### USER FEEDBACK ###\n${prmpt}`;
            } else {
                userMessage = `USER PROMPT: ${prmpt}`;
            }

            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: aiModel,
                contents: userMessage,
                config: { systemInstruction: SYSTEM_PROMPT }
            });
            const text = response.text || "";
            let code = text;
            if (text.includes("```glsl")) code = text.split("```glsl")[1].split("```")[0].trim();
            else if (text.includes("```")) code = text.split("```")[1].split("```")[0].trim();

            applyNewShader(code);

            setUnsavedShader({
                code,
                prompt: prmpt,
                category: targetCategory
            });

            setGeminiPrompt('');
            setShowAiInput(false);
        } catch (e: any) {
            const msg = e?.message || String(e);
            console.error('AI generation error:', e);
            setStatus(`❌ ${msg.slice(0, 40)}`);
            setStatusColor("text-rose-400");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async () => {
                const dataUrl = reader.result as string;
                new THREE.TextureLoader().load(dataUrl, (texture) => {
                    applyNewTexture(texture);
                    const warpIdx = activeWarpIndex !== null ? activeWarpIndex : Math.floor(Math.random() * PRESET_WARPS.length);
                    if (activeWarpIndex === null) setActiveWarpIndex(warpIdx);
                    applyNewShader(PRESET_WARPS[warpIdx].code, 'tex');
                    setStatus("📸 Texture loaded!");
                    setStatusColor("text-emerald-400");
                });
                saveImageToServer(dataUrl);
            };
            reader.readAsDataURL(file);
        }
    };

    useEffect(() => { autoCycleRef.current = autoCycle; }, [autoCycle]);

    const uniformsRef = useRef({
        u_time: { value: 0 },
        u_clock: { value: 0 },
        u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        u_bass: { value: 0 },
        u_flux: { value: 0 },
        u_high: { value: 0 },
        u_vol: { value: 0 },
        u_beat_phase: { value: 0 },
        u_beat_pulse: { value: 0 },
        u_dual: { value: 0.0 }, // Toggle for 2nd image masking (0.0 or 1.0)
        u_image: { value: new THREE.Texture() },
        u_image2: { value: new THREE.Texture() },
        u_strobe: { value: 0 },
        u_blackout: { value: 0 },
        u_spin: { value: 0 },
        u_spin_angle: { value: 0 },
        u_zoom: { value: 0 },
        u_hue: { value: 0 },
        u_invert: { value: 0 }
    });
    const baseMeshRef = useRef<THREE.Mesh | null>(null);
    const fxMeshRef = useRef<THREE.Mesh | null>(null);
    const strobeActiveRef = useRef(false);
    const blackoutActiveRef = useRef(false);
    const spinActiveRef = useRef(false);
    const spinAngleRef = useRef(0);
    const zoomTargetRef = useRef(1.0);
    const hueTargetRef = useRef(0.0);
    const invertActiveRef = useRef(false);
    const currentScaleRef = useRef(1);
    const currentHueRef = useRef(0.0);
    const currentInvertRef = useRef(0.0);
    const effSpeedRef = useRef(0.6);
    const effIntensityRef = useRef(1.0);
    const mTimeRef = useRef(0.0);
    const beatPhaseRef = useRef(0.0);
    const localFlutterRef = useRef(0.0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: false });
        renderer.setSize(window.innerWidth, window.innerHeight);

        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 256, 256);
            ctx.fillStyle = '#ffffff'; ctx.font = '24px Arial'; ctx.fillText('NO IMAGE', 70, 136);
        }
        const defaultTex = new THREE.CanvasTexture(canvas);
        defaultTex.wrapS = THREE.RepeatWrapping; defaultTex.wrapT = THREE.RepeatWrapping;
        uniformsRef.current.u_image.value = defaultTex;
        uniformsRef.current.u_image2.value = defaultTex;

        const baseMat = new THREE.ShaderMaterial({ vertexShader: VERTEX_SHADER, fragmentShader: DEFAULT_FRAGMENT_SHADER, uniforms: uniformsRef.current });
        const baseMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), baseMat);
        scene.add(baseMesh); baseMeshRef.current = baseMesh;

        const fxMat = new THREE.ShaderMaterial({ vertexShader: VERTEX_SHADER, fragmentShader: DEFAULT_FRAGMENT_SHADER, uniforms: uniformsRef.current, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const fxMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fxMat);
        fxMesh.visible = false;
        scene.add(fxMesh); fxMeshRef.current = fxMesh;

        let startT = performance.now() * 0.001;
        let lastTime = performance.now();
        let frameCount = 0;

        const animate = () => {
            frameCount++;
            const now = performance.now();
            const dt = now - lastTime;
            if (dt >= 1000) { setFps(Math.round((frameCount * 1000) / dt)); frameCount = 0; lastTime = now; }
            uniformsRef.current.u_time.value = (now * 0.001) - startT;
            renderer.render(scene, camera);
            requestAnimationFrame(animate);
        };
        animate();

        const handleResize = () => { renderer.setSize(window.innerWidth, window.innerHeight); uniformsRef.current.u_resolution.value.set(window.innerWidth, window.innerHeight); };
        window.addEventListener("resize", handleResize);
        return () => { window.removeEventListener("resize", handleResize); renderer.dispose(); };
    }, []);

    useEffect(() => {
        let socket: WebSocket | null = null;
        let lastBase = -1;
        let lastFx = -1;
        const targetMods = { flux: 0, bass: 0, high: 0, vol: 0, beat_phase: 0 };
        const smoothedMods = { flux: 0, bass: 0, high: 0, vol: 0, beat_phase: 0 };
        let lastTime = performance.now();

        const connect = () => {
            socket = new WebSocket(wsUrl);
            socket.binaryType = 'arraybuffer';
            socket.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    const view = new DataView(event.data);
                    const mTime = view.getFloat32(0, true);
                    mTimeRef.current = mTime;
                    targetMods.flux = view.getFloat32(4, true);
                    targetMods.bass = view.getFloat32(8, true);
                    targetMods.high = view.getFloat32(16, true);
                    targetMods.vol = view.getFloat32(20, true);
                    targetMods.beat_phase = view.getFloat32(28, true);
                    effIntensityRef.current = view.getUint8(59) / 255.0;

                    const baseIdx = view.getUint16(80, true);
                    const fxIdx = view.getUint16(82, true);

                    if (autoCycleRef.current && libraryRef.current.length > 0) {
                        const bases = libraryRef.current.filter(i => i.category === 'base');
                        const images = libraryRef.current.filter(i => i.category === 'image');
                        const imagePool = [...images];
                        if (spotifyTextureRef.current) {
                            imagePool.push({ category: 'spotify', file: 'spotify_art', prompt: 'Spotify Art' });
                        }
                        const allSources = [...bases, ...imagePool];

                        if (baseIdx !== lastBase) {
                            lastBase = baseIdx;
                            if (allSources.length > 0) {
                                const source = allSources[baseIdx % allSources.length];
                                
                                // Randomly enable dual-image masking ~50% of the time on drops
                                uniformsRef.current.u_dual.value = Math.random() > 0.5 ? 1.0 : 0.0;

                                if (source.category === 'tex') loadFromLibrary(source, baseIdx);
                                else if (source.category === 'spotify' && spotifyTextureRef.current) {
                                    applyNewTexture(spotifyTextureRef.current);
                                    const warpIdx = baseIdx % PRESET_WARPS.length;
                                    setActiveWarpIndex(warpIdx);
                                    applyNewShader(PRESET_WARPS[warpIdx].code, 'tex');
                                    setStatus("🎵 Spotify Art Live");
                                    setStatusColor("text-emerald-400");
                                }
                                else loadAiShader(source);
                            }
                        }
                        if (fxIdx !== lastFx) {
                            lastFx = fxIdx;
                            const fxs = libraryRef.current.filter(i => i.category === 'fx');

                            const currentSource = allSources.length > 0 ? allSources[Math.abs(lastBase) % allSources.length] : null;
                            const isImageActive = currentSource?.category === 'image' || currentSource?.category === 'spotify';

                            const fxRatio = isImageActive ? 0.5 : (bases.length > 0 ? (fxs.length / bases.length) : 0);
                            const seededRand = ((fxIdx * 9301 + 49297) % 233280) / 233280.0;

                            if (fxs.length > 0 && seededRand <= fxRatio) {
                                loadAiShader(fxs[fxIdx % fxs.length]);
                            } else if (fxMeshRef.current) {
                                fxMeshRef.current.visible = false;
                            }
                        }
                    }
                } else {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === "state") {
                            if (msg.vibe) vibeRef.current = msg.vibe;
                            if (msg.eff_speed !== undefined) effSpeedRef.current = msg.eff_speed;
                            if (msg.eff_intensity !== undefined) effIntensityRef.current = msg.eff_intensity;

                            // Handle DMX-Timed Visual Commands
                            if (msg.visual_commands) {
                                strobeActiveRef.current = msg.visual_commands.some((c: any) => c.function === 'strobe' && c.value > 0);
                                blackoutActiveRef.current = msg.visual_commands.some((c: any) => c.function === 'blackout' && c.value > 0);
                                spinActiveRef.current = msg.visual_commands.some((c: any) => c.function === 'spin' && c.value > 0);

                                const zoomCmd = msg.visual_commands.find((c: any) => c.function === 'zoom');
                                zoomTargetRef.current = zoomCmd ? (parseFloat(zoomCmd.value) || 1.0) : 1.0;

                                const hueCmd = msg.visual_commands.find((c: any) => c.function === 'hue');
                                hueTargetRef.current = hueCmd ? (parseFloat(hueCmd.value) / 255.0 || 0.0) : 0.0;

                                invertActiveRef.current = msg.visual_commands.some((c: any) => c.function === 'invert' && c.value > 0);

                                if (msg.visual_commands.length > 0) {
                                    console.log("🎬 Visual Commands:", msg.visual_commands);
                                }
                            } else {
                                strobeActiveRef.current = false;
                                blackoutActiveRef.current = false;
                                spinActiveRef.current = false;
                                zoomTargetRef.current = 1.0;
                                hueTargetRef.current = 0.0;
                                invertActiveRef.current = false;
                            }

                            if (msg.spotify && msg.spotify.image_high) {
                                if (lastSpotifyUrlRef.current !== msg.spotify.image_high) {
                                    lastSpotifyUrlRef.current = msg.spotify.image_high;
                                    setCurrentSpotifyArt(msg.spotify.image_high);
                                    new THREE.TextureLoader().setCrossOrigin('anonymous').load(msg.spotify.image_high, (tex) => {
                                        spotifyTextureRef.current = tex;
                                        // Trigger immediate update on song change
                                        applyNewTexture(tex);
                                        const warpIdx = Math.floor(Math.random() * PRESET_WARPS.length);
                                        if (autoCycleRef.current) setActiveWarpIndex(warpIdx);
                                        const finalWarpIdx = autoCycleRef.current ? warpIdx : (activeWarpIndex ?? warpIdx);
                                        applyNewShader(PRESET_WARPS[finalWarpIdx].code, 'tex');
                                        setStatus("🎵 Spotify Art Detected");
                                        setStatusColor("text-indigo-400");
                                    });
                                }
                            } else if (!msg.spotify) {
                                spotifyTextureRef.current = null;
                                lastSpotifyUrlRef.current = null;
                                setCurrentSpotifyArt(null);
                            }
                        }
                    } catch (e) { }
                }
            };
            socket.onopen = () => { setStatus("Sync Active"); setStatusColor("text-emerald-400"); };
            socket.onclose = () => { setStatus("Offline"); setStatusColor("text-rose-400"); setTimeout(connect, 3000); };
        };

        const updateLoop = () => {
            const now = performance.now();
            const dt = (now - lastTime) / 1000.0;
            lastTime = now;
            const sf = 1.0 - Math.pow(0.005, dt);

            smoothedMods.flux += (targetMods.flux - smoothedMods.flux) * sf;
            smoothedMods.bass += (targetMods.bass - smoothedMods.bass) * sf;
            smoothedMods.high += (targetMods.high - smoothedMods.high) * sf;
            smoothedMods.vol += (targetMods.vol - smoothedMods.vol) * sf;
            smoothedMods.beat_phase = targetMods.beat_phase; 

            // Accumulate local high-frequency flutter (Bass/Flux pulses)
            // We scale these by dt but NOT by effSpeedRef, as backend mTime already handles global warp
            localFlutterRef.current += dt * (smoothedMods.flux * 1.5 + smoothedMods.bass * 0.4);
            
            // Sync u_clock to Backend Master Time + Local Flutter offset
            // This eliminates drift while keeping local reactivity "liquid smooth"
            uniformsRef.current.u_clock.value = mTimeRef.current + localFlutterRef.current;
            // Master intensity scalar for the whole visual system
            const masterAlpha = effIntensityRef.current;
            uniformsRef.current.u_flux.value = smoothedMods.flux;
            uniformsRef.current.u_bass.value = smoothedMods.bass;
            uniformsRef.current.u_high.value = smoothedMods.high;
            uniformsRef.current.u_vol.value = smoothedMods.vol;
            uniformsRef.current.u_beat_phase.value = smoothedMods.beat_phase;
            
            // Calculate a snappy exponential pulse (1.0 -> 0.0) from the linear phase
            const beatPulse = Math.exp(-5.0 * smoothedMods.beat_phase);
            uniformsRef.current.u_beat_pulse.value = beatPulse;

            // Handle Blackout
            const isBlackout = blackoutActiveRef.current;
            uniformsRef.current.u_blackout.value = isBlackout ? 1.0 : 0.0;
            if (isBlackout) {
                if (baseMeshRef.current) baseMeshRef.current.visible = false;
                if (fxMeshRef.current) fxMeshRef.current.visible = false;
            } else {
                if (baseMeshRef.current) baseMeshRef.current.visible = true;
                // FX visibility is usually managed by its own logic, but we must restore it if it was visible
                // Actually, just let the next binary packet restore it or check if it should be visible.
                // For simplicity, restore base and let fx be managed by indices logic
                if (baseMeshRef.current) baseMeshRef.current.visible = true;
            }
            // Handle Strobe
            if (strobeActiveRef.current) {
                const strobeState = (Math.floor(now / 20) % 2); // ~25Hz strobe for tighter look
                uniformsRef.current.u_strobe.value = strobeState;
                if (strobeState === 0) {
                    if (baseMeshRef.current) baseMeshRef.current.visible = false;
                    if (fxMeshRef.current) fxMeshRef.current.visible = false;
                }
            } else {
                uniformsRef.current.u_strobe.value = 0;
            }

            // Handle Spin & Zoom
            const isSpinning = spinActiveRef.current;
            const spinScaleBoost = isSpinning ? 1.45 : 1.0;
            const targetScale = zoomTargetRef.current * spinScaleBoost;
            currentScaleRef.current += (targetScale - currentScaleRef.current) * sf;

            if (isSpinning) {
                spinAngleRef.current += dt * 2.0; // Steady rotation
            } else {
                // Return to 0 smoothly if not too far
                if (spinAngleRef.current % (Math.PI * 2) !== 0) {
                    spinAngleRef.current += (0 - (spinAngleRef.current % (Math.PI * 2))) * sf;
                }
            }

            // Handle Color FX
            currentHueRef.current += (hueTargetRef.current - currentHueRef.current) * sf;
            currentInvertRef.current += ((invertActiveRef.current ? 1.0 : 0.0) - currentInvertRef.current) * sf;

            const rotationZ = spinAngleRef.current;
            uniformsRef.current.u_spin.value = isSpinning ? 1.0 : 0.0;
            uniformsRef.current.u_spin_angle.value = rotationZ;
            uniformsRef.current.u_zoom.value = zoomTargetRef.current;
            uniformsRef.current.u_hue.value = currentHueRef.current;
            uniformsRef.current.u_invert.value = currentInvertRef.current;

            if (baseMeshRef.current) {
                baseMeshRef.current.rotation.z = rotationZ;
                // Add a subtle 5% "pump" to the global scale based on the beat pulse
                const beatScale = currentScaleRef.current * (1.0 + uniformsRef.current.u_beat_pulse.value * 0.05);
                baseMeshRef.current.scale.set(beatScale, beatScale, 1);
            }
            if (fxMeshRef.current) {
                fxMeshRef.current.rotation.z = rotationZ;
                const beatScale = currentScaleRef.current * (1.0 + uniformsRef.current.u_beat_pulse.value * 0.05);
                fxMeshRef.current.scale.set(beatScale, beatScale, 1);
            }

            // Apply global opacity based on eff_intensity (0..1 range expected for opacity)
            const globalOpacity = Math.max(0, Math.min(1.0, masterAlpha));
            if (baseMeshRef.current) (baseMeshRef.current.material as THREE.ShaderMaterial).opacity = globalOpacity;
            if (fxMeshRef.current) (fxMeshRef.current.material as THREE.ShaderMaterial).opacity = globalOpacity;

            requestAnimationFrame(updateLoop);
        };

        connect(); updateLoop();
        return () => socket?.close();
    }, [wsUrl]);

    return (
        <div className="relative w-full h-full bg-black text-white font-sans overflow-hidden"
            onClick={() => { setShowToolbar(!showToolbar); setShowHistory(false); setShowSettings(false); }}>
            <canvas ref={canvasRef} className="block w-full h-full" />

            <AnimatePresence>
                {showHistory && (
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onClick={e => e.stopPropagation()} className="absolute top-4 left-4 bottom-4 w-80 bg-zinc-900/95 border border-zinc-800 rounded-2xl flex flex-col z-50 overflow-hidden pointer-events-auto backdrop-blur-md shadow-2xl">
                        <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-black/40">
                            <h3 className="text-xs font-black tracking-widest text-indigo-400 uppercase">Unified Library</h3>
                            <div className="flex gap-2">
                                {filterTab === 'tex' ? (
                                    <div className="relative">
                                        <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                        <button className="p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white shadow-lg transition-colors">
                                            <Camera size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowAiInput(!showAiInput)} className={`p-1.5 rounded-md transition-all shadow-lg ${showAiInput ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-fuchsia-400 hover:text-white'}`}>
                                        <Sparkles size={14} />
                                    </button>
                                )}
                                <button onClick={() => setShowHistory(false)} className="p-1.5 hover:bg-zinc-800 rounded-md"><X size={14} /></button>
                            </div>
                        </div>

                        <AnimatePresence>
                            {showAiInput && (filterTab === 'base' || filterTab === 'fx') && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden bg-black/60 border-b border-zinc-800">
                                    <div className="p-3 flex flex-col gap-2">
                                        <textarea
                                            value={geminiPrompt}
                                            onChange={e => setGeminiPrompt(e.target.value)}
                                            placeholder={`Describe a ${filterTab} shader... (Type "undo" to revert edit)`}
                                            className="w-full bg-zinc-900 text-white border border-zinc-700 rounded-lg p-2 text-[10px] focus:outline-none focus:border-fuchsia-500 placeholder:text-zinc-600 resize-none h-16"
                                        />
                                        <div className="flex gap-2">
                                            <button onClick={() => handleGenerateAi('new')} disabled={isGenerating || !geminiPrompt} className="flex-1 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-[10px] font-black tracking-widest text-white rounded-lg transition-colors flex items-center justify-center gap-1.5">
                                                {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                {isGenerating ? 'DREAMING...' : 'NEW'}
                                            </button>
                                            <button onClick={() => handleGenerateAi('refine')} disabled={isGenerating || !geminiPrompt} className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[10px] font-black tracking-widest text-white rounded-lg transition-colors flex items-center justify-center gap-1.5">
                                                {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Edit size={12} />}
                                                {isGenerating ? 'REFINING...' : 'REFINE'}
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="flex bg-black">
                            {['tex', 'base', 'fx'].map(tab => (
                                <button key={tab} onClick={() => { setFilterTab(tab as any); setShowAiInput(false); }} className={`flex-1 py-3 text-[10px] font-black tracking-widest ${filterTab === tab ? 'text-white border-b-2 border-indigo-500 bg-indigo-900/20' : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50'}`}>
                                    {tab === 'tex' ? 'TEX' : tab.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-auto p-4 gap-4 grid grid-cols-2 content-start custom-scrollbar">
                            {((filterTab === 'tex' && currentSpotifyArt)
                                ? [{ category: 'spotify', file: currentSpotifyArt, name: 'Spotify Art' }, ...libraryItems.filter(i => i.category === 'tex')]
                                : libraryItems.filter(i => i.category === filterTab)
                            ).map((item, idx) => (
                                item.category === 'spotify' ? (
                                    <div key="spotify" className={`relative group aspect-square rounded-xl overflow-hidden border-2 cursor-pointer shadow-lg transition-all ${activeShaderId === 'spotify-art' ? 'border-emerald-500 shadow-emerald-500/20' : 'border-zinc-800 hover:border-emerald-400'}`} onClick={() => loadFromLibrary(item)}>
                                        <img src={item.file} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="bg-emerald-500 text-black text-[8px] font-black px-2 py-0.5 rounded-full mb-1">LIVE</div>
                                            <div className="text-[10px] font-bold text-white">SPOTIFY</div>
                                        </div>
                                        {activeShaderId === 'spotify-art' && (
                                            <div className="absolute top-2 left-2 w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                                        )}
                                    </div>
                                ) : filterTab === 'tex' ? (
                                    <div key={idx} className={`relative group aspect-square rounded-xl overflow-hidden border cursor-pointer shadow-lg transition-all ${activeShaderId === item.file ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-zinc-800 hover:border-indigo-400'}`} onClick={() => loadFromLibrary(item)}>
                                        <img src={`${apiBase}/${item.file}`} className="w-full h-full object-cover" />
                                        <button onClick={(e) => { e.stopPropagation(); deleteLibraryItem(item); }} className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-rose-500 rounded-lg text-white opacity-30 group-hover:opacity-100 transition-opacity backdrop-blur-md"><X size={14} /></button>
                                    </div>
                                ) : (
                                    <div
                                        key={idx}
                                        className={`relative group aspect-square rounded-xl border flex flex-col items-center justify-center p-3 cursor-pointer shadow-lg transition-all ${activeShaderId === item.file ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-zinc-800 bg-black hover:border-zinc-600 hover:bg-zinc-900'}`}
                                        onClick={() => {
                                            if (activeShaderId === item.file) {
                                                renameLibraryItem(item);
                                            } else {
                                                loadAiShader(item);
                                            }
                                        }}
                                    >
                                        <Sparkles size={24} className={`${activeShaderId === item.file ? 'text-fuchsia-400' : 'text-zinc-600 group-hover:text-fuchsia-400'} mb-2 transition-colors`} />
                                        <div className="text-[9px] text-zinc-500 font-bold text-center line-clamp-3 leading-relaxed">{item.prompt || item.file}</div>
                                        <button onClick={(e) => { e.stopPropagation(); deleteLibraryItem(item); }} className="absolute top-2 right-2 p-1.5 bg-black hover:bg-rose-500 border border-zinc-800 rounded-lg text-white opacity-30 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                                        {activeShaderId === item.file && (
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    const libPath = item.path || 'library2';
                                                    const res = await fetch(`${apiBase}/${libPath}/${item.file}`);
                                                    const code = await res.text();
                                                    const blob = new Blob([code], { type: 'text/plain' });
                                                    const a = document.createElement('a');
                                                    a.href = URL.createObjectURL(blob);
                                                    a.download = item.file.split('/').pop() || 'shader.frag';
                                                    a.click();
                                                    URL.revokeObjectURL(a.href);
                                                }}
                                                className="absolute bottom-2 inset-x-2 py-1 bg-fuchsia-600/80 hover:bg-fuchsia-500 rounded-lg text-white text-[8px] font-black tracking-widest flex items-center justify-center gap-1 transition-colors"
                                            >
                                                <Download size={10} /> SAVE .FRAG
                                            </button>
                                        )}
                                    </div>
                                )
                            ))}
                        </div>

                        {filterTab === 'tex' && (
                            <div className="flex-none p-4 border-t border-zinc-800 bg-black/60 backdrop-blur-md">
                                <div className="text-[9px] font-black text-indigo-400 mb-3 tracking-widest uppercase flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" /> Modifiers
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar scrollbar-hide">
                                    {PRESET_WARPS.map((warp, i) => (
                                        <button
                                            key={i}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveWarpIndex(i);
                                                applyNewShader(warp.code, 'tex');
                                            }}
                                            className={`flex-none px-4 py-2 rounded-xl text-[9px] font-black tracking-widest transition-all border whitespace-nowrap ${activeWarpIndex === i ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]' : 'bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
                                        >
                                            {warp.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}

                {showSettings && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} onClick={e => e.stopPropagation()} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-zinc-900/98 border border-zinc-800 rounded-3xl p-6 z-[100] pointer-events-auto backdrop-blur-2xl shadow-3xl">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xs font-black tracking-widest text-zinc-400 flex items-center gap-2">
                                <Settings size={14} /> ENGINE SETTINGS
                            </h3>
                            <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-zinc-800 rounded-full"><X size={16} /></button>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 tracking-wider flex items-center gap-2 px-1">
                                    <Key size={10} /> GEMINI API KEY
                                </label>
                                <form autoComplete="off" onSubmit={e => e.preventDefault()}>
                                    <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} readOnly />
                                    <input
                                        type="password"
                                        value={geminiKey}
                                        onChange={e => { setGeminiKey(e.target.value); localStorage.setItem('vj_gemini_key', e.target.value); }}
                                        placeholder="Paste API Key..."
                                        autoComplete="current-password"
                                        className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-indigo-400 focus:outline-none focus:border-indigo-500/50"
                                    />
                                </form>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 tracking-wider flex items-center gap-2 px-1">
                                    <Cpu size={10} /> AI MODEL
                                </label>
                                <select
                                    value={aiModel}
                                    onChange={e => { setAiModel(e.target.value); localStorage.setItem('vj_ai_model', e.target.value); }}
                                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 appearance-none"
                                >
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                    <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                                    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</option>
                                    <option value="gemini-flash-latest">Gemini Flash (Latest)</option>
                                </select>
                            </div>
                        </div>

                        <button onClick={() => setShowSettings(false)} className="w-full mt-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-black tracking-widest rounded-xl transition-all shadow-lg active:scale-95">
                            SAVE & CLOSE
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="fixed bottom-10 inset-x-0 w-full flex justify-center pointer-events-none">
                <AnimatePresence>
                    {showToolbar && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={e => e.stopPropagation()} className="pointer-events-auto flex flex-col gap-3 w-full max-w-xl px-4 sm:px-12">

                            <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/80 p-2.5 rounded-3xl flex items-center justify-between shadow-3xl overflow-hidden">
                                <div className="flex gap-2">
                                    <button onClick={() => setShowHistory(!showHistory)} className={`p-3 rounded-2xl transition-all border ${showHistory ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]' : 'bg-black/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
                                        <Layers size={18} />
                                    </button>
                                    <button onClick={() => setShowSettings(!showSettings)} className={`p-3 rounded-2xl transition-all border ${showSettings ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]' : 'bg-black/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
                                        <Settings size={18} />
                                    </button>
                                    <button onClick={() => setAutoCycle(!autoCycle)} className={`px-4 py-2 rounded-2xl transition-all border flex items-center justify-center gap-2 ${autoCycle ? 'bg-emerald-600/10 border-emerald-500/40 text-emerald-400' : 'bg-black/50 border-zinc-800 text-zinc-500 hover:bg-zinc-800'}`}>
                                        <RefreshCw size={14} className={autoCycle ? 'animate-spin-slow' : ''} />
                                        <span className="text-[10px] font-black tracking-widest">{autoCycle ? 'AUTO SYNC' : 'MANUAL'}</span>
                                    </button>
                                    <AnimatePresence>
                                        {unsavedShader && (
                                            <motion.button
                                                initial={{ opacity: 0, scale: 0.8 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.8 }}
                                                onClick={handleSaveUnsavedShader}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-2xl text-white flex items-center justify-center gap-2 shadow-lg transition-colors border border-indigo-500 font-black tracking-widest text-[10px]"
                                            >
                                                <Save size={14} /> SAVE
                                            </motion.button>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <button
                                    onClick={() => window.location.href = '/manager.html'}
                                    className="flex flex-col items-end px-4 gap-1 ml-auto group transition-all border-none bg-transparent cursor-pointer"
                                >
                                    <div className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-2 ${statusColor} group-hover:text-white transition-colors`}>
                                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${statusColor.replace('text-', 'bg-')}`} /> HOME
                                    </div>
                                    <div className="text-[8px] font-bold text-zinc-600 tracking-tighter uppercase">{fps} FPS • PI-5 GL ES</div>
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* DEBUG OVERLAY - Enhanced for visibility, only shows when toolbar is active */}
                {showToolbar && (
                    <div className="fixed top-24 left-8 pointer-events-none font-mono text-[12px] space-y-2 z-[100] bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/5 shadow-2xl">
                        <div className="text-zinc-500 mb-2 border-b border-white/10 pb-1 text-[10px] font-black uppercase tracking-wider">Visual FX Debug</div>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${strobeActiveRef.current ? "bg-amber-400 animate-pulse shadow-[0_0_10px_#fbbf24]" : "bg-zinc-800"}`} />
                            <span className={strobeActiveRef.current ? "text-amber-200" : "text-zinc-600"}>STROBE</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${spinActiveRef.current ? "bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]" : "bg-zinc-800"}`} />
                            <span className={spinActiveRef.current ? "text-emerald-200" : "text-zinc-600"}>SPIN</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${(zoomTargetRef.current > 1.05 || zoomTargetRef.current < 0.95) ? "bg-indigo-400 shadow-[0_0_10px_#818cf8]" : "bg-zinc-800"}`} />
                            <span className={(zoomTargetRef.current > 1.05 || zoomTargetRef.current < 0.95) ? "text-indigo-200" : "text-zinc-600"}>ZOOM: {zoomTargetRef.current.toFixed(2)}x</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${hueTargetRef.current > 0 ? "bg-rose-400 shadow-[0_0_10px_#fb7185]" : "bg-zinc-800"}`} />
                            <span className={hueTargetRef.current > 0 ? "text-rose-200" : "text-zinc-600"}>HUE: {(hueTargetRef.current * 360).toFixed(0)}°</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${invertActiveRef.current ? "bg-white shadow-[0_0_10px_#fff]" : "bg-zinc-800"}`} />
                            <span className={invertActiveRef.current ? "text-white" : "text-zinc-600"}>INVERT</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}