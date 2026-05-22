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

#define PI 3.14159265359

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    // Base rotation and zoom
    float zoom = 1.0 + u_axis_b * 3.0 + u_vol * 0.5;
    uv *= zoom;
    uv = rotate2d(u_dmxRot - u_time * 0.05 * (u_flux + 0.1)) * uv;

    // Kaleidoscope effect
    float numSlices = floor(3.0 + u_axis_a * 10.0);
    float angle = atan(uv.y, uv.x);
    float r = length(uv);

    float sliceAngle = 2.0 * PI / numSlices;
    angle = mod(angle, sliceAngle);
    angle = abs(angle - sliceAngle * 0.5);

    vec2 p = vec2(cos(angle), sin(angle)) * r;

    // Pattern generation in the folded space
    vec3 col = vec3(0.0);
    
    // Add time-based translation to the pattern space
    p.x += u_time * 0.1 * (1.0 + u_flux);
    p.y -= u_time * 0.08;
    
    // Pattern 1: Wavy lines
    float line_pattern = sin(p.x * 12.0 + cos(p.y * 18.0 + u_time * 1.5) * 2.5);
    line_pattern = 1.0 - abs(line_pattern);
    float line_thickness = 0.8 + u_bass * 0.18;
    float line_brightness = smoothstep(line_thickness, 1.0, line_pattern);
    
    // Pattern 2: Concentric rings reacting to bass
    float ring_pattern = sin(length(p) * 30.0 - u_time * 4.0);
    float ring_thickness = 0.6 - u_bass * 0.5;
    ring_pattern = smoothstep(ring_thickness, 1.0, ring_pattern);
    
    // Combine patterns
    float final_pattern = max(line_brightness, ring_pattern);

    // Color based on radius and time
    float hue = fract(r * 0.3 - u_time * 0.1 + u_axis_c);
    vec3 color = hsv2rgb(vec3(hue, 1.0 - u_axis_d * 0.9, final_pattern));
    
    // Additive feedback-like glow from center based on high frequencies
    float glow = 1.0 - r * (1.8 - u_high * 1.5);
    color *= smoothstep(0.0, 0.6, glow);
    
    // Apply high black point for extreme contrast
    color = (color - 0.2) / 0.8;
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}