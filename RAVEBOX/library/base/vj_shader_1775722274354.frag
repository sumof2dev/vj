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

// Hash function for pseudo-randomness
float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p = fract(p * p);
    return fract(p);
}

// SDF for a box
float sdBox( vec3 p, vec3 b ) {
    vec3 q = abs(p) - b;
    return length(max(vec3(0.0),q)) + min(0.0,max(q.x,max(q.y,q.z)));
}

// Maze map function
float map(vec3 p, float cellSize, float wallThickness, float timeOffset, float dmxAxisE) {
    vec3 gp = p / cellSize; // Grid position
    vec3 ci = floor(gp);   // Integer cell coordinates
    vec3 cf = fract(gp);   // Fractional cell coordinates (0 to 1)

    // Maze blocks (pillars/obstacles)
    float cellHash = hash11(dot(ci, vec3(1.0, 100.0, 10000.0)) + timeOffset);
    
    // Create a central block if `cellHash` is low
    // u_vol reduces block density, u_intensity adds to it
    float blockThreshold = 0.6 - u_vol * 0.2 + u_intensity * 0.1;
    float isBlockCell = step(blockThreshold, cellHash);

    // Block dimensions are affected by u_high
    vec3 blockDims = vec3(0.5 - wallThickness * 2.0);
    float mazeBlockSDF = mix(1e5, sdBox(cf - 0.5, blockDims * (0.8 + u_high * 0.1)), isBlockCell);

    // Grid lines for the voxel effect
    // Thickness of grid lines is affected by u_flux
    float gridLineThickness = wallThickness * (0.5 + u_flux * 0.5);
    float gridLineX = abs(fract(p.x / cellSize) - 0.5) - gridLineThickness;
    float gridLineY = abs(fract(p.y / cellSize) - 0.5) - gridLineThickness;
    float gridLineZ = abs(fract(p.z / cellSize) - 0.5) - gridLineThickness;

    float gridLines = min(min(gridLineX, gridLineY), gridLineZ);
    
    // Union of the main maze blocks and grid lines.
    float d = min(mazeBlockSDF, gridLines);

    // Broad tunnel boundaries (main outer walls)
    // These define the overall navigable space
    float tunnelWidth = 10.0 + u_bass * 5.0; // Bass makes the tunnel wider
    float tunnelHeight = 5.0 + u_high * 2.0; // Highs affect tunnel height
    
    float mainTunnelX = abs(p.x) - tunnelWidth;
    float mainTunnelY = abs(p.y) - tunnelHeight;
    
    // Carve out the main tunnel bounds from the maze elements (using max operator)
    d = max(d, mainTunnelX);
    d = max(d, mainTunnelY);

    return d;
}


void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    // Apply main rotation to the screen space
    uv = rotate2d(u_dmxRot) * uv;

    // Camera/Ray origin, moving forward with u_clock
    vec3 ro = vec3(u_axis_a * 5.0,     // X position
                    u_axis_b * 5.0,     // Y position
                    u_clock * 10.0);    // Z position (forward movement)

    // Ray direction with camera look-around using u_axis_c and u_axis_d
    vec3 rd = normalize(vec3(uv, 1.0));
    float camYaw = u_axis_c * 1.0;
    float camPitch = u_axis_d * 0.5;
    rd.xy = rotate2d(camYaw) * rd.xy;
    rd.yz = rotate2d(camPitch) * rd.yz;
    
    // Further perspective distortion / fisheye with u_axis_e
    float fovAdjust = 1.0 + u_axis_e * 0.5;
    rd.xy *= fovAdjust;
    rd = normalize(rd);

    vec3 finalColor = vec3(0.0);
    float totalDist = 0.0;
    float cellSize = 1.5 + u_bass * 0.5; // Bass affects cell size
    float wallThickness = 0.05 + u_flux * 0.02; // Flux affects wall thickness
    float timeOffset = u_time * 0.1; // Slow animation for maze pattern

    int maxIterations = 16; // STRICTLY limited iterations for performance

    for (int i = 0; i < maxIterations; i++) {
        vec3 p = ro + rd * totalDist;
        
        float d = map(p, cellSize, wallThickness, timeOffset, u_axis_e);

        if (d < 0.001) { // Hit a surface
            // Approximate normal using numerical differentiation (gradient of the SDF)
            float e = 0.001;
            vec3 eps = vec3(e, 0.0, 0.0);
            vec3 N;
            N.x = map(p + eps.xyy, cellSize, wallThickness, timeOffset, u_axis_e) - map(p - eps.xyy, cellSize, wallThickness, timeOffset, u_axis_e);
            N.y = map(p + eps.yxy, cellSize, wallThickness, timeOffset, u_axis_e) - map(p - eps.yxy, cellSize, wallThickness, timeOffset, u_axis_e);
            N.z = map(p + eps.yyx, cellSize, wallThickness, timeOffset, u_axis_e) - map(p - eps.yyx, cellSize, wallThickness, timeOffset, u_axis_e);
            N = normalize(N);

            // Simple diffuse lighting
            float light = 0.5 + 0.5 * dot(N, normalize(vec3(0.5, 1.0, 0.5)));
            light += u_high * 0.5; // Highs add more light

            // Base color from palette, modulated by cell ID and uniforms
            vec3 baseColor = palette(
                hash11(dot(floor(p / cellSize).xz, vec2(1.0, 100.0))) + u_clock * 0.05,
                vec3(0.5, 0.5, 0.5),
                vec3(0.5, 0.5, 0.5),
                vec3(0.8 + u_vol * 0.5, 0.8 + u_high * 0.5, 0.8 + u_flux * 0.5),
                vec3(0.0, 0.1, 0.2)
            );
            
            finalColor = baseColor * light * (1.0 + u_intensity * 0.5);

            // Add glowing effect based on proximity to hit point
            float glow = 0.05 + u_flux * 0.1 + u_intensity * 0.2;
            finalColor += baseColor * pow(max(0.0, 1.0 - d / (totalDist * 0.1 + 0.001)), 2.0) * glow;
            
            break; // Exit loop after first hit
        }

        totalDist += d * 0.8; // Step by 80% of distance to avoid overstepping
        if (totalDist > 100.0) break; // Maximum view distance
    }

    // Fog / background color for rays that didn't hit anything or went too far
    float fogFactor = smoothstep(0.0, 1.0, totalDist / 100.0);
    vec3 fogColor = palette(u_clock * 0.1 + u_flux * 0.2,
                            vec3(0.1,0.1,0.1),
                            vec3(0.05,0.05,0.1),
                            vec3(0.5 + u_vol * 0.2, 0.5 + u_high * 0.2, 0.5 + u_bass * 0.2),
                            vec3(0.0,0.1,0.2));
    
    finalColor = mix(finalColor, fogColor, fogFactor);

    // Apply high black point for extreme contrast
    finalColor.rgb = (finalColor.rgb - 0.2) / 0.8;
    finalColor.rgb = clamp(finalColor.rgb, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}