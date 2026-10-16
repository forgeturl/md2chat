"""Package the Image Gen design into platform icon formats (requires Pillow)."""
from PIL import Image
from pathlib import Path
root = Path(__file__).resolve().parent
image = Image.open(root / 'design/app-icon.png').convert('RGBA')
image.resize((1024, 1024), Image.Resampling.LANCZOS).save(root / 'icon.icns', format='ICNS')
image.save(root / 'icon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.resize((512, 512), Image.Resampling.LANCZOS).save(root.parent / 'assets/app-icon.png', optimize=True)
image.resize((64, 64), Image.Resampling.LANCZOS).save(root.parent / 'assets/favicon.png', optimize=True)
