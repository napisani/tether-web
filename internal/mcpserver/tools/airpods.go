package tools

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
)

const airPodsConnectTimeout = 30 * time.Second

var (
	airPodsModes  = []string{"off", "transparency", "adaptive", "anc"}
	airPodsPauses = []string{"never", "one-removed", "both-removed"}
)

type airPodsState struct {
	Address        string  `json:"address"`
	Name           string  `json:"name"`
	Left           float64 `json:"left"`
	Right          float64 `json:"right"`
	Case           float64 `json:"case"`
	InEar          float64 `json:"in_ear"`
	PeerTakingOver bool    `json:"peer_taking_over"`
	PeerActive     bool    `json:"peer_active"`
	PeerAudio      bool    `json:"peer_audio"`
	PeerCall       bool    `json:"peer_call"`
	PeerHoldsAudio bool    `json:"peer_holds_audio"`
	ANC            string  `json:"anc,omitempty"`
	Status         string  `json:"status"`
	Reason         string  `json:"reason"`
	Ear            struct {
		Primary   string `json:"primary"`
		Secondary string `json:"secondary"`
	} `json:"ear"`
}

type airPodsResult struct {
	AirPods     airPodsState `json:"airpods"`
	Managed     *bool        `json:"managed,omitempty"`
	AutoPause   string       `json:"auto_pause,omitempty"`
	CallHandoff *bool        `json:"call_handoff,omitempty"`
}

type connectAirPodsInput struct {
	Address string `json:"address" jsonschema:"AirPods Bluetooth address from list_bluetooth_devices"`
	Connect bool   `json:"connect" jsonschema:"true to connect, false to disconnect"`
}

type airPodsModeInput struct {
	Mode string `json:"mode" jsonschema:"off, transparency, adaptive or anc"`
}

type airPodsPauseInput struct {
	Mode string `json:"mode" jsonschema:"never, one-removed or both-removed"`
}

func (t *Set) airPodsReady() error { return t.featureReady("airpods") }

func (t *Set) registerAirPodsTools(server *mcp.Server) {
	notDestructive := false
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_airpods",
		Description: "Read AirPods connection, battery, ear detection, audio state and tetherd's AirPods options.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.getAirPods)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "connect_airpods",
		Description: "Connect or disconnect AirPods. The result is not attributed to this request; check get_airpods.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive},
	}, t.connectAirPods)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "set_airpods_managed",
		Description: "Turn tetherd's AirPods management on or off. The result is observed from host status.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setAirPodsManaged)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "set_airpods_noise_control",
		Description: "Set the AirPods noise-control mode: off, transparency, adaptive or anc. The AirPods must be live.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setAirPodsNoiseControl)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "set_airpods_auto_pause",
		Description: "Choose when removing AirPods pauses audio: never, one-removed or both-removed.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setAirPodsAutoPause)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "set_airpods_call_handoff",
		Description: "Turn automatic AirPods call handoff on or off. The result is observed from host status.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setAirPodsCallHandoff)
}

func (t *Set) currentAirPods(ctx context.Context) (airPodsState, error) {
	state, err := requestAs[airPodsState](t, ctx, t.airPodsReady, map[string]any{"command": "bt_airpods"}, "bt_airpods", nil)
	state.Address = boundedText(state.Address, maxAddressBytes)
	state.Name = boundedText(state.Name, 256)
	state.Reason = boundedText(state.Reason, 512)
	return state, err
}

func (t *Set) getAirPods(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, airPodsResult, error) {
	state, err := t.currentAirPods(ctx)
	if err != nil {
		return nil, airPodsResult{}, err
	}
	result := airPodsResult{AirPods: state}
	t.mu.Lock()
	if t.host != nil {
		result.Managed, result.AutoPause, result.CallHandoff = t.host.AirPodsEnabled, t.host.AirPodsPause, t.host.AirPodsHandoff
	}
	t.mu.Unlock()
	return nil, result, nil
}

