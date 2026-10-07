package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestMarkMessagesReadIsObservedNotAttributed(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.markMessagesRead(t.Context(), nil, markReadInput{Handles: []string{"h1", "h2"}})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(started, statusPending)
	command := p.last("bt_mark_read")
	if command["read"] != true || len(command["handles"].([]any)) != 2 {
		t.Fatalf("command = %v", command)
	}
	p.feed(map[string]any{"command": "bt_message_read", "handles": []string{"h1"}, "read": true, "success": true})
	p.wantStatus(p.operation(started.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_message_read", "handles": []string{"h1", "h2"}, "read": true, "success": true})
	p.wantStatus(p.operation(started.OperationID), statusObserved)
	for _, handles := range [][]string{nil, {""}, make([]string, maxReadHandles+1)} {
		if _, _, err := p.set.markMessagesRead(t.Context(), nil, markReadInput{Handles: handles}); err == nil {
			t.Fatalf("invalid handles %v accepted", handles)
		}
	}
}

func TestMarkMessagesReadIgnoresUnreadAndMissingReadState(t *testing.T) {
	for _, test := range []struct {
		name string
		read any
	}{
		{name: "unread", read: false},
		{name: "missing read state"},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := newParity(t)
			_, started, err := p.set.markMessagesRead(t.Context(), nil, markReadInput{Handles: []string{"h1"}})
			if err != nil {
				t.Fatal(err)
			}
			event := map[string]any{"command": "bt_message_read", "handles": []string{"h1"}, "success": true}
			if test.read != nil {
				event["read"] = test.read
			}
			p.feed(event)
			p.wantStatus(p.operation(started.OperationID), statusPending)
			event["read"] = true
			p.feed(event)
			p.wantStatus(p.operation(started.OperationID), statusObserved)
		})
	}
}

func TestMarkMessagesReadFailureIsReportedNotCorrelated(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.markMessagesRead(t.Context(), nil, markReadInput{Handles: []string{"h1"}})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_message_read", "handles": []string{"h1"}, "read": true, "success": false, "message": "phone busy"})
	got := p.operation(started.OperationID)
	p.wantStatus(got, statusReported)
	if got.Message != "phone busy" {
		t.Fatalf("message = %q", got.Message)
	}
}

