precision highp float;

varying vec2 vUv;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_dmxRot;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 st = vUv - 0.5;
    st.x *= u_resolution.x / u_resolution.y;
    st = rotate2d(u_dmxRot) * st;

    // Initial position in 3D space, scaled by volume, moving in Z over time/flux
    vec3 p = vec3(st * (4.0 + u_vol * 3.0), u_time * 0.2 + u_flux * 0.5);

    float final_brightness = 0.0;
    
    // Parameters influenced by uniforms
    float scale_factor = 2.5 + u_flux * 2.0; // Controls the fractal's inherent scaling
    float bass_impact = 1.0 + u_bass * 3.0; // Bass increases brightness and core size
    float high_detail_level = 2.0 + u_high * 8.0; // High freq increases grid density and sharpness

    for (int i = 0; i < 6; i++) {
        // Core fractal transform: absolute folding, scaling, and translation
        p = abs(p);
        p = p * scale_factor - (scale_factor - 1.0); 

        // Add subtle warping/distortion based on high frequencies
        float wobble_strength = u_high * 0.15;
        p.x += sin(u_time * 0.5 + p.y * 0.1) * wobble_strength;
        p.y += cos(u_time * 0.6 + p.x * 0.1) * wobble_strength;
        p.z += sin(u_time * 0.7 + p.z * 0.1) * wobble_strength;

        // Voxel effect: Quantize coordinates to create a sharp grid-like structure
        // `high_detail_level` controls the fineness of the voxel grid
        vec3 snapped_p = floor(p * high_detail_level + 0.5) / high_detail_level;
        
        // Calculate distance from the snapped "voxel" center
        float d = length(p - snapped_p);
        
        // Accumulate brightness for the core of the voxels
        // `bass_impact` provides explosive brightness/size
        final_brightness += bass_impact * (0.05 / (d * d * d * 100.0 + 0.01)); 
        
        // Add a softer glow around the voxels, also influenced by `bass_impact`
        final_brightness += bass_impact * exp(-d * high_detail_level * 5.0);
        
        // General fractal density/glow based on overall distance from origin
        final_brightness += 0.05 / (length(p) * 2.0 + 0.1);
    }
    
    // Overall volume control for intensity
    final_brightness *= (0.5 + u_vol * 1.5);

    // Apply psychedelic coloring based on accumulated brightness and time
    vec3 color = vec3(
        sin(final_brightness * 0.5 + u_time * 0.3) * 0.5 + 0.5,
        sin(final_brightness * 0.5 + u_time * 0.4 + 2.0) * 0.5 + 0.5,
        sin(final_brightness * 0.5 + u_time * 0.5 + 4.0) * 0.5 + 0.5
    );

    // Increase contrast and scale color by the final brightness
    color = pow(color, vec3(1.5)); 
    color *= final_brightness * 0.5;

    gl_FragColor = vec4(color, 1.0);
}