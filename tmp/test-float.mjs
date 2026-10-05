// Test des conversions FLOAT <-> HH:mm (lib/dash.js)
import { floatVersHHmm, hhmmVersFloat, floatValide } from '../frontend/src/lib/dash.js';

const cas = [7, 7.25, 7.5, 7.75, 8.5, 12.5, 15.5, 22.5, 24, -1, 25, 'abc', '7,5', ''];
for (const c of cas) console.log(String(c).padStart(6), '->', JSON.stringify(floatVersHHmm(c)));
console.log('---');
console.log('07:30 ->', hhmmVersFloat('07:30'), '| 22:00 ->', hhmmVersFloat('22:00'), '| 24:00 ->', hhmmVersFloat('24:00'), '| "xx" ->', hhmmVersFloat('xx'));
console.log('floatValide : 8.5 =', floatValide(8.5), '| -2 =', floatValide(-2), '| 30 =', floatValide(30), '| "abc" =', floatValide('abc'), '| 0 =', floatValide(0), '| 24 =', floatValide(24));
