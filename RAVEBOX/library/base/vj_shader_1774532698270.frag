#define PI 3.14159265359

precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_dmxRot;

varying vec2 vUv;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 uv = (vUv * 2.0 - 1.0) * u_resolution / min(u_resolution.x, u_resolution.y);
    uv = rotate2d(u_dmxRot) * uv;

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    // Dynamic Kaleidoscope folding based on flux
    // Determines the number of symmetry segments (e.g., 6 for hexagonal, 8 for octagonal)
    float num_segments = floor(4.0 + u_flux * 8.0); // From 4 to 12 segments
    num_segments = max(num_segments, 4.0); // Ensure a minimum of 4 segments
    
    float angle_period = 2.0 * PI / num_segments;
    a = mod(a, angle_period); // Fold the angle into a single segment
    a = abs(a - angle_period * 0.5); // Mirror within that segment

    // Distort the folded angle and radius based on time, bass, and flux
    float warped_a = a * (1.0 + sin(u_time * 0.7 + r * 8.0) * 0.15 * u_flux);
    float warped_r = r * (1.0 + u_bass * 0.7 + sin(u_time * 0.3 + a * 5.0) * 0.08 * u_flux);

    // --- Pattern Layers ---
    vec3 col = vec3(0.0);

    // Layer 1: Main mandala structure with high-contrast details
    float mandala_pattern = 0.0;
    mandala_pattern += sin(warped_r * (15.0 + u_high * 10.0) - u_time * 0.8 + warped_a * 5.0);
    mandala_pattern += cos(warped_a * (10.0 + u_flux * 5.0) + warped_r * (20.0 + u_high * 5.0) + u_time * 0.5);
    mandala_pattern = fract(mandala_pattern * 0.5 + 0.5); // Normalize to 0-1 range
    mandala_pattern = pow(mandala_pattern, 2.0 + u_high * 2.0); // Sharpen with u_high
    mandala_pattern *= (1.0 - pow(r, 1.5)); // Fade out from the center

    // Dynamic color for the main pattern, shifting with time and affected by u_high
    vec3 color_a = vec3(0.2, 0.8, 1.0); // Cyan-blue base
    vec3 color_b = vec3(1.0, 0.4, 0.8); // Pink-magenta accent
    vec3 current_color = mix(color_a, color_b, sin(u_time * 0.1) * 0.5 + 0.5);
    current_color = mix(current_color, vec3(0.8, 1.0, 0.4), u_high * 0.5); // Add green-yellow with u_high
    col += current_color * mandala_pattern * (0.8 + u_bass * 1.5) * u_vol;

    // Layer 2: Sharp, pulsing concentric rings
    float rings = sin(warped_r * (30.0 + u_flux * 15.0) - u_time * 1.2);
    rings = smoothstep(0.9, 1.0, abs(rings)); // Create sharp lines/rings
    rings *= (0.5 + u_bass * 0.5); // Intensity pulses with bass
    col += vec3(1.0, 0.6, 0.0) * rings * (0.5 + u_vol * 0.5); // Orange rings

    // Layer 3: Subtle angular details that react to flux
    float angle_detail = sin(warped_a * (30.0 + u_high * 20.0) + u_time * 0.9 + warped_r * 5.0);
    angle_detail = smoothstep(0.9, 1.0, abs(angle_detail));
    col += vec3(0.5, 1.0, 0.7) * angle_detail * (0.2 + u_flux * 0.8) * u_vol; // Green-ish angular details

    // Overall brightness and edge fade
    col *= (0.8 + u_vol * 0.7); // Adjust overall brightness, boosts with volume
    col *= (1.0 - pow(r, 2.5) * 0.6); // Gentle fade towards the screen edges

    // Add a strong white flash effect on high bass input
    col += vec3(1.0, 1.0, 1.0) * pow(u_bass, 4.0) * 3.0;

    gl_FragColor = vec4(col, 1.0);
}