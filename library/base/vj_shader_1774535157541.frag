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
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y; // Aspect ratio correction

    vec3 finalColor = vec3(0.0);

    // Primary geometric space rotation, influenced by u_dmxRot and u_flux/time
    uv *= rotate2d(u_dmxRot + u_time * 0.05 * u_flux);

    // --- Shape 1: Radial Spikes / Starburst ---
    float angle = atan(uv.y, uv.x);
    float r = length(uv);

    float numSpikes = 3.0 + floor(u_flux * 10.0 + u_high * 5.0); // Flux and High affect complexity
    float spikePattern = abs(sin(angle * numSpikes + u_time * 0.1 * u_flux));
    // Bass makes spikes wider and brighter
    spikePattern = smoothstep(0.95, 1.0 - u_bass * 0.08, spikePattern);
    spikePattern *= smoothstep(0.0, 0.0 + u_bass * 0.1, r); // Fade in from center with bass
    spikePattern *= (1.0 - r * 1.5); // Fade out towards edge
    finalColor += vec3(0.1, 0.8, 0.9) * spikePattern * (0.8 + u_vol * 0.5); // Neon Cyan

    // --- Shape 2: Concentric Pulsing Rings ---
    float ringSpeed = 0.5 + u_flux * 0.5; // Flux affects ring speed
    float ringVal = abs(fract(r * (5.0 + u_high * 5.0) - u_time * ringSpeed) - 0.5);
    float ringThickness = 0.02 + u_bass * 0.05; // Bass affects ring thickness
    ringVal = smoothstep(ringThickness, ringThickness + 0.01, ringVal);
    ringVal = 1.0 - ringVal; // Invert to get bright rings
    finalColor += vec3(0.9, 0.2, 0.8) * ringVal * (0.7 + u_vol * 0.5); // Neon Pink

    // --- Shape 3: Rotating Square/Diamond Grid ---
    vec2 uv2 = uv;
    uv2 *= rotate2d(u_time * 0.2 + u_high * 1.0); // Independent rotation with high frequency
    uv2 = abs(uv2 * (4.0 + u_flux * 4.0) - vec2(0.5)); // Scale and mirror based on flux
    float squarePattern = max(uv2.x, uv2.y);
    float squareThickness = 0.05 + u_bass * 0.08; // Bass affects square line thickness
    squarePattern = smoothstep(squareThickness, squareThickness + 0.01, squarePattern);
    squarePattern = 1.0 - squarePattern; // Invert for bright lines
    finalColor += vec3(0.8, 0.9, 0.1) * squarePattern * (0.6 + u_vol * 0.5); // Neon Yellow-Green

    // --- Shape 4: Central Pulsing Burst ---
    float centerDist = length(uv);
    float bassBurstRadius = 0.1 + u_bass * 0.4; // Bass drives burst size
    float burstFalloff = 0.05 + u_vol * 0.05; // Volume affects sharpness of burst
    float centerBurst = smoothstep(bassBurstRadius, bassBurstRadius - burstFalloff, centerDist);
    finalColor += vec3(1.0, 0.5, 0.0) * centerBurst * (1.0 + u_bass * 1.0); // Vibrant Orange Burst

    // --- Final Adjustments ---
    // Overall intensity boost based on volume and bass
    finalColor *= (0.8 + u_vol * 0.7 + u_bass * 0.5);

    // Add a subtle flicker/glow effect, more active with u_high
    float glowFactor = 0.1 + u_high * 0.3;
    finalColor += finalColor * glowFactor * sin(u_time * 10.0 + length(uv) * 5.0);

    // Apply power curve for more contrast and 'neon glow' feel
    finalColor = pow(finalColor, vec3(1.0 + u_vol * 0.5));

    gl_FragColor = vec4(finalColor, 1.0);
}