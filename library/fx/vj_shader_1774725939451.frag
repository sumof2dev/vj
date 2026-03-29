precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_dmxRot;
uniform float u_axis_a; // Character density/size
uniform float u_axis_b; // Scroll speed multiplier
uniform float u_axis_c; // Trail length/fade
uniform float u_axis_d; // Symbol variation/flicker
uniform float u_axis_e; // Color shift

varying vec2 vUv;

// Helper function
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

// Hash function for pseudo-randomness
float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p = p * p + p;
    return fract(p);
}
float hash12(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    // Apply rotation to the entire coordinate space
    uv = rotate2d(u_dmxRot) * uv;

    // Scale for the grid effect (u_axis_a controls character density/size)
    float gridScale = mix(15.0, 50.0, u_axis_a); // From sparse to dense
    uv *= gridScale;

    // Scrolling effect
    float scrollSpeed = 0.5 + u_flux * 2.0 + u_axis_b * 2.0; // u_flux and u_axis_b control scroll speed
    float yOffset = u_time * scrollSpeed;

    vec2 iuv = floor(uv); // Integer cell coordinates
    vec2 fuv = fract(uv); // Fractional position within cell

    float brightness = 0.0;

    // Determine the active state of a column/cell (creates the "rain" effect)
    // A column can flicker on/off with time and flux influence
    float colActivationSeed = iuv.x * 0.1 + floor(u_time * 0.5 + u_flux * 0.5) * 100.0;
    float colActive = step(0.5 + sin(colActivationSeed * 5.0 + u_time * 0.1) * 0.4, hash11(colActivationSeed));
    
    // Add more fine-grained flicker based on time and u_axis_d
    colActive *= step(0.5, hash11(iuv.x * 123.456 + u_time * (0.5 + u_axis_d * 2.0)));


    if (colActive > 0.0) {
        // Vary fall patterns per column based on randomness and d-axis
        float colRandom = hash11(iuv.x * 7.123 + u_axis_d * 10.0);
        float fallPattern = fract(yOffset + iuv.x * colRandom * 0.5);
        
        // This creates the "falling character" effect (brighter at the head, fades down)
        float head = fract(fallPattern + colRandom * 5.0); // Random offset for trail start
        
        float trailLength = mix(0.1, 0.8, u_axis_c); // u_axis_c controls trail length (short to long)
        float fallingBrightness = smoothstep(0.0, trailLength * (1.0 + u_bass * 0.5), head) * // Bass makes trail thicker
                                  smoothstep(1.0, 1.0 - trailLength, head);
        
        // Character generation within the cell based on fuv and cell randomness
        float symbolSeed = hash12(iuv); // Randomness per cell
        symbolSeed += u_time * (0.1 + u_axis_d * 0.2); // u_axis_d for symbol variation over time
        symbolSeed = fract(symbolSeed);

        float charVal = 0.0;
        vec2 charCoord = fuv; // Normalized 0-1 within cell

        float patternType = floor(hash11(symbolSeed) * 5.0); // 5 different symbol types
        float thickness = mix(0.01, 0.05, u_bass * 0.5); // Bass makes symbols thicker

        if (patternType == 0.0) { // Dashed vertical line
            charVal = smoothstep(thickness, 0.0, abs(charCoord.x - 0.5));
            charVal *= step(0.2, fract(charCoord.y * 5.0 + u_time * 0.2 + symbolSeed));
        } else if (patternType == 1.0) { // Small square
            charVal = step(0.25, charCoord.x) * step(charCoord.x, 0.75) *
                      step(0.25, charCoord.y) * step(charCoord.y, 0.75);
            charVal *= fract(symbolSeed + u_time * 0.3) > (0.5 - u_axis_d * 0.4) ? 1.0 : 0.0; // Flickering with u_axis_d
        } else if (patternType == 2.0) { // Diagonal line
            charVal = smoothstep(thickness, 0.0, abs(charCoord.x - charCoord.y));
            charVal *= fract(symbolSeed * 2.0 + u_time * 0.2) > (0.3 - u_axis_d * 0.2) ? 1.0 : 0.0;
        } else if (patternType == 3.0) { // Grid dots
            charVal = smoothstep(thickness * 2.0, 0.0, length(mod(charCoord * 3.0, 1.0) - 0.5));
            charVal *= fract(symbolSeed * 3.0 + u_time * 0.4) > (0.6 - u_axis_d * 0.3) ? 1.0 : 0.0;
        } else { // Another square type
            charVal = smoothstep(thickness, 0.0, max(abs(charCoord.x - 0.5), abs(charCoord.y - 0.5)));
            charVal *= fract(symbolSeed * 4.0 + u_time * 0.1) > (0.4 - u_axis_d * 0.3) ? 1.0 : 0.0;
        }
        
        brightness = charVal * fallingBrightness;
        
        // Make the "head" of the trail brighter based on u_high and u_bass
        if (head < 0.05 + u_bass * 0.1) { // Head expands with bass, gets brighter
            brightness += (u_high * 1.5 + u_bass * 1.0);
        }

        brightness *= (1.0 + u_bass * 0.5); // Bass makes everything brighter
    }

    // Apply overall volume
    brightness *= (u_vol * 1.5); // Boost volume

    // Base color (green for matrix)
    vec3 color; 

    // Color shifting based on u_axis_e (cycles through primary and secondary colors)
    float hueShift = u_axis_e * 6.0; // Map 0-1 to 0-6 to cover 6 segments for a full color cycle
    vec3 c1, c2;
    if (hueShift < 1.0) { // Green to Cyan
        c1 = vec3(0.0, 1.0, 0.0); c2 = vec3(0.0, 1.0, 1.0);
    } else if (hueShift < 2.0) { // Cyan to Blue
        c1 = vec3(0.0, 1.0, 1.0); c2 = vec3(0.0, 0.0, 1.0);
    } else if (hueShift < 3.0) { // Blue to Magenta
        c1 = vec3(0.0, 0.0, 1.0); c2 = vec3(1.0, 0.0, 1.0);
    } else if (hueShift < 4.0) { // Magenta to Red
        c1 = vec3(1.0, 0.0, 1.0); c2 = vec3(1.0, 0.0, 0.0);
    } else if (hueShift < 5.0) { // Red to Yellow
        c1 = vec3(1.0, 0.0, 0.0); c2 = vec3(1.0, 1.0, 0.0);
    } else { // Yellow to Green
        c1 = vec3(1.0, 1.0, 0.0); c2 = vec3(0.0, 1.0, 0.0);
    }
    color = mix(c1, c2, fract(hueShift));

    color *= brightness;

    // Apply high black point for extreme contrast
    color.rgb = (color.rgb - 0.2) / 0.8;
    color.rgb = clamp(color.rgb, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}