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

// Function to create a glowing outline of a shape
float sdOutline(float dist, float radius, float thickness) {
    // 1.0 means fully opaque at radius, falling off to 0.0 over 'thickness'
    return 1.0 - smoothstep(0.0, thickness, abs(dist - radius));
}

void main() {
    vec2 uv = (vUv - 0.5) * u_resolution / min(u_resolution.x, u_resolution.y);

    // Apply overall DMX rotation
    uv = rotate2d(u_dmxRot) * uv;

    // Zonal transformations:
    // Apply additional rotation based on the quadrant
    vec2 zone_uv = uv;
    float zone_rot_intensity = 0.0;

    // Determine zone and apply specific rotation intensity
    // These rotations are based on the original uv *before* zonal rotation, to prevent discontinuities at zone boundaries.
    // The `zone_uv` is then computed using the current `uv` and the determined `zone_rot_intensity`.
    if (uv.x < 0.0 && uv.y < 0.0) { // Bottom-Left
        zone_rot_intensity = u_flux * 0.7 + u_time * 0.1;
    } else if (uv.x >= 0.0 && uv.y < 0.0) { // Bottom-Right
        zone_rot_intensity = u_bass * 0.5 + u_high * 0.3 + u_time * 0.15;
    } else if (uv.x < 0.0 && uv.y >= 0.0) { // Top-Left
        zone_rot_intensity = u_high * 1.0 + sin(u_time * 0.2) * u_flux * 0.5;
    } else { // Top-Right
        zone_rot_intensity = sin(u_time * 0.2) * u_bass * 0.8 + u_flux * 0.2;
    }
    zone_uv = rotate2d(zone_rot_intensity) * uv;

    // Grid scaling and cell identification
    // Scale the grid based on overall volume and bass for intensity
    vec2 p = zone_uv * (3.0 + u_vol * 3.0 + u_bass * 1.0); 
    vec2 id = floor(p); // Cell ID
    vec2 f = fract(p) - 0.5; // Fractional part for shape within cell (from -0.5 to 0.5)

    // Parameters for shapes
    float base_radius = 0.25 + u_bass * 0.1; // Base radius influenced by bass
    float thickness = 0.03 + u_flux * 0.02 + u_high * 0.01; // Thickness influenced by flux and high
    thickness = clamp(thickness, 0.01, 0.1); // Ensure thickness is within reasonable bounds

    // Calculate shape outlines
    float circle_outline = sdOutline(length(f), base_radius, thickness);
    float square_outline = sdOutline(max(abs(f.x), abs(f.y)), base_radius, thickness);

    // Combine shapes: alternate based on cell ID
    float pattern_value = 0.0;
    if (mod(id.x + id.y, 2.0) < 1.0) { // Alternating cells get different shapes
        pattern_value = circle_outline;
    } else {
        pattern_value = square_outline;
    }

    // Add pulsating inner details based on high frequency
    float pulse_factor = sin(u_time * 8.0 + (id.x + id.y) * 0.5) * 0.5 + 0.5; // Pulsating effect
    float inner_cross_thickness = 0.01 + u_bass * 0.005;
    float cross_x = smoothstep(inner_cross_thickness, 0.0, abs(f.x));
    float cross_y = smoothstep(inner_cross_thickness, 0.0, abs(f.y));
    float inner_cross = max(cross_x, cross_y);
    pattern_value = max(pattern_value, inner_cross * u_high * pulse_factor * 0.3); // Add as a highlight

    // Add a central dot for extra detail
    float central_dot_size = 0.02 + u_bass * 0.02;
    float central_dot = 1.0 - smoothstep(0.0, 0.005, length(f) - central_dot_size);
    pattern_value = max(pattern_value, central_dot * u_high * 0.2); // Add as a highlight


    // Coloring
    vec3 col = vec3(0.0);

    // Primary color shifts with time
    vec3 primary_color = vec3(
        sin(u_time * 0.2 + 0.0) * 0.5 + 0.5,
        sin(u_time * 0.2 + 2.0) * 0.5 + 0.5,
        sin(u_time * 0.2 + 4.0) * 0.5 + 0.5
    );
    // Secondary color for highlights, shifts at a different rate
    vec3 secondary_color = vec3(
        sin(u_time * 0.4 + 1.0) * 0.5 + 0.5,
        sin(u_time * 0.4 + 3.0) * 0.5 + 0.5,
        sin(u_time * 0.4 + 5.0) * 0.5 + 0.5
    );

    // Base color from primary_color, scaled by pattern value
    col = mix(vec3(0.0), primary_color, pattern_value);

    // Add glow based on flux, shifting towards green/yellow
    col += pattern_value * vec3(u_flux, u_flux * 0.5, u_flux * 0.2) * 0.5;

    // Add highlights based on high frequency, using secondary color
    col += pattern_value * secondary_color * u_high * 0.5;

    // Overall brightness controlled by u_vol
    col *= u_vol * 1.5;

    // Apply high black point for extreme contrast
    col = (col - 0.2) / 0.8; 
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, 1.0);
}