import os


application = os.path.abspath(defines["app"])  # noqa: F821
background = os.path.abspath(defines["background"])  # noqa: F821
app_name = os.path.basename(application)

format = "UDZO"
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}

window_rect = ((200, 200), (660, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

arrange_by = None
label_pos = "bottom"
text_size = 14
icon_size = 96
icon_locations = {
    app_name: (170, 220),
    "Applications": (490, 220),
}
