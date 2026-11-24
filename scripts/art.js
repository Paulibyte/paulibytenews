// Generates placeholder artwork (covers, product shots, icons) as SVG → raster via sharp.
const sharp = require('sharp');

const PALETTES = [
  ['#0B1230', '#2F6BFF', '#7AA2FF'], ['#1A0B2E', '#8B5CF6', '#F472B6'], ['#06201B', '#0EA371', '#7CE7C0'],
  ['#2A0E05', '#FF5A1F', '#FFC069'], ['#0A1A2A', '#06B6D4', '#A5F3FC'], ['#1E1B0A', '#F5B301', '#FFE08A'],
];
const SHAPES = {
  phone: (c) => `<g transform="translate(560 70) rotate(-12)"><rect width="230" height="460" rx="38" fill="#0A0E1A" stroke="${c[2]}" stroke-width="6"/><rect x="16" y="18" width="198" height="424" rx="26" fill="url(#scr)"/><circle cx="115" cy="44" r="8" fill="#0A0E1A"/></g>`,
  laptop: (c) => `<g transform="translate(330 150)"><rect width="520" height="320" rx="18" fill="#0A0E1A" stroke="${c[2]}" stroke-width="6"/><rect x="20" y="20" width="480" height="280" rx="8" fill="url(#scr)"/><path d="M-50 330h620l-40 40H-10z" fill="${c[2]}" opacity=".9"/></g>`,
  buds: (c) => `<g transform="translate(470 150)"><rect width="330" height="250" rx="110" fill="#F3F5FA"/><rect y="105" width="330" height="8" fill="#C9D0DE"/><ellipse cx="110" cy="70" rx="44" ry="34" fill="#fff" stroke="${c[1]}" stroke-width="5"/><ellipse cx="220" cy="70" rx="44" ry="34" fill="#fff" stroke="${c[1]}" stroke-width="5"/></g>`,
  watch: (c) => `<g transform="translate(540 60)"><rect x="55" width="130" height="500" rx="40" fill="${c[1]}" opacity=".85"/><rect y="130" width="240" height="260" rx="60" fill="#0A0E1A" stroke="${c[2]}" stroke-width="6"/><rect x="22" y="152" width="196" height="216" rx="44" fill="url(#scr)"/><text x="120" y="275" text-anchor="middle" font-family="Arial" font-weight="700" font-size="56" fill="#fff">10:09</text></g>`,
  chip: (c) => `<g transform="translate(470 120)"><rect width="320" height="320" rx="34" fill="#0A0E1A" stroke="${c[2]}" stroke-width="6"/><rect x="70" y="70" width="180" height="180" rx="16" fill="url(#scr)"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${30 + i * 36}" y="-26" width="14" height="26" fill="${c[2]}"/><rect x="${30 + i * 36}" y="320" width="14" height="26" fill="${c[2]}"/><rect y="${30 + i * 36}" x="-26" height="14" width="26" fill="${c[2]}"/><rect y="${30 + i * 36}" x="320" height="14" width="26" fill="${c[2]}"/>`).join('')}<text x="160" y="175" text-anchor="middle" font-family="Arial" font-weight="700" font-size="44" fill="#fff">AI</text></g>`,
  router: (c) => `<g transform="translate(360 200)"><rect width="520" height="150" rx="30" fill="#0A0E1A" stroke="${c[2]}" stroke-width="6"/>${[0, 1, 2, 3, 4].map(i => `<circle cx="${90 + i * 60}" cy="75" r="9" fill="${i < 3 ? '#0EA371' : c[2]}"/>`).join('')}<rect x="60" y="-150" width="18" height="150" rx="9" fill="#0A0E1A"/><rect x="442" y="-150" width="18" height="150" rx="9" fill="#0A0E1A"/><path d="M260 -40a120 120 0 0 1 0 0" /><path d="M170 -30q90 -80 180 0M200 0q60 -50 120 0" stroke="${c[2]}" stroke-width="10" fill="none" stroke-linecap="round"/></g>`,
  rocket: (c) => `<g transform="translate(560 70) rotate(30)"><path d="M90 0c60 60 80 160 60 300H30C10 160 30 60 90 0z" fill="#F3F5FA"/><circle cx="90" cy="130" r="34" fill="${c[1]}"/><path d="M30 240-20 330l60-20zM150 240l50 90-60-20z" fill="${c[1]}"/><path d="M45 300h90l-45 110z" fill="#FF5A1F"/></g>`,
  game: (c) => `<g transform="translate(400 190)"><path d="M90 0h300c70 0 110 60 120 140s-40 120-90 70l-60-60H120l-60 60C10 260-40 220-30 140S20 0 90 0z" fill="#0A0E1A" stroke="${c[2]}" stroke-width="6"/><path d="M110 85v70M75 120h70" stroke="#fff" stroke-width="16" stroke-linecap="round"/><circle cx="370" cy="95" r="15" fill="${c[1]}"/><circle cx="410" cy="135" r="15" fill="#FF5A1F"/><circle cx="330" cy="135" r="15" fill="#0EA371"/><circle cx="370" cy="175" r="15" fill="#F5B301"/></g>`,
};

function svgCover(shape, pal, w = 1200, h = 675) {
  const c = PALETTES[pal % PALETTES.length];
  const dots = Array.from({ length: 22 }, (_, i) => `<circle cx="${(i * 137) % w}" cy="${(i * 89) % h}" r="${2 + (i % 4)}" fill="${c[2]}" opacity=".35"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1200 675">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient>
  <linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0v40" fill="none" stroke="#fff" stroke-opacity=".07"/></pattern></defs>
  <rect width="1200" height="675" fill="url(#bg)"/><rect width="1200" height="675" fill="url(#grid)"/>
  <circle cx="980" cy="120" r="260" fill="${c[2]}" opacity=".18"/><circle cx="160" cy="600" r="220" fill="#000" opacity=".18"/>${dots}
  ${(SHAPES[shape] || SHAPES.chip)(c)}</svg>`;
}

async function cover(file, shape, pal, w = 1200) {
  const h = Math.round(w * 675 / 1200);
  await sharp(Buffer.from(svgCover(shape, pal, w, h))).webp({ quality: 80 }).toFile(file);
}

const LOGO = (size, bg = '#0A0E1A', rounded = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40"><rect width="40" height="40" rx="${rounded ? 10 : 0}" fill="${bg}"/><path d="M15 12 8 20l7 8" fill="none" stroke="#3D7BFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 28V12h5.5a4.5 4.5 0 0 1 0 9H20" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="28" r="3" fill="#FF5A1F"/></svg>`;

async function icons(dir) {
  const fs = require('fs');
  fs.writeFileSync(dir + '/favicon.svg', LOGO(40));
  await sharp(Buffer.from(LOGO(192, '#0A0E1A', false))).png().toFile(dir + '/icon-192.png');
  await sharp(Buffer.from(LOGO(512, '#0A0E1A', false))).png().toFile(dir + '/icon-512.png');
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0A0E1A"/><g transform="translate(120 215) scale(5)">${LOGO(40).replace(/<\/?svg[^>]*>/g, '')}</g><text x="360" y="320" font-family="Arial, sans-serif" font-weight="700" font-size="92" fill="#fff">Paulibyte<tspan fill="#3D7BFF">News</tspan></text><text x="364" y="385" font-family="Arial, sans-serif" font-size="34" fill="#9AA4BE">Tech news · honest reviews · live Review Lab</text></svg>`;
  await sharp(Buffer.from(og)).png().toFile(dir + '/og-default.png');
}

module.exports = { cover, icons };
if (require.main === module) icons(require('path').join(__dirname, '..', 'public', 'img')).then(() => console.log('icons written'));
