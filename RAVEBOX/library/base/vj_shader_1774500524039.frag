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
    vec2 st = (vUv - 0.5) * 2.0;
    st.x *= u_resolution.x / u_resolution.y;

    // Apply global rotation from DMX and time-based drift
    st *= rotate2d(u_dmxRot + u_time * 0.2);

    vec3 finalColor = vec3(0.0);
    vec2 p = st;

    // Iterative fractal folding pattern
    for (float i = 0.0; i < 3.0; i++) {
        p = abs(p) - (0.2 + u_bass * 0.4);
        p *= rotate2d(u_time * 0.3 + u_flux + i);
        
        float d = length(p);
        
        // Create high-contrast glowing geometric lines
        float speed = u_time * (2.0 + i);
        float line = abs(sin(d * 10.0 - speed)) / 20.0;
        float brightness = (0.005 + (u_bass * 0.02)) / line;
        
        // Dynamic color palette shifting with highs and bass
        vec3 color = vec3(
            0.5 + 0.5 * sin(u_time + i * 1.2 + u_high),
            0.2 + 0.8 * cos(u_time + i * 0.8 + u_bass),
            0.8 + 0.2 * sin(u_time + i * 1.5)
        );
        
        finalColor += color * brightness;
    }

    // Add a center pulse based on bass
    float centerDist = length(st);
    float glow = exp(-centerDist * (4.0 - u_bass * 2.0)) * u_bass;
    finalColor += vec3(1.0, 0.4, 0.2) * glow * 1.5;

    // Sharpen and amplify
    finalColor *= u_vol;
    finalColor = pow(finalColor, vec3(1.2));

    gl_FragColor = vec4(finalColor, 1.0);
}