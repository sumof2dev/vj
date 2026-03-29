precision highp float;
varying vec2 vUv;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_dmxRot;
uniform float u_axis_a;
uniform float u_axis_b;
uniform float u_axis_c;
uniform float u_axis_d;
uniform float u_axis_e;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 uv = (vUv - 0.5) * u_resolution / u_resolution.y; // Centered, aspect ratio corrected

    // Apply flux-based distortion to UV
    uv.x += sin(uv.y * (10.0 + u_high * 5.0) + u_time * (0.5 + u_flux * 0.5)) * (0.05 + u_flux * 0.05);
    uv.y += cos(uv.x * (8.0 + u_high * 4.0) + u_time * (0.4 + u_flux * 0.4)) * (0.04 + u_flux * 0.04);
    
    // Rotate the base coordinate system
    uv = rotate2d(u_dmxRot) * uv; 

    float lineThickness = (0.005 + u_bass * 0.005);
    float edgeFade = fwidth(uv.x) * 2.0; // Adaptive edge fading for smooth lines

    // --- Main City Grid (Streets/Block Boundaries) ---
    vec2 cityUv = uv * (3.0 + u_vol * 3.0); // Scale with volume
    cityUv.x += u_time * (0.1 + u_flux * 0.2); // Animate movement
    cityUv.y += u_time * (0.05 + u_flux * 0.1);

    vec2 cityCell = fract(cityUv) - 0.5;
    float distToCityEdge = min(abs(cityCell.x), abs(cityCell.y));
    float intensity_grid = 1.0 - smoothstep(lineThickness, lineThickness + edgeFade, distToCityEdge); // 1 on lines, 0 elsewhere

    // --- Inner Building Details (Windows/Floors) ---
    vec2 cellID = floor(cityUv); // Unique ID for each city block
    vec2 innerOffset = sin(cellID * 10.0) * (0.05 + u_axis_e * 0.05); // Slight per-block offset for variety

    vec2 innerUv = (cityUv + innerOffset) * (2.0 + u_high * 1.0 + u_axis_d * 2.0); // Scale inner pattern more
    innerUv.y += u_time * (0.1 + u_flux * 0.1);

    vec2 innerCell = fract(innerUv) - 0.5;
    float distToInnerEdge = min(abs(innerCell.x), abs(innerCell.y));
    float intensity_inner = 1.0 - smoothstep(lineThickness * 0.5, lineThickness * 0.5 + edgeFade, distToInnerEdge); // 1 on inner lines, 0 elsewhere

    // Mask for inner lines: only draw them inside the city blocks, not on main grid lines.
    float innerMask = 1.0 - step(0.99, intensity_grid); // 1 inside blocks, 0 on main grid lines
    float finalPatternIntensity = max(intensity_grid, intensity_inner * innerMask);

    // --- Vertical Lines (for skyscraper effect) ---
    float vertLineFreq = 10.0 + u_high * 5.0;
    float vertLines = abs(fract(uv.x * vertLineFreq + u_time * u_vol * 0.1) - 0.5);
    vertLines = 1.0 - smoothstep(lineThickness * 0.3, lineThickness * 0.3 + edgeFade, vertLines);
    finalPatternIntensity = max(finalPatternIntensity, vertLines * (0.5 + u_axis_e * 0.5)); // Mix in vertical lines

    // --- Coloring ---
    vec3 finalColor = vec3(0.0);

    // Dynamic Hues using u_axis_a,b,c and time
    float hue1 = u_axis_a * 6.28 + u_time * 0.1;
    float hue2 = u_axis_b * 6.28 + u_time * 0.2;
    float hue3 = u_axis_c * 6.28 + u_time * 0.3;

    vec3 colA = vec3(0.5 + 0.5 * sin(hue1), 0.5 + 0.5 * sin(hue1 + 2.094), 0.5 + 0.5 * sin(hue1 + 4.188));
    vec3 colB = vec3(0.5 + 0.5 * sin(hue2), 0.5 + 0.5 * sin(hue2 + 2.094), 0.5 + 0.5 * sin(hue2 + 4.188));
    vec3 colC = vec3(0.5 + 0.5 * sin(hue3), 0.5 + 0.5 * sin(hue3 + 2.094), 0.5 + 0.5 * sin(hue3 + 4.188));

    // Blend colors across the screen
    vec3 blendedColor = mix(colA, colB, fract(uv.y * 3.0 + u_time * 0.1));
    blendedColor = mix(blendedColor, colC, fract(uv.x * 2.0 - u_time * 0.05));

    // Apply the pattern intensity to the blended color
    finalColor = blendedColor * finalPatternIntensity;

    // Add overall glow/brightness based on bass and volume
    finalColor *= (1.0 + u_bass * 2.0 + u_vol * 1.0);

    // --- High Black Point for Contrast ---
    finalColor.rgb = (finalColor.rgb - 0.2) / 0.8;
    finalColor.rgb = clamp(finalColor.rgb, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}