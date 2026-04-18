precision highp float;

varying vec2 vUv;
uniform float u_time;
uniform float u_clock;
uniform float u_bass;
uniform float u_flux;
uniform float u_high;
uniform float u_vol;
uniform vec2 u_resolution;

// Optimized rainbow palette
vec3 palette(float t) {
    vec3 b = vec3(0.5);
    return vec3(0.5) + b * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

// 2D Rotation matrix
mat2 rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

void main() {
    // Center and correct aspect ratio
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    // Reactive UV distortion - "Bass Bulge"
    float dist = length(uv);
    uv *= (1.0 - u_bass * 0.15 * exp(-dist * 2.0));
    
    // Feedback-style rotation modulated by energy
    uv *= rot(u_clock * 0.2 + (dist * u_flux * 0.5));

    // Recalculate polar coordinates after distortion
    float radius = length(uv);
    float angle = atan(uv.y, uv.x);

    // Dynamic starburst: Frequency shifts with high-end energy
    float slices = 8.0 + (u_bass * 12.0);
    float star = sin(angle * slices + u_clock) * 0.5 + 0.5;
    
    // Fractal-like ring layers
    float ringFreq = 30.0 + (u_high * 20.0);
    float rings = sin(radius * ringFreq - u_clock * 8.0 + (star * 2.0));
    
    // Sharpening logic: Bass expands the "light" areas, Flux tightens them
    float threshold = 0.9 - (u_bass * 0.3);
    float mask = smoothstep(threshold, threshold + 0.05, rings);

    // Audio-reactive coloring
    // Highs control color cycle speed, Flux controls color density
    vec3 colorBase = palette(radius * 0.5 + u_clock * 0.3 + u_flux * 0.2);
    
    // Radial glow/vignette modulated by volume
    float glow = exp(-radius * (2.0 - u_vol));
    
    // Composite: Rings * Palette + Centered glow + High-frequency "sparkle"
    vec3 finalColor = colorBase * mask;
    
    // Add sharp highlights on high-frequency hits
    finalColor += (1.0 - mask) * u_high * 0.4 * colorBase.zyx;
    
    // Inner core flash
    float core = smoothstep(0.4 * u_bass, 0.0, radius);
    finalColor += core * vec3(1.0, 0.8, 0.6) * u_bass;

    // Final global boost and contrast
    finalColor *= (0.8 + u_vol * 0.5);
    finalColor = pow(finalColor, vec3(0.9)); // Slight gamma curve for punch

    gl_FragColor = vec4(finalColor, 1.0);
}