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
    return a + b*cos( 6.28318*(c*t+d) );
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    // Apply overall rotation to the coordinate space using u_dmxRot
    uv = rotate2d(u_dmxRot) * uv;

    // Create a tiled space where each cell contains a Lissajous figure.
    // u_axis_e controls the base tiling frequency (zoom), u_vol and u_intensity add dynamic range.
    vec2 grid_scale = vec2(mix(3.0, 10.0, u_axis_e) + u_vol * 3.0);
    vec2 grid_uv = uv * grid_scale;

    // Get the integer ID of the cell and the fractional position within the cell.
    // cell_uv is centered from -0.5 to 0.5.
    vec2 grid_id = floor(grid_uv);
    vec2 cell_uv = fract(grid_uv) - 0.5;

    // Define frequencies for the Lissajous pattern within each cell.
    // u_axis_a, u_axis_b control the base frequencies, u_high and u_bass add audio-reactive elements.
    float freq_a = mix(2.0, 8.0, u_axis_a) + u_high * 4.0;
    float freq_b = mix(2.0, 8.0, u_axis_b) + u_bass * 4.0;

    // Define phases for the Lissajous pattern within each cell.
    // u_clock for continuous motion, u_flux for dynamic phase shifts.
    // u_axis_c, u_axis_d add base phase offsets or speeds, grid_id adds spatial variation.
    float phase_x = u_clock * (mix(0.5, 2.0, u_axis_c) + u_flux * 0.5) + grid_id.x * 0.7;
    float phase_y = u_clock * (mix(0.5, 2.0, u_axis_d) + u_flux * 0.5) + grid_id.y * 0.7;

    // Calculate the Lissajous point within the cell.
    // The amplitude of the Lissajous path is influenced by overall volume (u_vol).
    vec2 lissajous_point = vec2(
        sin(freq_a * phase_x) * (0.4 + u_vol * 0.1),
        cos(freq_b * phase_y) * (0.4 + u_vol * 0.1)
    );

    // Calculate the distance from the current pixel within the cell to the Lissajous point.
    float dist_to_liss = length(cell_uv - lissajous_point);

    // Create a base pattern (e.g., circles or dots) around the Lissajous point.
    // u_bass influences the size/thickness of this primary shape.
    float pattern = smoothstep(0.15 + u_vol * 0.05, 0.05 + u_bass * 0.05, dist_to_liss);

    // Add expanding rings from the Lissajous point for more detail and motion.
    // u_intensity and u_high influence ring density and speed.
    float ring_frequency = mix(10.0, 30.0, u_axis_c) + u_intensity * 10.0;
    float ring_motion = u_clock * (1.0 + u_flux * 0.5 + u_high * 0.5);
    float rings = fract(dist_to_liss * ring_frequency - ring_motion);
    rings = smoothstep(0.9, 1.0, rings); // Creates sharp, bright rings.

    pattern += rings * (0.5 + u_high * 0.5); // Add rings, high frequency audio makes them more prominent.

    // Secondary pattern: a glowing trail or "ghost" following the Lissajous path slightly delayed.
    // Using an offset time to create a series of points or a softer trail.
    float trail_offset_time = u_clock * (mix(0.5, 1.5, u_axis_a) + u_flux * 0.2) + u_time * 0.05;
    vec2 lissajous_trail_point = vec2(
        sin(freq_a * trail_offset_time - 0.5) * (0.4 + u_vol * 0.1),
        cos(freq_b * trail_offset_time - 0.5) * (0.4 + u_vol * 0.1)
    );

    float trail_dist = length(cell_uv - lissajous_trail_point);
    float trail_pattern = smoothstep(0.2 + u_bass * 0.1, 0.01, trail_dist); // Wider, softer trail.

    pattern = max(pattern, trail_pattern * (0.5 + u_intensity * 0.5)); // Overlay the trail, intensity enhances it.

    // Add a general background wave for overall subtle motion, modulated by audio.
    float background_wave = sin(uv.x * (5.0 + u_high * 2.0) + u_clock * 2.0 + u_flux * 1.0);
    background_wave += cos(uv.y * (5.0 + u_bass * 2.0) + u_clock * 2.5 + u_flux * 1.0);
    background_wave *= (0.1 + u_intensity * 0.1); // Make it subtle.

    pattern += background_wave;
    pattern = clamp(pattern, 0.0, 1.0);

    // Coloring using the provided palette function.
    // Color scheme shifts based on u_clock, u_flux, and audio frequency bands.
    vec3 col = palette(pattern + u_clock * 0.05 + u_flux * 0.1,
                       vec3(0.5, 0.5, 0.5),                      // Base color offset
                       vec3(0.5, 0.5, 0.5),                      // Amplitude for color modulation
                       vec3(1.0, 1.0, 1.0) * (0.5 + u_intensity * 0.5), // Frequency multiplier for color
                       vec3(0.0, 0.1, 0.2) + vec3(u_flux, u_bass, u_high) * 0.2); // Phase offset for color.

    // Apply overall brightness based on pattern and intensity.
    col *= pattern * (1.0 + u_intensity * 2.0 + u_flux * 1.0);

    // Apply high black point for extreme contrast (laser/LED pop).
    col = (col - 0.2) / 0.8;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, 1.0);
}