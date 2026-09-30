// Renders www/icon.svg to the PNGs electron-builder and @capacitor/assets need.
const fs = require('fs');
const sharp = require('sharp');
const svg = fs.readFileSync(__dirname + '/../www/icon.svg');
fs.mkdirSync(__dirname + '/../build', { recursive: true });
fs.mkdirSync(__dirname + '/../assets', { recursive: true });
Promise.all([
  sharp(svg).resize(512, 512).png().toFile(__dirname + '/../build/icon.png'),
  sharp(svg).resize(1024, 1024).png().toFile(__dirname + '/../assets/icon.png')
]).then(() => console.log('icons ready'));
