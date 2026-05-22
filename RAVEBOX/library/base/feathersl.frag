precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_clock;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_flux;

vec3 palette( in float t ) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos( 6.28318 * (c * t + d) );
}

mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    vec2 uv0 = uv;
    vec3 finalColor = vec3(0.0);
    
    // 1. Bilateral symmetry (Creates the butterfly/lotus foundation)
    uv.x = abs(uv.x);
    
    // Slight breathing effect on the whole coordinate space
    uv *= 0.9 + sin(u_clock * 0.5) * 0.1;

    // 2. Space Folding Loop (Max 6 iterations to keep GPU happy)
    for (float i = 0.0; i < 6.0; i++) {
        // Symmetrical folding and scaling
        uv = abs(uv) - (0.2 + u_bass * 0.05);
        
        // Rotate each iteration to create the fractal curves
        uv *= rot(u_clock * 0.15 + i * 0.4);
        
        // Add curly organic distortion to the tendrils
        uv.x += sin(uv.y * 4.0 + u_clock) * 0.1;
        
        float d = length(uv);
        
        // Dynamic rainbow coloring
        vec3 col = palette(length(uv0) + i * 0.15 - u_clock * 0.2);
        
        // Create the glowing neon string effect (additive glow)
        float glowThickness = 0.01 + (u_bass * 0.02);
        d = glowThickness / d;
        
        // Attenuate glow toward the edges so it doesn't blow out completely
        finalColor += col * d * exp(-length(uv0) * 1.5);
    }
    
    // Apply high black point for extreme contrast
    finalColor = (finalColor - 0.15) / 0.85;
    finalColor = clamp(finalColor, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}