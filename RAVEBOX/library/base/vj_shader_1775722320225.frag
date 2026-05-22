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

    // Apply main rotation controlled by DMX and clock
    uv = rotate2d(u_dmxRot * 0.5 + u_clock * 0.05 + u_axis_a * 0.2) * uv;

    vec3 finalColor = vec3(0.0);
    float d = 0.0; // Accumulator for "depth" or "density"

    // Base position for the fractal tunnel effect
    vec2 p = uv * (2.0 + u_bass * 0.2); // Bass makes the tunnel wider/more encompassing

    float speed = u_clock * (0.3 + u_flux * 0.5); // Speed of tunnel progression
    float distortAmount = u_high * 0.2; // Highs add distortion/complexity

    const int ITERATIONS = 8;
    for (int i = 0; i < ITERATIONS; i++) {
        // Fractal transformation: Scale and fold/mirror (kaleidoscope effect)
        p.x = abs(p.x);
        p.y = abs(p.y);

        // Recursive scaling and offset for tunnel progression
        // u_intensity drives the overall expansion/growth of the fractal
        p = p * (2.0 + u_intensity * 0.5) - vec2(1.0 + u_axis_b * 0.5);

        // Introduce rotation for spiral effect within the tunnel
        p = rotate2d(speed * 0.05 + float(i) * 0.1 + u_axis_c * 0.2) * p;

        // Add some subtle distortion based on audio
        p += sin(p * 5.0 + u_clock * 0.5 + float(i)) * distortAmount * 0.1;

        // Accumulate a value based on distance to origin in the fractal space
        // This creates a sense of depth and luminosity, points closer to center accumulate less
        d += length(p) * (0.1 + u_flux * 0.05);
    }

    // Secondary layer for more detail and pulsing glow
    vec2 uv2 = (vUv - 0.5) * 2.0;
    uv2.x *= u_resolution.x / u_resolution.y;
    uv2 = rotate2d(u_dmxRot * 0.8 + u_clock * 0.1 + u_axis_d * 0.3) * uv2;
    float r = length(uv2);
    float angle = atan(uv2.y, uv2.x);

    // Add some pulsing to the rings/patterns
    float ringPattern = sin(angle * (5.0 + u_high * 2.0) + r * (10.0 + u_bass * 5.0) - u_clock * (1.0 + u_flux * 0.5)) * 0.5 + 0.5;

    // Combine fractal 'd' with ring pattern for a richer visual
    float glow = fract(d * (0.1 + u_flux * 0.2) + speed * 0.5) * 0.5 + 0.5; // Fractal pattern
    glow = mix(glow, ringPattern, 0.4 + u_vol * 0.2); // Mix in the ring pattern, more with u_vol

    // Add some sharp, reactive lines using fract for infinite repetition
    float lines = fract(d * 0.5 + speed * 0.3 + u_axis_d * 0.5) * 2.0;
    lines = abs(lines - 1.0); // Create thin lines
    glow += lines * (0.5 + u_intensity); // Add lines, more intense with u_intensity

    // Color based on the accumulated 'glow' using a reactive palette
    finalColor = palette(
        glow * (0.5 + u_intensity * 0.3) + u_clock * 0.05,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(0.5 + u_bass, 0.5 + u_flux, 0.5 + u_high), // Color influenced by audio
        vec3(u_axis_e * 0.5, 0.2, 0.1) // Axis_e shifts the color palette phases
    );

    // Further intensity scaling for overall brightness
    finalColor *= (0.5 + glow * 2.0 + u_vol * 1.5);
    finalColor *= (u_intensity * 1.5 + 0.5); // Overall brightness controlled by intensity

    // Apply high black point for extreme contrast
    finalColor.rgb = (finalColor.rgb - 0.2) / 0.8;
    finalColor.rgb = clamp(finalColor.rgb, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}