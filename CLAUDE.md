## Coding guidelines

- All comments and documents are in English, concise, and describe the code as it stands; history belongs in git.
- Pin GitHub Actions to a commit SHA, with the tag in a trailing comment.
- `src/server.ts` answers as the Rust function SDK (`subako-function-sdk` on crates.io) does; keep the two in step.
- `runtime/module.wasm` is committed. After changing anything under `runtime/`, run `runtime/build.sh` and commit the result; CI checks it matches a rebuild.
