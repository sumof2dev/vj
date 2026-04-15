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
    // 1. Coordinate Setup
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    // Apply global rotation with a slow continuous drift
    uv = rotate2d(u_dmxRot + u_clock * 0.05) * uv;

    // 2. Polar Conversion & Tunnel Math
    float r = length(uv);
    float a = atan(uv.y, uv.x);

    // Using inverse radius for a classic tunnel perspective. Scale factor adjusts ring size.
    float tunnel_dist = 0.7 / r;

    // 3. Geometry Generation
    // Define the number of segmented tubes around the tunnel, controlled by a dial.
    float num_tubes = floor(mix(4.0, 24.0, u_axis_a));

    // Modulate the tunnel distance by angle to create the "columns" or "tubes".
    // This creates the wavy, organic structure and makes them appear to overlap.
    float tube_offset = sin(a * num_tubes) * 0.5;

    // Combine distance, animation, and tube offset into a single coordinate for depth.
    float ring_coord = tunnel_dist - u_clock * 3.0 + tube_offset;

    // 4. Shading & Shape
    // First, create the ring profile along the tunnel's depth.
    // sin(fract * PI) gives a nice 0 -> 1 -> 0 curve for a rounded shape.
    float ring_profile = sin(fract(ring_coord) * 3.14159);
    
    // Sharpen the profile for a more defined look, making rings "fatter" on bass hits.
    float ring_power = mix(3.0, 0.8, smoothstep(0.0, 1.0, u_bass));
    ring_profile = pow(ring_profile, ring_power);

    // Second, create shading across the tube's cross-section for a 3D feel.
    // Adding the ring coordinate makes the shading ripple down the tubes.
    float tube_shade = sin(a * num_tubes + floor(ring_coord) * 0.5) * 0.5 + 0.5;
    // Sharpen the cross-section highlight.
    tube_shade = pow(tube_shade, 2.5);

    // Combine the two shading components to get the final brightness.
    float brightness = ring_profile * tube_shade;
    
    // Add an inner glow that reacts to energy changes (flux).
    brightness += pow(max(0.0, 1.0 - r), 1.5) * 0.2 * u_flux;

    // 5. Coloring
    // The color is determined by which tube we're on and which ring segment.
    float ring_id = floor(ring_coord * 0.5); // Slower color change along depth.
    float angle_color_freq = mix(1.0, 10.0, u_axis_b);
    float color_t = a / 6.28318 * angle_color_freq + ring_id * 0.1 - u_clock * 0.1;

    // Define the color palette (vibrant, psychedelic rainbow).
    vec3 col_a = vec3(0.5, 0.5, 0.5);
    vec3 col_b = vec3(0.5, 0.5, 0.5);
    vec3 col_c = vec3(1.0, 1.0, 1.0);
    vec3 col_d = vec3(0.0, 0.33, 0.67);
    vec3 color = palette(color_t, col_a, col_b, col_c, col_d);

    // 6. Final Composition
    vec3 final_color = color * brightness;

    // Apply high contrast rule to make colors pop and blacks deep.
    final_color = (final_color - 0.2) / 0.8;
    final_color = clamp(final_color, 0.0, 1.0);
    
    // Fade the very center to black to prevent a single bright pixel artifact.
    final_color *= smoothstep(0.0, 0.05, r);
    
    gl_FragColor = vec4(final_color, 1.0);
}