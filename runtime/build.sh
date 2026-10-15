#!/bin/sh
# Builds runtime/module.wasm, the module every JavaScript package ships. Run
# it when rquickjs, the host functions, or the toolchain changes, and commit
# the result: every package built with the same file shares one compiled copy
# in the worker. Paths are remapped, so the same source builds the same bytes
# wherever it is built, and CI checks the committed file against a rebuild.
#
# Needs wasi-sdk 25 at $WASI_SDK (default /opt/wasi-sdk).
set -eu
cd "$(dirname "$0")"
WASI_SDK=${WASI_SDK:-/opt/wasi-sdk}
export CC_wasm32_wasip1="$WASI_SDK/bin/clang"
export AR_wasm32_wasip1="$WASI_SDK/bin/llvm-ar"
export CFLAGS_wasm32_wasip1="--sysroot=$WASI_SDK/share/wasi-sysroot -ffile-prefix-map=$PWD=/runtime -ffile-prefix-map=${CARGO_HOME:-$HOME/.cargo}=/cargo"
export RUSTFLAGS="--remap-path-prefix=$PWD=/runtime --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
cargo build --release --locked --target wasm32-wasip1
cp target/wasm32-wasip1/release/module.wasm module.wasm
sha256sum module.wasm