func (t *Set) connectAirPods(ctx context.Context, _ *mcp.CallToolRequest, input connectAirPodsInput) (*mcp.CallToolResult, operationResult, error) {
	if !validAddress(input.Address) {
		return nil, operationResult{}, errors.New("address is required and must be at most 128 bytes")
	}
	result, err := t.dispatch(ctx, action{
		subject: "AirPods connection", timeout: airPodsConnectTimeout, ready: t.airPodsReady,
		start: func(string) (any, observer) {
			command := map[string]any{"command": "bt_airpods_connect", "address": input.Address, "connect": input.Connect}
			return command, resultObserver("bt_airpods_connect_result", "tetherd reported the AirPods connection request finished.")
		},
	})
	return nil, result, err
}

func (t *Set) setAirPodsManaged(ctx context.Context, _ *mcp.CallToolRequest, input setToggleInput) (*mcp.CallToolResult, operationResult, error) {
	result, err := t.changeHostSetting(ctx, hostSetting{
		capability: "airpods", command: "bt_airpods_enable", fields: map[string]any{"enabled": input.Enabled}, expected: input.Enabled,
		get: func(s *hostSettings) any { return boolValue(s.AirPodsEnabled) },
	})
	return nil, result, err
}

func (t *Set) setAirPodsAutoPause(ctx context.Context, _ *mcp.CallToolRequest, input airPodsPauseInput) (*mcp.CallToolResult, operationResult, error) {
	if !slices.Contains(airPodsPauses, input.Mode) {
		return nil, operationResult{}, errors.New("mode must be never, one-removed or both-removed")
	}
	result, err := t.changeHostSetting(ctx, hostSetting{
		capability: "airpods", command: "bt_airpods_pause", fields: map[string]any{"mode": input.Mode}, expected: input.Mode,
		get: func(s *hostSettings) any { return stringValue(s.AirPodsPause) },
	})
	return nil, result, err
}

func (t *Set) setAirPodsCallHandoff(ctx context.Context, _ *mcp.CallToolRequest, input setToggleInput) (*mcp.CallToolResult, operationResult, error) {
	result, err := t.changeHostSetting(ctx, hostSetting{
		capability: "airpods", command: "bt_airpods_handoff", fields: map[string]any{"enabled": input.Enabled}, expected: input.Enabled,
		get: func(s *hostSettings) any { return boolValue(s.AirPodsHandoff) },
	})
	return nil, result, err
}

func (t *Set) setAirPodsNoiseControl(ctx context.Context, _ *mcp.CallToolRequest, input airPodsModeInput) (*mcp.CallToolResult, operationResult, error) {
	if !slices.Contains(airPodsModes, input.Mode) {
		return nil, operationResult{}, errors.New("mode must be off, transparency, adaptive or anc")
	}
	state, err := t.currentAirPods(ctx)
	if err != nil {
		return nil, operationResult{}, err
	}
	if state.Status != "live" {
		return nil, operationResult{}, errors.New("the AirPods are not live; connect them first (get_airpods shows their status)")
	}
	if state.ANC == input.Mode {
		result, err := t.complete("AirPods mode", observation{status: statusObserved, message: "The AirPods already use this mode."})
		return nil, result, err
	}
	result, err := t.dispatch(ctx, action{
		subject: "AirPods mode", timeout: settingTimeout, ready: t.airPodsReady,
		start: func(string) (any, observer) {
			command := map[string]any{"command": "bt_airpods_mode", "mode": input.Mode}
			return command, func(event gateway.Event, name string) (observation, bool) {
				switch name {
				case "bt_airpods":
					var reply airPodsState
					if json.Unmarshal(event.Data, &reply) == nil && reply.ANC == input.Mode {
						return observation{status: statusObserved, message: "The AirPods now report this mode."}, true
					}
				case "bt_airpods_mode_result":
					return resultObserver("bt_airpods_mode_result", "tetherd reported the mode change finished.")(event, name)
				}
				return observation{}, false
			}
		},
	})
	return nil, result, err
}
