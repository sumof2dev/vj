precision highp float;
varying vec2 vUv;
uniform float u_time; 
uniform float u_speed; 
uniform float u_intensity;
uniform float u_bass; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_flux;
uniform vec2 u_resolution; 
uniform float u_dmxRot;

vec3 hslToRgb(float h, float s, float l) {
    l = min(0.6, l);
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return vec3(l) + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;
    float time = u_time * 0.15;

    uv = abs(uv);
    float ca = cos(u_dmxRot); float sa = sin(u_dmxRot);
    uv = mat2(ca, -sa, sa, ca) * uv;

    float clampedFlux = min(u_flux, 0.7);
    float scale = 4.0 + clampedFlux * 2.0;
    vec2 cell = floor(uv * scale);
    vec2 frac = fract(uv * scale);

    float minDist = 1.0;
    float secondDist = 1.0;
    vec2 closestCell = vec2(0.0);

    for (float j = -1.0; j <= 1.0; j++) {
        for (float i = -1.0; i <= 1.0; i++) {
            vec2 neighbor = vec2(i, j);
            vec2 point = hash2(cell + neighbor);
            point = 0.5 + 0.4 * sin(time * 0.5 + 6.2831 * point);
            float d = length(frac - neighbor - point);
            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                closestCell = cell + neighbor;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    float border = smoothstep(0.02, 0.06 + u_bass * 0.02, secondDist - minDist);
    float cellHash = fract(sin(dot(closestCell, vec2(12.9898, 78.233))) * 43758.5453);
    float hue = mod(cellHash * 0.3 + 0.55 + time * 0.1 + u_bass * 0.1, 1.0); 
    float sat = 0.7 + cellHash * 0.3;
    float light = 0.35 + 0.2 * sin(time * 0.3 + cellHash * 6.28);
    light += u_vol * 0.15;

    vec3 glassColor = hslToRgb(hue, sat, light);
    vec3 borderColor = vec3(0.05, 0.04, 0.03);
    vec3 color = mix(borderColor, glassColor, border);

    float grain = fract(sin(dot(uv * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * 0.04;

    gl_FragColor = vec4(color, 1.0);
}
