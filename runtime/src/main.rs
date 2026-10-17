//! The module every JavaScript function package shares. It evaluates the
//! package's bundle, an ES module, then hands each stdin line to the bundle's
//! `__subako_deliver` and runs what that starts until it settles or waits on
//! nothing.
//!
//! The bundle is `/package/main.qjsbc`, QuickJS bytecode `--compile` wrote
//! from `/package/main.js`, so a call skips parsing; or `/package/main.js`
//! itself when there is no bytecode. Bytecode is read unchecked, which can
//! harm only this module's own sandbox, and only this module's QuickJS reads
//! what it wrote, since a package ships the two together.
//!
//! The bundle reaches the worker through `__subako`, a handful of primitives;
//! everything a script expects beyond them (console, timers, fetch) is the
//! SDK's JavaScript, so this module changes only when the primitives do and
//! packages built with different SDK versions keep sharing one compiled copy.

use std::io::{self, BufRead, Write};
use std::time::Duration;

use rquickjs::function::Opt;
use rquickjs::module::WriteOptions;
use rquickjs::promise::PromiseState;
use rquickjs::{
    ArrayBuffer, CatchResultExt, Context, Ctx, Exception, Function, Module, Object, Promise,
    Runtime, TypedArray,
};

const SOURCE: &str = "/package/main.js";
const BYTECODE: &str = "/package/main.qjsbc";
/// Where the evaluated bundle's promise waits for `main` to check it.
const LOADED: &str = "__subako_loaded";

fn start() -> (Runtime, Context) {
    let runtime = Runtime::new().unwrap_or_else(|e| fail(&format!("start QuickJS: {e}")));
    let context = Context::full(&runtime).unwrap_or_else(|e| fail(&format!("start QuickJS: {e}")));
    context.with(|ctx| {
        if let Err(error) = install(&ctx) {
            fail(&format!("install the host functions: {error}"));
        }
    });
    (runtime, context)
}

fn main() {
    let (runtime, context) = start();
    if std::env::args().nth(1).as_deref() == Some("--compile") {
        return compile(&context);
    }
    context.with(|ctx| {
        let loaded = load(&ctx).and_then(|promise| ctx.globals().set(LOADED, promise));
        if let Err(error) = loaded.catch(&ctx) {
            fail(&format!("main.js failed: {error}"));
        }
    });
    settle(&runtime, &context);
    context.with(|ctx| {
        let loaded: Promise = ctx
            .globals()
            .get(LOADED)
            .unwrap_or_else(|e| fail(&format!("main.js: {e}")));
        match loaded.state() {
            PromiseState::Resolved => {}
            PromiseState::Rejected => {
                let error = loaded
                    .result::<()>()
                    .and_then(|result| result.catch(&ctx).err());
                fail(&format!(
                    "main.js failed: {}",
                    error.map(|e| e.to_string()).unwrap_or_default()
                ))
            }
            PromiseState::Pending => fail("main.js is still waiting on its top-level await"),
        }
        if ctx
            .globals()
            .get::<_, Function>("__subako_deliver")
            .is_err()
        {
            fail("main.js did not call serve() from @subako-ai/function-sdk");
        }
    });
    let mut stdin = io::stdin().lock();
    let mut line = String::new();
    loop {
        line.clear();
        match read_line(&mut stdin, &mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => fail(&format!("read stdin: {error}")),
        }
        context.with(|ctx| {
            let deliver: Function = ctx
                .globals()
                .get("__subako_deliver")
                .expect("checked above");
            if let Err(error) = deliver
                .call::<_, ()>((line.trim_end_matches(['\r', '\n']),))
                .catch(&ctx)
            {
                eprintln!("delivering a message failed: {error}");
            }
        });
        settle(&runtime, &context);
    }
}

/// Starts evaluating the bundle, from its bytecode when there is some.
fn load<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Promise<'js>> {
    match std::fs::read(BYTECODE) {
        // SAFETY: see the module doc; the bytes harm at most this sandbox.
        Ok(bytes) => unsafe { Module::load(ctx.clone(), &bytes) }?
            .eval()
            .map(|(_, promise)| promise),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let source = std::fs::read_to_string(SOURCE).map_err(|e| io_error(ctx, SOURCE, e))?;
            Module::evaluate(ctx.clone(), "main.js", source)
        }
        Err(error) => Err(io_error(ctx, BYTECODE, error)),
    }
}

