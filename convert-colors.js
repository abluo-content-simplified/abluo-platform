const { sanityClient } = require('./src/lib/sanity/client');

// HEX to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : null;
}

// RGB to OKLch
function rgbToOklch(r, g, b) {
  // RGB to linear
  const lr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  // Linear to XYZ (D65)
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

  // XYZ to LMS
  const l_ = Math.cbrt(x * 0.8189330101 + y * 0.3329415441 + z * -0.1288174949);
  const m_ = Math.cbrt(x * 0.0329845436 + y * 0.9440763681 + z * 0.1231897411);
  const s_ = Math.cbrt(x * 0.1467054338 + y * -0.3045674746 + z * 0.2413163729);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.sqrt(a * a + b_ * b_);
  let h = Math.atan2(b_, a) * (180 / Math.PI);
  if (h < 0) h += 360;

  return { L: parseFloat(L.toFixed(4)), C: parseFloat(C.toFixed(4)), h: parseFloat(h.toFixed(2)) };
}

// HEX to OKLch string
function hexToOklch(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const oklch = rgbToOklch(rgb.r, rgb.g, rgb.b);
  return `oklch(${oklch.L} ${oklch.C} ${oklch.h}deg)`;
}

async function convertDesignSystems() {
  try {
    const query = `*[_type == "designSystem" && (name == "Abluo Base" || name == "Abluo Dental")] {
      _id, name, colors
    }`;

    const systems = await sanityClient.fetch(query);
    console.log(`Found ${systems.length} design systems\n`);

    for (const system of systems) {
      console.log(`Converting ${system.name}...`);
      
      const updatedColors = { lightTheme: {}, darkTheme: {} };

      if (system.colors?.lightTheme) {
        for (const [key, value] of Object.entries(system.colors.lightTheme)) {
          if (typeof value === 'string' && value.startsWith('#')) {
            updatedColors.lightTheme[key] = hexToOklch(value);
            console.log(`  Light.${key}: ${value} → ${updatedColors.lightTheme[key]}`);
          } else {
            updatedColors.lightTheme[key] = value;
          }
        }
      }

      if (system.colors?.darkTheme) {
        for (const [key, value] of Object.entries(system.colors.darkTheme)) {
          if (typeof value === 'string' && value.startsWith('#')) {
            updatedColors.darkTheme[key] = hexToOklch(value);
            console.log(`  Dark.${key}: ${value} → ${updatedColors.darkTheme[key]}`);
          } else {
            updatedColors.darkTheme[key] = value;
          }
        }
      }

      await sanityClient.patch(system._id).set({ colors: updatedColors }).commit();
      console.log(`✅ ${system.name} updated\n`);
    }

    console.log('✅ Done - all colors converted to OKLCH');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

convertDesignSystems();
