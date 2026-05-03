precision highp float;

// Uniforms provided by the user's existing code
uniform float u_hue;
uniform float u_invert;

// Standard uniforms from the VJ system
varying vec2 vUv;
uniform float u_time;
uniform float u_clock;      // audio-modulated integrated time for continuous smooth rotation
uniform float u_bass;       // 0.0 to 1.5, synchronized to bass impact
uniform float u_flux;       // 0.0 to 1.5, synchronized to overall energy flux
uniform float u_high;       // 0.0 to 1.5, synchronized to high-frequency / hi-hat energy
uniform float u_vol;        // 0.0 to 1.5, tied to overall volume
uniform vec2 u_resolution;
uniform sampler2D u_image;  // Unused in this shader, but available
uniform sampler2D u_image2; // Unused in this shader, but available
uniform float u_strobe;     // 0.0 or 1.0, flips at ~10Hz when strobe command active
uniform float u_blackout;   // 1.0 when blackout command active

vec3 palette( in float t ) {
    // Rainbow cosine palette
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.33, 0.67);
    return a + b * cos( 6.28318 * (c * t + d) );
}

void main() {
    // Center coordinates (-1.0 to 1.0)
    vec2 uv = (vUv - 0.5) * 2.0;

    // Polar coordinates for circular symmetry
    float radius = length(uv);
    float angle = atan(uv.y, uv.x);

    // --- ENHANCEMENT: Global Radial Wave/Pulse ---
    // Makes the entire pattern breathe, distorting rings radially, driven by overall volume and high-freq for complexity.
    float pulseMagnitude = u_vol * 0.06; // Intensify pulse with volume
    // Add intricate ripples using high frequencies
    float radialPulse = sin(radius * (10.0 + u_high * 7.0) - u_clock * 4.0);
    radius += radialPulse * pulseMagnitude;

    // High-frequency wavy distortion (creates the starburst points)
    // --- ENHANCEMENT: Dynamic Starburst Intensity & Twist ---
    // Starburst points become more prominent with high frequencies.
    float waveAmplitude = 0.1 + u_high * 0.12; 
    // Starburst points subtly twist and deform with overall energy flux.
    float wave = sin(angle * (20.0 + u_flux * 7.0) + u_clock * 0.5) * waveAmplitude;
    
    // Distort the radius using the wave
    float distortedRadius = radius + wave;

    // Create tight, high-frequency concentric rings expanding outward
    // --- ENHANCEMENT: Ring Pushing/Pulling ---
    // Rings visibly "kick" and expand faster with bass hits.
    float ringExpansionSpeed = u_clock * 3.0 + u_bass * 2.0; 
    float rings = sin(distortedRadius * 50.0 - ringExpansionSpeed);

    // Make the lines sharp. Bass thickens them.
    // --- ENHANCEMENT: Pulsating Line Thickness ---
    // Line thickness also pulsates with general energy flux, adding more life.
    float baseLineThickness = 0.85;
    float dynamicThicknessMod = u_bass * 0.2 + u_flux * 0.15; // Total dynamic thickness modulation
    float lineThickness = baseLineThickness - dynamicThicknessMod;
    
    // Use a small fixed range for smoothstep for consistent sharpness, regardless of lineThickness.
    rings = smoothstep(lineThickness, lineThickness + 0.1, rings);

    // Dynamic rainbow coloring based on radius and modulated time
    // --- ENHANCEMENT: Color Progression Modulation ---
    // Subtle color shifts and intensity based on overall energy flux.
    vec3 color = palette(radius * (1.0 + u_flux * 0.15) + u_clock * 0.2);

    color *= rings;
    
    // Apply high black point for extreme contrast
    color = (color - 0.1) / 0.9;
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);

    // Global FX Phase 1 (from original shader)
    if (u_invert > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, 1.0 - gl_FragColor.rgb, u_invert);
    if (u_hue > 0.0) {
        vec3 c_fx = gl_FragColor.rgb;
        const vec3 k_fx = vec3(0.57735); // A normalized vector (1/sqrt(3), 1/sqrt(3), 1/sqrt(3))
        float cosA_fx = cos(u_hue * 6.28318);
        gl_FragColor.rgb = c_fx * cosA_fx + cross(k_fx, c_fx) * sin(u_hue * 6.28318) + k_fx * dot(k_fx, c_fx) * (1.0 - cosA_fx);
    }
    
    // Global FX Phase 2 (from VJ system defaults)
    if (u_strobe > 0.5) {
        // A subtle, rapid flicker effect during strobe command
        gl_FragColor.rgb *= (0.7 + 0.3 * (sin(u_time * 100.0) * 0.5 + 0.5)); 
    }
    if (u_blackout > 0.5) {
        gl_FragColor.rgb = vec3(0.0); // Full blackout
    }
}