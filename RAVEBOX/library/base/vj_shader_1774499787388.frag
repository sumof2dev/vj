varying vec2 vUv;
uniform float u_time;
uniform float u_clock; // Use this for speed modulation to avoid jitter
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_intensity; // Smoother volume track
uniform float u_high; 
uniform float u_dmxRot;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle), -sin(_angle),
                sin(_angle), cos(_angle));
}

float getShape(vec2 p, float sides) {
    float a = atan(p.x, p.y) + u_time * 0.2;
    float r = length(p);
    float d = cos(floor(0.5 + a / (6.28318 / sides)) * (6.28318 / sides) - a) * r;
    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    
    uv *= rotate2d(u_dmxRot * 6.28318);
    
    float pulse = u_bass * 0.5;
    float speed = u_clock;
    
    float ang = atan(uv.y, uv.x);
    float dist = length(uv);
    
    // Perspective warp for tunnel effect
    float tunnelZ = 1.0 / (dist + 0.01);
    vec2 polar = vec2(ang / 6.28318 + 0.5, tunnelZ + speed);
    
    // Distort tunnel based on high frequencies
    polar.x += sin(polar.y * 5.0 + u_time) * (0.05 * u_high);
    
    // Create Geometric Rings
    float sides = 3.0 + floor(u_intensity * 5.0);
    float shape = getShape(uv * tunnelZ * 0.2, sides);
    
    // Grid and structure
    float line1 = abs(sin(polar.y * 10.0)) * 0.8;
    float line2 = abs(sin(polar.x * 20.0 + polar.y)) * 0.5;
    float intensity = pow(0.02 / abs(line1 * line2), 1.2);
    
    // Bass-driven explosion of light
    float rings = smoothstep(0.4, 0.5, fract(polar.y * 2.0 - speed * 0.5));
    intensity += (rings * u_bass * 2.0) / tunnelZ;
    
    // Color Palette based on audio
    vec3 col = vec3(0.0);
    col += vec3(0.1, 0.4, 1.0) * (1.0 / tunnelZ) * u_high; // Deep blue highs
    col += vec3(1.0, 0.2, 0.5) * intensity * (u_bass + 0.2); // Pink/Red bass kicks
    col += vec3(0.2, 1.0, 0.7) * sin(polar.y + u_time) * u_vol; // Greenish volume flow
    
    // Additive glow
    float glow = exp(-dist * (2.0 - u_bass));
    col += vec3(0.5, 0.2, 0.8) * glow * u_vol;

    // Darken center for depth
    col *= smoothstep(0.0, 0.2, dist);
    
    // Final output with additive friendliness
    gl_FragColor = vec4(col * (1.0 + u_flux), 1.0);
}