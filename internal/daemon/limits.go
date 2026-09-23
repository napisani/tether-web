package daemon

import "time"

const (
	maxSubscribers  = 64
	maxReplayEvents = 256
	maxReplayBytes  = 4 << 20
	maxFrameBytes   = 16 << 20
	maxRetryDelay   = 30 * time.Second
	stableSession   = 30 * time.Second
	writeTimeout    = 5 * time.Second
	dialLogInterval = time.Minute
)
