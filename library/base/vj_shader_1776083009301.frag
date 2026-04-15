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

    uv = rotate2d(u_dmxRot) * uv;

    float zoom = 3.0 + u_vol * 1.0 + u_flux * 1.5;
    vec2 uv_zoom = uv * zoom;

    // Grid for alternating patterns
    vec2 id_grid = floor(uv_zoom);
    vec2 p_grid = fract(uv_zoom) - 0.5;

    // Main pattern type selector (alternating grid cells for diagonal pattern)
    float pattern_toggle = mod(id_grid.x + id_grid.y, 2.0); // 0 or 1

    vec3 final_pixel_color = vec3(0.0);

    // Define base colors using the palette helper
    vec3 orange_color = palette(u_clock * 0.05 + u_intensity * 0.1, vec3(0.8, 0.4, 0.0), vec3(0.5, 0.5, 0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.1, 0.2));
    vec3 magenta_color = palette(u_clock * 0.05 + u_intensity * 0.1, vec3(0.8, 0.0, 0.4), vec3(0.5, 0.5, 0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.1, 0.2));
    vec3 black_color = vec3(0.0);

    float base_line_thickness = 0.05 + u_bass * 0.03;
    base_line_thickness = clamp(base_line_thickness, 0.02, 0.1);

    // --- Pattern A: Diamonds ---
    vec3 diamond_pattern = black_color;
    vec2 d_uv_cell = p_grid;
    d_uv_cell = abs(d_uv_cell); // Quadrant symmetry for diamond shape

    float d1 = d_uv_cell.x + d_uv_cell.y; // Basic diamond SDF

    // Jagged detail for diamond edges
    float d_jagged_noise_freq = 100.0 + u_vol * 10.0;
    float d_jagged_noise = sin(d_uv_cell.x * d_jagged_noise_freq + d_uv_cell.y * d_jagged_noise_freq + u_clock * 15.0) * (0.01 + u_high * 0.005);

    // Outer diamond (orange)
    float d_outer_val = 0.4 - u_flux * 0.1 - u_axis_a * 0.1;
    float d_outer = smoothstep(base_line_thickness + d_jagged_noise, base_line_thickness * 0.5 + d_jagged_noise, abs(d1 - d_outer_val));
    diamond_pattern = mix(diamond_pattern, orange_color, d_outer);

    // Inner diamond (magenta)
    float d_inner_val = 0.2 - u_flux * 0.1 - u_axis_b * 0.1;
    float d_inner = smoothstep(base_line_thickness + d_jagged_noise, base_line_thickness * 0.5 + d_jagged_noise, abs(d1 - d_inner_val));
    diamond_pattern = mix(diamond_pattern, magenta_color, d_inner);

    // --- Pattern B: Swirls (S-curves) ---
    vec3 swirl_pattern = black_color;
    vec2 s_uv_cell = p_grid;

    // Apply specific reflections to create the S-curve tiling
    s_uv_cell.x *= mix(1.0, -1.0, mod(id_grid.y, 2.0)); // Reflect x based on row ID
    s_uv_cell.y *= mix(1.0, -1.0, mod(id_grid.x, 2.0)); // Reflect y based on column ID

    // Create a strong S-bend curve by warping the y-coordinate with a cubic function of x
    float bend_amount = 0.3 + u_flux * 0.2 + u_axis_c * 0.3;
    float curve_y_offset = (s_uv_cell.x * s_uv_cell.x * s_uv_cell.x) * bend_amount;
    float curve_y_offset2 = (s_uv_cell.x * s_uv_cell.x * s_uv_cell.x) * (bend_amount + 0.15 + u_axis_d * 0.1);

    // Lines for the swirl pattern
    float swirl_line_dist_1 = abs(s_uv_cell.y - curve_y_offset - u_clock * 0.1);
    float swirl_line_dist_2 = abs(s_uv_cell.y - curve_y_offset2 - u_clock * 0.1);

    // Jagged detail for swirl edges
    float jagged_swirl_base = 0.01 + u_high * 0.005;
    float jagged_swirl_noise_freq = 120.0 + u_vol * 20.0;
    float jagged_swirl_noise = sin(s_uv_cell.x * jagged_swirl_noise_freq + s_uv_cell.y * jagged_swirl_noise_freq + u_clock * 20.0) * jagged_swirl_base;

    float s_thickness = 0.05 + u_bass * 0.03;
    s_thickness = clamp(s_thickness, 0.02, 0.1);

    // Draw first swirl line (orange)
    float s_curve_draw1 = smoothstep(s_thickness + jagged_swirl_noise, s_thickness * 0.5 + jagged_swirl_noise, swirl_line_dist_1);
    swirl_pattern = mix(swirl_pattern, orange_color, s_curve_draw1);

    // Draw second swirl line (magenta)
    float s_curve_draw2 = smoothstep(s_thickness + jagged_swirl_noise, s_thickness * 0.5 + jagged_swirl_noise, swirl_line_dist_2);
    swirl_pattern = mix(swirl_pattern, magenta_color, s_curve_draw2);

    // Mix the two patterns based on the grid toggle
    final_pixel_color = mix(swirl_pattern, diamond_pattern, pattern_toggle);

    // Apply high black point for extreme contrast
    final_pixel_color = (final_pixel_color - 0.2) / 0.8;
    final_pixel_color = clamp(final_pixel_color, 0.0, 1.0);

    // Add a subtle glow/bloom based on overall intensity
    float glow = u_intensity * 0.5 + u_bass * 0.3;
    final_pixel_color += final_pixel_color * glow * 0.5;

    gl_FragColor = vec4(final_pixel_color, 1.0);
}