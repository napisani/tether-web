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

type connectionStatus struct {
	MAPOpen       bool   `json:"map_open"`
	PBAPOpen      bool   `json:"pbap_open"`
	ANCSReady     bool   `json:"ancs_ready"`
	LinkReason    string `json:"link_reason,omitempty"`
	ProfileReason string `json:"profile_reason,omitempty"`
	MAPError      string `json:"map_error,omitempty"`
	PBAPError     string `json:"pbap_error,omitempty"`
	ANCSReason    string `json:"ancs_reason,omitempty"`
}

type sendMessageCommand struct {
	Command     string `json:"command"`
	Thread      string `json:"thread"`
	Body        string `json:"body"`
	OperationID string `json:"operation_id"`
}
