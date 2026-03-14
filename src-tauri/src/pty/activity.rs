use std::collections::VecDeque;
use std::time::{Duration, Instant};

const BUCKET_COUNT: usize = 60;
const BUCKET_DURATION: Duration = Duration::from_secs(60);

pub struct ActivityTracker {
    buckets: VecDeque<u32>,
    current_bucket_start: Instant,
}

impl ActivityTracker {
    pub fn new() -> Self {
        let mut buckets = VecDeque::with_capacity(BUCKET_COUNT);
        buckets.push_back(0);
        Self {
            buckets,
            current_bucket_start: Instant::now(),
        }
    }

    pub fn record(&mut self, bytes: u32) {
        self.rotate();
        if let Some(last) = self.buckets.back_mut() {
            *last = last.saturating_add(bytes);
        }
    }

    pub fn get_buckets(&self) -> Vec<u32> {
        self.buckets.iter().copied().collect()
    }

    fn rotate(&mut self) {
        let elapsed = self.current_bucket_start.elapsed();
        let buckets_elapsed = (elapsed.as_secs() / BUCKET_DURATION.as_secs()) as usize;

        if buckets_elapsed > 0 {
            // Add empty buckets for any gaps
            let to_add = buckets_elapsed.min(BUCKET_COUNT);
            for _ in 0..to_add {
                if self.buckets.len() >= BUCKET_COUNT {
                    self.buckets.pop_front();
                }
                self.buckets.push_back(0);
            }
            self.current_bucket_start = Instant::now();
        }
    }
}
