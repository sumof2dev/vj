precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform float u_bass;
uniform float u_flux;
uniform float u_vol;
uniform vec2 u_resolution;
uniform float u_dmxRot;

vec3 quickHue(float h) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return rgb * 0.6; 
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;
    vec3 color = vec3(0.0);

    float flux = min(u_flux, 0.6);
    float bass = min(u_bass, 0.8);
    float vol = min(u_vol, 0.8);
    
    vec3 freq = vec3(3.0, 2.0, 2.5);
    vec3 radius = vec3(0.6 + bass * 0.4, 0.5 + bass * 0.3, 0.4 + bass * 0.3);
    
    float ca = cos(u_dmxRot);
    float sa = sin(u_dmxRot);
    mat2 rot = mat2(ca, -sa, sa, ca);
    
    float intensityBase = (0.005 + flux * 0.008) * (0.4 + vol * 0.6);

    for(float z_idx = 0.0; z_idx < 4.0; z_idx++) {
        float phase = z_idx * 1.570796;
        for(float i = 0.0; i < 12.0; i++) {
            float t = (u_time * 0.4) - (i * 0.03);
            vec3 pos = vec3(
                sin(t * freq.x + phase) * radius.x,
                sin(t * freq.y) * radius.y,
                sin(t * freq.z + phase * 0.5) * radius.z
            );
            pos.xy = rot * pos.xy;
            float z = pos.z + 1.2; 
            vec2 p2d = pos.xy / z;
            float dist = length(uv - p2d);
            float hue = fract(u_time * 0.1 + z_idx * 0.25 + pos.z * 0.1);
            float fade = 1.0 - (i / 12.0);
            color += quickHue(hue) * (intensityBase * fade / (dist + 0.003));
        }
    }
    gl_FragColor = vec4(color, 1.0);
}
