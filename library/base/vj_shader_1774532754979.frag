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

void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y; // Aspect ratio correction

    // Apply global DMX rotation
    uv = rotate2d(u_dmxRot) * uv;

    float angle_raw = atan(uv.y, uv.x);
    float radius_raw = length(uv);

    // Kaleidoscope folding effect
    float num_sectors_base = 6.0;
    float num_sectors = num_sectors_base + floor(u_high * 4.0); // 6 to 10 sectors based on high frequency
    num_sectors = max(num_sectors, 2.0); // Ensure at least 2 for stability

    float sector_angle_size = 2.0 * 3.1415926535 / num_sectors;
    float angle_folded = mod(angle_raw, sector_angle_size);
    angle_folded = abs(angle_folded - sector_angle_size * 0.5); // Mirror within the sector

    // Convert back to cartesian coordinates, effectively "unfolding" the mirrored sector
    vec2 folded_uv = vec2(cos(angle_folded), sin(angle_folded)) * radius_raw;

    // Add dynamic rotation to the folded space
    float inner_rot_speed = u_time * 0.2 + u_flux * 0.5; // Flux influences inner rotation speed
    folded_uv = rotate2d(inner_rot_speed) * folded_uv;

    vec3 color = vec3(0.0);

    // Mandala patterns using folded_uv coordinates

    // 1. Central pulsing bloom/shape
    float pulse_radius = length(folded_uv);
    float bloom_intensity = sin(pulse_radius * (15.0 + u_flux * 5.0) - u_time * 1.0) * 0.5 + 0.5;
    bloom_intensity = pow(bloom_intensity, 2.0 + u_bass * 3.0); // Bass makes it sharper and brighter
    bloom_intensity *= (1.0 + u_bass * 2.0); // Bass makes it glow more intensely
    color += bloom_intensity * vec3(0.1, 0.4, 0.8) * (0.8 + u_vol * 0.5); // Blue tones, influenced by volume

    // 2. Layered rings / intricate angular details
    float detail_freq = 25.0 + u_flux * 15.0; // Flux increases detail density
    float detail_pattern = fract(length(folded_uv) * detail_freq - u_time * 0.3);
    detail_pattern = smoothstep(0.4, 0.5 + u_bass * 0.1, detail_pattern); // Bass makes lines thicker

    // Add angular modulation within the folded sector (creates repeating features)
    // The angle_folded ranges from 0 to sector_angle_size * 0.5.
    // To make a pattern repeat N times across the *entire original circle*,
    // using this angle is like `angle_folded / (sector_angle_size * 0.5) * PI` mapping to 0..PI
    // Then `sin(mapped_angle * K)`
    float angle_in_half_sector_norm = angle_folded / (sector_angle_size * 0.5); // Normalized 0-1
    detail_pattern *= sin(angle_in_half_sector_norm * 3.1415926535 * (4.0 + u_high * 4.0) + u_time * 0.4) * 0.5 + 0.5;
    
    color += detail_pattern * vec3(0.8, 0.2, 0.6) * (0.6 + u_vol * 0.8); // Magenta/Red tones

    // 3. Spiraling / warping effect based on bass and flux
    vec2 warped_uv = folded_uv;
    float warp_strength = u_flux * 0.03 + u_bass * 0.05; // Bass and flux increase warp
    float warp_speed = u_time * 0.5 + u_bass * 0.3;
    warped_uv.x += sin(warped_uv.y * (30.0 + u_high * 10.0) + warp_speed) * warp_strength;
    warped_uv.y += cos(warped_uv.x * (30.0 + u_high * 10.0) - warp_speed) * warp_strength;

    float spiral_pattern = fract(length(warped_uv) * (40.0 + u_flux * 20.0) - atan(warped_uv.y, warped_uv.x) * (5.0 + u_bass * 2.0) / (2.0 * 3.1415926535) - u_time * 0.6);
    spiral_pattern = pow(spiral_pattern, 10.0 + u_high * 5.0); // High makes spirals sharper/more defined
    color += spiral_pattern * vec3(1.0, 0.7, 0.0) * (0.5 + u_bass * 1.5 + u_vol * 0.5); // Yellow/Orange, very reactive

    // 4. Outer glow / subtle background light
    float outer_glow_radius = length(vUv - 0.5); // Use raw UV for a non-kaleidoscopic outer glow
    float outer_glow = pow(max(0.0, 1.0 - outer_glow_radius * 1.5), 3.0); // Inverse power falloff
    outer_glow *= (u_vol * 0.8 + u_bass * 0.5); // Boost with volume/bass
    color += outer_glow * vec3(0.3, 0.6, 1.0); // Light blue glow

    // Final color adjustment for VJ style: high contrast and brightness
    color *= (0.8 + u_vol * 1.5); // Overall intensity boost with volume
    color = pow(color, vec3(0.8)); // Gamma correction for brightness
    color += vec3(0.01) * u_high; // Subtle base glow influenced by high frequency

    gl_FragColor = vec4(color, 1.0);
}