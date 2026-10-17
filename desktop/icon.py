"""Package the source artwork into platform icon formats (requires Pillow)."""
from PIL import Image
from pathlib import Path
root = Path(__file__).resolve().parent
image = Image.open(root / 'design/app-icon.png').convert('RGBA')
# macOS Dock icons need transparent space around their visible artwork.
# Match the ~80.5% footprint of standard macOS icons; the shared source also
# serves small website/Windows icons, where adding this padding is undesirable.
artwork = image.crop(image.getchannel('A').getbbox())
artwork.thumbnail((824, 824), Image.Resampling.LANCZOS)
mac_icon = Image.new('RGBA', (1024, 1024))
mac_icon.alpha_composite(artwork, ((1024 - artwork.width) // 2, (1024 - artwork.height) // 2))
mac_icon.save(root / 'icon.icns', format='ICNS')
image.save(root / 'icon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.resize((512, 512), Image.Resampling.LANCZOS).save(root.parent / 'assets/app-icon.png', optimize=True)
image.resize((64, 64), Image.Resampling.LANCZOS).save(root.parent / 'assets/favicon.png', optimize=True)
