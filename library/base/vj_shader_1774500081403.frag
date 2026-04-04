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

float box(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= u_resolution.x / u_resolution.y;

    // Raymarching setup
    vec3 ro = vec3(0.0, 0.0, 5.0);
    vec3 rd = normalize(vec3(uv, -1.5));
    
    // Rotate camera space
    ro.xz *= rotate2d(u_dmxRot + u_time * 0.1);
    rd.xz *= rotate2d(u_dmxRot + u_time * 0.1);
    ro.yz *= rotate2d(u_time * 0.05);
    rd.yz *= rotate2d(u_time * 0.05);

    float t = 0.0;
    float glow = 0.0;
    vec3 color = vec3(0.0);
    
    // Voxel grid properties
    float gridSize = 0.4 + (u_high * 0.2);
    
    for(int i = 0; i < 25; i++) {
        vec3 p = ro + rd * t;
        
        // Space repetition for voxels
        vec3 gridP = floor(p / gridSize + 0.5) * gridSize;
        
        // Voxel logic - creating a generative structure
        float noise = sin(gridP.x * 0.8 + u_time + u_flux) * 
                      cos(gridP.y * 0.8 - u_time * 0.5) * 
                      sin(gridP.z * 0.8 + u_flux);
        
        // Distance function - dynamic box size based on audio
        float size = gridSize * 0.4 * (u_bass * 1.2 + 0.2);
        float d = box(p - gridP, vec3(size));
        
        // Discard voxels based on threshold to create holes
        if(noise < 0.2 - u_vol * 0.3) {
            d = length(p - gridP) - 0.1; // Small spheres for empty cells
            d = max(d, 0.1); // Ensure we keep marching
        }

        if(d < 0.001) {
            // Hit logic
            float depth = 1.0 - (t / 12.0);
            vec3 voxelCol = mix(vec3(0.1, 0.4, 1.0), vec3(0.0, 1.0, 0.8), sin(gridP.z + u_time) * 0.5 + 0.5);
            voxelCol = mix(voxelCol, vec3(1.0, 0.0, 0.5), u_high);
            color = voxelCol * depth * (1.0 + u_bass);
            break;
        }
        
        // Glow accumulation
        glow += (0.01 / (d + 0.05)) * u_bass;
        
        t += d * 0.7;
        if(t > 15.0) break;
    }

    // Post-processing and bloom
    vec3 finalColor = color + (glow * vec3(0.2, 0.5, 1.0) * 0.5);
    
    // Scanlines
    finalColor *= 0.8 + 0.2 * sin(vUv.y * 800.0);
    
    // Audio reactive pulse
    finalColor += pow(glow * 0.1, 2.0) * vec3(1.0, 0.8, 0.5) * u_bass;

    gl_FragColor = vec4(finalColor, 1.0);
}