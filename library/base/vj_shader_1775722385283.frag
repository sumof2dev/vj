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

    vec3 final_color = vec3(0.0);
    float t = u_clock * 0.05; // Base time for continuous tunnel movement

    // Start with a 3D point where x,y are screen coordinates and z represents depth in the tunnel
    vec3 p = vec3(uv, t * 10.0); // Z progresses over time to move through the tunnel

    // Apply overall rotation to the XY plane (screen plane)
    p.xy = rotate2d(u_dmxRot + t * 0.5) * p.xy;

    float acc_dist = 0.0; // Accumulator for "distance" or complexity in the fractal
    float wobble = u_bass * 0.2; // Wobble factor from bass
    
    // Fractal iterations to generate the tunnel structure
    for (int i = 0; i < 10; i++) {
        // Fold the XY plane to create repeating, kaleidoscope-like patterns on the tunnel walls
        p.xy = abs(p.xy) - 0.5; 
        
        // Wrap the Z component to create infinite tunnel segments
        p.z = fract(p.z) - 0.5;

        // Scale up to simulate zooming into the tunnel
        p = p * (2.0 + wobble * 0.5 + u_flux * 0.1); 
        
        // Rotate each fractal layer
        p.xy = rotate2d(t * 0.2 + float(i) * 0.1 + u_high * 0.1) * p.xy; 
        
        // Add a positional wobble based on Z, time, and bass/flux
        p += sin(t * 0.7 + p.z * 1.0 + float(i)) * (wobble + u_flux) * 0.1; 

        // Accumulate 'distance' from the origin, which will influence color
        acc_dist += length(p); 
    }

    // Map the accumulated distance and time to a color palette
    float color_mix_val = acc_dist * 0.05 - t * 0.1;

    vec3 c1 = palette(color_mix_val,
                      vec3(0.5, 0.5, 0.5),
                      vec3(0.5, 0.5, 0.5),
                      vec3(u_axis_a, u_axis_b, u_axis_c),
                      vec3(0.1, 0.2, 0.3));

    vec3 c2 = palette(color_mix_val + 0.5, // Second palette for richer colors
                      vec3(0.5, 0.5, 0.5),
                      vec3(0.5, 0.5, 0.5),
                      vec3(u_axis_d, u_axis_e, u_vol),
                      vec3(0.4, 0.3, 0.2));

    // Dynamically blend between the two palettes
    final_color = mix(c1, c2, smoothstep(0.4, 0.6, sin(color_mix_val * 2.0)));

    // Apply overall brightness and audio reactivity
    final_color *= u_intensity * 2.5 + u_high * 0.8;
    final_color += u_bass * 1.5; // Strong bass pulse for brightness

    // Add glow effects
    float center_vignette = smoothstep(0.0, 0.7, 1.0 - length(uv)); // Glow in the center
    final_color += center_vignette * u_intensity * 0.5;
    final_color += smoothstep(0.5, 1.0, acc_dist * 0.1) * u_flux * 0.7; // Flux-based glow

    // Apply an edge vignette to fade out the borders
    float vignette_amount = smoothstep(0.8, 1.0, length(uv));
    final_color *= (1.0 - vignette_amount * 0.8);

    // Apply high black point for extreme contrast (laser/LED friendly)
    final_color.rgb = (final_color.rgb - 0.2) / 0.8;
    final_color.rgb = clamp(final_color.rgb, 0.0, 1.0);

    gl_FragColor = vec4(final_color, 1.0);
}