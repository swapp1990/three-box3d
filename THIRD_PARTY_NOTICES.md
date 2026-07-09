# Third-Party Notices

This file aggregates third-party license notices for code compiled into or
distributed with the `three-box3d` native WASM build and toolchain.

## box3d

box3d is Copyright (c) 2026 Erin Catto and is licensed under the MIT License.

```text
MIT License

Copyright (c) 2026 Erin Catto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Source: https://github.com/erincatto/box3d (pinned tag v0.1.0, commit
8441b4a06d6d09dcfb0b0f704df4d847d1437b92; see `native/BOX3D_VERSION`).
Only `include/` and `src/` are compiled into `native/dist/box3d.wasm`.

## Excluded Dependencies (NOT Compiled Or Distributed)

box3d's `samples/` tree, including its own `extern/` directory, is excluded
from this project's Emscripten build via the include path and source list in
`native/scripts/build-wasm.sh`. The following third-party code lives only under
box3d's `samples/extern` tree, is never linked into this project's WASM output,
and is listed here only for transparency and completeness, not because it ships
with `three-box3d`.

### extern/sokol

`extern/sokol` is Copyright (c) 2018 Andre Weissflog and is licensed under the
zlib/libpng license.

```text
This software is provided "as-is", without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use of
this software.

Permission is granted to anyone to use this software for any purpose, including
commercial applications, and to alter it and redistribute it freely, subject to
the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a
   product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```

### samples/jsmn.h

`samples/jsmn.h` is Copyright (c) 2010 Serge Zaitsev and is licensed under the
MIT License.

### samples/tiny_obj_loader.h

`samples/tiny_obj_loader.h` is Copyright (c) 2012-Present, Syoyo Fujita and many
contributors, and is licensed under the MIT License.

## Emscripten Toolchain

The WASM build uses the Emscripten compiler toolchain, emsdk pinned at version
6.0.2, at build time only: https://github.com/emscripten-core/emsdk.

The Emscripten-generated runtime glue that this project's own hand-written
loader is modeled after is Copyright (c) Emscripten authors and licensed under
the MIT License; see
https://github.com/emscripten-core/emscripten/blob/main/LICENSE.

emsdk itself is a build-time tool. Its own third-party bundled components, such
as LLVM and Binaryen, are not distributed with this project's published npm
packages. Only the compiled `.wasm` output is distributed.

## Maintenance

This file is maintained by hand. If `native/bridge.c` or
`native/scripts/build-wasm.sh` ever links additional third-party source, add its
notice here in the same pattern before the next release.
