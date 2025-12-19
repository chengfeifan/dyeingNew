
// Simplified D65 Illuminant and CIE 1931 2° Standard Observer data (every 10nm from 400 to 700)
// This is a condensed version for frontend real-time calculation.
const cmfData: Record<number, { x: number; y: number; z: number; d65: number }> = {
    400: { x: 0.0143, y: 0.0004, z: 0.0679, d65: 82.75 },
    410: { x: 0.0435, y: 0.0012, z: 0.2074, d65: 91.49 },
    420: { x: 0.1344, y: 0.0040, z: 0.6456, d65: 93.43 },
    430: { x: 0.2839, y: 0.0116, z: 1.3856, d65: 86.68 },
    440: { x: 0.3483, y: 0.0230, z: 1.7471, d65: 104.86 },
    450: { x: 0.3362, y: 0.0380, z: 1.7721, d65: 117.01 },
    460: { x: 0.2908, y: 0.0600, z: 1.6692, d65: 117.81 },
    470: { x: 0.1954, y: 0.0910, z: 1.2876, d65: 114.86 },
    480: { x: 0.0956, y: 0.1390, z: 0.8130, d65: 115.92 },
    490: { x: 0.0320, y: 0.2080, z: 0.4652, d65: 108.81 },
    500: { x: 0.0049, y: 0.3230, z: 0.2720, d65: 109.35 },
    510: { x: 0.0093, y: 0.5030, z: 0.1582, d65: 107.80 },
    520: { x: 0.0633, y: 0.7100, z: 0.0782, d65: 104.79 },
    530: { x: 0.1655, y: 0.8620, z: 0.0422, d65: 107.69 },
    540: { x: 0.2904, y: 0.9540, z: 0.0203, d65: 104.41 },
    550: { x: 0.4334, y: 0.9950, z: 0.0087, d65: 104.05 },
    560: { x: 0.5945, y: 0.9950, z: 0.0039, d65: 100.00 },
    570: { x: 0.7621, y: 0.9520, z: 0.0021, d65: 96.33 },
    580: { x: 0.9163, y: 0.8700, z: 0.0017, d65: 95.79 },
    590: { x: 1.0263, y: 0.7570, z: 0.0011, d65: 88.69 },
    600: { x: 1.0622, y: 0.6310, z: 0.0008, d65: 90.01 },
    610: { x: 1.0026, y: 0.5030, z: 0.0003, d65: 89.60 },
    620: { x: 0.8544, y: 0.3810, z: 0.0002, d65: 87.70 },
    630: { x: 0.6424, y: 0.2650, z: 0.0000, d65: 83.29 },
    640: { x: 0.4479, y: 0.1750, z: 0.0000, d65: 83.70 },
    650: { x: 0.2835, y: 0.1070, z: 0.0000, d65: 80.03 },
    660: { x: 0.1649, y: 0.0610, z: 0.0000, d65: 80.21 },
    670: { x: 0.0874, y: 0.0320, z: 0.0000, d65: 82.28 },
    680: { x: 0.0468, y: 0.0170, z: 0.0000, d65: 78.28 },
    690: { x: 0.0227, y: 0.0082, z: 0.0000, d65: 69.72 },
    700: { x: 0.0114, y: 0.0041, z: 0.0000, d65: 71.61 }
};

// Interpolate spectral data to match 10nm intervals
const interpolate = (lambda: number[], values: number[], target: number): number => {
    // Find closest indices
    if (target <= lambda[0]) return values[0];
    if (target >= lambda[lambda.length - 1]) return values[values.length - 1];
    
    const idx = lambda.findIndex(l => l >= target);
    if (idx === -1) return 0;
    
    const x0 = lambda[idx - 1];
    const x1 = lambda[idx];
    const y0 = values[idx - 1];
    const y1 = values[idx];
    
    return y0 + (y1 - y0) * ((target - x0) / (x1 - x0));
};

export const reflectanceToColor = (lambda: number[], R: number[]): { xyz: {x:number, y:number, z:number}, lab: {l:number, a:number, b:number}, rgb: string } => {
    let X = 0, Y = 0, Z = 0;
    let N = 0;

    for (let nm = 400; nm <= 700; nm += 10) {
        const rVal = interpolate(lambda, R, nm); // R is 0-1 or 0-100? Assuming 0-1 for calculation
        const rFactor = rVal > 1 ? rVal / 100 : rVal; // Normalize to 0-1
        
        const props = cmfData[nm];
        if (props) {
            X += rFactor * props.d65 * props.x;
            Y += rFactor * props.d65 * props.y;
            Z += rFactor * props.d65 * props.z;
            N += props.d65 * props.y;
        }
    }

    // Normalize XYZ
    X = (X / N) * 100;
    Y = (Y / N) * 100;
    Z = (Z / N) * 100;

    // XYZ to Lab
    const refX = 95.047;
    const refY = 100.000;
    const refZ = 108.883;

    const f = (val: number) => val > 0.008856 ? Math.pow(val, 1/3) : (7.787 * val) + (16/116);

    const L = (116 * f(Y / refY)) - 16;
    const a = 500 * (f(X / refX) - f(Y / refY));
    const b = 200 * (f(Y / refY) - f(Z / refZ));

    // XYZ to RGB (sRGB)
    let r = (X * 3.2406 + Y * -1.5372 + Z * -0.4986) / 100;
    let g = (X * -0.9689 + Y * 1.8758 + Z * 0.0415) / 100;
    let bl = (X * 0.0557 + Y * -0.2040 + Z * 1.0570) / 100;

    const gammaCorrect = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1/2.4) - 0.055;
    
    r = gammaCorrect(r);
    g = gammaCorrect(g);
    bl = gammaCorrect(bl);

    // Clamp
    r = Math.min(Math.max(r, 0), 1) * 255;
    g = Math.min(Math.max(g, 0), 1) * 255;
    bl = Math.min(Math.max(bl, 0), 1) * 255;

    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

    return {
        xyz: { x: X, y: Y, z: Z },
        lab: { l: L, a, b },
        rgb: `#${toHex(r)}${toHex(g)}${toHex(bl)}`
    };
};

// Kubelka-Munk Theory
// K/S = (1-R)^2 / 2R
export const RtoKS = (R: number): number => {
    const rNorm = Math.max(0.001, Math.min(0.999, R));
    return Math.pow(1 - rNorm, 2) / (2 * rNorm);
};

// R = 1 + (K/S) - sqrt((K/S)^2 + 2(K/S))
export const KStoR = (KS: number): number => {
    return 1 + KS - Math.sqrt(Math.pow(KS, 2) + 2 * KS);
};
