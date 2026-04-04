precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_clock;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_flux;

vec3 palette( in float t ) {
    // Rainbow cosine palette
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.33, 0.67);
    return a + b * cos( 6.28318 * (c * t + d) );
}

void main() {
    // Center coordinates (-1.0 to 1.0)
    vec2 uv = (vUv - 0.5) * 2.0;

    // Polar coordinates for circular symmetry
    float radius = length(uv);
    float angle = atan(uv.y, uv.x);

    // High-frequency wavy distortion (creates the starburst points)
    float wave = sin(angle * 20.0 + u_clock * 0.5) * 0.1;
    
    // Distort the radius using the wave
    float distortedRadius = radius + wave;

    // Create tight, high-frequency concentric rings expanding outward
    float rings = sin(distortedRadius * 50.0 - u_clock * 3.0);

    // Make the lines sharp. Bass thickens them.
    float lineThickness = 0.85 - (u_bass * 0.2);
    rings = smoothstep(lineThickness, 0.95, rings);

    // Dynamic rainbow coloring based on radius and modulated time
    vec3 color = palette(radius + u_clock * 0.2);

    color *= rings;
    
    // Apply high black point for extreme contrast
    color = (color - 0.1) / 0.9;
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}