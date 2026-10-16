const path = require('node:path');

function createMenuIcons(nativeImage) {
 const cache = new Map();
 return name => {
  if (!cache.has(name)) {
   let image;
   try {
    image = nativeImage.createFromPath(path.join(__dirname, '../assets/menu-icons', name + '.png'));
    if (image.isEmpty()) image = undefined;
    else image.setTemplateImage(false);
   } catch {image = undefined;}
   cache.set(name, image);
  }
  return cache.get(name);
 };
}

module.exports = {createMenuIcons};
