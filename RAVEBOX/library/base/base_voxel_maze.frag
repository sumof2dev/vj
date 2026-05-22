precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_clock; // Jitter-free Modulated Time
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_intensity; // Smoother intensity track
uniform float u_transient_state;
uniform float u_drop_time;

// Optimized Rotation
void rot(inout vec2 p, float a) {
    float s = sin(a), c = cos(a);
    p = mat2(c, -s, s, c) * p;
}

// Faster Box Approximation (Fastest bound)
float sdBox(vec3 p, float b) {
    vec3 d = abs(p) - b;
    return max(d.x, max(d.y, d.z));
}

float map(vec3 p) {
    float clampedFlux = min(u_flux, 0.6);
    float clampedBass = min(u_bass, 0.8);
    float clampedVol = min(u_intensity, 0.8);
    
    p.z += u_clock;
    
    // Combine rotations into one call where possible
    float rotAngle = u_time * 0.1 + p.z * 0.03 * (1.0 + clampedBass * 0.2);
    rot(p.xy, rotAngle);
    
    float size = 4.0;
    p = mod(p + size*0.5, size) - size*0.5;
    
    if (clampedFlux > 0.3) {
        rot(p.xy, 0.785);
        p = abs(p) - (0.3 * clampedFlux);
    }

    float d = sdBox(p, 1.0);
    
    // Performance: Cap fractal iterations at 1 for voxel look
    float s = 1.0;
    for(int m=0; m<1; m++) {
        vec3 a = mod(p * s, 2.0) - 1.0;
        s *= 3.0; 
        vec3 r = abs(1.0 - 3.0 * abs(a));
        float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
        d = max(d, c);
    }
    return d;
}

void main() {
    if (u_resolution.y < 1.0) { gl_FragColor = vec4(0.0); return; }
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    vec3 ro = vec3(0.0, 0.0, -4.0); 
    vec3 rd = normalize(vec3(uv, 1.0)); 
    
    float t = 0.0; 
    int steps = 0;
    // PERFORMANCE: Reduced steps to 24 for smoother Pi 5 playback
    for(int i=0; i<24; i++) {
        float d = map(ro + rd * t);
        t += d * 0.85; // Slightly larger step
        if(d < 0.01 || t > 60.0) break;
        steps = i;
    }
    
    vec3 col = vec3(0.0);
    if(t < 60.0) {
        vec3 p = ro + rd * t;
        float ao = 1.0 - float(steps) / 24.0;
        float hue = p.z * 0.05 + u_time * 0.1;
        
        // Optimized color mixing
        col = 0.4 + 0.4 * cos(6.28 * (hue + vec3(0.0, 0.33, 0.67)));
        col *= ao;
        
        // Simple linear fog
        float fog = smoothstep(60.0, 10.0, t);
        col *= fog;
        
        col += vec3(0.1, 0.3, 0.5) * u_bass * ao; 
    }
    gl_FragColor = vec4(col, 1.0);
}
