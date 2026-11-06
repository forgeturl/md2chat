use std::time::{Duration, Instant};

const RENDER_TIMEOUT: Duration = Duration::from_secs(60);

// Human input has no render deadline. Closing the prompt still settles the
// original oneshot immediately; actual rendering receives a fresh bounded wait.
pub(crate) struct Deadline {
    expires: Instant,
    waiting: bool,
}

impl Deadline {
    pub(crate) fn new(now: Instant) -> Self {
        Self { expires: now + RENDER_TIMEOUT, waiting: false }
    }

    pub(crate) fn set_waiting(&mut self, waiting: bool, now: Instant) {
        if self.waiting && !waiting { self.expires = now + RENDER_TIMEOUT; }
        self.waiting = waiting;
    }

    pub(crate) fn remaining(&self, now: Instant) -> Option<Duration> {
        if self.waiting { None } else { Some(self.expires.saturating_duration_since(now)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn human_input_pauses_the_deadline_and_rendering_remains_bounded() {
        let start = Instant::now();
        let mut deadline = Deadline::new(start);
        assert_eq!(deadline.remaining(start + Duration::from_secs(61)), Some(Duration::ZERO));
        deadline.set_waiting(true, start);
        assert_eq!(deadline.remaining(start + Duration::from_secs(3600)), None);
        let resumed = start + Duration::from_secs(3600);
        deadline.set_waiting(false, resumed);
        assert_eq!(deadline.remaining(resumed), Some(Duration::from_secs(60)));
        deadline.set_waiting(false, resumed + Duration::from_secs(50));
        assert_eq!(deadline.remaining(resumed + Duration::from_secs(61)), Some(Duration::ZERO));
    }
}
