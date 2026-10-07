package tools

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
)

const settingTimeout = 12 * time.Second

// hostSetting describes one daemon-global setting that tetherd reports in
// bt_status. Completion is observed from that status, not from a command reply.
type hostSetting struct {
	capability string
	command    string
	fields     map[string]any
	expected   any
	get        func(*hostSettings) any
	requires   func(*hostSettings) error
}

type setToggleInput struct {
	Enabled bool `json:"enabled" jsonschema:"true to turn the setting on, false to turn it off"`
}

type setRetentionInput struct {
	Retention string `json:"retention" jsonschema:"encrypted, plaintext or none. plaintext and none ask for confirmation first"`
}

func boolValue(value *bool) any {
	if value == nil {
		return nil
	}
	return *value
}

func stringValue(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func bonded(settings *hostSettings) error {
	if !settings.Available || settings.DeviceAddress == "" || (settings.Enabled != nil && !*settings.Enabled) {
		return errors.New("no iPhone is bonded and enabled on this Bluetooth host; use list_bluetooth_devices")
	}
	return nil
}

func bondedHost(settings *hostSettings) error {
	if !settings.Available || settings.DeviceAddress == "" {
		return errors.New("no iPhone is bonded on this Bluetooth host; use list_bluetooth_devices")
	}
	return nil
}

func (t *Set) registerSettingTools(server *mcp.Server) {
	notDestructive := false
	destructive := true
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_settings",
		Description: "Read tetherd host settings: notification mirroring, call control, message retention, Bluetooth and AirPods options.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.getSettings)
	mcp.AddTool(server, &mcp.Tool{
		Name: "set_notification_mirroring",
		Description: "Turn host notification mirroring on or off. The result is observed from host status, not attributed " +
			"to this request. Use get_operation to check it.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setNotificationMirroring)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "set_notification_content",
		Description: "Choose whether mirrored notifications include their content. Requires notification mirroring on.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setNotificationContent)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "set_call_control",
		Description: "Turn host call control on or off. Calls also require the iPhone to connect Hands-Free.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive, IdempotentHint: true},
	}, t.setCallControl)
	mcp.AddTool(server, &mcp.Tool{
		Name: "set_message_retention",
		Description: "Choose how tetherd keeps message history and contacts: encrypted, plaintext or none. plaintext stores " +
			"readable files on the host and none permanently deletes retained history, so both return a confirmation " +
			"request first. Nothing changes until confirm_action approves it.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &destructive, IdempotentHint: true},
	}, t.setMessageRetention)
}

func (t *Set) getSettings(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, hostSettings, error) {
	reply, err := requestAs[hostSettings](t, ctx, func() error { return t.featureReady("settings") },
		map[string]any{"command": "bt_status"}, "bt_status", nil)
	if err != nil {
		return nil, hostSettings{}, err
	}
	reply.DeviceAddress = boundedText(reply.DeviceAddress, 128)
	return nil, reply, nil
}

// changeHostSetting dispatches one observed setting change. A setting that
// already has the requested value completes without contacting tetherd.
func (t *Set) changeHostSetting(ctx context.Context, setting hostSetting) (operationResult, error) {
	var current any
	ready := func() error {
		if err := t.featureReady(setting.capability); err != nil {
			return err
		}
		if t.host == nil {
			return errors.New("host settings are not loaded yet; call get_settings")
		}
		if current = setting.get(t.host); current == nil {
			return errors.New("this tetherd version does not report that setting")
		}
		if setting.requires != nil {
			return setting.requires(t.host)
		}
		return nil
	}
	t.mu.Lock()
	err := ready()
	unchanged := err == nil && current == setting.expected
	t.mu.Unlock()
	if err != nil {
		return operationResult{}, err
	}
	if unchanged {
		return t.complete("setting", observation{status: statusObserved, message: "The setting already has the requested value."})
	}
	return t.dispatch(ctx, action{
		subject: "setting", timeout: settingTimeout, ready: ready,
		start: func(string) (any, observer) {
			command := map[string]any{"command": setting.command}
			for key, value := range setting.fields {
				command[key] = value
			}
			return command, func(event gateway.Event, name string) (observation, bool) {
				var status hostSettings
				if name != "bt_status" || json.Unmarshal(event.Data, &status) != nil || setting.get(&status) != setting.expected {
					return observation{}, false
				}
				return observation{status: statusObserved, message: "Host status now reports the requested value. Another client could have caused it."}, true
			}
		},
	})
}

func (t *Set) setNotificationMirroring(ctx context.Context, _ *mcp.CallToolRequest, input setToggleInput) (*mcp.CallToolResult, operationResult, error) {
	result, err := t.changeHostSetting(ctx, hostSetting{
		capability: "settings", command: "bt_set_ancs", fields: map[string]any{"enabled": input.Enabled}, expected: input.Enabled,
		get: func(s *hostSettings) any { return boolValue(s.ANCSEnabled) }, requires: bonded,
	})
	return nil, result, err
}

func (t *Set) setNotificationContent(ctx context.Context, _ *mcp.CallToolRequest, input setToggleInput) (*mcp.CallToolResult, operationResult, error) {
	result, err := t.changeHostSetting(ctx, hostSetting{
		capability: "settings", command: "bt_set_ancs_content", fields: map[string]any{"enabled": input.Enabled}, expected: input.Enabled,
		get: func(s *hostSettings) any { return boolValue(s.ANCSContentEnabled) },
		requires: func(s *hostSettings) error {
			if err := bonded(s); err != nil {
				return err
			}
			if s.ANCSEnabled == nil || !*s.ANCSEnabled {
				return errors.New("turn notification mirroring on before changing notification content")
			}
			return nil
		},
	})
	return nil, result, err
}

func (t *Set) setCallControl(ctx context.Context, _ *mcp.CallToolRequest, input setToggleInput) (*mcp.CallToolResult, operationResult, error) {
	result, err := t.changeHostSetting(ctx, hostSetting{
		capability: "settings", command: "bt_set_calls", fields: map[string]any{"enabled": input.Enabled}, expected: input.Enabled,
		get: func(s *hostSettings) any { return boolValue(s.CallsEnabled) }, requires: bonded,
	})
	return nil, result, err
}

func (t *Set) setMessageRetention(ctx context.Context, _ *mcp.CallToolRequest, input setRetentionInput) (*mcp.CallToolResult, operationResult, error) {
	setting := hostSetting{
		capability: "settings", command: "bt_set_retention", fields: map[string]any{"retention": input.Retention}, expected: input.Retention,
		get: func(s *hostSettings) any { return stringValue(s.Retention) }, requires: bondedHost,
	}
	var summary string
	switch input.Retention {
	case "encrypted":
		result, err := t.changeHostSetting(ctx, setting)
		return nil, result, err
	case "none":
		summary = "Permanently delete the host's retained message history and contacts and stop keeping them across restarts. This cannot be undone."
	case "plaintext":
		summary = "Store messages and contacts as readable, unencrypted files on the tetherd host."
	default:
		return nil, operationResult{}, errors.New("retention must be encrypted, plaintext or none")
	}
	// Check availability before asking, so an impossible change is never offered.
	t.mu.Lock()
	err := t.featureReady(setting.capability)
	if err == nil && t.host == nil {
		err = errors.New("host settings are not loaded yet; call get_settings")
	}
	if err == nil {
		err = setting.requires(t.host)
	}
	t.mu.Unlock()
	if err != nil {
		return nil, operationResult{}, err
	}
	result, err := t.ask(summary, func(ctx context.Context) (operationResult, error) {
		return t.changeHostSetting(ctx, setting)
	})
	return nil, result, err
}
