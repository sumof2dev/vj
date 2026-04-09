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

    // Apply global rotation to the coordinate space
    float globalRot = u_dmxRot * 6.28318 + u_clock * 0.07 * u_vol;
    uv = rotate2d(globalRot) * uv;

    // Zoom level and initial distortion based on audio
    float zoom = 2.0 + u_intensity * 1.5 + u_axis_a * 1.0;
    uv *= zoom;

    // Define Lissajous-like frequencies and phases, modulated by audio and axis controls
    float freqX = 3.0 + u_high * 7.0 + u_axis_b * 5.0;
    float freqY = 2.0 + u_bass * 7.0 + u_axis_c * 5.0;
    
    float phaseX = u_clock * (0.8 + u_flux * 0.5) + u_axis_d * 2.0;
    float phaseY = u_clock * (0.7 + u_flux * 0.5) + u_axis_e * 2.0;

    // Apply Lissajous-like distortions to the UV coordinates
    // These create the characteristic interwoven and curved patterns
    vec2 p = uv;
    p.x += sin(p.y * freqX * 0.5 + phaseX * 0.7) * (0.2 + u_intensity * 0.1);
    p.y += cos(p.x * freqY * 0.5 + phaseY * 0.7) * (0.2 + u_intensity * 0.1);

    // Add another layer of distortion for complexity and responsiveness
    p.x += sin(p.y * (freqX * 0.7 + u_vol * 2.0) + phaseX * 1.1) * (0.1 + u_flux * 0.07);
    p.y += cos(p.x * (freqY * 0.8 + u_vol * 2.0) + phaseY * 1.3) * (0.1 + u_flux * 0.07);

    // Create complex repeating patterns using fract() and abs() for sharp lines
    float pattern1 = fract(p.x * freqX * 0.2 + phaseX * 0.1);
    float pattern2 = fract(p.y * freqY * 0.2 + phaseY * 0.1);

    // Shift patterns based on u_clock for continuous forward motion
    pattern1 = fract(pattern1 + u_clock * 0.05 * u_high);
    pattern2 = fract(pattern2 + u_clock * 0.06 * u_bass);

    // Combine patterns to form the main Lissajous-like structure
    float finalPattern = abs(pattern1 - 0.5) * 2.0;
    finalPattern += abs(pattern2 - 0.5) * 2.0;
    finalPattern *= 0.5; // Normalize the combined value

    // Create glowing lines with adjustable thickness based on audio
    float thickness = 0.03 + u_bass * 0.02 + u_flux * 0.01;
    float line = smoothstep(thickness, thickness * 0.5, finalPattern);

    // Introduce a secondary, more energetic interference pattern
    float secondaryWave = sin(uv.x * (freqX + u_high * 10.0) * 0.5 + phaseX * 1.5) * 0.5;
    secondaryWave += cos(uv.y * (freqY + u_bass * 10.0) * 0.5 + phaseY * 1.5) * 0.5;
    secondaryWave = fract(secondaryWave + u_clock * 0.03 * u_vol);
    secondaryWave = abs(secondaryWave - 0.5) * 2.0;
    secondaryWave = smoothstep(thickness * 1.5, thickness * 0.7, secondaryWave);

    // Blend the primary and secondary patterns, with blend amount modulated by intensity
    float final_effect = mix(line, secondaryWave, 0.4 + u_intensity * 0.3);

    // Apply a vibrant color palette, shifting with time and audio
    vec3 color = palette(
        final_effect + u_clock * 0.05 + u_vol * 0.1, // Time and volume shift color
        vec3(0.5, 0.5, 0.5),                      // Base color (a)
        vec3(0.5, 0.5, 0.5),                      // Amplitude (b)
        vec3(u_high * 0.5 + 1.0, u_bass * 0.5 + 0.8, u_flux * 0.5 + 0.6), // Frequency (c) modulated by audio
        vec3(0.0, 0.33, 0.67)                     // Phase (d)
    );
    
    // Enhance brightness and glow based on overall volume and intensity
    color *= (u_intensity * 2.0 + u_vol * 1.0 + 0.5);

    // Apply high black point for extreme contrast, making bright parts pop
    color.rgb = (color.rgb - 0.2) / 0.8;
    color.rgb = clamp(color.rgb, 0.0, 1.0);
    
    // Add a subtle central glow, amplified by intensity and volume
    float center_dist = length(vUv - 0.5);
    float glow = smoothstep(0.4, 0.0, center_dist) * (u_intensity * 1.5 + u_vol * 0.5);
    color.rgb += color.rgb * glow * 0.5; // Additively blend glow
    color.rgb = clamp(color.rgb, 0.0, 1.0); // Ensure color stays within valid range

    gl_FragColor = vec4(color, 1.0);
}