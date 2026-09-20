// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::Sender as AsyncSender;

pub struct LogWatcher {
    watcher: Option<RecommendedWatcher>,
    current_path: Arc<Mutex<Option<PathBuf>>>,
    // Signals the forwarding thread (spawned in `start`) to exit. Without this
    // the thread blocks forever on the dead event channel and leaks on every
    // start()/stop()/settings-save.
    stop_signal: Mutex<Option<Sender<()>>>,
    // Join handle for the forwarding thread so `stop()` can reap it and avoid
    // accumulating detached threads across repeated start/stop cycles.
    forward_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl LogWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            current_path: Arc::new(Mutex::new(None)),
            stop_signal: Mutex::new(None),
            forward_handle: Mutex::new(None),
        }
    }

    pub fn start(
        &mut self,
        path_str: &str,
        tx: AsyncSender<PathBuf>,
        stability_delay_ms: u64,
    ) -> Result<(), String> {
        // Stop existing watcher + forwarding thread if active
        self.stop();

        let path = Path::new(path_str).to_path_buf();
        if !path.exists() {
            return Err("Directory does not exist".to_string());
        }

        *self.current_path.lock().unwrap() = Some(path.clone());

        // Event channel for the watcher -> forwarding thread
        let (std_tx, std_rx) = mpsc::channel();

        let mut watcher = RecommendedWatcher::new(
            std_tx,
            notify::Config::default().with_poll_interval(Duration::from_secs(1)),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        self.watcher = Some(watcher);

        // Channel used to tell the forwarding thread to stop.
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        *self.stop_signal.lock().unwrap() = Some(stop_tx);

        // Spawn a background thread to forward events to the async tokio channel.
        // Wrapped in catch_unwind: this is the app's ONLY non-tokio thread, so an
        // unwrapped panic here would abort the ENTIRE process (not just this task).
        // Catch + log instead, so a watcher bug degrades to "no new watches" rather
        // than a full app crash. The panic hook still records the backtrace.
        let handle = std::thread::spawn(move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                loop {
                    match std_rx.recv_timeout(Duration::from_millis(500)) {
                        Ok(res) => {
                            match res {
                                Ok(event) => {
                                    if is_log_creation_event(&event) {
                                        for file_path in event.paths {
                                            if let Some(ext) = file_path.extension() {
                                                let ext_str = ext.to_string_lossy().to_lowercase();
                                                if ext_str == "evtc" || ext_str == "zevtc" {
                                                    // Wait for file writing to settle (configurable debounce
                                                    // against ArcDPS partial writes).
                                                    std::thread::sleep(Duration::from_millis(
                                                        stability_delay_ms,
                                                    ));
                                                    let _ = tx.blocking_send(file_path);
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("watch error: {:?}", e);
                                }
                            }
                        }
                        // Timed out with no event: poll the stop signal so the thread
                        // can actually terminate when stop() is called.
                        Err(RecvTimeoutError::Timeout) => {
                            if stop_rx.try_recv().is_ok() {
                                break;
                            }
                        }
                        // Sender dropped: nothing left to read, exit cleanly.
                        Err(_) => break,
                    }
                }
            }));
        });

        *self.forward_handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    pub fn stop(&mut self) {
        // Signal the forwarding thread to exit (it polls this every 500ms).
        if let Some(tx) = self.stop_signal.lock().unwrap().take() {
            let _ = tx.send(());
        }
        if let Some(mut watcher) = self.watcher.take() {
            let path_lock = self.current_path.lock().unwrap();
            if let Some(ref path) = *path_lock {
                let _ = watcher.unwatch(path);
            }
        }
        // Reap the forwarding thread so it never leaks across start/stop cycles.
        if let Some(handle) = self.forward_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
        *self.current_path.lock().unwrap() = None;
    }
}

fn is_log_creation_event(event: &Event) -> bool {
    match event.kind {
        EventKind::Create(_)
        | EventKind::Modify(_)
        | EventKind::Access(notify::event::AccessKind::Close(notify::event::AccessMode::Write)) => {
            true
        }
        _ => false,
    }
}