/// `--compile`: writes `/package/main.js` as bytecode to `/package/main.qjsbc`.
fn compile(context: &Context) {
    context.with(|ctx| {
        let written = std::fs::read_to_string(SOURCE)
            .map_err(|e| io_error(&ctx, SOURCE, e))
            .and_then(|source| Module::declare(ctx.clone(), "main.js", source))
            .and_then(|module| module.write(WriteOptions::default()))
            .and_then(|bytes| {
                std::fs::write(BYTECODE, bytes).map_err(|e| io_error(&ctx, BYTECODE, e))
            });
        if let Err(error) = written.catch(&ctx) {
            fail(&format!("compile main.js: {error}"));
        }
    });
}

/// One line, retried while stdin has nothing yet: a host that makes stdin
/// non-blocking answers a read with `WouldBlock` rather than waiting.
fn read_line(stdin: &mut impl BufRead, line: &mut String) -> io::Result<usize> {
    loop {
        match stdin.read_line(line) {
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(1))
            }
            result => return result,
        }
    }
}

/// Runs pending jobs and due timers until `__subako_tick` says nothing is
/// left to wait for, sleeping until the next timer while one is.
fn settle(runtime: &Runtime, context: &Context) {
    loop {
        loop {
            match runtime.execute_pending_job() {
                Ok(true) => continue,
                Ok(false) => break,
                Err(error) => eprintln!("a job failed: {error:?}"),
            }
        }
        let wait = context.with(|ctx| {
            let tick = ctx.globals().get::<_, Function>("__subako_tick").ok()?;
            tick.call::<_, f64>(()).catch(&ctx).ok()
        });
        match wait {
            Some(ms) if ms >= 0.0 => std::thread::sleep(Duration::from_secs_f64(ms / 1000.0)),
            _ => return,
        }
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(2)
}

fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    let host = Object::new(ctx.clone())?;
    host.set("write", Function::new(ctx.clone(), write)?)?;
    host.set("log", Function::new(ctx.clone(), log)?)?;
    host.set("http", Function::new(ctx.clone(), http_request)?)?;
    host.set("readFile", Function::new(ctx.clone(), read_file)?)?;
    host.set("writeFile", Function::new(ctx.clone(), write_file)?)?;
    host.set("mkdir", Function::new(ctx.clone(), mkdir)?)?;
    host.set("remove", Function::new(ctx.clone(), remove)?)?;
    host.set("stat", Function::new(ctx.clone(), stat)?)?;
    host.set("readDir", Function::new(ctx.clone(), read_dir)?)?;
    host.set("encodeUtf8", Function::new(ctx.clone(), encode_utf8)?)?;
    host.set("decodeUtf8", Function::new(ctx.clone(), decode_utf8)?)?;
    host.set("randomBytes", Function::new(ctx.clone(), random_bytes)?)?;
    ctx.globals().set("__subako", host)
}

/// Writes `line` and a newline to stdout, flushed, so the worker reads it now.
fn write(line: String) {
    let mut out = io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn log(line: String) {
    eprintln!("{line}");
}

fn http_request<'js>(ctx: Ctx<'js>, request: String) -> rquickjs::Result<String> {
    http::call(request.as_bytes()).map_err(|e| Exception::throw_message(&ctx, &e))
}

fn read_file<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<ArrayBuffer<'js>> {
    let bytes = std::fs::read(&path).map_err(|e| io_error(&ctx, &path, e))?;
    ArrayBuffer::new(ctx, bytes)
}

fn write_file<'js>(
    ctx: Ctx<'js>,
    path: String,
    bytes: TypedArray<'js, u8>,
    append: Opt<bool>,
) -> rquickjs::Result<()> {
    // SAFETY: the slice is copied before any JavaScript runs.
    let bytes = unsafe { bytes.as_slice() }.to_vec();
    let written = match append.0.unwrap_or(false) {
        true => std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| file.write_all(&bytes)),
        false => std::fs::write(&path, &bytes),
    };
    written.map_err(|e| io_error(&ctx, &path, e))
}

fn mkdir<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<()> {
    std::fs::create_dir_all(&path).map_err(|e| io_error(&ctx, &path, e))
}

