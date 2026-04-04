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
    vec2 uv = (vUv - 0.5) * u_resolution / min(u_resolution.x, u_resolution.y); // Center and aspect correct coordinates
    
    uv = rotate2d(u_dmxRot) * uv; // Apply global DMX rotation

    float d = 0.0; // Accumulator for fractal iteration 'distance'
    float scaleFactor = 2.0 + u_flux * 0.7; // Base scale influenced by flux, causes patterns to "grow" or "zoom"
    int num_iterations = 6 + int(u_bass * 7.0); // More iterations with bass for increased complexity and "growth"

    // Animate the base offset for the fractal folding pattern
    // This creates a pulsing, breathing effect of the fractal geometry
    vec2 fractalOffset = vec2(sin(u_time * 0.25 + u_flux * 0.1), cos(u_time * 0.3 + u_flux * 0.15)) * (0.2 + u_vol * 0.3);
    
    for (int i = 0; i < 15; i++) {
        if (i >= num_iterations) break;
        // Core fractal folding operation: absolute value, scale, and offset
        uv = abs(uv) * scaleFactor - (1.0 + u_high * 0.2) + fractalOffset; 
        
        // Add dynamic rotation within the fractal itself, making it swirl
        uv = rotate2d(u_time * 0.15 + u_flux * 0.4 + float(i) * 0.07) * uv;
        
        d += length(uv); // Accumulate magnitude for color mapping
    }
    
    // --- Color Calculation ---
    vec3 finalColor = vec3(0.0); // Start with black for additive blending
    
    // Map the accumulated 'd' value to psychedelic, high-contrast colors using sin waves
    float color_d = d * 0.1 + u_time * 0.5; // Scale and animate the 'd' value
    
    // RGB components offset by different phases for vibrant, cycling colors
    float r = sin(color_d + 0.0) * 0.5 + 0.5;
    float g = sin(color_d + 2.0) * 0.5 + 0.5; 
    float b = sin(color_d + 4.0) * 0.5 + 0.5; 
    
    finalColor = vec3(r, g, b);
    
    // Boost overall brightness and saturation based on bass and volume
    float intensity = 0.8 + u_bass * 2.5 + u_vol * 1.5; // Explosive brightness/presence from bass/volume
    intensity *= (1.0 + u_high * 0.7); // High-freq adds sharpness and vibrancy to the pattern
    
    finalColor *= intensity;
    
    // Add a glowing core/central bloom effect to enhance the "growing" feel
    // The length of 'uv' indicates distance from the center after transformations.
    // Smaller length means closer to the "heart" of the fractal.
    float glowFactor = 1.0 - smoothstep(0.0, 0.5 + u_bass * 0.4, length(uv)); // Glow stronger towards center, expands with bass
    glowFactor = pow(glowFactor, 2.0) * (u_bass * 1.5 + u_vol * 0.7); // Sharper falloff, scaled by bass/vol for intensity
    
    // Add a distinct color to the central glow, e.g., purple/magenta
    finalColor += vec3(glowFactor * 0.7, glowFactor * 0.2, glowFactor * 1.0); 
    
    gl_FragColor = vec4(finalColor, 1.0);
}