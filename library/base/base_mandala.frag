precision highp float;
varying vec2 vUv;
uniform float u_time; 
uniform float u_audioLevel; 
uniform float u_bass; 
uniform float u_mids; 
uniform float u_highs; 
uniform float u_intensity; 
uniform float u_speed; 
uniform vec2 u_resolution;
uniform sampler2D u_noiseTex;

float snoise(vec3 v) {
    return texture2D(u_noiseTex, v.xy * 0.05 + v.z * 0.1).r * 2.0 - 1.0;
}

vec3 hslToRgb(float h, float s, float l) { 
    l = min(0.6, l); 
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); 
    return vec3(l) + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0)); 
}

const float PI = 3.14159265359;

void main() {
    vec2 uv = vUv - 0.5; uv.x *= u_resolution.x / u_resolution.y;
    float time = u_time * 0.4;
    
    float clampedBass = min(u_bass, 0.7);
    float zoomVar = clampedBass * u_intensity * 0.12;
    float zoom = 1.0 - min(0.4, zoomVar); 
    float radius = length(uv) * (2.0 - zoomVar * 2.0);
    
    float angle = atan(uv.y, uv.x);
    float segments = 6.0 + floor(min(1.0, u_mids) * 6.0);
    angle = mod(angle, PI * 2.0 / segments);
    angle = abs(angle - PI / segments);
    
    float gutterWidth = 0.1 + u_bass * 0.05;
    float gutter = smoothstep(0.0, gutterWidth, angle) * 
                   smoothstep(PI / segments, PI / segments - gutterWidth, angle);

    vec3 noiseCoord = vec3(uv * (1.0 + u_audioLevel * 1.5), time * 0.8);
    float noiseVal = snoise(noiseCoord * 2.0);
    
    float pattern = 0.0;
    pattern += sin(radius * 12.0 - time * 8.0 + noiseVal * 4.0);
    pattern += cos(angle * segments * 2.0 + time * 5.0);
    
    pattern *= smoothstep(0.1, 0.6, radius);
    pattern = fract(pattern * 1.5);
    pattern = pow(pattern, 2.5);
    
    float hue = fract(time * 0.2 + radius * 0.5 - angle*0.1 + u_bass * 0.4);
    float light = (pattern * 0.8 + u_highs * u_intensity * 0.2) * gutter;
    light = min(0.7, light); 
    
    vec3 color = hslToRgb(hue, 0.8 + u_mids * 0.2, light);
    gl_FragColor = vec4(color, 1.0);
}
