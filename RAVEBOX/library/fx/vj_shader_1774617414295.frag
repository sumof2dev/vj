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
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    // Apply primary rotation from DMX and time
    uv = rotate2d(u_dmxRot + u_time * 0.05) * uv;

    // --- Kaleidoscope effect ---
    // Dynamic zoom based on flux and bass
    float k_zoom = 3.0 + u_flux * 5.0 + u_bass * 2.0;
    uv *= k_zoom;

    // Tiling and initial mirroring
    uv = fract(uv); // Creates a tiled pattern from 0 to 1
    uv -= 0.5;       // Centers each tile to -0.5 to 0.5
    uv = abs(uv);    // Mirrors tiles across X and Y axes

    // Further internal rotation within the folded space
    float internal_rot_speed = u_time * 0.1 + u_high * 0.5;
    uv = rotate2d(internal_rot_speed) * uv;

    // Radial folding for classic kaleidoscope segments
    float angle = atan(uv.y, uv.x);
    float radius = length(uv);

    // Number of kaleidoscope segments (controlled by flux)
    float segments = 6.0 + floor(u_flux * 6.0); // 6, 12, 18 segments
    angle = mod(angle, 2.0 * 3.14159 / segments); // Fold the angle into a single segment
    angle = abs(angle - 3.14159 / segments);      // Mirror the segment

    uv = vec2(cos(angle), sin(angle)) * radius; // Reconstruct uv with folded angle

    // --- Shape generation ---
    // Create a pulsating, expanding geometric shape (e.g., a star-like ring)
    float d = length(uv);
    float pulse = sin(u_time * 2.0 + u_flux * 5.0) * 0.1 + 0.9;
    pulse *= (1.0 + u_bass * 0.5); // Bass makes the pulse more pronounced

    float thickness = 0.05 + u_bass * 0.05; // Bass makes lines thicker
    float feather = 0.01;

    // Add some star-like points using a small perturbation to the distance
    float star_freq = 12.0;
    float star_amp = 0.05 * u_high * u_vol;
    d += sin(angle * star_freq + u_time * 3.0) * star_amp;

    // Create a central glowing shape
    float central_glow = smoothstep(0.0, 0.05, 0.1 - d); // Small central glow

    // Create a ring shape
    float target_radius = 0.3 + pulse * 0.1;
    float ring_outline = smoothstep(thickness + feather, thickness, abs(d - target_radius));

    float shape_intensity = ring_outline;

    // --- Coloring ---
    vec3 col = vec3(0.0);

    // Dynamic color shifting
    vec3 color_primary = vec3(0.0, 0.5, 1.0); // Blue
    vec3 color_secondary = vec3(1.0, 0.2, 0.0); // Orange
    vec3 color_tertiary = vec3(0.0, 1.0, 0.2); // Green

    float t_col = sin(u_time * 0.5 + u_high * 2.0) * 0.5 + 0.5;
    vec3 current_color = mix(color_primary, color_secondary, t_col);
    current_color = mix(current_color, color_tertiary, sin(u_time * 0.3 + u_vol) * 0.5 + 0.5);

    // Apply color to the shape
    col += current_color * shape_intensity * (0.8 + u_vol * 1.2);

    // Add glowing effect, especially with bass
    col += current_color * central_glow * (0.5 + u_bass * 1.5);

    // Secondary high-frequency color accents
    float detail_glow = (1.0 - smoothstep(0.0, 0.2, d)) * u_high * 0.8;
    col += vec3(0.8, 0.1, 1.0) * detail_glow; // Purple glow

    // Overall brightness adjustment
    col *= (0.5 + u_vol * 1.5);

    // --- High black point for contrast ---
    col = (col - 0.2) / 0.8;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, 1.0);
}