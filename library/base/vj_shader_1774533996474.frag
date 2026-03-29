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
    
    // Initial space rotation from DMX control
    st = rotate2d(u_dmxRot) * st;

    // Initial position in 3D space, scaled by volume, moving in Z over time/flux
    // Reduced initial scale of st to prevent immediate divergence and allow more detail
    vec3 p = vec3(st * (1.5 + u_vol * 1.0), u_time * 0.2 + u_flux * 0.5);

    float final_brightness = 0.0;
    
    // Parameters influenced by uniforms
    float scale_factor = 2.0 + u_flux * 1.0;
    float bass_impact = 0.5 + u_bass * 2.0;
    float high_detail_level = 3.0 + u_high * 7.0;
    float rotation_speed = u_time * 0.1 + u_flux * 0.5;

    for (int i = 0; i < 7; i++) {
        // Core fractal transform: absolute folding and scaling
        p = abs(p);
        p -= 0.5; // Offset to center around 0 for the scaling
        p = p * scale_factor;
        
        // Add subtle fractal shift based on time and flux
        p += sin(u_time * 0.3 + float(i)) * u_flux * 0.1; 
        
        // Clamp 'p' values to prevent them from growing too large or small,
        // which helps maintain detail and prevent complete divergence/convergence.
        // Bounds adjusted slightly to allow more fractal growth.
        p = clamp(p, -4.0, 4.0); 

        // Add subtle warping/distortion based on high frequencies
        float wobble_strength = u_high * 0.1 + u_flux * 0.03; 
        p.x += sin(u_time * 0.7 + p.y * 0.2 + float(i) * 0.5) * wobble_strength;
        p.y += cos(u_time * 0.8 + p.x * 0.2 + float(i) * 0.5) * wobble_strength;
        p.z += sin(u_time * 0.9 + p.z * 0.2 + float(i) * 0.5) * wobble_strength;

        // Apply slight rotation in the loop to make the structure tumble
        p.xy = rotate2d(rotation_speed * 0.1 * float(i)) * p.xy;
        p.yz = rotate2d(rotation_speed * 0.08 * float(i)) * p.yz;
        
        // Voxel effect: Quantize coordinates to create a sharp grid-like structure
        vec3 snapped_p = floor(p * high_detail_level + 0.5) / high_detail_level;
        
        // Calculate distance from the snapped "voxel" center
        float d = length(p - snapped_p);
        
        // Accumulate brightness for the core of the voxels
        // Changed d*d*d to d*d for smoother, more visible lines and adjusted constants.
        final_brightness += bass_impact * (0.2 / (d * d * 20.0 + 0.01)); 
        
        // Add a softer glow around the voxels, also influenced by `bass_impact`
        final_brightness += bass_impact * exp(-d * high_detail_level * 5.0); 
        
        // General fractal density/glow based on overall distance from origin
        // Increased base brightness contribution slightly
        final_brightness += (0.05 + u_high * 0.02) / (length(p) * (1.0 + u_vol * 0.5) + 0.1); 
    }
    
    // Overall volume control for intensity
    final_brightness *= (0.5 + u_vol * 1.5);

    // Apply psychedelic coloring based on accumulated brightness and time
    vec3 color = vec3(
        sin(final_brightness * 0.7 + u_time * 0.3) * 0.5 + 0.5,
        sin(final_brightness * 0.7 + u_time * 0.4 + 2.0) * 0.5 + 0.5,
        sin(final_brightness * 0.7 + u_time * 0.5 + 4.0) * 0.5 + 0.5
    );

    // Increase contrast and scale color by the final brightness
    color = pow(color, vec3(1.5 + u_high * 0.3)); 
    color *= final_brightness * (0.5 + u_bass * 0.15); 

    // Add a subtle bloom or glow effect, especially from bass
    color += vec3(u_bass * 0.15); 

    gl_FragColor = vec4(color, 1.0);
}