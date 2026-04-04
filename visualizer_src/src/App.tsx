import React, { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import {
  Zap, Save, Code, Cloud, RefreshCw, AlertCircle,
  Trash2, Play, Pause, ChevronLeft, ChevronRight,
  Maximize2, Minimize2, Cpu, Settings, Copy, X, Key, Edit, Home, Trash
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey?: () => Promise<boolean>;
      openSelectKey?: () => Promise<void>;
    };
  }
}

const VJ_SYSTEM_PROMPT = `
You are an expert GLSL fragment shader developer for live EDM VJ performances. Your sole purpose is to generate a complete GLSL fragment shader compatible with a Three.js ShaderMaterial.

CRITICAL RULES:
- The output should ONLY be the raw GLSL code. Do not include any explanations, markdown formatting like \`\`\`glsl, or any text other than the code itself.
- Start your code with "precision highp float;".
- Declare "varying vec2 vUv;" at the top.
- Use the following uniforms. Do not invent new uniforms:
  uniform float u_time;       // Absolute time
  uniform float u_clock;      // Audio-modulated time (USE THIS FOR SMOOTH CONTINUOUS MOTION)
  uniform vec2 u_resolution;
  uniform float u_bass;       // 0.0 to 1.5+ (Kicks/Lows)
  uniform float u_flux;       // 0.0 to 1.5+ (Energy changes)
  uniform float u_vol;        // 0.0 to 1.5+ (Overall volume)
  uniform float u_intensity;  // Smoothed overall volume
  uniform float u_high;       // 0.0 to 1.5+ (Hi-hats/Highs)
  uniform float u_dmxRot;
  uniform float u_axis_a;
  uniform float u_axis_b;
  uniform float u_axis_c;
  uniform float u_axis_d;
  uniform float u_axis_e;

HELPER FUNCTIONS (Include these in your output if needed):
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}
vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
    return a + b*cos( 6.28318*(c*t+d) ); // Cosine based color palette
}

DESIGN GUIDELINES (MESMERIZING & IMPACTFUL):
- Center the coordinate system: vec2 uv = (vUv - 0.5) * 2.0;
- Fix aspect ratio if needed: uv.x *= u_resolution.x / u_resolution.y;
- Use Signed Distance Fields (SDFs), fractals, kaleidoscope mirroring (abs(uv)), or infinite tunnels.
- Tie continuous forward/rotational movement to u_clock to prevent jitter.
- Tie explosive scale, thickness, and glow directly to u_bass or u_flux.
- Rotate the primary geometric space using rotate2d(u_dmxRot).
- Output must be additive-blend friendly (pure black vec4(0.0) for empty space).

PERFORMANCE GUIDELINES (EFFICIENT GPU USAGE):
- STRICTLY FORBIDDEN: Do not use branching "if/else" statements. Use step(), smoothstep(), and mix() instead.
- STRICTLY FORBIDDEN: Do not use loops with high iterations (max 16 if absolutely necessary for raymarching/fractals).
- Rely on fract() for infinite repetition instead of looping.

CONTRAST RULE:
- APPLY HIGH BLACK POINT: In your final gl_FragColor calculation, always apply a high black point for extreme contrast to make lasers and LEDs pop.
  Example logic: color.rgb = (color.rgb - 0.2) / 0.8; color.rgb = clamp(color.rgb, 0.0, 1.0);
`;

const DEFAULT_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_bass;
uniform float u_flux;