func TestDismissNotificationChecksCurrentStateThenObservesResult(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_notifications"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_notifications", "notifications": []map[string]any{
			{"uid": 7, "title": "Hi", "negative_action": true}, {"uid": 8, "title": "Sticky"},
		}}}
	}
	if _, _, err := p.set.dismissNotification(t.Context(), nil, dismissNotificationInput{UID: 8}); err == nil {
		t.Fatal("an undismissable notification was dispatched")
	}
	if _, _, err := p.set.dismissNotification(t.Context(), nil, dismissNotificationInput{UID: 99}); err == nil {
		t.Fatal("a missing notification was dispatched")
	}
	if _, _, err := p.set.dismissNotification(t.Context(), nil, dismissNotificationInput{UID: -1}); err == nil {
		t.Fatal("an invalid uid was accepted")
	}
	if p.count("bt_notification_action") != 0 {
		t.Fatal("a rejected dismissal still sent a command")
	}
	_, started, err := p.set.dismissNotification(t.Context(), nil, dismissNotificationInput{UID: 7})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(started, statusPending)
	if got := p.last("bt_notification_action"); got["uid"] != float64(7) || got["action"] != "negative" {
		t.Fatalf("command = %v", got)
	}
	p.feed(map[string]any{"command": "bt_notification_action_result", "uid": 8, "success": true})
	p.wantStatus(p.operation(started.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_notification_action_result", "uid": 7, "success": false})
	p.wantStatus(p.operation(started.OperationID), statusReported)
	p.feed(map[string]any{"command": "bt_notification_removed", "uid": 7})
	p.wantStatus(p.operation(started.OperationID), statusObserved)
}

func TestDialCallNeverResolvesFromUnattributedSuccessAndNeverRepeats(t *testing.T) {
	p := newParity(t)
	input := dialCallInput{InstanceID: p.set.instanceID, RequestKey: "dial-1", Number: "+1 (555) 010-0123"}
	_, first, err := p.set.dialCall(t.Context(), nil, input)
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(first, statusPending)
	if got := p.last("bt_call_dial"); got["number"] != "+1 (555) 010-0123" {
		t.Fatalf("command = %v", got)
	}
	p.feed(map[string]any{"command": "bt_call_result", "action": "dial", "success": true})
	p.wantStatus(p.operation(first.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_calls", "calls": []map[string]any{{"path": "/c/1", "number": "+15559999999", "outgoing": true, "state": "dialing"}}})
	p.wantStatus(p.operation(first.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_calls", "calls": []map[string]any{{"path": "/c/2", "number": "15550100123", "outgoing": true, "state": "dialing"}}})
	p.wantStatus(p.operation(first.OperationID), statusObserved)
	_, repeated, err := p.set.dialCall(t.Context(), nil, input)
	if err != nil || repeated.OperationID != first.OperationID || p.count("bt_call_dial") != 1 {
		t.Fatalf("retry dispatched again: %+v, error = %v, dials = %d", repeated, err, p.count("bt_call_dial"))
	}
	input.Number = "+15550000000"
	if _, _, err := p.set.dialCall(t.Context(), nil, input); err == nil {
		t.Fatal("a changed number reused a request key")
	}
}

func TestDialCallReportsDaemonFailureAndRequiresInstance(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.dialCall(t.Context(), nil, dialCallInput{InstanceID: p.set.instanceID, RequestKey: "dial-2", Number: "911"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_call_result", "action": "dial", "success": false, "message": "no signal"})
	got := p.operation(started.OperationID)
	p.wantStatus(got, statusReported)
	if !strings.Contains(got.Message, "no signal") || !strings.Contains(got.Message, "not attributed") {
		t.Fatalf("message = %q", got.Message)
	}
	if _, _, err := p.set.dialCall(t.Context(), nil, dialCallInput{InstanceID: "previous-process", RequestKey: "dial-3", Number: "911"}); err == nil {
		t.Fatal("a stale instance dialed")
	}
	if _, _, err := p.set.dialCall(t.Context(), nil, dialCallInput{InstanceID: p.set.instanceID, RequestKey: "dial-4", Number: " "}); err == nil {
		t.Fatal("a blank number dialed")
	}
}

func TestDialCallBecomesUnknownWhenConnectionLost(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.dialCall(t.Context(), nil, dialCallInput{InstanceID: p.set.instanceID, RequestKey: "dial-5", Number: "5550100"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_connection_changed", "map_open": true, "ancs_ready": true, "calls": map[string]any{"available": false, "reason": "hfp lost"}})
	got := p.operation(started.OperationID)
	p.wantStatus(got, statusUnknown)
	if !strings.Contains(got.Message, "Check before retrying") {
		t.Fatalf("message = %q", got.Message)
	}
}

func TestControlCallValidatesAgainstCurrentCallsAndObservesState(t *testing.T) {
	p := newParity(t)
	calls := []map[string]any{{"path": "/c/ring", "ringing": true, "state": "incoming"}, {"path": "/c/done", "state": "disconnected"}}
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": calls}}
	}
	for name, input := range map[string]controlCallInput{
		"no path":             {Action: "answer"},
		"unknown call":        {Action: "hangup", CallPath: "/c/none"},
		"ended call":          {Action: "hangup", CallPath: "/c/done"},
		"answer not ringing":  {Action: "answer", CallPath: "/c/done"},
		"bad action":          {Action: "mute", CallPath: "/c/ring"},
		"audio already phone": {Action: "audio_phone"},
	} {
		if _, _, err := p.set.controlCall(t.Context(), nil, input); err == nil {
			t.Fatalf("%s was dispatched", name)
		}
	}
	if p.count("bt_call_action") != 0 {
		t.Fatal("a rejected call action still sent a command")
	}
	_, answer, err := p.set.controlCall(t.Context(), nil, controlCallInput{Action: "answer", CallPath: "/c/ring"})
	if err != nil {
		t.Fatal(err)
	}
	if got := p.last("bt_call_action"); got["action"] != "answer" || got["path"] != "/c/ring" {
		t.Fatalf("command = %v", got)
	}
	p.feed(map[string]any{"command": "bt_call_result", "action": "answer", "success": true})
	p.wantStatus(p.operation(answer.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_calls", "calls": []map[string]any{{"path": "/c/ring", "ringing": true}}})
	p.wantStatus(p.operation(answer.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_calls", "calls": []map[string]any{{"path": "/c/ring", "connected": true, "state": "active"}}})
	p.wantStatus(p.operation(answer.OperationID), statusObserved)

	_, audio, err := p.set.controlCall(t.Context(), nil, controlCallInput{Action: "audio_here"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_connection_changed", "map_open": true, "pbap_open": true, "ancs_ready": true, "calls": map[string]any{"available": true, "audio": "active"}})
	p.wantStatus(p.operation(audio.OperationID), statusObserved)
}

func TestControlCallAudioNeedsAvailableKnownRouting(t *testing.T) {
	for _, test := range []struct {
		name      string
		action    string
		available bool
		audio     string
		want      operationStatus
	}{
		{name: "phone audio disconnected", action: "audio_phone", audio: "idle", want: statusUnknown},
		{name: "host audio disconnected", action: "audio_here", audio: "active", want: statusUnknown},
		{name: "phone audio missing", action: "audio_phone", available: true, want: statusPending},
		{name: "phone audio pending", action: "audio_phone", available: true, audio: "pending", want: statusPending},
		{name: "phone audio unrecognized", action: "audio_phone", available: true, audio: "unrecognized", want: statusPending},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := newParity(t)
			connection := openConnection()
			initialAudio, requestedAudio := "active", "idle"
			if test.action == "audio_here" {
				initialAudio, requestedAudio = "idle", "active"
			}
			connection["calls"] = map[string]any{"available": true, "audio": initialAudio}
			p.feed(connection)
			_, started, err := p.set.controlCall(t.Context(), nil, controlCallInput{Action: test.action})
			if err != nil {
				t.Fatal(err)
			}
			connection["calls"] = map[string]any{"available": test.available, "audio": test.audio}
			p.feed(connection)
			p.wantStatus(p.operation(started.OperationID), test.want)
			connection["calls"] = map[string]any{"available": true, "audio": requestedAudio}
			p.feed(connection)
			p.wantStatus(p.operation(started.OperationID), statusObserved)
		})
	}
}

func TestControlCallReportsDaemonFailure(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []map[string]any{{"path": "/c/1", "connected": true, "state": "active"}}}}
	}
	_, started, err := p.set.controlCall(t.Context(), nil, controlCallInput{Action: "hangup", CallPath: "/c/1"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_call_result", "action": "hangup", "success": false, "message": "refused"})
	p.wantStatus(p.operation(started.OperationID), statusReported)
}

func TestToggleSettingsRespectDependenciesAndAlreadySet(t *testing.T) {
	p := newParity(t)
	sent := len(p.sent)
	_, same, err := p.set.setNotificationMirroring(t.Context(), nil, setToggleInput{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(same, statusObserved)
	if len(p.sent) != sent {
		t.Fatal("an unchanged setting contacted tetherd")
	}
	_, changing, err := p.set.setNotificationContent(t.Context(), nil, setToggleInput{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(changing, statusPending)
	if got := p.last("bt_set_ancs_content"); got["enabled"] != true {
		t.Fatalf("command = %v", got)
	}
	unrelated := connectedStatus()
	p.feed(unrelated)
	p.wantStatus(p.operation(changing.OperationID), statusPending)
	changed := connectedStatus()
	changed["ancs_content_enabled"] = true
	p.feed(changed)
	p.wantStatus(p.operation(changing.OperationID), statusObserved)

	off := connectedStatus()
	off["ancs_enabled"] = false
	p.feed(off)
	if _, _, err := p.set.setNotificationContent(t.Context(), nil, setToggleInput{Enabled: false}); err == nil {
		t.Fatal("content changed while mirroring is off")
	}
	unbonded := connectedStatus()
	delete(unbonded, "device_address")
	p.feed(unbonded)
	if _, _, err := p.set.setCallControl(t.Context(), nil, setToggleInput{Enabled: false}); err == nil {
		t.Fatal("call control changed with no bonded iPhone")
	}
}

func TestSettingChangeTimesOutAsUnknownAndLaterStatusResolvesIt(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.setCallControl(t.Context(), nil, setToggleInput{Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	p.set.mu.Lock()
	p.set.expireOperations(p.set.operations[started.OperationID].deadline)
	p.set.mu.Unlock()
	p.wantStatus(p.operation(started.OperationID), statusUnknown)
	changed := connectedStatus()
	changed["calls_enabled"] = false
	p.feed(changed)
	p.wantStatus(p.operation(started.OperationID), statusObserved)
}

func TestSettingsRefuseUnreportedFields(t *testing.T) {
	p := newParity(t)
	old := connectedStatus()
	delete(old, "calls_enabled")
	p.feed(old)
	if _, _, err := p.set.setCallControl(t.Context(), nil, setToggleInput{Enabled: true}); err == nil || !strings.Contains(err.Error(), "does not report") {
		t.Fatalf("unsupported setting error = %v", err)
	}
}

func TestRetentionChangesNeedConfirmationAndRunExactlyOnce(t *testing.T) {
	p := newParity(t)
	sent := len(p.sent)
	_, ask, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(ask, statusConfirmation)
	if ask.ChallengeID == "" || !strings.Contains(ask.Summary, "Permanently delete") || ask.OperationID != "" {
		t.Fatalf("challenge = %+v", ask)
	}
	if len(p.sent) != sent {
		t.Fatal("a command was sent before approval")
	}
	_, approved, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(approved, statusPending)
	if got := p.last("bt_set_retention"); got["retention"] != "none" {
		t.Fatalf("command = %v", got)
	}
	_, again, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
	if err != nil || again.OperationID != approved.OperationID || p.count("bt_set_retention") != 1 {
		t.Fatalf("repeated approval = %+v, error = %v, sends = %d", again, err, p.count("bt_set_retention"))
	}
	changed := connectedStatus()
	changed["retention"] = "none"
	p.feed(changed)
	p.wantStatus(p.operation(approved.OperationID), statusObserved)
}

func TestApprovedConfirmationCannotBeRejected(t *testing.T) {
	p := newParity(t)
	_, ask, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"})
	if err != nil {
		t.Fatal(err)
	}
	_, approved, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	_, rejected, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "reject"})
	if err != nil || rejected != approved {
		t.Fatalf("rejection after approval = %+v, error = %v, want %+v", rejected, err, approved)
	}
	_, again, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
	if err != nil || again != approved || p.count("bt_set_retention") != 1 {
		t.Fatalf("approval after rejection = %+v, error = %v, sends = %d", again, err, p.count("bt_set_retention"))
	}
}

func TestInFlightConfirmationCannotBeRejected(t *testing.T) {
	p := newParity(t)
	_, ask, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	writing, resume := make(chan struct{}), make(chan struct{})
	send := p.bus.onSend
	p.bus.onSend = func(data json.RawMessage) error {
		err := send(data)
		close(writing)
		<-resume
		return err
	}
	type approval struct {
		result operationResult
		err    error
	}
	done := make(chan approval, 1)
	go func() {
		_, result, err := p.set.confirmAction(ctx, nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
		done <- approval{result: result, err: err}
	}()
	defer func() {
		close(resume)
		approved := <-done
		if approved.err != nil {
			t.Errorf("approval failed: %v", approved.err)
			return
		}
		_, again, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
		if err != nil || again != approved.result || p.count("bt_set_retention") != 1 {
			t.Errorf("repeated approval = %+v, error = %v, sends = %d", again, err, p.count("bt_set_retention"))
		}
	}()
	select {
	case <-writing:
	case <-ctx.Done():
		t.Fatal("approval did not start writing")
	}
	if _, result, err := p.set.confirmAction(ctx, nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "reject"}); err == nil {
		t.Fatalf("in-flight rejection = %+v, want an error", result)
	}
}

func TestRetentionEncryptedNeedsNoConfirmationAndPlaintextDoes(t *testing.T) {
	p := newParity(t)
	plain := connectedStatus()
	plain["retention"] = "plaintext"
	p.feed(plain)
	_, direct, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "encrypted"})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(direct, statusPending)
	p.feed(connectedStatus())
	_, ask, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "plaintext"})
	if err != nil || ask.Status != statusConfirmation || !strings.Contains(ask.Summary, "unencrypted") {
		t.Fatalf("plaintext = %+v, error = %v", ask, err)
	}
	if _, _, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "forever"}); err == nil {
		t.Fatal("an unknown retention was accepted")
	}
}

func TestConfirmationRejectionExpiryAndConnectionChange(t *testing.T) {
	p := newParity(t)
	ask := func() operationResult {
		_, result, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	rejected := ask()
	_, cancelled, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: rejected.ChallengeID, Decision: "reject"})
	if err != nil || cancelled.Status != statusCancelled || p.count("bt_set_retention") != 0 {
		t.Fatalf("rejection = %+v, error = %v", cancelled, err)
	}
	if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: rejected.ChallengeID, Decision: "approve"}); err == nil {
		t.Fatal("a rejected challenge was approved")
	}
	expired := ask()
	p.set.mu.Lock()
	p.set.expireChallenges(expired.ExpiresAt)
	p.set.mu.Unlock()
	if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: expired.ChallengeID, Decision: "approve"}); err == nil {
		t.Fatal("an expired challenge was approved")
	}
	stale := ask()
	p.bus.mu.Lock()
	p.bus.generation++
	p.bus.mu.Unlock()
	if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: stale.ChallengeID, Decision: "approve"}); err == nil {
		t.Fatal("a challenge survived a connection change")
	}
	if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: "chal-unknown", Decision: "approve"}); err == nil {
		t.Fatal("an unknown challenge was approved")
	}
	if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: stale.ChallengeID, Decision: "maybe"}); err == nil {
		t.Fatal("an invalid decision was accepted")
	}
	if p.count("bt_set_retention") != 0 {
		t.Fatal("an unapproved retention change was sent")
	}
}

