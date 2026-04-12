precision highp float;

varying vec2 vUv;

uniform float u_time;
uniform float u_clock;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_flux;
uniform float u_vol;
uniform float u_intensity;
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
vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
    return a + b*cos( 6.28318*(c*t+d) ); // Cosine based color palette
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    // Rotate the entire space, with continuous motion from u_clock and user control from u_dmxRot
    uv = rotate2d(u_dmxRot + u_clock * 0.15 + u_axis_c * 2.0) * uv;

    // Global scaling influenced by audio intensity
    float global_scale = 1.0 + u_bass * 0.3 + u_vol * 0.2;
    uv /= global_scale;

    vec3 final_color = vec3(0.0);

    // --- Primary Tiled Pattern ---
    float tile_density = 4.0 + u_high * 3.0 + u_axis_a * 5.0; // More tiles with high frequency
    vec2 tiled_uv = fract(uv * tile_density + vec2(u_clock * 0.05));

    // Mirror the UVs within each tile to create symmetry and a kaleidoscope effect
    tiled_uv = abs(tiled_uv - 0.5);

    // Apply some distortion/turbulence controlled by u_flux and u_bass
    float dist_amount = sin(u_clock * 0.7 + uv.x * 5.0) * cos(u_clock * 0.4 + uv.y * 5.0);
    tiled_uv.x += dist_amount * (u_flux * 0.08 + u_bass * 0.05);
    tiled_uv.y += dist_amount * (u_flux * 0.08 + u_bass * 0.05);

    // SDF-like shapes within each mirrored tile to form intricate lines and dots
    float line_thickness = 0.01 + u_high * 0.008 + u_axis_b * 0.01;
    float glow_falloff = 0.005; // Fixed small falloff for crispness

    // Diagonal lines (X-Y and X+Y)
    float diag_line1 = smoothstep(line_thickness + glow_falloff, line_thickness, abs(tiled_uv.x - tiled_uv.y) * 0.8);
    float diag_line2 = smoothstep(line_thickness + glow_falloff, line_thickness, abs(tiled_uv.x + tiled_uv.y - 0.5) * 0.8);

    // Horizontal/Vertical lines, offset to create interesting intersections
    float hv_line1 = smoothstep(line_thickness + glow_falloff, line_thickness, abs(tiled_uv.x * 0.8 - 0.2));
    float hv_line2 = smoothstep(line_thickness + glow_falloff, line_thickness, abs(tiled_uv.y * 0.8 - 0.2));

    // Create a central circle/dot in each cell
    float circle_dist = length(tiled_uv);
    float circle_rad = 0.1 + u_bass * 0.05 + u_axis_d * 0.1;
    float central_circle = smoothstep(circle_rad + glow_falloff, circle_rad, circle_dist);

    // Combine all pattern elements using max to blend glowing lines
    float pattern_val = max(diag_line1, diag_line2);
    pattern_val = max(pattern_val, max(hv_line1, hv_line2));
    pattern_val = max(pattern_val, central_circle);

    // --- Secondary, larger-scale pattern overlay ---
    vec2 secondary_uv = uv * (2.0 + u_flux * 0.5); // Scale it up, affected by flux
    secondary_uv += u_clock * vec2(0.02, 0.01); // Continuous movement
    secondary_uv = rotate2d(u_clock * 0.05 + u_axis_e * 1.0) * secondary_uv; // Rotation
    
    // Use fract for infinite repetition, then mirror for abstract shapes
    secondary_uv = abs(fract(secondary_uv) - 0.5); 

    // Create abstract spots/shapes for the secondary layer
    float secondary_pattern_val = smoothstep(0.1 + u_flux * 0.05, 0.05, length(secondary_uv.xy - vec2(0.2, 0.2)));
    secondary_pattern_val += smoothstep(0.1 + u_flux * 0.05, 0.05, length(secondary_uv.xy - vec2(0.3, 0.7))); 
    secondary_pattern_val = clamp(secondary_pattern_val, 0.0, 1.0); // Ensure bounds

    // Color palette based on time and audio
    vec3 col1 = palette(u_clock * 0.1 + u_intensity * 0.2, vec3(0.5, 0.5, 0.5), vec3(0.5, 0.5, 0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));
    vec3 col2 = palette(u_clock * 0.15 + u_bass * 0.2, vec3(0.5, 0.5, 0.5), vec3(0.5, 0.5, 0.5), vec3(0.8, 0.7, 0.5), vec3(0.1, 0.5, 0.9));

    // Mix colors for the primary pattern based on location or another reactive element
    vec3 pattern_color = mix(col1, col2, smoothstep(0.0, 1.0, sin(uv.x * 2.0 + u_clock * 0.3) * 0.5 + 0.5));

    // Apply the primary pattern value to the color, creating glowing lines on a dark background
    final_color += pattern_color * pattern_val;

    // Enhance glow based on overall intensity and high-frequency audio
    float glow_boost = (u_intensity * 0.8 + u_high * 0.5 + u_flux * 0.6);
    final_color += pattern_color * glow_boost * 0.5 * pattern_val;

    // Add the secondary pattern as an overlay, mixed with different colors and scaled by overall volume
    final_color += mix(col2 * 0.5, col1 * 0.8, secondary_pattern_val) * (secondary_pattern_val * (u_vol * 0.5 + 0.5));

    // Saturate and clamp
    final_color = max(final_color, 0.0); // Ensure no negative colors
    final_color = min(final_color, 5.0); // Allow for some HDR-like glow before final clamping

    // Final contrast enhancement (high black point for extreme contrast)
    final_color.rgb = (final_color.rgb - 0.2) / 0.8;
    final_color.rgb = clamp(final_color.rgb, 0.0, 1.0);

    gl_FragColor = vec4(final_color, 1.0);
}