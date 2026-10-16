# Third-party notices

- **Marked 15.0.12**, Copyright (c) 2011–2025 Christopher Jeffrey and contributors, MIT License.
  - Upstream: https://github.com/markedjs/marked
  - Vendored UMD build: `assets/vendor/marked.js`
  - Original license: `assets/vendor/LICENSE.md`
  - Distribution source: https://cdn.jsdelivr.net/npm/marked@15.0.12/lib/marked.umd.js

Marked is bundled locally. Loading md2chat does not contact a CDN.

- **Mermaid 12.1.0**, MIT License.
  - Upstream: https://github.com/mermaid-js/mermaid
  - Build: `assets/vendor/mermaid/mermaid.min.js`
  - License: `assets/vendor/mermaid/LICENSE`; bundled dependency notices are retained in the build.
  - Source: https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js

- **MathJax 3.2.2**, Apache License 2.0.
  - Upstream: https://github.com/mathjax/MathJax
  - Build: `assets/vendor/mathjax/tex-svg.js`
  - License: `assets/vendor/mathjax/LICENSE`
  - Source: https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js

The renderer bundles are unmodified and served from the same static site. No content is sent to an external renderer.

- **Highlight.js 11.12.0**, BSD 3-Clause License.
  - Upstream: https://github.com/highlightjs/highlight.js
  - Common-language build: `assets/vendor/highlight/highlight.min.js`
  - License: `assets/vendor/highlight/LICENSE`
  - Source: https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js
  - Served locally and loaded only when rendering code blocks; source code is not uploaded.

- **Tauri 2.12.4** and **Tauri updater 2.14.0**, MIT OR Apache-2.0.
  - Upstream: https://github.com/tauri-apps/tauri and https://github.com/tauri-apps/plugins-workspace
  - License texts: `assets/licenses/tauri-MIT.txt`, `assets/licenses/tauri-plugins-MIT.txt`, and `assets/licenses/tauri-Apache-2.0.txt`.
  - The desktop shell uses system WebViews. Rust dependency versions are recorded in `src-tauri/Cargo.lock`; updater checks and downloads releases from GitHub.
  - Electron and electron-updater are not included in Tauri desktop packages.

## Platform identifiers

Platform logos are used only to identify the corresponding copy destinations. They remain the property and trademarks of their respective owners; the project license does not license these marks or imply endorsement. The following sources were verified on 2026-10-16:

| Local asset | Official page | Official source and local preparation |
| --- | --- | --- |
| `assets/platforms/wechat.svg` | [WeChat](https://www.wechat.com/en/) | [Official touch icon](https://newres.wechat.com/t/fed_upload/08b92997-2415-408f-b706-442ed4ede518/OTE0YTAw.png), original PNG bytes embedded in a self-contained SVG. |
| `assets/platforms/dingtalk.svg` | [DingTalk](https://www.dingtalk.com/) | [Official favicon](https://gw.alicdn.com/imgextra/i3/O1CN014ZbI6ZTEhdC0ttN2_!!6000000003783-2-tps-444-444.png), original PNG bytes embedded in a self-contained SVG. |
| `assets/platforms/feishu.svg` | [Feishu](https://www.feishu.cn/) | [Official header logo](https://p1-hera.feishucdn.com/tos-cn-i-jbbdkfciu3/eff71c9398c04ebd8452d748646fc1e8.png~tplv-jbbdkfciu3-png:0:0.png), original PNG bytes embedded in an SVG viewport that excludes the wordmark. |
| `assets/platforms/wecom.svg` | [WeCom](https://work.weixin.qq.com/) | `LogoSingle` from the [official vector sprite](https://wwcdn.weixin.qq.com/node/wwnl/wwnl/style/images/officialImages$hab21d86.svg), with its original paths and colors centered in a square viewport. |

`assets/platforms/email.svg` is a generic envelope drawn for this project, rather than a mail provider's logo. The tray PNGs were generated locally from these same SVGs and are provided at 1× and 2× resolutions. All icon assets are bundled locally; displaying them does not fetch third-party resources.
