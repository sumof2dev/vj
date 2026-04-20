precision highp float;
uniform float u_hue;
uniform float u_invert;

varying vec2 vUv;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_flux;
uniform float u_vol;
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

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

    uv = rotate2d(u_dmxRot) * uv;

    float gridScale = mix(5.0, 25.0, u_axis_a); // u_axis_a controls grid density
    vec2 gridUV = uv * gridScale;

    // Add some dynamic distortion based on u_flux and u_axis_d
    gridUV.x += sin(gridUV.y * 0.5 + u_time * u_flux * 0.1) * 0.5 * u_axis_d;
    gridUV.y += cos(gridUV.x * 0.5 - u_time * u_flux * 0.1) * 0.5 * u_axis_d;

    vec2 cellID = floor(gridUV);
    vec2 cellUV = fract(gridUV) - 0.5; // Centered coordinates within each cell (-0.5 to 0.5)

    // Make circles slide up and down, alternating each row
    float slideSpeed = 2.0; // Controls the speed of the slide
    // Amplitude of slide, modulated by u_flux for audio reactivity
    // The maximum shift is 0.2 (20% of cell height), controlled by u_flux
    float slideAmplitude = u_flux * 0.2; 
    
    // Determine direction for alternating rows (-1 for even rows, 1 for odd rows)
    float slideDirection = mod(cellID.y, 2.0) * 2.0 - 1.0; 

    // Calculate vertical offset for the circle's center
    float yOffset = sin(u_time * slideSpeed + cellID.y * 0.5) * slideAmplitude * slideDirection;
    cellUV.y += yOffset; // Apply the offset to the cell's local Y coordinate

    float dist = length(cellUV);

    float circleRadius = mix(0.3, 0.48, u_bass); // u_bass affects circle size
    float circleEdge = mix(0.005, 0.04, u_axis_b); // u_axis_b affects circle edge sharpness

    float circle = smoothstep(circleRadius + circleEdge, circleRadius - circleEdge, dist);

    // Alternating color pattern based on cell ID
    float checker = mod(cellID.x + cellID.y, 2.0);

    vec3 color1 = vec3(0.0);
    vec3 color2 = vec3(0.0);

    // Psychedelic colors animated by u_time, u_axis_c, and u_axis_e
    color1 = 0.5 + 0.5 * cos(u_time * 0.5 + cellID.x * 0.2 + u_axis_c + u_axis_e * 2.0 + vec3(0.0, 2.0, 4.0));
    color2 = 0.5 + 0.5 * cos(u_time * 0.5 + cellID.y * 0.2 - u_axis_c - u_axis_e * 2.0 + vec3(4.0, 0.0, 2.0));

    // Modulate color intensity/saturation with u_vol and u_high
    color1 = mix(color1, vec3(1.0), u_vol * 0.5 + u_high * 0.2);
    color2 = mix(color2, vec3(1.0), u_high * 0.5 + u_vol * 0.2);
    
    vec3 finalColor = mix(color1, color2, checker);

    // Make circles brighter with bass
    finalColor *= (0.5 + u_bass * 1.5); 

    vec4 fragColor = vec4(finalColor * circle, 1.0);

    // Apply high black point for extreme contrast
    fragColor.rgb = (fragColor.rgb - 0.2) / 0.8;
    fragColor.rgb = clamp(fragColor.rgb, 0.0, 1.0);

    gl_FragColor = fragColor;

    // Global FX Phase 1
    if (u_invert > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, 1.0 - gl_FragColor.rgb, u_invert);
    if (u_hue > 0.0) {
        vec3 c_fx = gl_FragColor.rgb;
        const vec3 k_fx = vec3(0.57735);
        float cosA_fx = cos(u_hue * 6.28318);
        gl_FragColor.rgb = c_fx * cosA_fx + cross(k_fx, c_fx) * sin(u_hue * 6.28318) + k_fx * dot(k_fx, c_fx) * (1.0 - cosA_fx);
    }
}