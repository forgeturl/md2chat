"""Regenerate the md2chat app icon (optional; requires Pillow)."""
from PIL import Image, ImageDraw
from pathlib import Path
import tempfile, subprocess
with tempfile.TemporaryDirectory() as root:
    folder=Path(root)/'md2chat.iconset';folder.mkdir()
    img=Image.new('RGBA',(1024,1024));d=ImageDraw.Draw(img)
    d.rounded_rectangle((70,70,954,954),radius=210,fill='#18594a')
    # A compact m and an outgoing arrow, matching the website mark.
    d.line([(245,680),(245,410),(345,410),(390,460),(440,410),(535,410),(535,680)],fill='white',width=72,joint='curve')
    d.line([(390,460),(390,680)],fill='white',width=64)
    d.line([(620,625),(795,390)],fill='white',width=66)
    d.line([(635,390),(800,390),(800,555)],fill='white',width=66,joint='curve')
    for size in (16,32,128,256,512):
        for scale in (1,2):
            suffix='@2x' if scale==2 else ''
            img.resize((size*scale,size*scale),Image.Resampling.LANCZOS).save(folder/f'icon_{size}x{size}{suffix}.png')
    img.save(Path(__file__).with_name('icon.icns'), format='ICNS')

    img.save(Path(__file__).with_name('icon.ico'), format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