void main() {
    vec2 uv = vUv;
    float dist = distance(uv, vec2(0.5));
    float circle = smoothstep(0.2 + u_bass * 0.1, 0.18 + u_bass * 0.1, dist);
    
    vec3 color = vec3(uv.x, uv.y, sin(u_time) * 0.5 + 0.5);
    color += circle * vec3(1.0, 0.5, 0.0);
    
    // High Black Point
    color = (color - 0.2) / 0.8;
    color = clamp(color, 0.0, 1.0);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shaderDescription, setShaderDescription] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [statusColor, setStatusColor] = useState("text-amber-400");
  const [isGenerating, setIsGenerating] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [currentShaderCode, setCurrentShaderCode] = useState(DEFAULT_FRAGMENT_SHADER);
  const [showCode, setShowCode] = useState(false);
  const [libraryVisuals, setLibraryVisuals] = useState<{ file: string; prompt: string; type?: string }[]>([]);
  const libraryRef = useRef<{ file: string; prompt: string; type?: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [autoCycle, setAutoCycle] = useState(true);
  const autoCycleRef = useRef(true);
  const [selectedModel, setSelectedModel] = useState(localStorage.getItem('vj_gemini_model') || "gemini-3-flash");
  const [showSettings, setShowSettings] = useState(false);

  // Persistence: Save API Key To LocalStorage
  const getApiKey = () => localStorage.getItem('vj_gemini_api_key') || "";
  const setApiKey = (key: string) => {
    localStorage.setItem('vj_gemini_api_key', key);
    setHasApiKey(!!key);
  };

  const updateHistory = (data: any[]) => {
    setLibraryVisuals(data);
    libraryRef.current = data;
  };

  const fetchHistory = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/usergen/list`);
      if (resp.ok) {
        const data = await resp.json();
        updateHistory(data);
      }
    } catch (err) {
      console.error("Library load failed:", err);
    }
  };

  useEffect(() => {
    autoCycleRef.current = autoCycle;
  }, [autoCycle]);

  useEffect(() => {
    setHasApiKey(!!getApiKey());
    fetchHistory();
  }, []);

  const openKeyDialog = async () => {
    const key = window.prompt("Enter your Gemini API Key:", getApiKey());
    if (key) setApiKey(key);
  };

  const updateModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('vj_gemini_model', model);
  };

  const uniformsRef = useRef({
    u_time: { value: 0 },
    u_clock: { value: 0 }, // MODULATED TIME
    u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    u_bass: { value: 0 },
    u_flux: { value: 0 },
    u_vol: { value: 0 },
    u_intensity: { value: 0 }, // SMOOTHER VOLUME
    u_high: { value: 0 },
    u_speed: { value: 1.0 },
    u_dmxRot: { value: 0 },
    u_axis_a: { value: 0 },
    u_axis_b: { value: 0 },
    u_axis_c: { value: 0 },
    u_axis_d: { value: 0 },
    u_axis_e: { value: 0 },
  });

  const baseMeshRef = useRef<THREE.Mesh | null>(null);
  const fxMeshRef = useRef<THREE.Mesh | null>(null);
  const [activeLayer, setActiveLayer] = useState<'base' | 'fx'>('base');
  const activeLayerRef = useRef<'base' | 'fx'>('base');
  const baseManualRef = useRef(false);
  const fxManualRef = useRef(false);
  const [currentBaseCode, setCurrentBaseCode] = useState(DEFAULT_FRAGMENT_SHADER);
  const [currentFxCode, setCurrentFxCode] = useState("precision highp float; void main() { gl_FragColor = vec4(0.0); }");
  const [fps, setFps] = useState(60);
  const [performanceWarning, setPerformanceWarning] = useState(false);

  useEffect(() => { activeLayerRef.current = activeLayer; }, [activeLayer]);

  const applyNewShader = (code: string, type: 'base' | 'fx' = activeLayerRef.current) => {
    try {
      const sanitizedCode = code.replace(/for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*(\d+)\s*;/g, (match, steps) => {
        const num = parseInt(steps);
        return num > 32 ? `for(int i=0; i<32;` : match;
      });

      const newMat = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: sanitizedCode,
        uniforms: uniformsRef.current,
        transparent: type === 'fx',
        blending: type === 'fx' ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
      });

      if (type === 'base' && baseMeshRef.current) {
        baseMeshRef.current.material.dispose();
        baseMeshRef.current.material = newMat;
        setCurrentBaseCode(sanitizedCode);
        baseManualRef.current = true;
      } else if (type === 'fx' && fxMeshRef.current) {
        fxMeshRef.current.material.dispose();
        fxMeshRef.current.material = newMat;
        fxMeshRef.current.visible = true;
        setCurrentFxCode(sanitizedCode);
        fxManualRef.current = true;
      }
      setStatus(`✅ ${type.toUpperCase()} Applied`);
      setStatusColor("text-indigo-400");
    } catch (err: any) {
      setStatus(`❌ Shader error: ${err.message || "Invalid GLSL"}`);
      setStatusColor("text-rose-400");
    }
  };

  const loadFromLibrary = async (item: { file: string, type?: string }, forceType?: 'base' | 'fx') => {
    setStatus(`📂 Loading ${item.file}...`);
    try {
      const resp = await fetch(`${apiBase}/library/${item.file}`);
      if (resp.ok) {
        const code = await resp.text();
        const targetLayer = forceType || (item.type as 'base' | 'fx') || activeLayerRef.current;
        applyNewShader(code, targetLayer === 'unknown' ? activeLayerRef.current : targetLayer);
      }
    } catch (err) { }
  };

  const deleteShader = async (item: { file: string }) => {
    if (!confirm(`Permanently delete ${item.file}?`)) return;
    try {
      const resp = await fetch(`${apiBase}/api/usergen/delete?file=${item.file}`, { method: 'DELETE' });
      if (resp.ok) {
        setStatus("🗑️ Deleted.");
        fetchHistory();
      } else {
        setStatus(`❌ Delete failed: ${resp.status}`);
      }
    } catch (err) {
      setStatus("❌ Delete failed (Network error).");
    }
  };

  const renameShader = async (item: { file: string, prompt: string }) => {
    const newPrompt = window.prompt("Enter new name for visual:", item.prompt);
    if (!newPrompt || newPrompt === item.prompt) return;
    try {
      const resp = await fetch(`${apiBase}/api/usergen/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: item.file, new_prompt: newPrompt })
      });
      if (resp.ok) {
        setStatus("📝 Renamed.");
        fetchHistory();
      }
    } catch (err) { setStatus("❌ Rename failed."); }
  };

  const saveToServer = async () => {
    const code = activeLayer === 'base' ? currentBaseCode : currentFxCode;
    if (code === DEFAULT_FRAGMENT_SHADER) return;
    setStatus(`💾 Saving ${activeLayer.toUpperCase()}...`);
    try {
      const resp = await fetch(`${apiBase}/api/usergen/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, prompt: shaderDescription, layer_type: activeLayer })
      });
      if (resp.ok) {
        setStatus("✅ Saved!");
        fetchHistory();
      }
    } catch (err) { setStatus("❌ Save failed."); }
  };

  // Three.js Render Setup
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const baseMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER, fragmentShader: DEFAULT_FRAGMENT_SHADER, uniforms: uniformsRef.current, depthWrite: false
    });
    const baseMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), baseMaterial);
    scene.add(baseMesh);
    baseMeshRef.current = baseMesh;

    const fxMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER, fragmentShader: currentFxCode, uniforms: uniformsRef.current, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const fxMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fxMaterial);
    scene.add(fxMesh);
    fxMeshRef.current = fxMesh;

    let startT = performance.now() * 0.001;
    let frameCount = 0;
    let lastTime = performance.now();

    const animate = () => {
      frameCount++;
      const now = performance.now();
      const delta = now - lastTime;
      if (delta >= 1000) {
        setFps(Math.round((frameCount * 1000) / delta));
        frameCount = 0;
        lastTime = now;
      }
      const elapsed = (now * 0.001) - startT;
      if (uniformsRef.current.u_time.value === 0) uniformsRef.current.u_time.value = elapsed * 0.6;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniformsRef.current.u_resolution.value.set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); renderer.dispose(); };
  }, []);

  // Host & WS Sync Configuration
  const { wsUrl, apiBase } = useMemo(() => {
    const savedHost = localStorage.getItem('vj_backend_host') || window.location.hostname;
    const isLocal = savedHost === "localhost" || savedHost === "127.0.0.1";
    const boxName = (savedHost === 'ravebox') ? 'ravebox.love' : ((savedHost && !savedHost.includes('.') && !isLocal) ? `${savedHost}.ravebox.love` : savedHost);
    const isCustomTunnel = boxName.endsWith('.ravebox.love') && boxName !== 'ravebox.love' && boxName !== 'api.ravebox.love';
    const apiHost = isCustomTunnel ? `api-${boxName}` : (boxName === 'ravebox.love' ? 'ravebox.love' : boxName);
    const wsHost = isCustomTunnel ? `ws-${boxName}` : (boxName === 'ravebox.love' ? 'wss.ravebox.love' : boxName);
    const useSSL = window.location.protocol === "https:" || isCustomTunnel || boxName.includes('ravebox.love');
    const wsUrl = `${useSSL ? "wss:" : "ws:"}//${wsHost}${isCustomTunnel ? "" : ":8765"}/`;
    const apiBase = `${useSSL ? "https:" : "http:"}//${apiHost}${isCustomTunnel ? "" : ":8000"}`;
    return { wsUrl, apiBase };
  }, []);

  // Sync Logic
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeout: any;
    const targetMods = { flux: 0, bass: 0, high: 0, vol: 0 };
    const smoothedMods = { flux: 0, bass: 0, high: 0, vol: 0 };
    let remoteParams = { speed: 1.0, amplitude: 1.0 };
    let logicState = { axis_a: 0, axis_b: 0, axis_c: 0, axis_d: 0, axis_e: 0 };
    let lastBase = -1;
    let lastFx = -1;

    const connect = () => {
      socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data);
          // Schema: < f 6f 6f 4B 5f 3H 513s
          const mTime = view.getFloat32(0, true);
          const flux = view.getFloat32(4, true);
          const bass = view.getFloat32(8, true);
          // const mid = view.getFloat32(12, true);
          const high = view.getFloat32(16, true);
          const vol = view.getFloat32(20, true);
          // const bpm = view.getFloat32(24, true);

          uniformsRef.current.u_time.value = mTime;
          targetMods.flux = flux;
          targetMods.bass = bass;
          targetMods.high = high;
          targetMods.vol = vol;

          logicState.axis_a = view.getFloat32(56, true);
          logicState.axis_b = view.getFloat32(60, true);
          logicState.axis_c = view.getFloat32(64, true);
          logicState.axis_d = view.getFloat32(68, true);
          logicState.axis_e = view.getFloat32(72, true);

          const baseIdx = view.getUint16(76, true);
          const fxIdx = view.getUint16(78, true);

          // Auto-Cycle logic (Throttled by internal state tracking in update thread)
          if (autoCycleRef.current) {
            if (baseIdx !== lastBase) {
              lastBase = baseIdx;
              baseManualRef.current = false;
              const bases = libraryRef.current.filter(h => h.type === 'base' || !h.type || h.type === 'unknown');
              if (bases.length) loadFromLibrary(bases[baseIdx % bases.length], 'base');
            }
            if (fxIdx !== lastFx) {
              lastFx = fxIdx;
              fxManualRef.current = false;
              const bases = libraryRef.current.filter(h => h.type === 'base' || !h.type || h.type === 'unknown');
              const fxs = libraryRef.current.filter(h => h.type === 'fx');
              const fxRatio = bases.length > 0 ? (fxs.length / bases.length) : 0;
              const seededRand = ((fxIdx * 9301 + 49297) % 233280) / 233280.0;

              if (fxs.length > 0 && seededRand <= fxRatio) {
                loadFromLibrary(fxs[fxIdx % fxs.length], 'fx');
                if (fxMeshRef.current) fxMeshRef.current.visible = true;
              } else if (fxMeshRef.current && fxs.length > 0 && !fxManualRef.current) {
                fxMeshRef.current.visible = false;
              }
            }
          }
          return;
        }

        try {
          const msg = JSON.parse(event.data);
          // Discrete state updates (Vibe change, preset change, errors)
          if (msg.type === "state") {
            if (msg.error) setStatus("⚠️ " + msg.error);
          }
          if (msg.type === "current_params" || msg.type === "visual_params") {
            if (msg.speed !== undefined) remoteParams.speed = msg.speed;
            if (msg.amplitude !== undefined) remoteParams.amplitude = msg.amplitude;
          }
        } catch (e) { }
      };
      socket.onopen = () => {
        setStatus("Connected. Waiting for prompt...");
        setStatusColor("text-emerald-400");
      };
      socket.onclose = () => {
        setStatus("Disconnected. Reconnecting...");
        setStatusColor("text-rose-400");
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };
    let lastTime = performance.now();
    const updateLoop = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      const sf = 1.0 - Math.pow(0.005, dt);
      const amp = remoteParams.amplitude || 1.0;

      smoothedMods.flux += (targetMods.flux - smoothedMods.flux) * sf;
      smoothedMods.bass += (targetMods.bass - smoothedMods.bass) * sf;
      smoothedMods.high += (targetMods.high - smoothedMods.high) * sf;
      smoothedMods.vol += (targetMods.vol - smoothedMods.vol) * sf;

      // MODULATED CLOCK INTEGRATION
      // Instead of u_time * flux (which jitters), we integrate time * flux into a single increasing value
      // Baseline 0.6 matching SERVER_START_TIME * 0.6 sync
      const modSpeed = 0.6 + (smoothedMods.flux * 1.5) + (smoothedMods.bass * 0.4);
      uniformsRef.current.u_clock.value += dt * modSpeed;

      uniformsRef.current.u_flux.value = Math.min(1.5, smoothedMods.flux * amp);
      uniformsRef.current.u_bass.value = Math.min(1.5, smoothedMods.bass * amp);
      uniformsRef.current.u_high.value = Math.min(1.5, smoothedMods.high * amp);
      uniformsRef.current.u_vol.value = Math.min(1.5, smoothedMods.vol * amp);
      uniformsRef.current.u_intensity.value = smoothedMods.vol * amp;

      uniformsRef.current.u_speed.value = remoteParams.speed;
      uniformsRef.current.u_axis_a.value = logicState.axis_a || 0;
      uniformsRef.current.u_axis_b.value = logicState.axis_b || 0;
      uniformsRef.current.u_axis_c.value = logicState.axis_c || 0;
      uniformsRef.current.u_axis_d.value = logicState.axis_d || 0;
      uniformsRef.current.u_axis_e.value = logicState.axis_e || 0;
      uniformsRef.current.u_dmxRot.value = (logicState.axis_b || 0) * Math.PI;
      requestAnimationFrame(updateLoop);
    };
    connect(); updateLoop();
    return () => { if (socket) socket.close(); clearTimeout(reconnectTimeout); };
  }, [wsUrl]);

  const handleGenerate = async (fixMode = false) => {
    if (!shaderDescription && !fixMode) return;
    if (!hasApiKey) { openKeyDialog(); return; }
    setIsGenerating(true); setStatus(fixMode ? "🔧 Fixing GLSL..." : "⏳ Re-dreaming...");
    try {
      const genAI = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await genAI.models.generateContent({
        model: selectedModel,
        contents: fixMode ? `Take this ${activeLayer.toUpperCase()} shader and adjust it: "${shaderDescription}". Return ONLY valid GLSL:\n\n${activeLayer === 'base' ? currentBaseCode : currentFxCode}` : `Generate a ${activeLayer.toUpperCase()} shader of ${shaderDescription}`,
        config: { systemInstruction: VJ_SYSTEM_PROMPT }
      });
      let code = (response.text || "").replace(/^```(glsl)?|```$/gm, "").trim();
      if (code) applyNewShader(code);
    } catch (err: any) { setStatus(`❌ Error: ${err.message}`); } finally { setIsGenerating(false); }
  };

  return (
    <div className="relative w-full h-full bg-black text-white font-sans overflow-hidden" onClick={() => {
      if (!showToolbar) {
        setShowToolbar(true);
      } else {
        setShowToolbar(false);
        setShowHistory(false);
        setShowSettings(false);
      }
    }}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      <AnimatePresence>
        {showHistory && (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onClick={e => e.stopPropagation()} className="absolute top-4 left-4 bottom-4 w-72 bg-zinc-900/95 border border-zinc-800 rounded-2xl flex flex-col z-50 overflow-hidden pointer-events-auto shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center"><h3 className="text-xs font-black">LIBRARY</h3><button onClick={() => setShowHistory(false)}><X size={16} /></button></div>
            <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
              <div className="flex gap-2 p-1 bg-black/40 rounded-lg">
                <button onClick={() => setActiveLayer('base')} className={`flex-1 py-1 text-[10px] font-bold rounded ${activeLayer === 'base' ? 'bg-indigo-600' : 'text-zinc-500'}`}>BASE</button>
                <button onClick={() => setActiveLayer('fx')} className={`flex-1 py-1 text-[10px] font-bold rounded ${activeLayer === 'fx' ? 'bg-indigo-600' : 'text-zinc-500'}`}>FX</button>
              </div>
              {libraryVisuals.filter(h => h.type === activeLayer || !h.type).map((item, idx) => (
                <div key={idx} className="p-3 bg-zinc-800 hover:bg-indigo-900/20 border border-zinc-700 rounded-xl relative group">
                  <div onClick={() => loadFromLibrary(item)} className="cursor-pointer pr-12"><div className="text-[10px] font-bold truncate">{item.prompt}</div><div className="text-[8px] text-zinc-500 truncate">{item.file}</div></div>
                  <div className="absolute right-2 top-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => renameShader(item)} className="p-1 hover:text-indigo-400"><Edit size={12} /></button>
                    <button onClick={() => deleteShader(item)} className="p-1 hover:text-rose-400"><Trash size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-xl">
        <AnimatePresence>
          {showToolbar && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={e => e.stopPropagation()} className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-3 flex flex-col gap-3 pointer-events-auto shadow-2xl">
              <input type="text" value={shaderDescription} onChange={e => setShaderDescription(e.target.value)} onKeyDown={e => e.key === "Enter" && handleGenerate()} placeholder={`Describe your ${activeLayer}...`} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:ring-1 focus:ring-indigo-500 transition-all" />
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-xl transition-all ${showHistory ? 'bg-indigo-600' : 'bg-black border border-zinc-800 text-zinc-400'}`}><Cloud size={16} /></button>
                  <button onClick={() => setAutoCycle(!autoCycle)} className={`p-2 rounded-xl transition-all ${autoCycle ? 'bg-indigo-600' : 'bg-black border border-zinc-800 text-zinc-400'}`}><RefreshCw size={16} className={autoCycle ? 'animate-spin-slow' : ''} /></button>
                  <button onClick={() => window.location.href = './manager.html'} className="p-2 bg-black border border-zinc-800 text-zinc-400 rounded-xl"><Home size={16} /></button>
                </div>
                <div className="flex gap-2">
                  {showSettings && (
                    <div className="flex bg-black border border-zinc-800 rounded-xl px-2 gap-2 items-center">
                      <select value={selectedModel} onChange={e => updateModel(e.target.value)} className="bg-transparent text-[8px] font-bold text-zinc-400 outline-none">
                        <option value="gemini-3-flash">GEMINI 3 FLASH</option>
                        <option value="gemini-2.5-flash">GEMINI 2.5 FLASH</option>
                        <option value="gemini-2.5-flash-lite">GEMINI 2.5 LITE</option>
                        <option value="gemini-2.5-pro">GEMINI 2.5 PRO</option>
                        <option value="gemini-2.5-flash-tts">GEMINI 2.5 FLASH TTS</option>
                        <option value="gemini-2.5-pro-tts">GEMINI 2.5 PRO TTS</option>
                      </select>
                      <button onClick={openKeyDialog} className="p-1 hover:text-indigo-400 border-l border-zinc-800 pl-2"><Edit size={12} /></button>
                    </div>
                  )}
                  <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-xl transition-all ${showSettings ? 'text-indigo-400' : 'bg-black border border-zinc-800 text-zinc-400'}`}><Key size={16} /></button>
                  <button onClick={saveToServer} className="p-2 bg-black border border-zinc-800 text-emerald-400 rounded-xl"><Save size={16} /></button>
                  <button onClick={() => handleGenerate()} disabled={isGenerating || !shaderDescription} className="px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-[10px] tracking-widest flex flex-col items-center">
                    {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}<span>{activeLayer.toUpperCase()}</span>
                  </button>
                </div>
              </div>
              <div className="flex justify-between items-center px-1"><div className={`text-[8px] font-black uppercase tracking-widest ${statusColor}`}>{status}</div><div className="text-[8px] font-bold text-zinc-600">{fps} FPS</div></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
