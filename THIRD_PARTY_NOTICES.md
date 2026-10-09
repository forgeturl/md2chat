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
