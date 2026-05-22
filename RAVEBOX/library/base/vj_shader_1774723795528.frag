precision highp float;

varying vec2 vUv;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass; 
uniform float u_flux; 
uniform float u_vol; 
uniform float u_high; 
uniform float u_dmxRot;
uniform float u_axis_a;
uniform float u_axis_b;
uniform float u_axis_c;
uniform float u_axis_d;
uniform float u_axis_e;

const float PI = 3.14159265359;

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

void main() {
    vec2 uv = (gl_FragCoord.xy / u_resolution.xy) - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    uv = rotate2d(u_dmxRot) * uv;

    float scale = 3.0 + u_flux * 2.0 + u_bass * 1.5;
    uv *= scale;

    uv += vec2(sin(u_time * 0.1 * u_flux), cos(u_time * 0.1 * u_flux)) * u_vol * 0.5;

    vec3 finalColor = vec3(0.0);

    float tiling_freq = 1.0 + u_axis_a * 5.0; 
    vec2 tiled_uv = uv * tiling_freq;
    tiled_uv = mod(tiled_uv, 2.0) - 1.0; 

    float dist_to_center = length(tiled_uv);

    float current_radius = 0.4 + u_bass * 0.15 + u_vol * 0.1; 
    float lineThickness = 0.01 + u_bass * 0.015; 

    float min_dist_to_line = 1000.0;

    min_dist_to_line = min(min_dist_to_line, abs(dist_to_center - current_radius));

    for (int i = 0; i < 6; i++) {
        float angle = float(i) * PI / 3.0 + u_time * 0.05 * u_flux;
        vec2 offset = vec2(cos(angle), sin(angle)) * current_radius;
        min_dist_to_line = min(min_dist_to_line, abs(length(tiled_uv - offset) - current_radius));
    }
    
    if (u_axis_b > 0.5) { 
        for (int i = 0; i < 6; i++) {
            float angle = float(i) * PI / 3.0 + u_time * 0.07 * u_flux;
            vec2 offset = vec2(cos(angle), sin(angle)) * current_radius * 2.0; 
            min_dist_to_line = min(min_dist_to_line, abs(length(tiled_uv - offset) - current_radius));
        }
    }

    float line_intensity = smoothstep(lineThickness, 0.0, min_dist_to_line);

    float dist_to_intersections = 1000.0;
    float intersection_radius = lineThickness * 2.0;

    dist_to_intersections = min(dist_to_intersections, length(tiled_uv));

    for (int i = 0; i < 6; i++) {
        float angle = float(i) * PI / 3.0 + u_time * 0.05 * u_flux;
        vec2 offset = vec2(cos(angle), sin(angle)) * current_radius;
        dist_to_intersections = min(dist_to_intersections, length(tiled_uv - offset));
    }
    
    if (u_axis_c > 0.5) { 
        for (int i = 0; i < 6; i++) {
            float angle = float(i) * PI / 3.0 + u_time * 0.06 * u_flux;
            vec2 offset = vec2(cos(angle), sin(angle)) * current_radius * 2.0; 
            dist_to_intersections = min(dist_to_intersections, length(tiled_uv - offset));
        }
         for (int i = 0; i < 6; i++) {
            float angle = (float(i) + 0.5) * PI / 3.0 + u_time * 0.06 * u_flux;
            vec2 offset = vec2(cos(angle), sin(angle)) * current_radius * 1.732; 
            dist_to_intersections = min(dist_to_intersections, length(tiled_uv - offset));
         }
    }

    float intersection_glow = smoothstep(intersection_radius, 0.0, dist_to_intersections);
    
    float hue_shift_time = u_time * 0.05 + u_flux * 0.1;
    float hue_shift_vol = u_vol * 3.0;
    float hue_shift_high = u_high * 2.0;

    vec3 color_base = vec3(0.0);
    color_base.r = sin(hue_shift_time + tiled_uv.x * 0.1 + hue_shift_vol) * 0.5 + 0.5;
    color_base.g = sin(hue_shift_time + tiled_uv.y * 0.1 + hue_shift_high + PI/2.0) * 0.5 + 0.5;
    color_base.b = sin(hue_shift_time + tiled_uv.x * 0.05 - tiled_uv.y * 0.05 + PI) * 0.5 + 0.5;
    
    vec3 axis_color_mix = vec3(u_axis_d, u_axis_e, u_axis_b); // Re-purpose axis_b, d, e for mix
    color_base = mix(color_base, axis_color_mix, u_axis_a * 0.5); // Use u_axis_a to blend in specific colors

    finalColor = color_base * line_intensity * (0.8 + u_bass * 2.0) * (0.5 + u_high * 1.5);
    finalColor *= (1.0 + u_vol * 0.8);

    vec3 glow_color = vec3(0.0);
    glow_color.r = sin(hue_shift_time * 1.2 + u_axis_d * 5.0) * 0.5 + 0.5;
    glow_color.g = sin(hue_shift_time * 1.3 + u_axis_e * 5.0 + PI/3.0) * 0.5 + 0.5;
    glow_color.b = sin(hue_shift_time * 1.1 + u_axis_d * 5.0 + PI*2.0/3.0) * 0.5 + 0.5;
    
    finalColor += glow_color * intersection_glow * (0.8 + u_bass * 2.0 + u_high * 1.0);

    finalColor = (finalColor - 0.2) / 0.8; 
    finalColor = clamp(finalColor, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}