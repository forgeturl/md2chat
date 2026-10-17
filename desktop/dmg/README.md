# DMG installation window

`background.svg` is the editable source for the installer guidance. The
committed `background.png` and `background@2x.png` are the 1x and Retina
assets consumed by `dmgbuild` and by Tauri's local DMG fallback.

The release build uses `dmgbuild` because Tauri skips Finder-based DMG layout
customization in CI. `settings.py` writes the Finder layout directly, keeping
the app on the left and the Applications shortcut on the right.

When the SVG changes, render it at 1320 x 800, save that result as
`background@2x.png`, and downsample it to 660 x 400 as `background.png`.
