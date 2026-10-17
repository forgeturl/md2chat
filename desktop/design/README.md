# App icon

The website and desktop application use the existing tray symbol from `../../assets/menu-icons/tray.svg`: a blue chat bubble with the white Markdown M and download arrow.

`app-icon.png` is a transparent 1024px rasterization of that SVG. `../icon.py` resizes and packages it as ICNS, ICO, the application PNG and favicon PNG. Keep the tray SVG as the source of truth when updating the artwork.

The macOS ICNS centers the visible artwork inside an 824px box on a transparent 1024px canvas, matching the visual footprint of standard Dock icons. Windows and web exports retain their existing sizing. Run `python3 desktop/icon.py` to regenerate, then `python3 desktop/test_icon.py` to check the packaged macOS sizes and margins (Pillow required).
