# App icon

The website and desktop application use the existing tray symbol from `../../assets/menu-icons/tray.svg`: a blue chat bubble with the white Markdown M and download arrow.

`app-icon.png` is a transparent 1024px rasterization of that SVG. `../icon.py` resizes and packages it as ICNS, ICO, the application PNG and favicon PNG. Keep the tray SVG as the source of truth when updating the artwork.
