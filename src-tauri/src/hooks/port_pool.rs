use std::collections::HashSet;
use std::net::TcpListener;
use std::sync::Mutex;

const PORT_RANGE_START: u16 = 7432;
const PORT_RANGE_END: u16 = 7499;

pub struct PortPool {
    in_use: Mutex<HashSet<u16>>,
}

impl PortPool {
    pub fn new() -> Self {
        Self {
            in_use: Mutex::new(HashSet::new()),
        }
    }

    /// Acquire an available port by bind-testing before allocating.
    pub fn acquire(&self) -> Option<u16> {
        let mut in_use = self.in_use.lock().unwrap();
        for port in PORT_RANGE_START..=PORT_RANGE_END {
            if in_use.contains(&port) {
                continue;
            }
            // Bind-test: ensure the port is actually free
            if TcpListener::bind(("127.0.0.1", port)).is_ok() {
                in_use.insert(port);
                return Some(port);
            }
        }
        None
    }

    /// Release a port back to the pool.
    pub fn release(&self, port: u16) {
        self.in_use.lock().unwrap().remove(&port);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_release() {
        let pool = PortPool::new();
        let port = pool.acquire().expect("should acquire a port");
        assert!((PORT_RANGE_START..=PORT_RANGE_END).contains(&port));
        pool.release(port);
        // After release, same port should be acquirable again
        let port2 = pool.acquire().expect("should acquire after release");
        assert_eq!(port, port2);
    }

    #[test]
    fn acquire_multiple_unique() {
        let pool = PortPool::new();
        let p1 = pool.acquire().unwrap();
        let p2 = pool.acquire().unwrap();
        assert_ne!(p1, p2);
        pool.release(p1);
        pool.release(p2);
    }
}
