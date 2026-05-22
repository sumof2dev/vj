precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_audioLevel;
uniform float u_bass;
uniform vec2 u_resolution;
uniform float u_dmxRot;

vec3 hslToRgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

float hexDist(vec2 p) {
    p = abs(p);
    float c = dot(p, normalize(vec2(1.0, 1.732)));
    return max(c, p.x);
}

vec4 hexCoords(vec2 uv) {
    vec2 r = vec2(1.0, 1.732);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = uv - gv;
    return vec4(gv, id);
}

mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    float zoom = 12.0 - u_bass * 2.0; 
    uv *= zoom;
    uv *= rot(u_dmxRot);

    vec4 hc = hexCoords(uv);
    float d = hexDist(hc.xy);
    
    float edgeWidth = 0.05 + u_audioLevel * 0.05;
    float glow = smoothstep(0.5 - edgeWidth, 0.5, d);
    
    float distToCenter = length(hc.zw);
    float centerMask = 1.0 - smoothstep(0.0, 3.0, distToCenter); 
    float reaction = min(1.5, mix(u_bass, u_audioLevel, 1.0 - centerMask)); 
    
    float pulseWave = sin(distToCenter * 2.0 - u_time * 2.0 + reaction * 5.0);
    
    float hue = u_time * 0.1 + distToCenter * 0.2 + u_bass * 0.2;
    vec3 col = hslToRgb(hue, 1.0, 0.5); 
    
    float brightness = glow * (0.5 + 0.5 * pulseWave + reaction * 2.0);
    brightness = min(2.0, brightness);
    float alpha = brightness * min(1.0, (0.6 + u_audioLevel * 0.8));

    gl_FragColor = vec4(col * brightness * 1.0, alpha);
}
