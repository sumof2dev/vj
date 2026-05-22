precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_audioLevel;
uniform float u_bass;
uniform float u_flux;
uniform vec2 u_resolution;
uniform float u_speed;

mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;
    
    float t = u_time * 0.5; 
    float idle = sin(t * 2.0) * 0.1;

    float clampedBass = min(u_bass, 0.7);
    uv *= 1.0 - clampedBass * 0.2 + idle;
    uv *= rot(t * 0.3 + clampedBass * 0.2); 

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float clampedFlux = min(u_flux, 0.6);
    float effectiveFlux = clampedFlux + 0.2 * sin(t); 

    float warp = sin(r * 5.0 - t * 3.0) * effectiveFlux * 0.5;
    a += warp;

    float web = sin(a * 10.0 + t) * sin(r * 10.0 - t * 2.0);
    web += sin(a * 20.0 - t * 2.0) * 0.5;

    float intensity = 1.0 - smoothstep(0.01, 0.08, abs(web) * 0.1);
    
    vec3 lineCol = vec3(0.1 + u_bass * 0.5, 0.5, 1.0); 
    if (uv.y > 0.0) lineCol = vec3(1.0, 0.2 + u_bass * 0.5, 0.8); 

    vec3 color = intensity * lineCol;
    color += lineCol * intensity * 0.5; 

    gl_FragColor = vec4(color, 1.0);
}
