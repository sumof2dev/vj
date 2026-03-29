precision highp float;

varying vec2 vUv;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_flux;
uniform float u_vol;
uniform float u_high;
uniform float u_dmxRot;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 uv = (vUv - 0.5) * u_resolution / min(u_resolution.x, u_resolution.y); // Centered, aspect ratio corrected
    
    // Apply DMX rotation to the primary space
    uv = rotate2d(u_dmxRot) * uv;

    // Distort UV coordinates based on flux, time, and bass
    float distortionFactor = u_flux * 0.2 + u_vol * 0.1;
    vec2 distortedUv = uv;
    distortedUv.x += sin(uv.y * (10.0 + u_bass * 5.0) + u_time * 1.5) * distortionFactor;
    distortedUv.y += cos(uv.x * (10.0 + u_bass * 5.0) + u_time * 1.5) * distortionFactor;

    vec3 color = vec3(0.0);

    // Dynamic scale for the repeating pattern, influenced by bass and flux
    float patternScale = 5.0 + u_bass * 10.0 + u_flux * 5.0;

    // Calculate repeating cell coordinates
    vec2 p = fract(distortedUv * patternScale) - 0.5;
    
    // Thickness of the lines, reactive to bass
    float thickness = 0.02 + u_bass * 0.04; 
    
    // Create horizontal and vertical grid lines
    float lineX = smoothstep(thickness, thickness * 0.5, abs(p.x));
    float lineY = smoothstep(thickness, thickness * 0.5, abs(p.y));

    // Create diagonal grid lines
    float diag1 = smoothstep(thickness, thickness * 0.5, abs(p.x + p.y) * 0.707); // Normalize distance for diagonals
    float diag2 = smoothstep(thickness, thickness * 0.5, abs(p.x - p.y) * 0.707);

    // Combine all line patterns
    float gridPattern = max(max(lineX, lineY), max(diag1, diag2));

    // Add a central radiating ripple effect
    float r = length(uv); // Use original UV for the central effect
    float ripple = sin(r * (20.0 + u_high * 10.0) - u_time * (2.0 + u_flux * 2.0)) * 0.5 + 0.5;
    ripple = pow(ripple, 5.0); // Sharpen the ripple for high contrast
    
    // Combine grid and ripple, making ripple stronger with bass/volume
    float finalPattern = max(gridPattern, ripple * (0.5 + u_bass * 0.5 + u_vol * 0.5));

    // Dynamic color mixing based on time and audio
    vec3 colA = vec3(0.0, 0.5 + u_high * 0.5, 1.0); // Base color 1 (cyan/blue), influenced by high frequencies
    vec3 colB = vec3(1.0, 0.2 + u_flux * 0.3, 0.0); // Base color 2 (orange/red), influenced by flux
    float lerpFactor = sin(u_time * 1.5 + u_bass * 2.0) * 0.5 + 0.5;
    color = mix(colA, colB, lerpFactor) * finalPattern;

    // Apply high black point, reactive to u_bass for extreme contrast
    float blackPointThreshold = 0.2 + u_bass * 0.4; // Black point is higher when u_bass is high
    color.rgb = (color.rgb - blackPointThreshold) / (1.0 - blackPointThreshold);
    color.rgb = clamp(color.rgb, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}