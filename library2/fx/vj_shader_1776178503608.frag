precision highp float;
varying vec2 vUv;

uniform float u_time;
uniform float u_clock; // audio-modulated integrated time for continuous smooth rotation
uniform float u_bass; // 0.0 to 1.5, synchronized to bass impact
uniform float u_flux; // 0.0 to 1.5, synchronized to overall energy flux
uniform float u_vol;  // 0.0 to 1.5, tied to overall volume
uniform sampler2D u_image; // Not used in this generative effect
uniform sampler2D u_image2; // Not used

void main() {
    vec2 uv = vUv;
    vec3 color;

    // --- Dynamic Parameters for the fractal-like pattern ---
    // Speed of animation, influenced by overall volume
    float speed = 0.2 + u_vol * 0.15;
    // Complexity/density of the pattern, influenced by energy flux
    float complexity = 3.0 + u_flux * 2.0;
    // Strength of the UV warping, subtly driven by bass and overall energy
    float warble_strength = 0.05 + u_bass * 0.03 + u_flux * 0.02;

    // --- Fractal-like UV Perturbation (Domain Warping) ---
    // This technique creates complex, organic shapes without expensive loops.
    // We perturb the UV coordinates, then perturb them again based on the *new* coordinates.

    // First layer of perturbation: low frequency, broad movements
    vec2 p1 = uv * complexity;
    vec2 offset1 = vec2(sin(p1.x * 3.0 + u_time * speed * 0.5),
                        cos(p1.y * 3.0 + u_time * speed * 0.6));
    offset1 *= warble_strength;

    // Second layer of perturbation: higher frequency, finer details
    // Applied to the already perturbed UVs for a cascading, fractal-like effect
    vec2 p2 = (uv + offset1) * complexity * 1.5; // Increase frequency for more detail
    vec2 offset2 = vec2(sin(p2.y * 4.0 + u_time * speed * 0.7),
                        cos(p2.x * 4.0 + u_time * speed * 0.8));
    offset2 *= warble_strength * 0.5; // Make the second offset slightly weaker

    // Final warped UV coordinates combine both layers
    vec2 final_uv = uv + offset1 + offset2;

    // --- Color Generation from Warped UVs (The "Color Shift") ---
    // We use the `fract` function extensively to create repeating, sharp color bands.
    // Different phase shifts for R, G, B channels create the characteristic "color shift" rainbow look.
    // u_clock ensures smooth, continuous rotation regardless of frame drops.
    float rotation_speed = u_clock * 0.1;

    // Red channel pattern
    float r = fract(final_uv.x * (5.0 + u_flux * 2.0) + rotation_speed);
    r += fract(final_uv.y * (4.0 + u_flux * 1.5) - rotation_speed * 0.5);
    r = fract(r * (1.0 + u_bass * 0.5)); // Bass adds sharpness/intensity to the bands

    // Green channel pattern (phase-shifted from red)
    float g = fract(final_uv.x * (5.0 + u_flux * 2.0) + rotation_speed + 0.333);
    g += fract(final_uv.y * (4.0 + u_flux * 1.5) - rotation_speed * 0.5 + 0.666);
    g = fract(g * (1.0 + u_bass * 0.5));

    // Blue channel pattern (phase-shifted from green)
    float b = fract(final_uv.x * (5.0 + u_flux * 2.0) + rotation_speed + 0.666);
    b += fract(final_uv.y * (4.0 + u_flux * 1.5) - rotation_speed * 0.5 + 0.333);
    b = fract(b * (1.0 + u_bass * 0.5));

    color = vec3(r, g, b);

    // --- Post-processing for Vibrancy and Audio Reaction ---
    // Enhance contrast and brightness, influenced by overall volume
    color = pow(color, vec3(1.5 + u_vol * 0.5));
    // Clamp values to ensure they stay within the 0-1 range
    color = clamp(color, 0.0, 1.0);

    // Apply a subtle global color tint based on energy flux for dynamic mood
    color = mix(color, color * vec3(0.9, 1.1, 1.2), u_flux * 0.3);

    // Output the final vibrant color
    gl_FragColor = vec4(color, 1.0);
}