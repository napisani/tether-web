package gateway

const (
	healthRoute   = "GET /healthz"
	readyRoute    = "GET /readyz"
	stateRoute    = "GET /api/v1/state"
	eventsRoute   = "GET /api/v1/events"
	commandsRoute = "POST /api/v1/commands"

	maxCommandBytes = 1 << 20
)
