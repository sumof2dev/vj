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
    vec2 uv = vUv - 0.5; // Center UV
    uv.x *= u_resolution.x / u_resolution.y; // Aspect ratio correction

    // Apply DMX rotation to the coordinate space
    uv = rotate2d(u_dmxRot) * uv;

    // Scale the fractal based on u_bass and u_vol
    uv *= 2.0 - u_bass * 0.5; // Zoom out slightly with bass
    uv /= (1.0 + u_vol * 0.5); // Overall zoom factor

    // Julia set parameters, highly reactive
    vec2 c;
    c.x = -0.8 + sin(u_time * 0.1 + u_flux * 0.5) * 0.4 + u_high * 0.2;
    c.y = 0.15 + cos(u_time * 0.15 + u_flux * 0.7) * 0.3 - u_bass * 0.1;
    
    // Add some complexity to C with u_time
    c += vec2(sin(u_time * 0.3) * 0.05, cos(u_time * 0.2) * 0.05);

    vec2 z = uv;
    float iterations = 0.0;
    int MAX_ITERATIONS = 20 + int(u_vol * 15.0 + u_flux * 10.0); // Capped iterations for Pi 5 WebGL

    for (int i = 0; i < 45; i++) {
        if (i >= MAX_ITERATIONS) break;
        if (dot(z, z) > 4.0) { // Check for divergence
            break;
        }
        // Standard Julia iteration
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iterations += 1.0;
    }

    vec3 color = vec3(0.0);
    if (iterations < float(MAX_ITERATIONS)) {
        // Smooth coloring based on the number of iterations and the final magnitude of z
        // Using a log-log coloring technique for smoother bands
        float mag_z = dot(z, z);
        float nu = log(log(mag_z) / log(2.0)) / log(2.0); // Smooth iteration count
        iterations = iterations + 1.0 - nu;

        // Map iterations to hue, adjusted by time and high frequency
        float hue = mod(iterations * 0.08 + u_time * 0.05 + u_high * 0.1, 1.0);
        
        // Calculate saturation and value
        float sat = 1.0 - u_flux * 0.3; // Reduce saturation with flux
        float val = 0.5 + u_bass * 0.5 + u_vol * 0.3; // Increase value with bass/vol

        // Basic HSV to RGB approximation
        vec3 hsv_base;
        hsv_base.r = abs(hue * 6.0 - 3.0) - 1.0;
        hsv_base.g = 2.0 - abs(hue * 6.0 - 2.0);
        hsv_base.b = 2.0 - abs(hue * 6.0 - 4.0);
        hsv_base = clamp(hsv_base, 0.0, 1.0);
        color = ((hsv_base - 1.0) * sat + 1.0) * val;
        
        // Apply a psychedelic color shift using u_high
        vec3 psychedelic_mix = vec3(
            sin(iterations * 0.1 + u_time * 0.2) * 0.5 + 0.5,
            cos(iterations * 0.15 + u_time * 0.25) * 0.5 + 0.5,
            sin(iterations * 0.2 + u_time * 0.3) * 0.5 + 0.5
        );
        color = mix(color, psychedelic_mix, u_high * 0.7); // Blend with high frequency input

        // Boost brightness and contrast based on bass/vol
        color *= (1.0 + u_bass * 1.5 + u_vol * 1.0);
        color = pow(color, vec3(0.8 + u_bass * 0.5)); // Gamma correction for bass punch
    }

    // Apply high black point for extreme contrast
    color = (color - 0.2) / 0.8;
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}