/// Removes a file, or a directory with everything in it; a missing path is
/// already removed.
fn remove<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<()> {
    let removed = match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(&path),
        Ok(_) => std::fs::remove_file(&path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    };
    removed.map_err(|e| io_error(&ctx, &path, e))
}

/// `{size, isDirectory}`, or null when nothing is at `path`.
fn stat<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Option<Object<'js>>> {
    match std::fs::metadata(&path) {
        Ok(meta) => {
            let stat = Object::new(ctx)?;
            stat.set("size", meta.len() as f64)?;
            stat.set("isDirectory", meta.is_dir())?;
            Ok(Some(stat))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error(&ctx, &path, e)),
    }
}

/// `[{name, isDirectory}]` for each entry of the directory at `path`.
fn read_dir<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Vec<Object<'js>>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| io_error(&ctx, &path, e))? {
        let entry = entry.map_err(|e| io_error(&ctx, &path, e))?;
        let item = Object::new(ctx.clone())?;
        item.set("name", entry.file_name().to_string_lossy().into_owned())?;
        item.set(
            "isDirectory",
            entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        )?;
        entries.push(item);
    }
    Ok(entries)
}

fn encode_utf8<'js>(ctx: Ctx<'js>, text: String) -> rquickjs::Result<ArrayBuffer<'js>> {
    ArrayBuffer::new(ctx, text.into_bytes())
}

/// The text `bytes` spell, invalid sequences replaced unless `fatal`.
fn decode_utf8<'js>(
    ctx: Ctx<'js>,
    bytes: TypedArray<'js, u8>,
    fatal: Opt<bool>,
) -> rquickjs::Result<String> {
    // SAFETY: the slice is read before any JavaScript runs.
    let bytes = unsafe { bytes.as_slice() };
    match fatal.0.unwrap_or(false) {
        true => std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|_| Exception::throw_type(&ctx, "The encoded data was not valid UTF-8")),
        false => Ok(String::from_utf8_lossy(bytes).into_owned()),
    }
}

unsafe extern "C" {
    /// wasi-libc's and glibc's: fills `len` bytes, at most 256, from the
    /// system's random source.
    fn getentropy(buf: *mut u8, len: usize) -> i32;
}

/// `len` cryptographically random bytes.
fn random_bytes<'js>(ctx: Ctx<'js>, len: usize) -> rquickjs::Result<ArrayBuffer<'js>> {
    let mut bytes = vec![0u8; len];
    for chunk in bytes.chunks_mut(256) {
        // SAFETY: `chunk` is writable for its length, which is at most 256.
        if unsafe { getentropy(chunk.as_mut_ptr(), chunk.len()) } != 0 {
            return Err(Exception::throw_message(&ctx, "no random source"));
        }
    }
    ArrayBuffer::new(ctx, bytes)
}

fn io_error(ctx: &Ctx<'_>, path: &str, error: io::Error) -> rquickjs::Error {
    Exception::throw_message(ctx, &format!("{path}: {error}"))
}

/// The worker's `subako_http` import: a JSON request in, a JSON answer out,
/// `{"ok": response}` or `{"error": {"kind", "message"}}`.
mod http {
    #[cfg(target_family = "wasm")]
    #[link(wasm_import_module = "subako_http")]
    unsafe extern "C" {
        fn request(ptr: *const u8, len: usize) -> i32;
        fn read_response(ptr: *mut u8, len: usize) -> i32;
    }

    #[cfg(target_family = "wasm")]
    pub fn call(body: &[u8]) -> Result<String, String> {
        let failed = |code: i32| format!("subako_http returned {code}");
        // SAFETY: the host reads `body.len()` bytes from `body`'s start.
        let len = unsafe { request(body.as_ptr(), body.len()) };
        let len = usize::try_from(len).map_err(|_| failed(len))?;
        let mut answer = vec![0u8; len];
        // SAFETY: the host writes exactly `len` bytes into `answer`.
        match unsafe { read_response(answer.as_mut_ptr(), len) } {
            0 => String::from_utf8(answer)
                .map_err(|_| "subako_http answered with no text".to_string()),
            code => Err(failed(code)),
        }
    }

    #[cfg(not(target_family = "wasm"))]
    pub fn call(_: &[u8]) -> Result<String, String> {
        Err("subako_http exists only inside the function worker".to_string())
    }
}
