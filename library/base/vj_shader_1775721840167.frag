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

    // Apply primary rotation from DMX
    uv = rotate2d(u_dmxRot * 6.28318) * uv;

    // Tentacle parameters
    float numTentacles = 6.0; // Base number of tentacles
    float angleStep = 6.28318 / numTentacles;

    // Radial symmetry / Kaleidoscope effect
    float a = atan(uv.y, uv.x);
    float r = length(uv);

    // Apply base rotation for animated motion
    a += u_clock * (0.1 + u_axis_a * 0.05);

    // Kaleidoscope effect by mirroring angles
    // This creates the radial symmetry for the "tentacles"
    a = fract(a / angleStep) * angleStep;
    a -= angleStep * 0.5; // Center the segment
    a = abs(a); // Mirror

    // Convert back to cartesian for further processing
    vec2 p = vec2(cos(a) * r, sin(a) * r);

    // Fractal iteration for inward growing effect
    float d = 0.0; // Accumulated distance or density
    float scaleFactor = 1.6 + u_flux * 0.5 + u_high * 0.2; // Scale factor for fractal iteration
    float offsetSpeed = u_clock * (0.5 + u_axis_a * 0.5); // Offset for inward growth simulation

    for (int i = 0; i < 7; i++) { // Max 7 iterations for performance
        p = rotate2d(u_clock * 0.3 + float(i) * 0.1 + u_axis_b * 1.5) * p; // Rotate each layer
        p.x = abs(p.x); // Mirror X for more intricate patterns

        // Inward growth by scaling and translating
        // The translation shifts the origin of the next iteration,
        // simulating movement towards the center of the fractal.
        p = p * scaleFactor - vec2(0.5, 0.0);
        
        // Dynamic offsets driven by time and initial radial distance 'r'
        // This adds organic wavy movement to the tentacles.
        p.x += sin(offsetSpeed + r * (u_axis_c * 2.0 + 1.0)) * (0.1 + u_vol * 0.05);
        p.y += cos(offsetSpeed + r * (u_axis_d * 2.0 + 1.0)) * (0.1 + u_vol * 0.05);

        // Calculate a distance metric for the current iteration
        // This creates lines/shapes that are thickened
        float currentDist = length(p.xy) - (0.1 + u_bass * 0.05); // Radius for a 'tentacle' segment

        // Accumulate distance using smoothstep for blending
        d += smoothstep(0.0, 0.05, currentDist);
    }

    // Enhance contrast and add banding with fract()
    d *= (1.0 + u_intensity * 0.5); // Overall brightness/intensity
    d = fract(d * (2.0 + u_high * 0.8)); // Create stripes/banding for more detail

    // Base color palette
    vec3 col = palette(d * 0.5 + u_clock * 0.1,
                       vec3(0.5, 0.5, 0.5),
                       vec3(0.5, 0.5, 0.5),
                       vec3(1.0, 0.7, 0.0) + u_flux * 0.2, // Yellow/Orange base, reacts to flux
                       vec3(0.0, 0.1, 0.2 + u_axis_e * 0.2)); // Phase offset

    // Add glowing secondary color, reacting to bass and intensity
    col += palette(d * 0.3 + u_clock * 0.2 + u_bass * 0.1,
                   vec3(0.5, 0.5, 0.5),
                   vec3(0.5, 0.5, 0.5),
                   vec3(0.8, 0.9, 1.0) + u_bass * 0.5 + u_intensity * 0.3, // Brighter blues/whites
                   vec3(0.0, 0.3, 0.6));

    // Exponential falloff for glow effect, making non-tentacle areas very dark
    col *= d * d * d * 8.0;

    // Apply overall volume and intensity
    col *= u_vol * (1.0 + u_intensity * 0.5);

    // FINAL CONTRAST RULE: APPLY HIGH BLACK POINT
    col = (col - 0.2) / 0.8;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, 1.0);
}