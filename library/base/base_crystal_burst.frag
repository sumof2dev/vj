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

const float PI = 3.14159265359;

vec3 hslToRgb(float h, float s, float l) {
    l = min(0.6, l);
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return vec3(l) + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;
    float time = u_time * 0.4;

    float r = length(uv);
    float clampedBass = min(u_bass, 0.8);
    
    float twist = sin(r * 3.0 - time * 2.0) * (0.2 + clampedBass * 0.4);
    float ca = cos(twist); float sa = sin(twist);
    uv = mat2(ca, -sa, sa, ca) * uv;
    
    float a = atan(uv.y, uv.x);

    float segments = 8.0;
    float segAngle = PI * 2.0 / segments;
    a = mod(a + PI + u_dmxRot, segAngle);
    a = abs(a - segAngle * 0.5);
    vec2 kuv = vec2(cos(a), sin(a)) * r;

    float crystal = 0.0;
    for (float i = 0.0; i < 4.0; i++) {
        float scale = 3.0 + i * 2.0;
        vec2 p = kuv * scale + time * (0.5 + i * 0.3);
        float jag = abs(sin(p.x * 5.0 + sin(p.y * 3.0 + time)) * cos(p.y * 4.0 + sin(p.x * 2.5 - time)));
        jag = pow(jag, 0.5 + u_bass * 0.5);
        crystal += jag * (1.0 / (1.0 + i));
    }
    crystal *= 0.5;

    float edge = abs(sin(kuv.x * 10.0 - time * 2.0) * cos(kuv.y * 8.0 + time));
    edge = smoothstep(0.9, 1.0, edge) * 2.0;

    float pattern = crystal + edge * 0.5;

    float center = 0.1 / (r * r + 0.05);
    pattern += center * (0.3 + u_bass * 0.5);

    vec3 baseCol = hslToRgb(0.5 + sin(time)*0.1, 1.0, 0.5);
    vec3 warmCol = vec3(1.0, 0.8, 0.2); 
    
    vec3 finalCol = mix(baseCol, warmCol, u_bass * 0.8 * pattern);
    finalCol += edge * vec3(1.0, 0.0, 1.0) * u_high; 

    vec3 color = finalCol * pattern * (0.6 + u_vol * 0.6);
    color *= smoothstep(1.8, 0.3, r);

    float alpha = smoothstep(0.02, 0.15, pattern);
    gl_FragColor = vec4(color, alpha);
}
