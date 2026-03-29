precision highp float;

varying vec2 vUv;

uniform float u_time;
uniform float u_clock; // Use for motion to avoid jitter
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_intensity; // Smoother intensity
uniform float u_high; 
uniform float u_dmxRot;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float map(vec3 p) {
    p.z += u_clock * 0.1; 
    
    float segmentLength = 2.0 + u_high * 0.5; 
    p.z = mod(p.z, segmentLength) - segmentLength * 0.5;
    
    vec3 q = p;
    float d = 1e5; 
    
    float foldScale = 1.0 + u_bass * 0.3; 
    float baseShift = 0.2 + u_intensity * 0.03;

    for (int i = 0; i < 3; i++) { // Reduced iterations for performance
        q = abs(q); 
        q -= baseShift; // Simplified shift
        q *= foldScale; 
        
        // Simplified box dimensions for less detail and better performance
        vec3 boxDims = vec3(0.05 + u_high * 0.01 + u_bass * 0.03);
        d = min(d, sdBox(q, boxDims)); 
    }
    
    return d / (pow(foldScale, 3.0)); // Scale by total scaling factor for 3 iterations
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0); 
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void main() {
    vec2 uv = (vUv - 0.5) * u_resolution / min(u_resolution.x, u_resolution.y);
    
    uv = rotate2d(u_dmxRot) * uv;

    vec3 ro = vec3(0.0); 
    vec3 rd = normalize(vec3(uv, 1.5)); 
    
    float totalDist = 0.0;
    float maxDist = 70.0; // Reduced max distance
    float hitDist = 0.01; // Increased hit distance for coarser hits
    int maxSteps = 60; // Reduced max steps for performance

    vec3 hitPos = vec3(0.0);
    float d = 0.0;
    
    for (int i = 0; i < maxSteps; i++) {
        hitPos = ro + rd * totalDist; 
        d = map(hitPos); 
        if (d < hitDist || totalDist > maxDist) break; 
        totalDist += d; 
    }

    vec3 finalColor = vec3(0.0);

    if (totalDist < maxDist) { 
        vec3 normal = calcNormal(hitPos); 
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0)); 
        
        float diffuse = clamp(dot(normal, lightDir) * 0.8 + 0.2, 0.0, 1.0);
        
        vec3 colorA = vec3(0.1, 0.3, 0.8); 
        vec3 colorB = vec3(0.8, 0.2, 0.1); 
        
        vec3 baseColor = mix(colorA, colorB, u_flux); 
        baseColor = mix(baseColor, vec3(0.9, 0.9, 0.1), u_high * 0.5); 
        
        // Simplified dynamic color additions
        baseColor += sin(hitPos.x * 5.0 + u_time * 2.0) * (0.1 + u_vol * 0.1); 
        baseColor += cos(hitPos.y * 5.0 + u_time * 2.0) * (0.1 + u_vol * 0.1); 
        baseColor += sin(hitPos.z * 5.0 + u_time * 2.0) * (0.1 + u_bass * 0.1); 
        
        finalColor = baseColor * diffuse; 
        
        vec3 reflectedRay = reflect(rd, normal);
        float specular = pow(max(0.0, dot(reflectedRay, lightDir)), 32.0); 
        finalColor += vec3(1.0) * specular * (0.5 + u_vol * 1.5); // Adjusted specular influence
        
        float fog = 1.0 - smoothstep(0.0, maxDist * 0.6, totalDist); // Adjusted fog range
        finalColor *= (0.5 + u_vol * 1.5) * fog; 
        
        finalColor += vec3(u_bass * 0.5); 
        
    } else {
        finalColor = vec3(0.0);
    }
    
    // Apply high black point for extreme contrast
    finalColor.rgb = (finalColor.rgb - 0.2) / 0.8; 
    finalColor.rgb = clamp(finalColor.rgb, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}