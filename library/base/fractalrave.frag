precision highp float;
varying vec2 vUv;

// Helper function for 2D rotation
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_dmxRot;

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y; // Aspect correction

    // Apply primary DMX rotation to the entire coordinate space
    uv = rotate2d(u_dmxRot) * uv;

    // Dynamic Julia set constant, influenced by time and flux
    // This shifts and warps the fractal structure
    vec2 c_julia = vec2(
        sin(u_time * 0.5 + u_flux * 2.5) * 0.4,
        cos(u_time * 0.3 - u_flux * 1.8) * 0.4
    );
    
    // Bass influences the initial zoom or scale of the fractal
    // Explosive size/thickness
    uv *= (2.0 - u_bass * 1.5); // Zoom in/out effect
    uv += vec2(sin(u_time * 0.2) * 0.05, cos(u_time * 0.2) * 0.05) * u_bass; // Small shift based on bass

    vec2 z = uv; // Initial z for the Julia set iteration
    
    float iterations = 0.0;
    // High frequency values increase the number of iterations, adding detail
    float max_iterations = 10.0 + u_high * 15.0; // Range: 10 to 25 iterations
    float escape_radius_sq = 16.0; // Squared escape radius for efficiency

    // Fractal iteration loop
    for (int i = 0; i < int(max_iterations); ++i) {
        if (dot(z, z) > escape_radius_sq) {
            break;
        }

        // Standard Julia iteration: z = z*z + c_julia
        z = vec2(
            z.x * z.x - z.y * z.y,
            2.0 * z.x * z.y
        );
        z += c_julia; // Add the dynamic constant

        // Add subtle chaotic movement directly to z based on flux for extra "rave" feel
        z += vec2(cos(u_time * 1.5 + u_flux * 0.5), sin(u_time * 1.2 - u_flux * 0.7)) * 0.005 * u_flux;
        
        iterations += 1.0;
    }

    vec3 color = vec3(0.0);

    // Color calculation based on fractal escape condition
    if (dot(z, z) > escape_radius_sq) { // The point escaped (outside the set)
        // Calculate smooth iteration count for smoother color banding
        float smooth_iter = iterations + 1.0 - log(log(length(z))) / log(2.0);
        
        // Psychedelic color blending based on iteration count, time, and music parameters
        vec3 col1 = vec3(0.0, 0.3, 0.7); // Base blue
        vec3 col2 = vec3(0.8, 0.1, 0.5); // Magenta/Red
        vec3 col3 = vec3(1.0, 0.8, 0.0); // Yellow

        // Interpolate colors in a cycling manner
        color = mix(col1, col2, smoothstep(0.0, 0.5, sin(smooth_iter * 0.15 + u_time * 0.2)));
        color = mix(color, col3, smoothstep(0.0, 0.5, cos(smooth_iter * 0.1 + u_time * 0.3)));
        
        // Bass influences brightness/explosiveness
        color *= (0.7 + u_bass * 1.8);
        // Volume influences overall intensity
        color *= (0.5 + u_vol * 0.7); 
        
        // Add more color variation based on high frequencies and flux
        color += sin(smooth_iter * 0.2 + u_high * 2.0) * 0.1 * u_high;
        color += cos(smooth_iter * 0.3 + u_flux * 3.0) * 0.1 * u_flux;

    } else { // The point did not escape (inside the set)
        // Darker, pulsating core for inside the fractal set
        color = vec3(0.0, 0.01, 0.05) * (0.5 + sin(u_time * 5.0) * 0.5 * u_bass); // Pulsating dark core
    }
    
    // Clamp color values to ensure they are within [0, 1] before black point
    color = clamp(color, 0.0, 1.0);
    
    // Apply high black point for extreme contrast
    color.rgb = (color.rgb - 0.2) / 0.8;
    color.rgb = clamp(color.rgb, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}