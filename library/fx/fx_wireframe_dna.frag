precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_audioLevel;
uniform float u_bass;
uniform vec2 u_resolution;
uniform float u_dmxRot;

mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;
    
    float time = u_time * 0.8; 
    uv *= rot(u_dmxRot); 
    
    float waveAmp = 0.4 + u_audioLevel * 0.2; 
    float freq = 4.0 + u_bass * 1.5; 
    
    float wave = sin(uv.x * freq + time * 1.5) * waveAmp;
    float wave2 = sin(uv.x * freq + time * 1.5 + 3.14159) * waveAmp;
    
    float d1 = abs(uv.y - wave);
    float d2 = abs(uv.y - wave2);

    float thickness = 0.04 + u_audioLevel * 0.02; 
    float line = smoothstep(thickness, 0.0, d1) + smoothstep(thickness, 0.0, d2);
    
    float stepX = 0.3; 
    if (fract(uv.x / stepX) < 0.05) { line += 0.2; }
    
    float boost = 0.7 + u_audioLevel * 0.3;
    line *= boost; 
    
    float dist = length(uv);
    line *= smoothstep(1.5, 0.5, dist);

    vec3 col = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), sin(uv.x * 1.5 + time) * 0.5 + 0.5);
    
    float finalAlpha = min(0.6, line * 0.8);
    gl_FragColor = vec4(col * line * 0.8, finalAlpha);
}