func TestApprovedConfirmationsDoNotCountAsPending(t *testing.T) {
	p := newParity(t)
	for range maxChallenges + 2 {
		_, ask, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"})
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "reject"}); err != nil {
			t.Fatal(err)
		}
	}
	for range maxChallenges {
		_, ask, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"})
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"}); err != nil {
			t.Fatal(err)
		}
		p.feed(connectedStatus())
	}
}

func TestPendingConfirmationsAreBounded(t *testing.T) {
	p := newParity(t)
	for range maxChallenges {
		if _, _, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := p.set.setMessageRetention(t.Context(), nil, setRetentionInput{Retention: "none"}); err == nil {
		t.Fatal("unbounded pending confirmations")
	}
}

func TestBluetoothPairingRequiresPersonVerifiedCode(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.pairBluetoothDevice(t.Context(), nil, addressInput{Address: "11:22"})
	if err != nil {
		t.Fatal(err)
	}
	command := p.last("bt_pair")
	if command["address"] != "11:22" || command["operation_id"] != started.OperationID {
		t.Fatalf("command = %v", command)
	}
	if _, _, err := p.set.confirmPairing(t.Context(), nil, confirmPairingInput{OperationID: started.OperationID, CodesMatch: true}); err == nil {
		t.Fatal("pairing was confirmed before a code was shown")
	}
	p.feed(map[string]any{"command": "bt_pair_progress", "operation_id": "someone-else", "step": "connecting", "detail": "x"})
	p.feed(map[string]any{"command": "bt_pair_progress", "operation_id": started.OperationID, "step": "pairing", "detail": "11:22"})
	progress := p.operation(started.OperationID)
	p.wantStatus(progress, statusPending)
	if !strings.Contains(progress.Message, "pairing") {
		t.Fatalf("progress message = %q", progress.Message)
	}
	p.feed(map[string]any{"command": "bt_pair_confirm_request", "operation_id": "someone-else", "code": "000000"})
	p.wantStatus(p.operation(started.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_pair_confirm_request", "operation_id": started.OperationID, "code": "123456"})
	waiting := p.operation(started.OperationID)
	p.wantStatus(waiting, statusNeedsPairing)
	if waiting.PairingCode != "123456" {
		t.Fatalf("code = %q", waiting.PairingCode)
	}
	p.feed(map[string]any{"command": "bt_pair_progress", "operation_id": started.OperationID, "step": "confirm", "detail": ""})
	if got := p.operation(started.OperationID); got.Status != statusNeedsPairing || got.PairingCode != "123456" {
		t.Fatalf("late progress hid the code: %+v", got)
	}
	_, sentAnswer, err := p.set.confirmPairing(t.Context(), nil, confirmPairingInput{OperationID: started.OperationID, CodesMatch: true})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(sentAnswer, statusPending)
	if got := p.last("bt_pair_confirm"); got["accept"] != true || got["operation_id"] != started.OperationID {
		t.Fatalf("confirmation = %v", got)
	}
	if _, _, err := p.set.confirmPairing(t.Context(), nil, confirmPairingInput{OperationID: started.OperationID, CodesMatch: true}); err == nil {
		t.Fatal("pairing was confirmed twice")
	}
	p.feed(map[string]any{"command": "bt_pair_result", "operation_id": started.OperationID, "success": true, "status": "paired", "message": "Paired"})
	p.wantStatus(p.operation(started.OperationID), statusSuccess)
}

func TestBluetoothPairingRejectionAndDisconnect(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.pairBluetoothDevice(t.Context(), nil, addressInput{Address: "11:22"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_pair_confirm_request", "operation_id": started.OperationID, "code": "654321"})
	if _, _, err := p.set.confirmPairing(t.Context(), nil, confirmPairingInput{OperationID: started.OperationID, CodesMatch: false}); err != nil {
		t.Fatal(err)
	}
	if got := p.last("bt_pair_confirm"); got["accept"] != false {
		t.Fatalf("rejection = %v", got)
	}
	p.feed(map[string]any{"command": "bt_pair_result", "operation_id": started.OperationID, "success": false, "status": "rejected", "message": "Rejected"})
	p.wantStatus(p.operation(started.OperationID), statusFailure)

	_, second, err := p.set.pairBluetoothDevice(t.Context(), nil, addressInput{Address: "33:44"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_pair_confirm_request", "operation_id": second.OperationID, "code": "111111"})
	p.set.applyStatusEvent(gatewayStatus(2, false), "gateway_status")
	got := p.operation(second.OperationID)
	p.wantStatus(got, statusUnknown)
	if got.PairingCode != "" {
		t.Fatal("a code survived a lost connection")
	}
	if _, _, err := p.set.confirmPairing(t.Context(), nil, confirmPairingInput{OperationID: second.OperationID, CodesMatch: true}); err == nil {
		t.Fatal("a lost pairing was confirmed")
	}
}

func TestUnpairNeedsConfirmationAndCorrelatesResult(t *testing.T) {
	p := newParity(t)
	_, ask, err := p.set.unpairBluetoothDevice(t.Context(), nil, addressInput{Address: "11:22"})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(ask, statusConfirmation)
	if p.count("bt_unpair") != 0 {
		t.Fatal("unpair was sent before approval")
	}
	_, started, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	command := p.last("bt_unpair")
	if command["address"] != "11:22" || command["operation_id"] != started.OperationID {
		t.Fatalf("command = %v", command)
	}
	p.feed(map[string]any{"command": "bt_unpair_result", "operation_id": "other", "success": true, "message": "x"})
	p.wantStatus(p.operation(started.OperationID), statusPending)
	p.feed(map[string]any{"command": "bt_unpair_result", "operation_id": started.OperationID, "success": true, "message": "Removed"})
	p.wantStatus(p.operation(started.OperationID), statusSuccess)
}

func TestBluetoothActionsObserveUnattributedResults(t *testing.T) {
	p := newParity(t)
	_, scan, err := p.set.scanBluetooth(t.Context(), nil, struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_scan_result", "success": true, "message": "done"})
	p.wantStatus(p.operation(scan.OperationID), statusObserved)
	_, solicit, err := p.set.requestPhonePermissions(t.Context(), nil, struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_solicit_result", "success": false, "message": "all profiles are already open"})
	got := p.operation(solicit.OperationID)
	p.wantStatus(got, statusReported)
	if !strings.Contains(got.Message, "already open") {
		t.Fatalf("message = %q", got.Message)
	}
	_, enable, err := p.set.setBluetoothEnabled(t.Context(), nil, setToggleInput{Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	off := connectedStatus()
	off["enabled"] = false
	p.feed(off)
	p.wantStatus(p.operation(enable.OperationID), statusObserved)
}

func TestPeerTrustChangesNeedConfirmationAndOnlyTargetKnownDevices(t *testing.T) {
	p := newParity(t)
	p.answers["state_snapshot"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "state_snapshot",
			"paired_devices":     []map[string]any{{"fingerprint": "paired-fp", "device_name": "Desktop"}},
			"pending_pairs":      []map[string]any{{"fingerprint": "pending-fp", "device_name": "Tablet"}},
			"connected_clients":  []any{},
			"discovered_devices": []map[string]any{{"name": "Laptop", "fingerprint": "near-fp", "addresses": []map[string]any{{"address": "192.0.2.7", "port": 5134}}}, {"name": "NoAddr", "fingerprint": "no-address", "addresses": []any{}}},
			"mdns_available":     true, "firewall_active": false}}
	}
	for name, call := range map[string]func() error{
		"unknown pair": func() error {
			_, _, err := p.set.pairPeer(t.Context(), nil, peerInput{Fingerprint: "ghost"})
			return err
		},
		"no address pair": func() error {
			_, _, err := p.set.pairPeer(t.Context(), nil, peerInput{Fingerprint: "no-address"})
			return err
		},
		"unknown accept": func() error {
			_, _, err := p.set.acceptPeer(t.Context(), nil, peerInput{Fingerprint: "paired-fp"})
			return err
		},
		"unknown forget": func() error {
			_, _, err := p.set.forgetPeer(t.Context(), nil, peerInput{Fingerprint: "ghost"})
			return err
		},
		"blank fingerprint": func() error { _, _, err := p.set.forgetPeer(t.Context(), nil, peerInput{Fingerprint: " "}); return err },
	} {
		if call() == nil {
			t.Fatalf("%s was offered", name)
		}
	}
	_, pairAsk, err := p.set.pairPeer(t.Context(), nil, peerInput{Fingerprint: "near-fp"})
	if err != nil || pairAsk.Status != statusConfirmation || !strings.Contains(pairAsk.Summary, "192.0.2.7:5134") {
		t.Fatalf("pair challenge = %+v, error = %v", pairAsk, err)
	}
	if p.count("pair_request") != 0 {
		t.Fatal("pair_request was sent before approval")
	}
	_, pair, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: pairAsk.ChallengeID, Decision: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	if got := p.last("pair_request"); got["host"] != "192.0.2.7" || got["port"] != float64(5134) || got["device_name"] != "Laptop" {
		t.Fatalf("pair_request = %v", got)
	}
	p.feed(map[string]any{"command": "pair_outbound_pending", "fingerprint": "other-fp", "device_name": "x", "address": "y"})
	p.wantStatus(p.operation(pair.OperationID), statusPending)
	p.feed(map[string]any{"command": "pair_rejected", "fingerprint": "near-fp", "device_name": "Laptop", "reason": "declined"})
	got := p.operation(pair.OperationID)
	p.wantStatus(got, statusReported)
	if got.Message != "declined" {
		t.Fatalf("message = %q", got.Message)
	}

	_, acceptAsk, err := p.set.acceptPeer(t.Context(), nil, peerInput{Fingerprint: "pending-fp"})
	if err != nil || acceptAsk.Status != statusConfirmation {
		t.Fatalf("accept challenge = %+v, error = %v", acceptAsk, err)
	}
	_, accept, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: acceptAsk.ChallengeID, Decision: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	if got := p.last("accept_device"); got["fingerprint"] != "pending-fp" || got["device_name"] != "Tablet" {
		t.Fatalf("accept_device = %v", got)
	}
	p.feed(map[string]any{"command": "pair_accepted", "fingerprint": "pending-fp", "connected": true})
	p.wantStatus(p.operation(accept.OperationID), statusObserved)

	_, forgetAsk, err := p.set.forgetPeer(t.Context(), nil, peerInput{Fingerprint: "paired-fp"})
	if err != nil || forgetAsk.Status != statusConfirmation {
		t.Fatalf("forget challenge = %+v, error = %v", forgetAsk, err)
	}
	_, forget, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: forgetAsk.ChallengeID, Decision: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "forget_device_result", "fingerprint": "paired-fp", "forgotten": true})
	p.wantStatus(p.operation(forget.OperationID), statusObserved)
}

func TestPeerTrustOperationsIgnoreOtherActions(t *testing.T) {
	for _, test := range []struct {
		name       string
		start      func(*Set, context.Context, peerInput) (operationResult, error)
		unrelated  []string
		completion string
	}{
		{
			name: "pair",
			start: func(set *Set, ctx context.Context, input peerInput) (operationResult, error) {
				_, result, err := set.pairPeer(ctx, nil, input)
				return result, err
			},
			unrelated: []string{"forget_device_result"}, completion: "pair_accepted",
		},
		{
			name: "accept",
			start: func(set *Set, ctx context.Context, input peerInput) (operationResult, error) {
				_, result, err := set.acceptPeer(ctx, nil, input)
				return result, err
			},
			unrelated: []string{"forget_device_result", "pair_outbound_pending"}, completion: "pair_accepted",
		},
		{
			name: "forget",
			start: func(set *Set, ctx context.Context, input peerInput) (operationResult, error) {
				_, result, err := set.forgetPeer(ctx, nil, input)
				return result, err
			},
			unrelated: []string{"pair_accepted", "pair_rejected", "pair_outbound_pending"}, completion: "forget_device_result",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := newParity(t)
			p.answers["state_snapshot"] = func(map[string]any) []map[string]any {
				return []map[string]any{{"command": "state_snapshot",
					"paired_devices": []map[string]any{{"fingerprint": "fp", "device_name": "Laptop"}},
					"pending_pairs":  []map[string]any{{"fingerprint": "fp", "device_name": "Laptop"}},
					"discovered_devices": []map[string]any{{"fingerprint": "fp", "name": "Laptop",
						"addresses": []map[string]any{{"address": "192.0.2.7", "port": 5134}}}},
				}}
			}
			ask, err := test.start(p.set, t.Context(), peerInput{Fingerprint: "fp"})
			if err != nil {
				t.Fatal(err)
			}
			_, started, err := p.set.confirmAction(t.Context(), nil, confirmInput{ChallengeID: ask.ChallengeID, Decision: "approve"})
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range test.unrelated {
				p.feed(map[string]any{"command": event, "fingerprint": "fp", "forgotten": true})
				if got := p.operation(started.OperationID); got != started {
					t.Fatalf("%s changed operation: %+v, want %+v", event, got, started)
				}
			}
			p.feed(map[string]any{"command": test.completion, "fingerprint": "fp", "forgotten": true})
			p.wantStatus(p.operation(started.OperationID), statusObserved)
		})
	}
}

func TestDiscoverPeersReturnsBoundedDevices(t *testing.T) {
	p := newParity(t)
	p.answers["discover"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "discovery_result", "devices": []map[string]any{{"name": "Laptop", "fingerprint": "fp", "addresses": []map[string]any{{"address": "192.0.2.7", "port": 5134}}}}}}
	}
	_, result, err := p.set.discoverPeers(t.Context(), nil, struct{}{})
	if err != nil || len(result.Devices) != 1 || result.Devices[0].Addresses[0].Port != 5134 {
		t.Fatalf("discovery = %+v, error = %v", result, err)
	}
}

func TestAirPodsNoiseControlNeedsLiveAirPodsAndObservesMode(t *testing.T) {
	p := newParity(t)
	status := "idle"
	mode := "off"
	p.answers["bt_airpods"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_airpods", "address": "CC:DD", "name": "Pods", "status": status, "anc": mode,
			"left": 1, "right": 1, "case": 1, "reason": "", "ear": map[string]any{"primary": "in_ear", "secondary": "in_ear"}}}
	}
	if _, _, err := p.set.setAirPodsNoiseControl(t.Context(), nil, airPodsModeInput{Mode: "anc"}); err == nil {
		t.Fatal("the mode changed while the AirPods were not live")
	}
	if _, _, err := p.set.setAirPodsNoiseControl(t.Context(), nil, airPodsModeInput{Mode: "loud"}); err == nil {
		t.Fatal("an invalid mode was accepted")
	}
	status = "live"
	_, same, err := p.set.setAirPodsNoiseControl(t.Context(), nil, airPodsModeInput{Mode: "off"})
	if err != nil || same.Status != statusObserved || p.count("bt_airpods_mode") != 0 {
		t.Fatalf("unchanged mode = %+v, error = %v", same, err)
	}
	_, started, err := p.set.setAirPodsNoiseControl(t.Context(), nil, airPodsModeInput{Mode: "anc"})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(started, statusPending)
	p.feed(map[string]any{"command": "bt_airpods", "address": "CC:DD", "name": "Pods", "status": "live", "anc": "anc", "left": 1, "right": 1, "case": 1, "reason": "", "ear": map[string]any{"primary": "in_ear", "secondary": "in_ear"}})
	p.wantStatus(p.operation(started.OperationID), statusObserved)
}

func TestAirPodsOptionsAndConnection(t *testing.T) {
	p := newParity(t)
	_, handoff, err := p.set.setAirPodsCallHandoff(t.Context(), nil, setToggleInput{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	changed := connectedStatus()
	changed["airpods_handoff"] = true
	p.feed(changed)
	p.wantStatus(p.operation(handoff.OperationID), statusObserved)

	if _, _, err := p.set.setAirPodsAutoPause(t.Context(), nil, airPodsPauseInput{Mode: "sometimes"}); err == nil {
		t.Fatal("an invalid auto-pause mode was accepted")
	}
	_, pause, err := p.set.setAirPodsAutoPause(t.Context(), nil, airPodsPauseInput{Mode: "both-removed"})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(pause, statusPending)
	_, managed, err := p.set.setAirPodsManaged(t.Context(), nil, setToggleInput{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	p.wantStatus(managed, statusObserved)

	_, connect, err := p.set.connectAirPods(t.Context(), nil, connectAirPodsInput{Address: "CC:DD", Connect: true})
	if err != nil {
		t.Fatal(err)
	}
	p.feed(map[string]any{"command": "bt_airpods_connect_result", "success": false, "message": "out of range"})
	p.wantStatus(p.operation(connect.OperationID), statusReported)
	if _, _, err := p.set.connectAirPods(t.Context(), nil, connectAirPodsInput{Address: " "}); err == nil {
		t.Fatal("a blank address was accepted")
	}
}

func TestOperationsCannotBeCompletedByPreviousConnectionEvents(t *testing.T) {
	p := newParity(t)
	_, started, err := p.set.setCallControl(t.Context(), nil, setToggleInput{Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	changed := connectedStatus()
	changed["calls_enabled"] = false
	data, _ := jsonMarshal(changed)
	p.set.applyStatusEvent(eventAt(0, data), "bt_status")
	p.wantStatus(p.operation(started.OperationID), statusPending)
	p.set.applyStatusEvent(eventAt(1, data), "bt_status")
	p.wantStatus(p.operation(started.OperationID), statusObserved)
}

func TestRejectedWritesNeverContactTetherd(t *testing.T) {
	p := newParity(t)
	sent := len(p.sent)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, err := p.set.setCallControl(ctx, nil, setToggleInput{Enabled: false}); err == nil {
		t.Fatal("a cancelled request dispatched")
	}
	if len(p.sent) != sent {
		t.Fatal("a cancelled request sent a command")
	}
}
