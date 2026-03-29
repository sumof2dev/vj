precision highp float;

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

varying vec2 vUv;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 uv = (gl_FragCoord.xy / u_resolution.xy) - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    // Apply primary rotation from DMX
    uv = rotate2d(u_dmxRot) * uv;

    // --- Warping and Distortion controlled by flux and bass ---
    vec2 warped_uv = uv;
    float warp_strength = 0.05 + u_bass * 0.15; // Bass influences intensity of warp
    float warp_speed = 0.5 + u_flux * 1.0; // Flux influences speed of warp

    warped_uv.x += sin(uv.y * (10.0 + u_axis_a * 5.0) + u_time * warp_speed) * warp_strength;
    warped_uv.y += cos(uv.x * (10.0 + u_axis_b * 5.0) + u_time * warp_speed * 0.7) * warp_strength;

    // --- Primary Geometric Pattern (Grid-like) ---
    float grid_density = 10.0 + u_axis_c * 15.0; // Axis_c controls grid density
    vec2 grid_coord = warped_uv * grid_density;

    float s = sin(u_time * 0.1 + u_flux * 0.3); // Time and flux create subtle movement
    float c = cos(u_time * 0.1 + u_flux * 0.3);

    float x_pattern = abs(sin(grid_coord.x + s));
    float y_pattern = abs(cos(grid_coord.y + c));

    // Bass controls line thickness for an "explosive" effect
    float line_thickness = 0.05 + u_bass * 0.1;
    float line_feather = 0.01; // Soften edges slightly

    float grid_effect = smoothstep(line_thickness, line_thickness + line_feather, x_pattern) +
                        smoothstep(line_thickness, line_thickness + line_feather, y_pattern);
    grid_effect = clamp(grid_effect, 0.0, 1.0);

    // --- Secondary Radial Pattern (Pulsing Rings) ---
    float r = length(uv);
    float angle = atan(uv.y, uv.x);

    float radial_density = 15.0 + u_axis_d * 20.0; // Axis_d controls radial density
    float radial_speed = 1.0 + u_flux * 0.8; // Flux influences radial speed

    float radial_wave = sin(r * radial_density - u_time * radial_speed + angle * 3.0 + u_high * 5.0);
    radial_wave = abs(radial_wave); // Create sharp bands
    float radial_effect = smoothstep(0.1 + u_bass * 0.1, 0.2 + u_bass * 0.15, radial_wave); // Bass affects ring thickness

    // --- Coloring and Combination ---
    vec3 final_color = vec3(0.0);

    // Base color for the grid, amplified by bass
    final_color += vec3(0.2, 0.6, 1.0) * grid_effect * (1.0 + u_bass * 1.5);

    // Secondary color for radial pattern, amplified by high frequencies
    final_color += vec3(0.8, 0.1, 0.6) * radial_effect * (0.5 + u_high * 1.0);

    // Tertiary abstract layer for added complexity
    float complex_layer = sin(uv.x * 20.0 + u_time * 0.5) * cos(uv.y * 20.0 - u_time * 0.7);
    complex_layer = abs(complex_layer) * (0.1 + u_axis_e * 0.3); // Axis_e controls its strength
    final_color += vec3(1.0, 0.8, 0.2) * complex_layer * (0.5 + u_flux * 0.5);

    // Overall brightness controlled by u_vol and slightly by u_flux
    final_color *= u_vol * (1.0 + u_flux * 0.5);

    // Ensure colors are within 0-1 range before black point
    final_color = clamp(final_color, 0.0, 1.0);

    // --- Apply High Black Point for extreme contrast ---
    final_color = (final_color - 0.2) / 0.8;
    final_color = clamp(final_color, 0.0, 1.0);

    gl_FragColor = vec4(final_color, 1.0);
}