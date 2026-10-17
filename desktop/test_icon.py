"""Check the actual macOS icon shipped by Tauri (requires Pillow)."""
from pathlib import Path
import unittest
from PIL import Image


class DockIconTests(unittest.TestCase):
    def test_dock_artwork_has_balanced_transparent_padding_at_every_scale(self):
        path = Path(__file__).resolve().parent / 'icon.icns'
        for size in [128, 256, 512, 1024]:
            with self.subTest(size=size), Image.open(path) as icon:
                icon.size = (512, 512) if size == 1024 else (size, size)
                icon.load(scale=2 if size == 1024 else 1)
                alpha = icon.convert('RGBA').getchannel('A')
                left, top, right, bottom = alpha.point(lambda a: 255 if a >= 128 else 0).getbbox()
                footprint = max(right - left, bottom - top) / size
                self.assertGreaterEqual(footprint, .78)
                self.assertLessEqual(footprint, .83, 'Dock artwork needs transparent padding')
                self.assertLessEqual(abs(left - (size - right)), 2)
                self.assertLessEqual(abs(top - (size - bottom)), 2)


if __name__ == '__main__':
    unittest.main()
