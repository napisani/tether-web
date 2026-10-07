package tools

type protocolInfo struct {
	Version      int      `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type bluetoothStatus struct {
	Available     bool   `json:"available"`
	Enabled       *bool  `json:"enabled,omitempty"`
	DeviceAddress string `json:"device_address,omitempty"`
	Version       string `json:"version,omitempty"`
	Error         string `json:"error,omitempty"`
}

// hostSettings holds the daemon-global fields of bt_status that the web
// Settings and Devices views read and change.
type hostSettings struct {
	Available          bool   `json:"available"`
	Enabled            *bool  `json:"enabled,omitempty"`
	DeviceAddress      string `json:"device_address,omitempty"`
	ANCSEnabled        *bool  `json:"ancs_enabled,omitempty"`
	ANCSContentEnabled *bool  `json:"ancs_content_enabled,omitempty"`
	CallsEnabled       *bool  `json:"calls_enabled,omitempty"`
	Retention          string `json:"retention,omitempty"`
	RetentionReady     *bool  `json:"retention_ready,omitempty"`
	AirPodsEnabled     *bool  `json:"airpods_enabled,omitempty"`
	AirPodsPause       string `json:"airpods_pause,omitempty"`
	AirPodsHandoff     *bool  `json:"airpods_handoff,omitempty"`
}

type callStatus struct {
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`
	Audio     string   `json:"audio,omitempty"`
	Operator  string   `json:"operator,omitempty"`
	Service   *bool    `json:"service,omitempty"`
	Signal    *float64 `json:"signal,omitempty"`
	Roaming   *bool    `json:"roaming,omitempty"`
	Battery   *float64 `json:"battery,omitempty"`
}

type connectionStatus struct {
	MAPOpen       bool        `json:"map_open"`
	PBAPOpen      bool        `json:"pbap_open"`
	ANCSReady     bool        `json:"ancs_ready"`
	LinkReason    string      `json:"link_reason,omitempty"`
	ProfileReason string      `json:"profile_reason,omitempty"`
	MAPError      string      `json:"map_error,omitempty"`
	PBAPError     string      `json:"pbap_error,omitempty"`
	ANCSReason    string      `json:"ancs_reason,omitempty"`
	Calls         *callStatus `json:"calls,omitempty"`
}

type sendMessageCommand struct {
	Command     string `json:"command"`
	Thread      string `json:"thread"`
	Body        string `json:"body"`
	OperationID string `json:"operation_id"`
}
